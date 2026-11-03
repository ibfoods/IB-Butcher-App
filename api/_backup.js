// Nightly backup to the connected Drive.
//   Full backup/ib-butcher-backup-YYYY-MM-DD-HHMM.json  — everything, for restore
//   <Store>/"<Store> - upcoming orders"                  — readable pickup fallback

import { Readable } from "node:stream";
import { admin } from "./_auth.js";
import { driveClient, ensureFolders, getSetting, setSetting, STORES } from "./_drive.js";
import { orderNumberText, qtyText } from "./_order.js";

export const BACKUP_FORMAT = "ib-butcher-backup/1";
const KEEP_DAYS = 30;
const PAGE = 1000;

// "2026-11-04" and "0215" in the stores' time zone
export function etParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}${p.minute}`, hour: Number(p.hour) };
}

// Read every row of a table, page by page (the API returns at most 1000 at a time).
async function readAll(db, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// Builds the backup object from the database (no Drive involved — testable on its own).
export async function buildBackup(db = admin()) {
  const { data: tables, error: tErr } = await db.rpc("ops_backup_tables");
  if (tErr) throw new Error(`Listing tables failed: ${tErr.message}`);
  const { data: schema, error: sErr } = await db.rpc("ops_schema_ddl");
  if (sErr) throw new Error(`Schema snapshot failed: ${sErr.message}`);

  const names = (tables || []).map(t => (typeof t === "string" ? t : t.ops_backup_tables));
  const out = { format: BACKUP_FORMAT, created_at: new Date().toISOString(), created_et: etParts(), counts: {}, schema_sql: schema, tables: {} };
  for (const t of names) {
    out.tables[t] = await readAll(db, t);
    out.counts[t] = out.tables[t].length;
  }
  return out;
}

// ── per-store upcoming orders sheet ──────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmtPickup = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });
};
const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

export function upcomingOrdersCsv(backup, storeId, today) {
  const { orders = [], order_items = [], items = [], customers = [] } = backup.tables;
  const itemById = new Map(items.map(i => [i.id, i]));
  const custById = new Map(customers.map(c => [c.id, c]));
  const lines = new Map();
  for (const oi of order_items) {
    if (!lines.has(oi.order_id)) lines.set(oi.order_id, []);
    lines.get(oi.order_id).push(oi);
  }
  const rows = orders
    .filter(o => o.location_id === storeId && (o.status || "pending") !== "cancelled" && String(o.pickup_date) >= today)
    .map(o => {
      const c = custById.get(o.customer_id);
      const [fallbackFirst, ...rest] = String(o.customer_name || "").trim().split(/\s+/);
      const first = c?.first_name || fallbackFirst || "";
      const last = c?.last_name || rest.join(" ") || "";
      const its = (lines.get(o.id) || []).map(oi => {
        const it = itemById.get(oi.item_id);
        return `${qtyText(it, oi.quantity, { times: "" })}${it?.sold_by === "lb" || it?.sold_by === "person" ? " " : " × "}${it?.name || oi.item_id}${oi.note ? ` (${oi.note})` : ""}`;
      });
      return { o, first, last, items: its.join("; ") };
    })
    .sort((a, b) => String(a.o.pickup_date).localeCompare(String(b.o.pickup_date))
      || String(a.o.pickup_time).localeCompare(String(b.o.pickup_time))
      || a.last.localeCompare(b.last) || a.first.localeCompare(b.first));

  const header = ["Pickup date", "Pickup time", "Order #", "Last name", "First name", "Phone", "Items", "Order note", "Email", "Taken by"];
  const body = rows.map(r => [fmtPickup(r.o.pickup_date), fmtTime(r.o.pickup_time), orderNumberText(r.o), r.last, r.first,
    r.o.customer_phone, r.items, r.o.notes || "", r.o.customer_email || "", r.o.taken_by || ""].map(csvCell).join(","));
  return { csv: [header.join(","), ...body].join("\r\n") + "\r\n", count: rows.length };
}

// ── retention ────────────────────────────────────────────────────────────────
// Keep the last 30 days, plus the first backup of each month forever.
export function filesToDelete(files, todayIso) {
  const cutoff = new Date(`${todayIso}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
  const dated = files.map(f => ({ ...f, d: /ib-butcher-backup-(\d{4}-\d{2}-\d{2})/.exec(f.name)?.[1] })).filter(f => f.d);
  const monthKeeper = new Map();   // "2026-11" -> earliest file name that month
  for (const f of [...dated].sort((a, b) => a.name.localeCompare(b.name))) {
    const ym = f.d.slice(0, 7);
    if (!monthKeeper.has(ym)) monthKeeper.set(ym, f.name);
  }
  return dated.filter(f => new Date(`${f.d}T00:00:00Z`) < cutoff && monthKeeper.get(f.d.slice(0, 7)) !== f.name);
}

