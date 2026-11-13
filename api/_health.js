// 6 AM daily health check. Each check returns { name, ok, detail } — ok:false is
// a problem (red in the email), ok:"warn" is worth a look, ok:true is fine.

import { google } from "googleapis";
import { admin, mintToken } from "./_auth.js";
import { gmailFor, rawSimpleEmail, LOCATION_EMAIL } from "./_gmail.js";
import { driveClient, getSetting, setSetting, STORES } from "./_drive.js";
import { etParts } from "./_backup.js";

export const REPORT_TO = process.env.OPS_REPORT_TO || "mike@ibfoods.com";
const storeName = (id) => STORES.find(s => s.id === id)?.name || id;

// Every server function, called without signing in. A working function answers
// "not signed in" / "missing info"; a broken one crashes (500) or times out.
const PROBES = [
  ["Email receipts", "POST", "/api/send-receipt", 401],
  ["Paper receipts", "POST", "/api/print-relay", 401],
  ["Stock alerts", "POST", "/api/notify-stock", 401],
  ["Sign-in (PIN/password)", "POST", "/api/auth/login", 400],
  ["Stay signed in", "POST", "/api/auth/refresh", 401],
  ["Staff list", "GET", "/api/users", 401],
  ["Gmail connect", "GET", "/api/auth/gmail", 400],
];

async function probe(base, [name, method, path, expect]) {
  try {
    const r = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined, signal: AbortSignal.timeout(15000),
    });
    return r.status === expect
      ? { ok: true }
      : { ok: false, detail: `${name} (${path}) answered ${r.status}${r.status >= 500 ? " — it is crashing" : ""}` };
  } catch (e) {
    return { ok: false, detail: `${name} (${path}) did not answer: ${e.name === "TimeoutError" ? "timed out" : e.message}` };
  }
}

export async function runHealth({ base }) {
  const checks = [];
  let stats = null;
  const add = (name, ok, detail, lines) => checks.push({ name, ok, detail, lines });

  // 1) Server functions load
  const probes = await Promise.all(PROBES.map(p => probe(base, p)));
  const bad = probes.filter(p => !p.ok);
  add("App server functions", bad.length === 0,
      bad.length ? `${bad.length} of ${PROBES.length} broken` : `All ${PROBES.length} working`, bad.map(b => b.detail));

  // 2) Sign-in tokens are accepted by the database, and the database is still locked without one
  try {
    const url = process.env.SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set");
    const token = mintToken({ id: "00000000-0000-0000-0000-000000000000", role: "clerk", location_id: "wantagh", name: "Daily check" }, 2);
    const signed = await fetch(`${url}/rest/v1/items?select=id&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    const signedRows = signed.ok ? await signed.json() : null;
    const open = await fetch(`${url}/rest/v1/customers?select=id&limit=1`, { headers: { apikey: anon }, signal: AbortSignal.timeout(10000) });
    const openRows = open.ok ? await open.json() : [];
    const problems = [];
    if (!signed.ok || !Array.isArray(signedRows) || signedRows.length === 0) problems.push(`A valid sign-in was refused by the database (status ${signed.status}). Staff may not be able to load orders — check SUPABASE_JWT_SECRET.`);
    if (Array.isArray(openRows) && openRows.length > 0) problems.push("The database is giving out customer data WITHOUT a sign-in. Security lock is off.");
    add("Sign-in & database lock", problems.length === 0, problems.length ? "Problem" : "Sign-ins accepted, locked without one", problems);
  } catch (e) { add("Sign-in & database lock", false, e.message); }

  // 3) Gmail per store (can each store still send?)
  const gmailLines = []; let gmailBad = 0;
  const { data: tokenRows } = await admin().from("gmail_tokens").select("location_id, refresh_token");
  const refreshFor = new Map((tokenRows || []).filter(r => r.refresh_token).map(r => [r.location_id, r.refresh_token]));
  await Promise.all(Object.keys(LOCATION_EMAIL).map(async (loc) => {
    if (!refreshFor.has(loc)) { gmailBad++; gmailLines.push(`${storeName(loc)}: not connected — receipts can't be emailed`); return; }
    try {
      // Same test as Admin → Gmail: can Google still give us a sending key?
      const c = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      c.setCredentials({ refresh_token: refreshFor.get(loc) });
      const { token } = await c.getAccessToken();
      if (!token) throw new Error("no key returned");
    } catch (e) {
      gmailBad++; gmailLines.push(`${storeName(loc)}: connection refused by Google (${e.message}). Reconnect in Admin → Gmail.`);
    }
  }));
  add("Store Gmail (receipts)", gmailBad === 0, gmailBad ? `${gmailBad} store(s) can't send` : "All 5 stores can send", gmailLines.sort());

  // 4) Data checks
  try {
    const { data: h, error } = await admin().rpc("ops_health");
    if (error) throw new Error(error.message);
    const lines = [];
    for (const d of h.duplicate_numbers) lines.push(`${storeName(d.location_id)} ${d.month}: #${d.number} is held by ${d.customers.join(" and ")}`);
    for (const o of h.orders_without_customer) lines.push(`${storeName(o.location_id)} #${o.number} (${o.customer}, pickup ${o.pickup_date}) isn't linked to a customer`);
    for (const o of h.orders_without_items) lines.push(`${storeName(o.location_id)} #${o.number} (${o.customer}, pickup ${o.pickup_date}) has no items`);
    for (const i of h.negative_inventory) lines.push(`${storeName(i.location_id)}: ${i.item} is oversold (${i.stock})`);
    add("Order data", lines.length === 0, lines.length ? `${lines.length} issue(s)` : "No duplicates, gaps or oversold items", lines);
    stats = h;
  } catch (e) { add("Order data", false, `Couldn't run data checks: ${e.message}`); }

  // 5) Receipt-printer relays: not checked. Stores are running printerless (Nov 13, 2026);
  //    the print code and relay stay in place, but an offline store PC isn't a problem to report.

  // 6) Backup
  try {
    const last = await getSetting("backup_last");
    const ageH = last?.at ? (Date.now() - new Date(last.at).getTime()) / 3.6e6 : Infinity;
    try { const { client } = await driveClient(); await client.getAccessToken(); }
    catch (e) { add("Backup Drive", false, "Not connected or refused", [e.message]); }
    if (!last) add("Last night's backup", false, "No backup has run yet");
    else if (last.ok === false) add("Last night's backup", false, "Failed", [last.error]);
    else if (ageH > 30) add("Last night's backup", false, `Last good backup was ${Math.round(ageH)} hours ago`);
    else add("Last night's backup", true, `${last.file} · ${Math.round(last.bytes / 1024)} KB · ${last.counts.orders} orders, ${last.counts.customers} customers`);
  } catch (e) { add("Last night's backup", false, e.message); }

  const problems = checks.filter(c => c.ok === false).length;
  const warnings = checks.filter(c => c.ok === "warn").length;
  return { at: new Date().toISOString(), date: etParts().date, problems, warnings, checks, stats };
}

// ── email ────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function reportEmail(rep) {
  const day = new Date(`${rep.date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const subject = rep.problems
    ? `⚠️ Butcher App: ${rep.problems} problem${rep.problems > 1 ? "s" : ""} — ${day}`
    : `✅ Butcher App: all good — ${day}`;
  const color = (ok) => ok === true ? "#1a7f37" : ok === "warn" ? "#9a6700" : "#b42318";
  const mark = (ok) => ok === true ? "✓" : ok === "warn" ? "!" : "✗";
  const rows = [...rep.checks].sort((a, b) => (a.ok === true) - (b.ok === true)).map(c => `
    <tr><td style="padding:8px 10px;color:${color(c.ok)};font-weight:700;vertical-align:top">${mark(c.ok)}</td>
        <td style="padding:8px 10px;vertical-align:top"><b>${esc(c.name)}</b> — ${esc(c.detail)}
        ${c.lines?.length ? `<ul style="margin:6px 0 0 18px;padding:0;color:#444">${c.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}</td></tr>`).join("");
  const s = rep.stats;
  const statLine = s ? `<p style="color:#555;font-size:13px">Upcoming pickups: ${Object.entries(s.upcoming_pickups).map(([k, v]) => `${esc(storeName(k))} ${v}`).join(", ") || "none"}.
    New orders yesterday: ${Object.entries(s.new_orders_yesterday).map(([k, v]) => `${esc(storeName(k))} ${v}`).join(", ") || "none"}.
    ${s.upcoming_without_email ? `${s.upcoming_without_email} upcoming order(s) have no customer email (older orders, before email was required).` : ""}</p>` : "";
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">${rep.problems ? `${rep.problems} problem${rep.problems > 1 ? "s" : ""} need attention` : "Everything is working"}</h2>
    <p style="color:#555;margin:0 0 12px">IB Butcher App daily check · ${esc(day)}</p>
    <table style="border-collapse:collapse;width:100%;border-top:1px solid #ddd">${rows}</table>
    ${statLine}
    <p style="color:#888;font-size:12px">Run it again any time: Admin → Backups → Run check now.</p></div>`;
  return { subject, html };
}

// Send through the first store Gmail that works (so one broken store can't silence the report).
export async function sendReport(rep) {
  const { subject, html } = reportEmail(rep);
  const order = ["woodbury", "wantagh", "nhp", "gardencity", "maspeth"];
  const errors = [];
  for (const loc of order) {
    try {
      const { gmail, from } = await gmailFor(loc);
      await gmail.users.messages.send({ userId: "me", requestBody: { raw: rawSimpleEmail({ from, to: REPORT_TO, subject, html, fromName: "IB Butcher App" }) } });
      return { sent: true, via: from };
    } catch (e) { errors.push(`${loc}: ${e.message}`); }
  }
  console.error("Daily report could not be emailed:", errors.join(" | "));
  return { sent: false, errors };
}

export async function recordHealth(rep, mail) {
  await setSetting("health_last", { at: rep.at, date: rep.date, problems: rep.problems, warnings: rep.warnings,
    checks: rep.checks.map(({ name, ok, detail, lines }) => ({ name, ok, detail, lines })), mail });
}