// ── the nightly job ──────────────────────────────────────────────────────────
export async function runBackup({ reason = "scheduled" } = {}) {
  const started = Date.now();
  const backup = await buildBackup();
  const { drive, conn } = await driveClient();
  const folders = await ensureFolders(drive, conn);
  const { date, hm } = backup.created_et;

  // 1) Full backup file
  const json = JSON.stringify(backup);
  const name = `ib-butcher-backup-${date}-${hm}.json`;
  const full = await drive.files.create({
    requestBody: { name, parents: [folders.full], description: `IB Butcher App backup (${reason}). Restore steps: docs/RESTORE.md in the repo.` },
    media: { mimeType: "application/json", body: Readable.from([json]) },
    fields: "id, size, webViewLink",
  });

  // Read it back and confirm it is complete before trusting it
  const check = await drive.files.get({ fileId: full.data.id, alt: "media" }, { responseType: "text" });
  const back = JSON.parse(typeof check.data === "string" ? check.data : JSON.stringify(check.data));
  for (const [t, n] of Object.entries(backup.counts)) {
    if ((back.tables?.[t]?.length ?? -1) !== n) throw new Error(`Backup check failed: ${t} has ${back.tables?.[t]?.length} rows in Drive, expected ${n}.`);
  }

  // 2) Store spreadsheets (replace yesterday's)
  const prev = (await getSetting("backup_sheets")) || {};
  const sheets = {};
  const storeCounts = {};
  for (const s of STORES) {
    const { csv, count } = upcomingOrdersCsv(backup, s.id, date);
    storeCounts[s.id] = count;
    const r = await drive.files.create({
      requestBody: { name: `${s.name} - upcoming orders`, parents: [folders.stores[s.id]], mimeType: "application/vnd.google-apps.spreadsheet",
                     description: `Live orders with pickup ${date} or later, as of ${date} ${hm.slice(0, 2)}:${hm.slice(2)} ET.` },
      media: { mimeType: "text/csv", body: Readable.from([csv]) },
      fields: "id",
    });
    sheets[s.id] = r.data.id;
    if (prev[s.id] && prev[s.id] !== r.data.id) { try { await drive.files.delete({ fileId: prev[s.id] }); } catch { /* already gone */ } }
  }
  await setSetting("backup_sheets", sheets);

  // 3) Retention
  const list = await drive.files.list({ q: `'${folders.full}' in parents and trashed = false`, fields: "files(id, name)", pageSize: 1000 });
  const old = filesToDelete(list.data.files || [], date);
  for (const f of old) { try { await drive.files.delete({ fileId: f.id }); } catch { /* ignore */ } }

  const result = {
    ok: true, at: new Date().toISOString(), reason, file: name, file_id: full.data.id,
    bytes: Number(full.data.size) || Buffer.byteLength(json), counts: backup.counts,
    store_upcoming: storeCounts, deleted_old: old.length, kept: (list.data.files || []).length - old.length,
    seconds: Math.round((Date.now() - started) / 100) / 10, folder_link: folders.root_link || null,
  };
  await setSetting("backup_last", result);
  return result;
}
