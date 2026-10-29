import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase";
import { findZebraPrinter, printZpl, buildLabels, zplForLabels } from "./zebraPrint";
import { Button, Card, Pill, Chip, Toggle, Field, Input, Select, Textarea, PasswordInput, Banner, Loading, Empty, Modal, Icon, MadeBy, cx } from "./ui";

const LOCS = [
  { id: "nhp", name: "New Hyde Park", address: "1538 Union Turnpike, Lake Success Center", city: "New Hyde Park, NY 11040", phone: "(516) 488-5600" },
  { id: "wantagh", name: "Wantagh", address: "1166 Wantagh Avenue", city: "Wantagh, NY 11793", phone: "(516) 781-6400" },
  { id: "maspeth", name: "Maspeth", address: "6900 Grand Avenue", city: "Maspeth, NY 11378", phone: "(718) 639-3623" },
  { id: "woodbury", name: "Woodbury", address: "7929 Jericho Turnpike", city: "Woodbury, NY 11797", phone: "(516) 921-5400" },
  { id: "gardencity", name: "Garden City", address: "140 7th Street", city: "Garden City, NY 11530", phone: "(516) 266-8800" },
];

const ROLES = { master_admin: "Master Admin", admin: "Admin", manager: "Manager", clerk: "Clerk" };
const BRAND = "#900027";

const digits = (p) => String(p || "").replace(/\D/g, "");
// Local-date YYYY-MM-DD (never UTC — the store day rolls at local midnight)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tod = () => ymd(new Date());
const nowT = () => new Date().toTimeString().slice(0, 5);
const LOGO_URL = "/logo.jpg";

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
}

// Parse casual time text ("1p", "1 pm", "130p", "1:30", "13:00", "noon") -> "HH:MM" 24h, or null
function parseTime(raw) {
  if (!raw) return null;
  let t = raw.trim().toLowerCase().replace(/\./g, "");
  if (t === "noon") return "12:00";
  if (t === "midnight") return "00:00";
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|p|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3] ? m[3][0] : null;
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "p" && h !== 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  } else {
    if (h > 23) return null;
    // no am/pm given: 1-6 assume PM (store hours), 7-11 AM, 12+ as typed
    if (h >= 1 && h <= 6) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function TimeInput({ value, onChange }) {
  const [text, setText] = useState(fmtTime(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(fmtTime(value)); setBad(false); }, [value]);
  const commit = () => {
    const p = parseTime(text);
    if (p) { setBad(false); onChange(p); setText(fmtTime(p)); }
    else if (text.trim() === "") { setBad(false); setText(fmtTime(value)); }
    else setBad(true);
  };
  return (
    <div>
      <Input value={text} bad={bad} onChange={e => { setText(e.target.value); setBad(false); }} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); e.target.blur(); } }}
        onFocus={e => e.target.select()} placeholder="e.g. 1p, 130p, 11:30" inputMode="text" />
      {bad && <p className="field-err">Try 1p, 1:30 pm, 11:30, or noon</p>}
    </div>
  );
}

function fmtDateLongShort(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function takenByInitials(name) {
  if (!name) return "";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function formatPhone(val) {
  const digits = val.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}

// ── Receipt printing ──────────────────────────────────────────────────────────
// Routes print jobs through the Vercel relay → Cloudflare Tunnel → local
// relay server → printer over TCP 9100 (raw ESC/POS). This sidesteps all
// browser security restrictions (mixed content, cert exceptions) that block
// direct browser → printer connections, including from home-screen icons.
async function printReceipt(order, orderItems, items, locs) {
  const loc = locs.find(l => l.id === order.location_id);
  try {
    const res = await fetch('/api/print-relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: order.location_id, order, orderItems, items, loc }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Print relay returned an error');
  } catch (err) {
    console.error('Print relay error:', err);
    const fallback = window.confirm(`Printer error: ${err.message}\n\nPrint via browser instead?`);
    if (fallback) printReceiptBrowser(order, orderItems, items, locs);
  }
}

// Browser fallback (original popup print)
function printReceiptBrowser(order, orderItems, items, locs) {
  const loc = locs.find(l => l.id === order.location_id);
  const takenBy = takenByInitials(order.taken_by);
  const itemLines = orderItems.map(li => {
    const item = items.find(i => i.id === li.item_id);
    return `<div style="padding:4px 0;border-bottom:1px dotted #ddd;"><span style="font-weight:bold;font-size:13px;">${item?.name || ""}</span><span style="float:right;color:#666;font-size:12px;">x${li.quantity}</span></div>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><title>Order #${order.invoice_number}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;padding:20px;max-width:300px;margin:0 auto}
    h2{font-size:17px;text-align:center;letter-spacing:1px;margin:0 0 3px}
    .c{text-align:center}.s{font-size:10px;color:#666;text-align:center}
    .d{border-top:1px dashed #aaa;margin:10px 0}
    .big{font-size:40px;font-weight:bold;text-align:center;margin:4px 0;color:${BRAND}}
    .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:8px 0 2px}
    .val{font-size:13px;font-weight:bold;margin:1px 0}
  </style></head><body>
    <h2>IAVARONE BROS.</h2>
    <p class="s">${loc?.address}<br>${loc?.city}<br>${loc?.phone}</p>
    <div class="d"></div>
    <p class="lbl">Daily order #</p><p class="big">${order.daily_number}</p>
    <div class="d"></div>
    <p class="lbl">Customer</p><p class="val">${order.customer_name}</p>
    <p class="lbl">Phone</p><p>${order.customer_phone}</p>
    <p class="lbl">Pickup</p><p class="val">${fmtDate(order.pickup_date)} at ${fmtTime(order.pickup_time)}</p>
    <p class="lbl">Invoice</p><p>#${order.invoice_number}</p>
    <div class="d"></div>
    <p class="lbl">Items</p>${itemLines}
    ${order.notes ? `<div class="d"></div><p class="lbl">Notes</p><p>${order.notes}</p>` : ""}
    <div class="d"></div>
    <p class="c s">Taken by ${takenBy}</p>
    <script>window.onload=function(){window.print();};<\/script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow popups to print."); return; }
  w.document.write(html);
  w.document.close();
}

const LABEL_FMT = { date: (d) => fmtDate(d), time: (t) => fmtTime(t) };
const htmlEsc = (v) => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Backup path: the browser print window. Sized to the real stock
// (4.25 x 2.75 in, feeding the wide way) with content kept inside the
// 4.09 in print head, 0.12 in margins and 0.22 in clear at the bottom.
// The Windows driver's paper size must also be 4.25 x 2.75 for this to land right.
function labelHTML(labels) {
  const logoUrl = window.location.origin + LOGO_URL;
  const labelsHtml = labels.map(p => `
      <div class="label"><div class="inner">
        <div class="top-row">
          <div class="logo-area">
            <img src="${logoUrl}" class="logo" />
            <span class="website">ibfoods.com</span>
          </div>
          <div class="customer-block">
            <div class="customer-lbl">CUSTOMER</div>
            <div class="customer">${htmlEsc(p.customer)}</div>
          </div>
          <div class="order-box">
            <div class="order-lbl">ORDER</div>
            <div class="daily-num">${htmlEsc(p.dailyNumber)}</div>
          </div>
        </div>
        <div class="middle-band">
          <div class="item-row"><span class="item-lbl">ITEM</span>${p.tag ? `<span class="tag">${htmlEsc(p.tag)}</span>` : ""}</div>
          <div class="item">${htmlEsc(p.itemName)}</div>
          ${p.note ? `<div class="notes">${htmlEsc(p.note)}</div>` : ""}
        </div>
        <div class="footer">
          <div class="footer-col"><div class="footer-lbl">PICKUP</div><div class="footer-val">${htmlEsc(p.pickup)}</div></div>
          <div class="footer-col"><div class="footer-lbl">INVOICE</div><div class="footer-val">${htmlEsc(p.invoice)}</div></div>
          <div class="footer-col"><div class="footer-lbl">LOCATION</div><div class="footer-val">${htmlEsc(p.location)}</div></div>
        </div>
      </div></div>`).join("");

  return `<!DOCTYPE html><html><head><title>Labels</title><style>
    @page { size: 4.25in 2.75in; margin: 0; }
    @media print { html, body { margin: 0 !important; padding: 0 !important; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: white; }
    .label { width: 4.25in; height: 2.75in; overflow: hidden; page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .inner { width: 4.09in; height: 2.75in; margin: 0 0.08in; padding: 0.12in 0.04in 0.22in; display: flex; flex-direction: column; overflow: hidden; }
    .top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.08in; }
    .logo-area { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
    .logo { width: 0.62in; height: 0.62in; object-fit: contain; }
    .website { font-size: 6pt; color: #000; }
    .customer-block { flex: 1; min-width: 0; text-align: center; padding-top: 0.06in; }
    .customer-lbl, .order-lbl, .item-lbl, .footer-lbl { font-size: 7pt; font-weight: 700; letter-spacing: 1px; color: #000; }
    .customer { font-size: 16pt; font-weight: 900; line-height: 1.1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .order-box { border: 2.5px solid #000; width: 0.85in; height: 0.72in; text-align: center; flex-shrink: 0; padding-top: 0.04in; }
    .daily-num { font-size: 28pt; font-weight: 900; line-height: 1; }
    .middle-band { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; margin-top: 0.05in; padding: 0.05in 0; flex: 1; min-height: 0; overflow: hidden; }
    .item-row { display: flex; justify-content: space-between; align-items: baseline; }
    .tag { font-size: 11pt; font-weight: 900; }
    .item { font-size: 17pt; font-weight: 900; line-height: 1.1; max-height: 2.2em; overflow: hidden; margin-top: 2px; }
    .notes { font-size: 10pt; color: #000; margin-top: 3px; max-height: 2.4em; overflow: hidden; }
    .footer { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 0.06in; padding-top: 0.05in; }
    .footer-val { font-size: 10pt; font-weight: 700; margin-top: 1px; white-space: nowrap; overflow: hidden; }
  </style></head><body>
    ${labelsHtml}
    <script>
      window.onload = function() {
        var imgs = document.querySelectorAll('img'); var left = imgs.length;
        if (!left) { window.print(); return; }
        imgs.forEach(function(img) {
          var done = function() { if (--left === 0) window.print(); };
          if (img.complete) done(); else { img.onload = done; img.onerror = done; }
        });
      };
    <\/script>
  </body></html>`;
}

function labelsFor(orders, orderItemsMap, items) {
  return buildLabels(orders, orderItemsMap, items, LOCS, LABEL_FMT);
}

// Opens the browser print window. Must run inside a click (popup blockers).
function printLabelsDialog(labels) {
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow popups to print."); return; }
  w.document.write(labelHTML(labels));
  w.document.close();
}

// ---- Zebra Browser Print detection, shared by every label button ----
const ZEBRA_DL = "https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html";
let zebraState = { status: "idle", device: null };   // idle | checking | found | none
const zebraSubs = new Set();
const setZebra = (st) => { zebraState = st; zebraSubs.forEach(f => f(st)); };
let zebraCheck = null;
function detectZebra() {
  if (zebraCheck) return zebraCheck;
  setZebra({ ...zebraState, status: "checking" });
  zebraCheck = findZebraPrinter().then(dev => {
    setZebra(dev ? { status: "found", device: dev } : { status: "none", device: null });
  }).finally(() => { zebraCheck = null; });
  return zebraCheck;
}
function useZebra() {
  const [st, setSt] = useState(zebraState);
  useEffect(() => {
    zebraSubs.add(setSt);
    if (zebraState.status !== "checking") detectZebra();
    return () => { zebraSubs.delete(setSt); };
  }, []);
  return st;
}

// One label-print control. Zebra is the default; the print window is the backup.
// getLabels: () => label payloads. showStatus: manager+ see the setup/status line.
function LabelPrint({ getLabels = () => [], caption = "", showStatus = false, style = {}, onPrinted, all = false, statusOnly = false, full = false }) {
  const zebra = useZebra();
  const [msg, setMsg] = useState(null);   // { ok, text }
  const [busy, setBusy] = useState(false);
  const count = getLabels().length;
  const noun = count === 1 ? "label" : "labels";
  const suffix = caption ? ` — ${caption}` : "";

  const toZebra = async () => {
    const labels = getLabels();
    if (!labels.length) { alert(`No labels to print${suffix}.`); return; }
    setBusy(true); setMsg(null);
    try {
      await printZpl(zebra.device, zplForLabels(labels));
      setMsg({ ok: true, text: `Sent ${labels.length} to Zebra` });
      onPrinted && onPrinted();
    } catch (e) {
      setMsg({ ok: false, text: `Zebra print failed — try the dialog. (${e.message || e})` });
    } finally { setBusy(false); }
  };
  const toDialog = () => {
    const labels = getLabels();
    if (!labels.length) { alert(`No labels to print${suffix}.`); return; }
    setMsg(null);
    printLabelsDialog(labels);
    onPrinted && onPrinted();
  };
  const found = zebra.status === "found";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      {!statusOnly && <div className="hstack">
        {count === 0
          ? <Button variant="outline" icon="tag" disabled full={full}>No labels to print{suffix}</Button>
          : found
            ? <Button variant="outline" icon="tag" onClick={toZebra} disabled={busy} full={full}>{busy ? "Sending…" : `Print ${all ? "all " : ""}${count} ${noun} to Zebra${suffix}`}</Button>
            : <Button variant="outline" icon="tag" onClick={toDialog} full={full}>Print {all ? "all " : ""}{count} {noun}{suffix}</Button>}
        {found && count > 0 && <button type="button" className="btn-link" onClick={toDialog}>or use print dialog</button>}
      </div>}
      {msg && <p className={cx("xs", msg.ok ? "ok" : "danger")}>{msg.text}</p>}
      {showStatus && zebra.status === "found" && <p className="xs ok">Zebra connected: {zebra.device?.name || "printer"} — labels print silently at exact size.</p>}
      {showStatus && zebra.status === "checking" && <p className="xs muted">Looking for Zebra printer…</p>}
      {showStatus && zebra.status === "none" && <p className="xs muted">
        No Zebra helper found — printing uses the browser dialog. For silent exact-size printing, <a href={ZEBRA_DL} target="_blank" rel="noopener noreferrer" className="brand">install Zebra Browser Print</a>. <button type="button" className="btn-link" onClick={() => detectZebra()}>Check again</button>
      </p>}
    </div>
  );
}

function getInvKey(itemId, items, locationId) {
  const item = items.find(i => i.id === itemId);
  const effectiveId = item?.parent_id || itemId;
  return `${locationId}_${effectiveId}`;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("login");
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [inv, setInv] = useState({});
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [printerIps, setPrinterIps] = useState({});
  const [paperOn, setPaperOn] = useState({});
  const [activeLoc, setActiveLoc] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadAll = useCallback(async () => {
    setLoadError("");
    try {
      const [u, o, oi, i, it, pr, cu] = await Promise.all([
        supabase.from("users").select("*"),
        supabase.from("orders").select("*"),
        supabase.from("order_items").select("*"),
        supabase.from("inventory").select("*"),
        supabase.from("items").select("*"),
        supabase.from("printer_settings").select("*"),
        supabase.from("customers").select("*"),
      ]);
      const failed = [u, o, oi, i, it, pr, cu].find(r => r.error);
      if (failed) throw new Error(failed.error.message);
      setCustomers(cu.data || []);
      setUsers(u.data || []);
      setOrders(o.data || []);
      setOrderItems(oi.data || []);
      const invMap = {};
      (i.data || []).forEach(r => { invMap[`${r.location_id}_${r.item_id}`] = r.stock; });
      setInv(invMap);
      setItems(it.data || []);
      const ipMap = {}; const paperMap = {};
      (pr.data || []).forEach(r => { if (r.printer_ip) ipMap[r.location_id] = r.printer_ip; paperMap[r.location_id] = !!r.paper_receipts_enabled; });
      setPrinterIps(ipMap);
      setPaperOn(paperMap);
      setReady(true);
    } catch (e) {
      console.error("Initial load failed", e);
      setLoadError(e.message || "Could not reach the database.");
    }
  }, []);

  useEffect(() => {
    loadAll();
    // Handle Gmail OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmailConnected")) {
      window.history.replaceState({}, "", "/");
      // Will show Gmail tab as connected after login
    }
    if (params.get("gmailError")) {
      window.history.replaceState({}, "", "/");
      console.error("Gmail OAuth error:", params.get("gmailError"));
    }
  }, [loadAll]);

  const refreshOrders = useCallback(async () => {
    const { data: o } = await supabase.from("orders").select("*");
    const { data: oi } = await supabase.from("order_items").select("*");
    setOrders(o || []);
    setOrderItems(oi || []);
  }, []);
  const refreshInv = useCallback(async () => {
    const { data } = await supabase.from("inventory").select("*");
    const m = {};
    (data || []).forEach(r => { m[`${r.location_id}_${r.item_id}`] = r.stock; });
    setInv(m);
  }, []);
  const refreshItems = useCallback(async () => { const { data } = await supabase.from("items").select("*"); setItems(data || []); }, []);
  const refreshCustomers = useCallback(async () => { const { data } = await supabase.from("customers").select("*"); setCustomers(data || []); }, []);
  const refreshUsers = useCallback(async () => { const { data } = await supabase.from("users").select("*"); setUsers(data || []); }, []);

  const orderItemsMap = {};
  orderItems.forEach(oi => {
    if (!orderItemsMap[oi.order_id]) orderItemsMap[oi.order_id] = [];
    orderItemsMap[oi.order_id].push(oi);
  });

  const can = (min) => { const h = ["clerk", "manager", "admin", "master_admin"]; return h.indexOf(user?.role) >= h.indexOf(min); };
  const logout = () => { setUser(null); setView("login"); };

  if (loadError) return (
    <div className="shell" style={{ paddingTop: "4rem", maxWidth: 420 }}>
      <Banner tone="err"><Icon name="alert" /><div><b>Couldn't load the app.</b><br /><span className="xs">{loadError}</span></div></Banner>
      <Button variant="primary" full icon="refresh" style={{ marginTop: 14 }} onClick={loadAll}>Try again</Button>
    </div>
  );
  if (!ready) return <Loading />;
  if (view === "login") return <Login users={users} onLogin={u => { setUser(u); setActiveLoc(u.location_id); setView("new_order"); }} />;

  const loc = activeLoc ? LOCS.find(l => l.id === activeLoc) : null;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav user={user} loc={loc} activeLoc={activeLoc} setActiveLoc={setActiveLoc} view={view} setView={setView} can={can} onLogout={logout} />
      <div className="shell">
        {view === "orders" && <Orders key={activeLoc} activeLoc={activeLoc} user={user} orders={orders} orderItemsMap={orderItemsMap} refresh={refreshOrders} inv={inv} refreshInv={refreshInv} items={items} can={can} paperOn={paperOn} />}
        {view === "new_order" && <NewOrder key={activeLoc} activeLoc={activeLoc} user={user} orders={orders} refresh={refreshOrders} inv={inv} refreshInv={refreshInv} items={items} setView={setView} paperOn={paperOn} customers={customers} refreshCustomers={refreshCustomers} />}
        {view === "customers" && <Customers customers={customers} refreshCustomers={refreshCustomers} orders={orders} orderItemsMap={orderItemsMap} items={items} activeLoc={activeLoc} />}
        {view === "reports" && <Reports key={activeLoc} activeLoc={activeLoc} orders={orders} orderItemsMap={orderItemsMap} items={items} user={user} can={can} />}
        {view === "inventory" && can("manager") && <Inventory activeLoc={activeLoc} can={can} inv={inv} refreshInv={refreshInv} items={items} user={user} />}
        {view === "admin" && can("manager") && <Admin users={users} refreshUsers={refreshUsers} items={items} refreshItems={refreshItems} user={user} can={can} printerIps={printerIps} setPrinterIps={setPrinterIps} paperOn={paperOn} setPaperOn={setPaperOn} />}
      </div>
    </div>
  );
}

function Login({ users, onLogin }) {
  const [mode, setMode] = useState("pin");
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const tryPin = (p) => {
    const u = users.find(u => u.pin === p);
    if (!u) { setShake(true); setErr("PIN not recognized."); setTimeout(() => { setShake(false); setPin(""); }, 450); return; }
    onLogin(u);
  };
  const press = (d) => {
    if (pin.length >= 4) return;
    setErr("");
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => tryPin(next), 120);
  };
  const back = () => { setErr(""); setPin(p => p.slice(0, -1)); };

  useEffect(() => {
    if (mode !== "pin") return;
    const h = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const goPw = () => {
    const u = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password);
    if (!u) { setErr("Invalid username or password."); return; }
    onLogin(u);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem 1rem" }}>
      <div style={{ width: "100%", maxWidth: 340 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <img src="/logo.jpg" alt="Iavarone Bros." style={{ width: 92, height: 92, objectFit: "contain", display: "block", margin: "0 auto 8px" }} />
          <p className="h2">Iavarone Bros.</p>
          <p className="small muted">Butcher Order System</p>
        </div>

        {mode === "pin" ? (
          <Card style={{ padding: 22, borderRadius: 16 }}>
            <p className="eyebrow" style={{ textAlign: "center", marginBottom: 16 }}>Enter your PIN</p>
            <div className={cx(shake && "shake")} style={{ display: "flex", justifyContent: "center", gap: 18, marginBottom: 8 }}>
              {[0, 1, 2, 3].map(i => <span key={i} style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${BRAND}`, background: i < pin.length ? BRAND : "transparent", transition: "background .1s" }} />)}
            </div>
            <p className="xs danger" style={{ textAlign: "center", minHeight: 18, marginBottom: 10 }}>{err}</p>
            <div className="keypad">
              {["1","2","3","4","5","6","7","8","9"].map(d => <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>)}
              <span />
              <button type="button" className="key" onClick={() => press("0")}>0</button>
              <button type="button" className="key dim" onClick={back} aria-label="Backspace">⌫</button>
            </div>
            <Button variant="ghost" full style={{ marginTop: 14 }} onClick={() => { setMode("pw"); setErr(""); setPin(""); }}>Sign in with password</Button>
          </Card>
        ) : (
          <Card style={{ padding: 22, borderRadius: 16 }}>
            <Field label="Username"><Input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && goPw()} placeholder="Username" autoCapitalize="none" /></Field>
            <Field label="Password" error={err}><PasswordInput value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && goPw()} placeholder="Password" /></Field>
            <Button variant="primary" full onClick={goPw}>Sign in</Button>
            <Button variant="ghost" full style={{ marginTop: 10 }} icon="back" onClick={() => { setMode("pin"); setErr(""); }}>Use PIN instead</Button>
          </Card>
        )}
        <div style={{ marginTop: 28 }}><MadeBy /></div>
      </div>
    </div>
  );
}

function Nav({ user, loc, activeLoc, setActiveLoc, view, setView, can, onLogout }) {
  const homeLoc = LOCS.find(l => l.id === user.location_id);
  const awayFromHome = activeLoc !== user.location_id;
  const canSwitch = can("manager");
  const tabs = [
    { id: "orders", label: "Orders" },
    { id: "new_order", label: "New order" },
    { id: "customers", label: "Customers" },
    { id: "reports", label: "Reports" },
    ...(can("manager") ? [{ id: "inventory", label: "Inventory" }] : []),
    ...(can("manager") ? [{ id: "admin", label: can("admin") ? "Admin" : "Users" }] : []),
  ];
  return (
    <div className={cx("nav", awayFromHome && "away")}>
      <div className="nav-inner">
        <div className="nav-top">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div className="monogram">IB</div>
            <div style={{ minWidth: 0 }}>
              {canSwitch ? (
                <div className="hstack">
                  <Select inline value={activeLoc} onChange={e => setActiveLoc(e.target.value)} style={{ minHeight: 38, padding: "6px 34px 6px 10px", fontSize: 15, fontWeight: 600, borderColor: awayFromHome ? "var(--warn)" : undefined, color: awayFromHome ? "var(--warn)" : undefined }}>
                    {LOCS.map(l => <option key={l.id} value={l.id}>{l.name}{l.id === user.location_id ? " (home)" : ""}</option>)}
                    {can("admin") && <option value="">All stores</option>}
                  </Select>
                  {awayFromHome && <span className="xs warn" style={{ fontWeight: 600 }}>Not your home store ({homeLoc?.name})</span>}
                </div>
              ) : (
                <p className="h2">{loc?.name}</p>
              )}
              <p className="xs muted">{user.name} · {ROLES[user.role]}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onLogout}>Sign out</Button>
        </div>
        <div className="nav-tabs">
          {tabs.map(t => <button key={t.id} type="button" className={cx("tab", view === t.id && "on")} onClick={() => setView(t.id)}>{t.label}</button>)}
        </div>
      </div>
    </div>
  );
}

function Orders({ activeLoc, user, orders, orderItemsMap, refresh, inv, refreshInv, items, can, paperOn = {} }) {
  const [search, setSearch] = useState("");
  const [lf, setLf] = useState(activeLoc || "");
  const [range, setRange] = useState("today");   // today | tomorrow | upcoming | all | date
  const [df, setDf] = useState(tod());
  const [showCancelled, setShowCancelled] = useState(false);
  const addDays = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return ymd(x); };
  const today = tod(); const tomorrow = addDays(today, 1);
  const pickRange = (r) => { setRange(r); setDf(r === "today" ? today : r === "tomorrow" ? tomorrow : ""); };
  const pickDate = (d) => { setDf(d); setRange(d === today ? "today" : d === tomorrow ? "tomorrow" : d ? "date" : "all"); };
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [detailEmail, setDetailEmail] = useState("");
  const [detailEmailSending, setDetailEmailSending] = useState(false);
  const [detailEmailStatus, setDetailEmailStatus] = useState("");

  const searching = search.trim().length > 0;
  const filtered = orders.filter(o => {
    if (!showCancelled && o.status === "cancelled") return false;
    if (lf && o.location_id !== lf) return false;
    if (searching) {
      const q = search.trim().toLowerCase(); const qd = q.replace(/\D/g, "");
      return (o.customer_name || "").toLowerCase().includes(q) || String(o.invoice_number).includes(q) || (qd.length >= 3 && (o.customer_phone || "").replace(/\D/g, "").includes(qd));
    }
    if (range === "upcoming") return o.pickup_date >= today;
    if (df) return o.pickup_date === df;
    return true;
  }).sort((a, b) => {
    if (searching || range === "all") return b.invoice_number - a.invoice_number;
    return (a.pickup_date || "").localeCompare(b.pickup_date || "") || (a.pickup_time || "").localeCompare(b.pickup_time || "") || a.daily_number - b.daily_number;
  });
  const groupByDate = !searching && (range === "upcoming" || range === "all");
  const statusCounts = filtered.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});

  const openDetail = (o) => { setDetail(o); setEditing(false); setEditForm(null); setDetailEmail(o.customer_email || ""); setDetailEmailStatus(""); };
  const closeDetail = () => { setDetail(null); setEditing(false); };

  const startEdit = (o) => {
    const nameParts = o.customer_name.split(" ");
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
    const firstName = nameParts.slice(0, nameParts.length > 1 ? -1 : 1).join(" ");
    setEditForm({
      firstName, lastName,
      customer_phone: o.customer_phone,
      customer_email: o.customer_email || "",
      pickup_date: o.pickup_date,
      pickup_time: o.pickup_time,
      notes: o.notes || "",
      location_id: o.location_id,
      lineItems: [...(orderItemsMap[o.id] || []).map(li => ({ item_id: li.item_id, quantity: li.quantity }))],
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    const customerName = `${editForm.firstName.trim()} ${editForm.lastName.trim()}`.trim();
    await supabase.from("orders").update({
      customer_name: customerName,
      customer_phone: editForm.customer_phone,
      customer_email: editForm.customer_email || null,
      pickup_date: editForm.pickup_date,
      pickup_time: editForm.pickup_time,
      notes: editForm.notes,
      location_id: editForm.location_id,
    }).eq("id", detail.id);
    await supabase.from("order_items").delete().eq("order_id", detail.id);
    await supabase.from("order_items").insert(
      editForm.lineItems.map(li => ({ order_id: detail.id, item_id: li.item_id, quantity: parseInt(li.quantity) || 1 }))
    );
    await refresh();
    setEditing(false);
    setDetail(null);
  };

  const cancel = async id => {
    if (!confirm("Cancel this order?")) return;
    const o = orders.find(x => x.id === id);
    if (o) {
      const lineItems = orderItemsMap[id] || [];
      for (const li of lineItems) {
        const poolItemId = items.find(i => i.id === li.item_id)?.parent_id || li.item_id;
        const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", o.location_id).eq("item_id", poolItemId).maybeSingle();
        if (existing) await supabase.from("inventory").update({ stock: existing.stock + li.quantity }).eq("id", existing.id);
      }
      await refreshInv();
    }
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", id);
    await refresh();
    setDetail(null);
  };

  const complete = async id => {
    await supabase.from("orders").update({ status: "completed" }).eq("id", id);
    await refresh();
    setDetail(null);
  };

  const deleteOrder = async id => {
    if (!confirm("Permanently delete this order? This cannot be undone.")) return;
    await supabase.from("order_items").delete().eq("order_id", id);
    await supabase.from("orders").delete().eq("id", id);
    await refresh();
    setDetail(null);
  };

  const sendDetailEmail = async () => {
    if (!detailEmail || !detailEmail.includes("@")) { setDetailEmailStatus("error_addr"); return; }
    setDetailEmailSending(true); setDetailEmailStatus("");
    const loc = LOCS.find(l => l.id === detail.location_id);
    try {
      const res = await fetch("/api/send-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: detailEmail, locationId: detail.location_id, order: detail, orderItems: orderItemsMap[detail.id] || [], items, loc }),
      });
      setDetailEmailStatus(res.ok ? "sent" : "error");
    } catch { setDetailEmailStatus("error"); }
    setDetailEmailSending(false);
  };

  return (
    <div>
      {detail && (
        <Modal title={`Order #${detail.invoice_number}`} onClose={closeDetail}>
          {!editing ? (
            <>
              <table className="tbl kv" style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    ["Customer", detail.customer_name],
                    ["Phone", detail.customer_phone],
                    ...(detail.customer_email ? [["Email", detail.customer_email]] : []),
                    ["Pickup", `${fmtDate(detail.pickup_date)} at ${fmtTime(detail.pickup_time)}`],
                    ["Invoice", `#${detail.invoice_number}`],
                    ["Location", LOCS.find(l => l.id === detail.location_id)?.name],
                    ["Order placed", `${fmtDate(detail.order_date)} at ${fmtTime(detail.order_time)}`],
                    ["Daily #", `#${detail.daily_number}`],
                    ["Taken by", detail.taken_by],
                    ["Status", detail.status],
                    ...(detail.notes ? [["Notes", detail.notes]] : [])
                  ].map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="divider" />
              <p className="eyebrow" style={{ marginBottom: 6 }}>Items</p>
              {(orderItemsMap[detail.id] || []).map((li, i) => {
                const item = items.find(x => x.id === li.item_id);
                return <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dotted var(--line)" }}>
                  <span>{item?.name}</span>
                  <span className="muted">x{li.quantity}</span>
                </div>;
              })}
              <div className="stack" style={{ marginTop: 14 }}>
                <div className="hstack" style={{ flexWrap: "nowrap" }}>
                  <Button style={{ flex: 1 }} onClick={() => startEdit(detail)}>Edit</Button>
                  {paperOn[detail.location_id] && <Button style={{ flex: 1 }} icon="printer" onClick={() => { setDetail(null); setTimeout(() => printReceipt(detail, orderItemsMap[detail.id] || [], items, LOCS), 200); }}>Print receipt</Button>}
                </div>
                <LabelPrint full getLabels={() => labelsFor([detail], { [detail.id]: orderItemsMap[detail.id] || [] }, items)} showStatus={can("manager")} />
                <Card tight>
                  <p className="small muted" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><Icon name="mail" size={16} />Email receipt</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Input type="email" value={detailEmail} onChange={e => { setDetailEmail(e.target.value); setDetailEmailStatus(""); }} placeholder="customer@email.com" style={{ flex: 1 }} />
                    <Button variant="primary" onClick={sendDetailEmail} disabled={detailEmailSending}>{detailEmailSending ? "Sending…" : "Send"}</Button>
                  </div>
                  {detailEmailStatus === "sent" && <p className="xs ok" style={{ marginTop: 6 }}>Receipt sent to {detailEmail}</p>}
                  {detailEmailStatus === "error" && <p className="xs danger" style={{ marginTop: 6 }}>Failed to send. Check Vercel logs.</p>}
                  {detailEmailStatus === "error_addr" && <p className="xs danger" style={{ marginTop: 6 }}>Please enter a valid email address.</p>}
                </Card>
                {detail.status === "pending" && (
                  <div className="hstack" style={{ flexWrap: "nowrap" }}>
                    <Button variant="ok-soft" style={{ flex: 1 }} onClick={() => complete(detail.id)}>Mark complete</Button>
                    <Button variant="danger-soft" style={{ flex: 1 }} onClick={() => cancel(detail.id)}>Cancel order</Button>
                  </div>
                )}
                {can("manager") && (
                  <div style={{ paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
                    <Button variant="danger" full icon="trash" onClick={() => deleteOrder(detail.id)}>Delete order (managers only)</Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid2">
                <Field label="First name"><Input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} /></Field>
                <Field label="Last name"><Input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} /></Field>
              </div>
              <Field label="Phone"><Input value={editForm.customer_phone} inputMode="tel" onChange={e => setEditForm(f => ({ ...f, customer_phone: formatPhone(e.target.value) }))} /></Field>
              <Field label="Email (optional)"><Input type="email" value={editForm.customer_email || ""} onChange={e => setEditForm(f => ({ ...f, customer_email: e.target.value }))} placeholder="customer@email.com" /></Field>
              {can("manager") && <Field label="Location"><Select value={editForm.location_id} onChange={e => setEditForm(f => ({ ...f, location_id: e.target.value }))}>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
              <div className="grid2">
                <Field label="Pickup date"><Input type="date" value={editForm.pickup_date} onChange={e => setEditForm(f => ({ ...f, pickup_date: e.target.value }))} /></Field>
                <Field label="Pickup time"><TimeInput value={editForm.pickup_time} onChange={v => setEditForm(f => ({ ...f, pickup_time: v }))} /></Field>
              </div>
              <Field label="Items">
                <div className="stack">
                  {editForm.lineItems.map((li, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Select value={li.item_id} onChange={e => setEditForm(f => ({ ...f, lineItems: f.lineItems.map((x, idx) => idx === i ? { ...x, item_id: e.target.value } : x) }))} style={{ flex: 3 }}>
                        {items.filter(x => x.active !== false).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </Select>
                      <Input type="number" min={1} value={li.quantity} onChange={e => setEditForm(f => ({ ...f, lineItems: f.lineItems.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x) }))} style={{ width: 72, flex: "none" }} />
                      {editForm.lineItems.length > 1 && <button type="button" className="close" style={{ margin: 0 }} onClick={() => setEditForm(f => ({ ...f, lineItems: f.lineItems.filter((_, idx) => idx !== i) }))} aria-label="Remove">×</button>}
                    </div>
                  ))}
                  <div><Button variant="outline" size="sm" icon="plus" onClick={() => setEditForm(f => ({ ...f, lineItems: [...f.lineItems, { item_id: items.filter(x => x.active !== false)[0]?.id || "", quantity: 1 }] }))}>Add item</Button></div>
                </div>
              </Field>
              <Field label="Notes"><Textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></Field>
              <div className="hstack" style={{ flexWrap: "nowrap" }}>
                <Button variant="primary" style={{ flex: 1 }} onClick={saveEdit}>Save changes</Button>
                <Button style={{ flex: 1 }} onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Range pills + search */}
      <div className="pills" style={{ marginBottom: 10 }}>
        {[["today", "Today"], ["tomorrow", "Tomorrow"], ["upcoming", "Upcoming"], ["all", "All"]].map(([r, lbl]) => (
          <Pill key={r} on={range === r && !searching} onClick={() => { setSearch(""); pickRange(r); }}>{lbl}</Pill>
        ))}
        <Input type="date" inline value={df} onChange={e => { setSearch(""); pickDate(e.target.value); }} style={{ minHeight: 40, padding: "6px 10px", borderRadius: 20, fontSize: 14, color: range === "date" ? "var(--brand)" : "var(--muted)" }} />
        <div style={{ flex: 1 }} />
        <label className="hstack small muted" style={{ cursor: "pointer", minHeight: 40 }}>
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />
          Cancelled
        </label>
      </div>
      <div className="hstack" style={{ marginBottom: 12 }}>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search all orders — name, phone, or invoice #" style={{ flex: 1, minWidth: 200 }} />
        {!activeLoc && <Select inline value={lf} onChange={e => setLf(e.target.value)} style={{ minWidth: 160 }}><option value="">All locations</option>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
      </div>

      {/* Print all labels for the day — its own bar so it can't be missed */}
      {!searching && (range === "upcoming" || range === "all") && can("manager") &&
        <LabelPrint statusOnly showStatus style={{ marginBottom: 8 }} />}
      {!searching && (range === "today" || range === "tomorrow" || range === "date") && (() => {
        const labelDay = df || today;
        const dayOrders = orders.filter(o => o.pickup_date === labelDay && o.status !== "cancelled" && (!lf || o.location_id === lf)).sort((a, b) => a.daily_number - b.daily_number);
        return <Card tight style={{ marginBottom: 12 }}>
          <LabelPrint all getLabels={() => labelsFor(dayOrders, orderItemsMap, items)} caption={fmtDateLongShort(labelDay)} showStatus={can("manager")} />
        </Card>;
      })()}

      {/* Summary line */}
      <p className="small muted" style={{ marginBottom: 8 }}>
        {searching ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : `${filtered.length} order${filtered.length === 1 ? "" : "s"}${range === "today" ? " today" : range === "tomorrow" ? " tomorrow" : range === "date" ? ` on ${fmtDate(df)}` : range === "upcoming" ? " upcoming" : ""}`}
        {Object.keys(statusCounts).filter(k => k !== "pending").map(k => ` · ${statusCounts[k]} ${k}`).join("")}
      </p>

      {filtered.length === 0 ? <Empty>{searching ? "No orders match." : range === "today" ? "No pickups today." : "No orders."}</Empty> :
        filtered.map((o, idx) => {
          const loc = LOCS.find(l => l.id === o.location_id);
          const lineItems = orderItemsMap[o.id] || [];
          const qty = lineItems.reduce((n, li) => n + (parseInt(li.quantity) || 0), 0);
          const itemSummary = lineItems.map(li => { const item = items.find(i => i.id === li.item_id); return `${li.quantity > 1 ? `${li.quantity}× ` : ""}${item?.name || ""}`; }).join(", ");
          const showHeader = groupByDate && (idx === 0 || filtered[idx - 1].pickup_date !== o.pickup_date);
          return (
            <div key={o.id}>
              {showHeader && <div className="date-head">
                <p className="eyebrow brand">{o.pickup_date === today ? "Today" : o.pickup_date === tomorrow ? "Tomorrow" : fmtDateLongShort(o.pickup_date)}</p>
                <LabelPrint all getLabels={() => labelsFor(filtered.filter(x => x.pickup_date === o.pickup_date && x.status !== "cancelled").sort((a, b) => a.daily_number - b.daily_number), orderItemsMap, items)} caption={fmtDateLongShort(o.pickup_date)} />
              </div>}
              <div className={cx("order-row", o.status === "cancelled" && "cancelled")} onClick={() => openDetail(o)} title={itemSummary}>
                <span className="order-num">#{o.daily_number}</span>
                <span className="order-time num">{fmtTime(o.pickup_time)}</span>
                <span className="order-name ellipsis">{o.customer_name}{(searching || range === "all") && <span className="sub"> · {fmtDate(o.pickup_date)}</span>}{!activeLoc && <span className="sub"> · {loc?.name}</span>}</span>
                <span className="order-qty">{qty} item{qty === 1 ? "" : "s"}</span>
                <Chip tone={o.status}>{o.status}</Chip>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

function NewOrder({ activeLoc, user, orders, refresh, inv, refreshInv, items, setView, paperOn = {}, customers = [], refreshCustomers }) {
  const locs = activeLoc ? LOCS.filter(l => l.id === activeLoc) : LOCS;
  const orderableItems = items.filter(i => i.active !== false);
  const [locationId, setLocationId] = useState(activeLoc || locs[0]?.id || "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lineItems, setLineItems] = useState([{ item_id: orderableItems[0]?.id || "", quantity: 1 }]);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("12:00");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  // confirmation screen state
  const [confirming, setConfirming] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [placedOrderItems, setPlacedOrderItems] = useState([]);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState(""); // "sent" | "error" | ""

  const [matched, setMatched] = useState(null);   // customer record auto-matched by phone
  const [custQuery, setCustQuery] = useState("");
  const custOrderCount = (c) => orders.filter(o => o.customer_id === c.id).length;
  const applyCustomer = (c) => {
    setMatched(c);
    setPhone(formatPhone(c.phone));
    setFirstName(c.first_name || (c.name || "").split(" ")[0] || "");
    setLastName(c.last_name || (c.name || "").split(" ").slice(1).join(" ") || "");
    if (c.email) setEmail(c.email);
    setCustQuery("");
  };
  const handlePhone = e => {
    const v = formatPhone(e.target.value);
    setPhone(v);
    const d = digits(v);
    if (d.length >= 10) {
      const c = customers.find(x => x.phone_digits === d);
      if (c && c.id !== matched?.id) applyCustomer(c);
      else if (!c) setMatched(null);
    } else setMatched(null);
  };
  const custResults = custQuery.trim().length >= 2 ? customers.filter(c => {
    const q = custQuery.trim().toLowerCase(); const qd = digits(q);
    return (c.name || "").toLowerCase().includes(q) || (qd.length >= 3 && (c.phone_digits || "").includes(qd)) || (c.email || "").toLowerCase().includes(q);
  }).slice(0, 8) : [];
  const addLineItem = () => setLineItems(li => [...li, { item_id: orderableItems[0]?.id || "", quantity: 1 }]);
  const removeLineItem = i => setLineItems(li => li.filter((_, idx) => idx !== i));
  const updateLineItem = (i, field, val) => setLineItems(li => li.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

  const getStockForItem = (itemId) => {
    const item = items.find(i => i.id === itemId);
    const poolId = item?.parent_id || itemId;
    return inv[`${locationId}_${poolId}`] ?? null;
  };

  const submit = async () => {
    if (!firstName.trim()) { setErr("First name required."); return; }
    if (!lastName.trim()) { setErr("Last name required."); return; }
    if (!phone.trim()) { setErr("Phone required."); return; }
    if (!pickupDate) { setErr("Pickup date required."); return; }
    if (lineItems.length === 0) { setErr("Add at least one item."); return; }

    const orderDate = tod();
    const orderTime = nowT();

    const { data: allOrders } = await supabase.from("orders").select("invoice_number, location_id, pickup_date, status");
    const { data: pickupOrders } = await supabase.from("orders").select("id").eq("location_id", locationId).eq("pickup_date", pickupDate).neq("status", "cancelled");
    const maxInvoice = (allOrders || []).reduce((m, o) => Math.max(m, o.invoice_number || 0), 999);
    const invoiceNumber = maxInvoice + 1;
    const dailyNumber = (pickupOrders || []).length + 1;
    const customerName = `${firstName.trim()} ${lastName.trim()}`;

    const newOrder = {
      id: `ord_${Date.now()}`,
      location_id: locationId,
      customer_name: customerName,
      customer_phone: phone,
      customer_email: email.trim() || null,
      item_id: lineItems[0]?.item_id || "",
      order_date: orderDate,
      order_time: orderTime,
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      notes,
      invoice_number: invoiceNumber,
      daily_number: dailyNumber,
      status: "pending",
      taken_by: user.name,
      created_at: new Date().toISOString()
    };

    // Create or update the customer record (phone is the key) and link the order
    try {
      const d = digits(phone);
      const existing = customers.find(c => c.phone_digits === d);
      const custPayload = { phone, name: customerName, first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim() || existing?.email || null, updated_at: new Date().toISOString() };
      if (existing) {
        await supabase.from("customers").update(custPayload).eq("id", existing.id);
        newOrder.customer_id = existing.id;
      } else {
        const { data: created } = await supabase.from("customers").insert({ ...custPayload, home_location_id: locationId }).select("id").single();
        if (created) newOrder.customer_id = created.id;
      }
    } catch (e) { console.error("customer upsert failed", e); }

    await supabase.from("orders").insert(newOrder);
    if (refreshCustomers) await refreshCustomers();

    const orderItemRows = lineItems.map(li => ({
      order_id: newOrder.id,
      item_id: li.item_id,
      quantity: parseInt(li.quantity) || 1,
    }));
    await supabase.from("order_items").insert(orderItemRows);

    const poolDeductions = {};
    for (const li of lineItems) {
      const item = items.find(i => i.id === li.item_id);
      const poolId = item?.parent_id || li.item_id;
      const key = `${locationId}_${poolId}`;
      poolDeductions[key] = (poolDeductions[key] || 0) + (parseInt(li.quantity) || 1);
    }
    for (const [key, qty] of Object.entries(poolDeductions)) {
      const parts = key.split("_");
      const locId = parts[0];
      const itemId = parts.slice(1).join("_");
      const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", locId).eq("item_id", itemId).maybeSingle();
      if (existing) await supabase.from("inventory").update({ stock: Math.max(0, existing.stock - qty) }).eq("id", existing.id);
    }

    await refreshInv();
    await refresh();

    // Go to confirmation screen instead of auto-printing
    setPlacedOrder(newOrder);
    setPlacedOrderItems(orderItemRows);
    setConfirmEmail(email);
    setConfirming(true);
  };

  const sendEmail = async (toAddr) => {
    if (!toAddr || !toAddr.includes("@")) { setEmailStatus("error_addr"); return; }
    setEmailSending(true);
    setEmailStatus("");
    const loc = LOCS.find(l => l.id === placedOrder.location_id);
    try {
      const res = await fetch("/api/send-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toAddr, locationId: placedOrder.location_id, order: placedOrder, orderItems: placedOrderItems, items, loc }),
      });
      if (res.ok) { setEmailStatus("sent"); }
      else { setEmailStatus("error"); }
    } catch {
      setEmailStatus("error");
    }
    setEmailSending(false);
  };

  // Confirmation screen
  if (confirming && placedOrder) {
    const paper = !!paperOn[placedOrder.location_id];
    const sent = emailStatus === "sent";
    const validEmail = confirmEmail && confirmEmail.includes("@");
    return (
      <div style={{ maxWidth: 440 }}>
        <Card style={{ textAlign: "center", marginBottom: 14, padding: 24 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--ok-bg)", color: "var(--ok)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}><Icon name="check" size={24} /></div>
          <p className="h2">Order confirmed</p>
          <p style={{ fontSize: 40, fontWeight: 800, color: "var(--brand)", lineHeight: 1.1, margin: "6px 0 4px" }}>#{placedOrder.daily_number}</p>
          <p className="small muted">Invoice #{placedOrder.invoice_number} · {placedOrder.customer_name}</p>
          <p className="small muted">Pickup: {fmtDate(placedOrder.pickup_date)} at {fmtTime(placedOrder.pickup_time)}</p>
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <p className="eyebrow" style={{ marginBottom: 10 }}>Send receipt</p>
          {sent ? (
            <Banner tone="ok" style={{ justifyContent: "center", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <p style={{ fontWeight: 600 }}>Receipt emailed</p>
              <p className="xs">{confirmEmail}</p>
            </Banner>
          ) : (
            <>
              <Input type="email" inputMode="email" value={confirmEmail} onChange={e => { setConfirmEmail(e.target.value); setEmailStatus(""); }}
                onKeyDown={e => e.key === "Enter" && validEmail && sendEmail(confirmEmail)} placeholder="Customer email address" style={{ marginBottom: 10 }} />
              <Button variant="primary" size="lg" full icon="mail" onClick={() => sendEmail(confirmEmail)} disabled={emailSending || !validEmail}>
                {emailSending ? "Sending…" : "Confirm & email receipt"}
              </Button>
              {emailStatus === "error" && <p className="xs danger" style={{ marginTop: 8 }}>Failed to send. Check the address and try again.</p>}
              {emailStatus === "error_addr" && <p className="xs danger" style={{ marginTop: 8 }}>Please enter a valid email address.</p>}
              {!validEmail && <p className="xs muted" style={{ marginTop: 8, textAlign: "center" }}>No email? The order is already saved — the customer can reference order #{placedOrder.daily_number}.</p>}
            </>
          )}
          {paper && <Button full icon="printer" style={{ marginTop: 10 }} onClick={() => printReceipt(placedOrder, placedOrderItems, items, LOCS)}>Print paper receipt</Button>}
        </Card>

        <Button variant="primary" full onClick={() => setView("orders")}>Done — back to orders</Button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 540 }}>
      <p className="h1">New order</p>
      {!activeLoc && <Field label="Location"><Select value={locationId} onChange={e => setLocationId(e.target.value)}>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
      <Field label={<>Find customer <span className="faint">(name, phone, or email)</span></>}>
        <div style={{ position: "relative" }}>
          <Input value={custQuery} onChange={e => setCustQuery(e.target.value)} placeholder="Start typing to search…" />
          {custResults.length > 0 && <div className="dropdown">
            {custResults.map(c => <div key={c.id} className="dropdown-item" onClick={() => applyCustomer(c)}>
              <div className="ellipsis"><p style={{ fontWeight: 600 }}>{c.name}</p><p className="xs muted ellipsis">{c.phone}{c.email ? ` · ${c.email}` : ""}</p></div>
              <span className="xs muted" style={{ whiteSpace: "nowrap" }}>{custOrderCount(c)} order{custOrderCount(c) === 1 ? "" : "s"}</span>
            </div>)}
          </div>}
        </div>
      </Field>
      <Field label="Phone number">
        <Input inputMode="tel" value={phone} onChange={handlePhone} placeholder="(xxx) xxx-xxxx" />
        {matched && <p className="xs ok" style={{ marginTop: 5 }}>Returning customer · {custOrderCount(matched)} previous order{custOrderCount(matched) === 1 ? "" : "s"}</p>}
        {!matched && digits(phone).length >= 10 && <p className="xs muted" style={{ marginTop: 5 }}>New customer</p>}
      </Field>
      <div className="grid2">
        <Field label="First name"><Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" /></Field>
        <Field label="Last name"><Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" /></Field>
      </div>
      <Field label="Customer email (optional)"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" /></Field>
      <Field label="Items">
        <div className="stack">
          {lineItems.map((li, i) => {
            const stock = getStockForItem(li.item_id);
            return <div key={i}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Select value={li.item_id} onChange={e => updateLineItem(i, "item_id", e.target.value)} style={{ flex: 3 }}>
                  {orderableItems.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                <Input type="number" min={1} value={li.quantity} onChange={e => updateLineItem(i, "quantity", e.target.value)} style={{ width: 72, flex: "none" }} />
                {lineItems.length > 1 && <button type="button" className="close" style={{ margin: 0 }} onClick={() => removeLineItem(i)} aria-label="Remove">×</button>}
              </div>
              {stock !== null && <p className={cx("xs", stock <= 0 ? "danger" : stock <= 5 ? "warn" : "ok")} style={{ marginTop: 4, marginLeft: 2 }}>{stock <= 0 ? "Out of stock" : stock <= 5 ? `Low stock (${stock} left in pool)` : `${stock} in pool`}</p>}
            </div>;
          })}
          <div><Button variant="outline" size="sm" icon="plus" onClick={addLineItem}>Add item</Button></div>
        </div>
      </Field>
      <div className="grid2">
        <Field label="Pickup date"><Input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)} /></Field>
        <Field label="Pickup time"><TimeInput value={pickupTime} onChange={setPickupTime} /></Field>
      </div>
      <Field label="Notes (optional)"><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Special instructions..." /></Field>
      {err && <Banner tone="err" style={{ marginBottom: 12 }}><Icon name="alert" size={16} />{err}</Banner>}
      <Button variant="primary" size="lg" full onClick={submit}>Place order</Button>
    </div>
  );
}


function Customers({ customers, refreshCustomers, orders, orderItemsMap, items, activeLoc }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");
  const [sf, setSf] = useState(activeLoc || "");   // store filter: "" = all stores
  const byCust = useMemo(() => {
    const m = {};
    for (const o of orders) { if (o.customer_id) (m[o.customer_id] = m[o.customer_id] || []).push(o); }
    return m;
  }, [orders]);
  const custOrders = (c) => (byCust[c.id] || []).slice().sort((a, b) => (b.pickup_date || "").localeCompare(a.pickup_date || "") || (b.invoice_number || 0) - (a.invoice_number || 0));
  // Home store: the saved one, otherwise the store they've ordered from most
  const homeOf = (c) => {
    if (c.home_location_id) return c.home_location_id;
    const counts = {};
    for (const o of byCust[c.id] || []) counts[o.location_id] = (counts[o.location_id] || 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  };
  // A customer shows under a store if it's their home store OR they've ever ordered there
  const atStore = (c, s) => homeOf(c) === s || (byCust[c.id] || []).some(o => o.location_id === s);
  const locName = (id) => LOCS.find(l => l.id === id)?.name || "";
  const storeCount = (s) => s ? customers.filter(c => atStore(c, s)).length : customers.length;
  const list = customers.filter(c => {
    if (sf && !atStore(c, sf)) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase(); const d = digits(t);
    return (c.name || "").toLowerCase().includes(t) || (d.length >= 3 && (c.phone_digits || "").includes(d)) || (c.email || "").toLowerCase().includes(t);
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const save = async () => {
    if (!edit.name?.trim() || !digits(edit.phone)) { setErr("Name and phone are required."); return; }
    const parts = edit.name.trim().split(" ");
    const { error } = await supabase.from("customers").update({ name: edit.name.trim(), first_name: parts[0], last_name: parts.slice(1).join(" ") || null, phone: formatPhone(edit.phone), email: edit.email?.trim() || null, notes: edit.notes?.trim() || null, home_location_id: edit.home_location_id || null, updated_at: new Date().toISOString() }).eq("id", edit.id);
    if (error) { setErr(error.message.includes("phone_digits") ? "Another customer already has that phone number." : error.message); return; }
    await refreshCustomers(); setSel({ ...edit }); setEdit(null); setErr("");
  };

  if (sel) {
    const c = customers.find(x => x.id === sel.id) || sel;
    const os = custOrders(c);
    return (
      <div style={{ maxWidth: 580 }}>
        <Button variant="ghost" icon="back" style={{ marginBottom: 10, marginLeft: -8 }} onClick={() => { setSel(null); setEdit(null); }}>All customers</Button>
        <Card style={{ marginBottom: 14 }}>
          {edit ? (
            <div>
              <Field label="Name"><Input value={edit.name} onChange={e => setEdit(f => ({ ...f, name: e.target.value }))} /></Field>
              <Field label="Phone"><Input inputMode="tel" value={edit.phone} onChange={e => setEdit(f => ({ ...f, phone: formatPhone(e.target.value) }))} /></Field>
              <Field label="Email"><Input type="email" value={edit.email || ""} onChange={e => setEdit(f => ({ ...f, email: e.target.value }))} /></Field>
              <Field label="Home store"><Select value={edit.home_location_id || ""} onChange={e => setEdit(f => ({ ...f, home_location_id: e.target.value }))}><option value="">— Not set —</option>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
              <Field label="Notes" error={err}><Textarea value={edit.notes || ""} onChange={e => setEdit(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Preferences, allergies, anything staff should know" /></Field>
              <div className="hstack">
                <Button variant="primary" onClick={save}>Save</Button>
                <Button onClick={() => { setEdit(null); setErr(""); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <p className="h2">{c.name}</p>
                <p className="small" style={{ marginTop: 3 }}>{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
                {c.notes && <p className="small brand" style={{ marginTop: 8, background: "var(--brand-tint)", padding: "8px 10px", borderRadius: 8 }}>{c.notes}</p>}
                <p className="xs muted" style={{ marginTop: 8 }}>{os.length} order{os.length === 1 ? "" : "s"}{homeOf(c) ? ` · Home store: ${locName(homeOf(c))}` : ""}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEdit({ ...c, home_location_id: homeOf(c) || "" })}>Edit</Button>
            </div>
          )}
        </Card>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Order history</p>
        {os.length === 0 && <p className="small muted">No orders yet.</p>}
        {os.map(o => {
          const lis = orderItemsMap[o.id] || [];
          const summary = lis.map(li => `${items.find(i => i.id === li.item_id)?.name || "?"} ×${li.quantity}`).join(", ");
          return <Card key={o.id} tight row style={{ marginBottom: 6 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 600 }}>{fmtDate(o.pickup_date)} {fmtTime(o.pickup_time)} · #{o.invoice_number}</p>
              <p className="small muted ellipsis" style={{ marginTop: 2 }}>{summary}</p>
              <p className="xs faint" style={{ marginTop: 2 }}>{LOCS.find(l => l.id === o.location_id)?.name}</p>
            </div>
            <Chip tone={o.status}>{o.status}</Chip>
          </Card>;
        })}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 580 }}>
      <p className="h1">Customers <span className="muted" style={{ fontWeight: 400, fontSize: "var(--fs-md)" }}>({list.length}{sf ? ` at ${locName(sf)}` : ""})</span></p>
      <div className="pills scroll" style={{ marginBottom: 12 }}>
        {[{ id: "", name: "All stores" }, ...LOCS].map(l => <Pill key={l.id || "all"} on={sf === l.id} count={storeCount(l.id)} onClick={() => setSf(l.id)}>{l.name}</Pill>)}
      </div>
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, or email" style={{ marginBottom: 12 }} />
      {list.slice(0, 100).map(c => {
        const n = custOrders(c).length;
        return <Card key={c.id} tight row tappable style={{ marginBottom: 6, minHeight: 60 }} onClick={() => setSel(c)}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 600 }}>{c.name}</p>
            <p className="small muted ellipsis" style={{ marginTop: 2 }}>{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
          </div>
          <span className="xs muted" style={{ whiteSpace: "nowrap", textAlign: "right", display: "flex", alignItems: "center", gap: 4 }}>
            <span>{n} order{n === 1 ? "" : "s"}{homeOf(c) && (!sf || homeOf(c) !== sf) && <><br /><span className="brand">{locName(homeOf(c))}</span></>}</span>
            <Icon name="chevron" size={16} />
          </span>
        </Card>;
      })}
      {list.length === 0 && <p className="small muted">{q.trim() ? "No customers match." : `No customers at ${locName(sf)} yet.`}{sf && <> <button type="button" className="btn-link" onClick={() => setSf("")}>Search all stores</button></>}</p>}
      {list.length > 100 && <p className="xs muted">Showing first 100 — narrow your search.</p>}
    </div>
  );
}

function Reports({ activeLoc, orders, orderItemsMap, items, user, can }) {
  const [type, setType] = useState("popularity");
  const [from, setFrom] = useState(tod());
  const [to, setTo] = useState(tod());
  const [loc, setLoc] = useState(activeLoc || "");

  const fil = orders.filter(o => {
    if (loc && o.location_id !== loc) return false;
    if (o.pickup_date < from || o.pickup_date > to) return false;
    if (o.status === "cancelled") return false;
    return true;
  });

  const popMap = {};
  fil.forEach(o => {
    (orderItemsMap[o.id] || []).forEach(li => {
      if (!popMap[li.item_id]) popMap[li.item_id] = 0;
      popMap[li.item_id] += parseInt(li.quantity) || 1;
    });
  });
  const pop = items.map(i => ({ item: i, count: popMap[i.id] || 0 })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  const prod = [...fil].sort((a, b) => a.location_id.localeCompare(b.location_id) || a.daily_number - b.daily_number);

  // Contact list — deduplicated by email, fallback dedupe by name+phone, most recent order wins
  const contactMap = {};
  [...orders].filter(o => o.status !== "cancelled").sort((a, b) => a.invoice_number - b.invoice_number).forEach(o => {
    const key = o.customer_email ? o.customer_email.toLowerCase() : `${o.customer_name.toLowerCase()}|${o.customer_phone}`;
    const l = LOCS.find(l => l.id === o.location_id);
    const lineItems = (orderItemsMap[o.id] || []).map(li => {
      const it = items.find(i => i.id === li.item_id);
      return `${li.quantity > 1 ? `${li.quantity}x ` : ""}${it?.name || ""}`;
    }).join(", ");
    contactMap[key] = {
      name: o.customer_name,
      phone: o.customer_phone,
      email: o.customer_email || "",
      location: l?.name || "",
      last_order_date: o.pickup_date,
      last_items: lineItems,
      order_count: (contactMap[key]?.order_count || 0) + 1,
    };
  });
  const contacts = Object.values(contactMap).sort((a, b) => a.name.localeCompare(b.name));
  const contactsWithEmail = contacts.filter(c => c.email);

  const downloadContactCSV = (emailOnly) => {
    const rows = emailOnly ? contactsWithEmail : contacts;
    const headers = ["Name", "Phone", "Email", "Location", "Last Order Date", "Last Items Ordered", "Total Orders"];
    const csv = [
      headers.join(","),
      ...rows.map(c => [
        `"${c.name}"`,
        `"${c.phone}"`,
        `"${c.email}"`,
        `"${c.location}"`,
        `"${fmtDate(c.last_order_date)}"`,
        `"${c.last_items}"`,
        c.order_count,
      ].join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = tod();
    a.download = `IB_Contacts_${emailOnly ? "EmailOnly_" : ""}${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rangeText = fmtDate(from) === fmtDate(to) ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;
  const openPrint = (html) => {
    const w = window.open("", "_blank");
    if (!w) { alert("Allow popups to print."); return; }
    w.document.write(html);
    w.document.close();
  };
  const printCss = `@page { size: letter; margin: 0.5in; }
      body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
      h2{margin:0 0 3px}p.sub{margin:0 0 12px;color:#666}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;border-bottom:2px solid #000;padding:6px 8px;font-size:10px;text-transform:uppercase}
      td{padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;vertical-align:top}
      .logo{width:50px;height:50px;object-fit:contain;margin-bottom:8px}`;

  const printPop = () => {
    const ln = loc ? LOCS.find(l => l.id === loc)?.name : "All Locations";
    const logoUrl = window.location.origin + LOGO_URL;
    openPrint(`<!DOCTYPE html><html><head><title>Popularity Report</title><style>${printCss}</style></head><body>
      <img src="${logoUrl}" class="logo" />
      <h2>Popularity Report — Iavarone Bros.</h2>
      <p class="sub">Pickup: ${rangeText} · ${ln}</p>
      <table><thead><tr><th>Qty</th><th>Item</th></tr></thead><tbody>
        ${pop.map(r => `<tr><td>${r.count}</td><td>${r.item.name}</td></tr>`).join("")}
      </tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
  };

  const printProd = () => {
    const ln = loc ? LOCS.find(l => l.id === loc)?.name : "All Locations";
    const logoUrl = window.location.origin + LOGO_URL;
    openPrint(`<!DOCTYPE html><html><head><title>Production</title><style>${printCss}</style></head><body>
      <img src="${logoUrl}" class="logo" />
      <h2>Production Report — Iavarone Bros.</h2>
      <p class="sub">Pickup: ${rangeText} · ${ln}</p>
      <table><thead><tr>
        <th>#</th><th>Invoice</th><th>Location</th><th>Customer</th><th>Phone</th><th>Items</th><th>Pickup time</th><th>Notes</th>
      </tr></thead><tbody>
        ${prod.map(o => {
          const l = LOCS.find(l => l.id === o.location_id);
          const lineItems = (orderItemsMap[o.id] || []).map(li => {
            const it = items.find(i => i.id === li.item_id);
            return `${li.quantity > 1 ? `${li.quantity}x ` : ""}${it?.name || ""}`;
          }).join("<br/>");
          return `<tr><td>${o.daily_number}</td><td>#${o.invoice_number}</td><td>${l?.name||""}</td><td>${o.customer_name}</td><td>${o.customer_phone}</td><td>${lineItems}</td><td>${fmtTime(o.pickup_time)}</td><td>${o.notes||""}</td></tr>`;
        }).join("")}
      </tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
  };

  const th = (cols) => <thead><tr>{cols.map(h => <th key={h}>{h}</th>)}</tr></thead>;

  return (
    <div>
      <p className="h1">Reports</p>
      <div className="pills" style={{ marginBottom: 12 }}>
        {[["popularity", "Popularity"], ["production", "Production"], ["contacts", "Contact list"]].map(([v, l]) => <Pill key={v} on={type === v} onClick={() => setType(v)}>{l}</Pill>)}
      </div>
      {type !== "contacts" && <div className="hstack" style={{ marginBottom: 12 }}>
        {!activeLoc && <Select inline value={loc} onChange={e => setLoc(e.target.value)} style={{ minWidth: 160 }}><option value="">All locations</option>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
        <Input type="date" inline value={from} onChange={e => setFrom(e.target.value)} />
        <span className="small muted">to</span>
        <Input type="date" inline value={to} onChange={e => setTo(e.target.value)} />
        {type === "popularity" && <Button icon="printer" onClick={printPop}>Print</Button>}
        {type === "production" && <>
          <Button icon="printer" onClick={printProd}>Print</Button>
          <LabelPrint all getLabels={() => labelsFor(prod, orderItemsMap, items)} caption={from === to ? fmtDateLongShort(from) : `${fmtDate(from)} – ${fmtDate(to)}`} showStatus={can("manager")} />
        </>}
      </div>}
      {type === "popularity" && <div>
        <p className="small muted" style={{ marginBottom: 10 }}>{fil.length} orders · pickup {rangeText}</p>
        {pop.length === 0 ? <Empty>No orders in this range.</Empty> :
          pop.map(r => <Card key={r.item.id} tight style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 14 }}>
            <span className="order-num" style={{ minWidth: 40 }}>{r.count}</span>
            <span>{r.item.name}</span>
          </Card>)
        }
      </div>}
      {type === "production" && <div>
        <p className="small muted" style={{ marginBottom: 10 }}>{prod.length} orders</p>
        {prod.length === 0 ? <Empty>No orders in this range.</Empty> :
          <div className="tbl-wrap">
            <table className="tbl">
              {th(["#", "Invoice", "Location", "Customer", "Phone", "Items", "Pickup", "Notes"])}
              <tbody>{prod.map(o => {
                const l = LOCS.find(l => l.id === o.location_id);
                const lineItems = (orderItemsMap[o.id] || []).map(li => {
                  const it = items.find(i => i.id === li.item_id);
                  return `${li.quantity > 1 ? `${li.quantity}x ` : ""}${it?.name || ""}`;
                });
                return <tr key={o.id}>
                  <td style={{ fontWeight: 700, color: "var(--brand)" }}>{o.daily_number}</td>
                  <td className="muted">#{o.invoice_number}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l?.name}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{o.customer_name}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{o.customer_phone}</td>
                  <td>{lineItems.map((li, i) => <div key={i}>{li}</div>)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(o.pickup_date)} {fmtTime(o.pickup_time)}</td>
                  <td className="muted">{o.notes}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        }
      </div>}
      {type === "contacts" && <div>
        <div className="hstack" style={{ marginBottom: 14 }}>
          <Card tight className="small"><span className="muted">Unique customers: </span><strong>{contacts.length}</strong></Card>
          <Card tight className="small"><span className="muted">With email: </span><strong className="ok">{contactsWithEmail.length}</strong></Card>
          <Button variant="primary" icon="download" onClick={() => downloadContactCSV(false)}>Download all (.csv)</Button>
          <Button variant="outline" icon="download" onClick={() => downloadContactCSV(true)}>Email list only (.csv)</Button>
        </div>
        {contacts.length === 0 ? <Empty>No contacts yet.</Empty> :
          <div className="tbl-wrap">
            <table className="tbl">
              {th(["Name", "Phone", "Email", "Location", "Last order", "Orders"])}
              <tbody>{contacts.map((c, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{c.name}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{c.phone}</td>
                  <td className={c.email ? "" : "faint"}>{c.email || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{c.location}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(c.last_order_date)}</td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: "var(--brand)" }}>{c.order_count}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        }
      </div>}
    </div>
  );
}

function StockRow({ stock, onSet }) {
  const tone = stock <= 0 ? "danger" : stock <= 5 ? "warn" : "ok";
  const text = stock <= 0 ? "Out of stock" : stock <= 5 ? `Low (${stock})` : `${stock} units`;
  return (
    <div className="hstack" style={{ flexWrap: "nowrap" }}>
      <div className="stepper">
        <button type="button" onClick={() => onSet(stock - 1)} aria-label="Decrease">−</button>
        <Input type="number" key={stock} defaultValue={stock} min={0} onBlur={e => onSet(e.target.value)} />
        <button type="button" onClick={() => onSet(stock + 1)} aria-label="Increase">+</button>
      </div>
      <span className={cx("xs", tone)} style={{ minWidth: 70 }}>{text}</span>
    </div>
  );
}

function Inventory({ activeLoc, can, inv, refreshInv, items, user }) {
  // Managers may only adjust their own store; admins follow the store switcher ("All stores" shows every location)
  const invLoc = can("admin") ? activeLoc : user.location_id;
  const locs = invLoc ? LOCS.filter(l => l.id === invLoc) : LOCS;
  const parentItems = items.filter(i => i.active !== false && !i.parent_id);
  const childItems = items.filter(i => i.active !== false && i.parent_id);

  const set = async (locId, itemId, val) => {
    const stock = Math.max(0, parseInt(val) || 0);
    const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", locId).eq("item_id", itemId).maybeSingle();
    if (existing) await supabase.from("inventory").update({ stock }).eq("id", existing.id);
    else await supabase.from("inventory").insert({ location_id: locId, item_id: itemId, stock });
    await refreshInv();
  };

  return (
    <div>
      <p className="h1">Inventory</p>
      {locs.map(loc => <div key={loc.id} style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow brand" style={{ marginBottom: 8 }}>{loc.name}</p>
        {parentItems.map(parent => {
          const children = childItems.filter(c => c.parent_id === parent.id);
          const stock = inv[`${loc.id}_${parent.id}`] ?? 0;
          return <Card key={parent.id} tight style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <p style={{ fontWeight: children.length ? 600 : 500 }}>{parent.name}</p>
                {children.length > 0 && <p className="xs muted" style={{ marginTop: 2 }}>Shared pool · covers plain & oven ready</p>}
              </div>
              <StockRow stock={stock} onSet={v => set(loc.id, parent.id, v)} />
            </div>
            {children.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
              {children.map(child => (
                <div key={child.id} className="small muted" style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>↳ {child.name}</span>
                  <span className="xs faint">draws from pool above</span>
                </div>
              ))}
            </div>}
          </Card>;
        })}
      </div>)}
    </div>
  );
}

const SOLD_BY = [["each", "Each (by the piece)"], ["lb", "By the pound (lb)"], ["person", "Per person"]];
const LABEL_MODES = [["default", "Default (follow Sold by)"], ["each", "Label each piece"], ["line", "One label per line"]];
// Plain-English summary of how an item's labels print.
function labelRuleText(it) {
  const mode = it?.label_mode || "default";
  const sold = it?.sold_by || "each";
  const soldTxt = sold === "lb" ? "Sold by lb" : sold === "person" ? "Sold per person" : "Sold each";
  const perPiece = mode === "each" || (mode === "default" && sold === "each");
  return `${soldTxt} · ${perPiece ? "1 label per piece" : "1 label per line"}${mode !== "default" ? " (override)" : ""}`;
}
function ItemLabelFields({ value, onChange }) {
  return <div className="grid2" style={{ marginBottom: 10 }}>
    <Field label="Sold by">
      <Select value={value.sold_by || "each"} onChange={e => onChange({ sold_by: e.target.value })}>{SOLD_BY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
    </Field>
    <Field label="Labels">
      <Select value={value.label_mode || "default"} onChange={e => onChange({ label_mode: e.target.value })}>{LABEL_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
    </Field>
  </div>;
}

function Admin({ users, refreshUsers, items, refreshItems, user, can, printerIps = {}, setPrinterIps, paperOn = {}, setPaperOn }) {
  const [tab, setTab] = useState("users");
  const isAdmin = can("admin");
  // Managers only see and manage clerks at their own store
  const visibleUsers = isAdmin ? users : users.filter(u => u.location_id === user.location_id && u.role === "clerk");
  const canManageUser = (u) => isAdmin || (u.role === "clerk" && u.location_id === user.location_id);
  const [pin, setPin] = useState("");
  const validPin = (p, excludeId) => {
    if (!p) return "";
    if (!/^[0-9]{4}$/.test(p)) return "PIN must be exactly 4 digits.";
    if (users.find(u => u.pin === p && u.id !== excludeId)) return "That PIN is already in use.";
    return "";
  };
  const [printerEdits, setPrinterEdits] = useState({});
  const [printerSaving, setPrinterSaving] = useState({});
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("clerk");
  const [locationId, setLocationId] = useState(user.location_id);
  const [ni, setNi] = useState({ name: "", parent_id: "", sold_by: "each", label_mode: "default" });
  const [ue, setUe] = useState("");
  const [ie, setIe] = useState("");
  const [editingUser, setEditingUser] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [gmailTokens, setGmailTokens] = useState({});
  const [gmailLoading, setGmailLoading] = useState(false);

  // Validate gmail tokens against live Gmail API
  const loadGmailTokens = async () => {
    setGmailLoading(true);
    try {
      const r = await fetch("/api/auth/status");
      const json = await r.json();
      if (json.statuses) setGmailTokens(json.statuses);
    } catch (e) {
      console.error("Failed to load Gmail statuses", e);
    } finally {
      setGmailLoading(false);
    }
  };

  useEffect(() => { loadGmailTokens(); }, []);

  const parentItems = items.filter(i => !i.parent_id);
  const grouped = parentItems.map(parent => ({
    parent,
    children: items.filter(i => i.parent_id === parent.id)
  }));

  const addU = async () => {
    if (!name || !username || !password || !locationId) { setUe("Name, username, password and home store are required."); return; }
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) { setUe("Username taken."); return; }
    const pe = validPin(pin); if (pe) { setUe(pe); return; }
    const { error } = await supabase.from("users").insert({ name, username, password, role: isAdmin ? role : "clerk", location_id: isAdmin ? locationId : user.location_id, pin: pin || null });
    if (error) { setUe(error.message.includes("users_pin_unique") ? "That PIN is already in use." : error.message); return; }
    await refreshUsers();
    setName(""); setUsername(""); setPassword(""); setPin(""); setRole("clerk"); setLocationId(user.location_id); setUe("");
  };

  const remU = async id => {
    if (id === user.id) return;
    if (!confirm("Remove user?")) return;
    await supabase.from("users").delete().eq("id", id);
    await refreshUsers();
  };

  const saveEditUser = async () => {
    if (!editingUser.name || !editingUser.username || !editingUser.password || !editingUser.location_id) { setUe("Name, username, password and home store are required."); return; }
    const pe = validPin(editingUser.pin, editingUser.id); if (pe) { setUe(pe); return; }
    const { error } = await supabase.from("users").update({
      name: editingUser.name, username: editingUser.username, password: editingUser.password,
      role: isAdmin ? editingUser.role : "clerk", location_id: isAdmin ? editingUser.location_id : user.location_id, pin: editingUser.pin || null,
    }).eq("id", editingUser.id);
    if (error) { setUe(error.message.includes("users_pin_unique") ? "That PIN is already in use." : error.message); return; }
    await refreshUsers();
    setEditingUser(null); setUe("");
  };

  const addI = async () => {
    if (!ni.name.trim()) { setIe("Name required."); return; }
    const { error } = await supabase.from("items").insert({
      id: `item_${Date.now()}`,
      name: ni.name.trim(),
      active: true,
      parent_id: ni.parent_id || null,
      sold_by: ni.sold_by || "each",
      label_mode: ni.label_mode || "default",
    });
    if (error) { setIe(error.message); return; }
    await refreshItems();
    setNi({ name: "", parent_id: "", sold_by: "each", label_mode: "default" }); setIe("");
  };

  const saveEditItem = async () => {
    const { error } = await supabase.from("items").update({
      name: editingItem.name,
      parent_id: editingItem.parent_id || null,
      active: editingItem.active,
      sold_by: editingItem.sold_by || "each",
      label_mode: editingItem.label_mode || "default",
    }).eq("id", editingItem.id);
    if (error) { alert(`Couldn't save item: ${error.message}`); return; }
    await refreshItems();
    setEditingItem(null);
  };

  const togI = async (id, active) => {
    await supabase.from("items").update({ active: !active }).eq("id", id);
    await refreshItems();
  };

  const roleSelect = (value, onChange) => (
    <Select value={value} onChange={onChange} disabled={!isAdmin}>
      <option value="clerk">Clerk</option>
      {isAdmin && <option value="manager">Manager</option>}
      {isAdmin && <option value="admin">Admin</option>}
      {can("master_admin") && <option value="master_admin">Master Admin</option>}
    </Select>
  );
  const locSelect = (value, onChange) => (
    <Select value={value} onChange={onChange} disabled={!isAdmin}>
      {LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
    </Select>
  );

  return (
    <div>
      <p className="h1">{isAdmin ? "Admin" : "Users"}</p>
      {isAdmin && <div className="pills" style={{ marginBottom: 16 }}>
        {[["users", "Users"], ["items", "Items"], ["gmail", "Gmail"], ["printers", "Printers"]].map(([t, l]) => <Pill key={t} on={tab === t} onClick={() => { setTab(t); if (t === "gmail") loadGmailTokens(); }}>{l}</Pill>)}
      </div>}

      {tab === "gmail" && <div>
        <div className="hstack" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <p className="small muted">Connect each location's Gmail account to enable email receipts.</p>
          <Button size="sm" icon="refresh" onClick={loadGmailTokens} disabled={gmailLoading}>{gmailLoading ? "Checking…" : "Refresh"}</Button>
        </div>
        {LOCS.map(loc => {
          const status = gmailTokens[loc.id];
          const isConnected = status?.connected === true;
          const isInvalid = status && status.connected === false;
          return <Card key={loc.id} tight row style={{ marginBottom: 8, borderColor: isInvalid ? "var(--danger)" : undefined }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 600 }}>{loc.name}</p>
              {gmailLoading
                ? <p className="xs faint">Checking…</p>
                : isConnected
                  ? <p className="xs ok">Connected · {status.email} · Last authorized {new Date(status.updated_at).toLocaleDateString()}</p>
                  : isInvalid
                    ? <p className="xs danger">Token invalid or revoked — reconnect required</p>
                    : <p className="xs danger">Not connected</p>
              }
            </div>
            <a href={`/api/auth/gmail?locationId=${loc.id}`} className={cx("btn", "btn-sm", isConnected ? "btn-outline" : "btn-primary")} style={{ textDecoration: "none" }}>
              {isConnected || isInvalid ? "Reconnect" : "Connect Gmail"}
            </a>
          </Card>;
        })}
      </div>}

      {tab === "users" && <div>
        <Card style={{ marginBottom: 16 }}>
          <p className="h2" style={{ marginBottom: 12 }}>Add user</p>
          <div className="grid2">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
            <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" />
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
            <Input value={pin} inputMode="numeric" maxLength={4} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4-digit PIN (for quick login)" />
            {roleSelect(isAdmin ? role : "clerk", e => setRole(e.target.value))}
            {locSelect(isAdmin ? locationId : user.location_id, e => setLocationId(e.target.value))}
          </div>
          <p className="xs muted" style={{ margin: "10px 0" }}>Home store is where the user's orders default to. {isAdmin ? "" : "Managers can add clerks for their own store only."}</p>
          {ue && !editingUser && <p className="xs danger" style={{ marginBottom: 10 }}>{ue}</p>}
          <Button variant="primary" icon="plus" onClick={addU}>Add user</Button>
        </Card>

        {visibleUsers.map(u => {
          const isEditing = editingUser?.id === u.id;
          return <Card key={u.id} tight style={{ marginBottom: 6 }}>
            {isEditing ? (
              <div>
                <div className="grid2" style={{ marginBottom: 10 }}>
                  <Input value={editingUser.name} onChange={e => setEditingUser(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
                  <Input value={editingUser.username} onChange={e => setEditingUser(f => ({ ...f, username: e.target.value }))} placeholder="Username" />
                  <PasswordInput value={editingUser.password} onChange={e => setEditingUser(f => ({ ...f, password: e.target.value }))} placeholder="Password" />
                  <Input value={editingUser.pin || ""} inputMode="numeric" maxLength={4} onChange={e => setEditingUser(f => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="4-digit PIN" />
                  {roleSelect(editingUser.role, e => setEditingUser(f => ({ ...f, role: e.target.value })))}
                  {locSelect(editingUser.location_id || "", e => setEditingUser(f => ({ ...f, location_id: e.target.value })))}
                </div>
                {ue && <p className="xs danger" style={{ marginBottom: 10 }}>{ue}</p>}
                <div className="hstack">
                  <Button variant="primary" onClick={saveEditUser}>Save</Button>
                  <Button onClick={() => setEditingUser(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 600 }}>{u.name} <span className="muted" style={{ fontWeight: 400 }}>@{u.username}</span></p>
                  <p className="xs muted">{ROLES[u.role]} · {LOCS.find(l => l.id === u.location_id)?.name || "No home store"} · {u.pin ? "PIN set" : <span className="warn">No PIN</span>}</p>
                </div>
                {canManageUser(u) && <div className="hstack" style={{ flexWrap: "nowrap" }}>
                  <Button variant="ghost" size="sm" onClick={() => { setEditingUser({ ...u }); setUe(""); }}>Edit</Button>
                  {u.id !== user.id && <Button variant="ghost" size="sm" className="danger" onClick={() => remU(u.id)}>Remove</Button>}
                </div>}
              </div>
            )}
          </Card>;
        })}
      </div>}

      {tab === "items" && <div>
        <Card style={{ marginBottom: 16 }}>
          <p className="h2" style={{ marginBottom: 12 }}>Add item</p>
          <Field label="Item name"><Input value={ni.name} onChange={e => setNi(f => ({ ...f, name: e.target.value }))} placeholder="Item name" onKeyDown={e => e.key === "Enter" && addI()} /></Field>
          <Field label="Parent item" hint="Optional — for shared inventory pools">
            <Select value={ni.parent_id} onChange={e => setNi(f => ({ ...f, parent_id: e.target.value }))}>
              <option value="">No parent — standalone item</option>
              {parentItems.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <ItemLabelFields value={ni} onChange={ch => setNi(f => ({ ...f, ...ch }))} />
          {ie && <p className="xs danger" style={{ marginBottom: 10 }}>{ie}</p>}
          <Button variant="primary" icon="plus" onClick={addI}>Add item</Button>
        </Card>

        {grouped.map(({ parent, children }) => (
          <Card key={parent.id} tight style={{ marginBottom: 8, opacity: parent.active === false ? 0.5 : 1 }}>
            {editingItem?.id === parent.id ? (
              <div>
                <Field label="Name"><Input value={editingItem.name} onChange={e => setEditingItem(f => ({ ...f, name: e.target.value }))} /></Field>
                <ItemLabelFields value={editingItem} onChange={ch => setEditingItem(f => ({ ...f, ...ch }))} />
                <div className="hstack">
                  <Button variant="primary" onClick={saveEditItem}>Save</Button>
                  <Button onClick={() => setEditingItem(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: children.length > 0 ? 600 : 500 }}>{parent.name}</p>
                  {children.length > 0 && <p className="xs muted">Shared pool</p>}
                  <p className="xs faint">{labelRuleText(parent)}</p>
                </div>
                <div className="hstack" style={{ flexWrap: "nowrap" }}>
                  <Button variant="ghost" size="sm" onClick={() => setEditingItem({ ...parent })}>Edit</Button>
                  <Button variant="ghost" size="sm" className={parent.active === false ? "ok" : "muted"} onClick={() => togI(parent.id, parent.active)}>{parent.active === false ? "Enable" : "Disable"}</Button>
                </div>
              </div>
            )}
            {children.length > 0 && <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
              {children.map(child => (
                <div key={child.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "4px 0", opacity: child.active === false ? 0.5 : 1 }}>
                  {editingItem?.id === child.id ? (
                    <div style={{ flex: 1 }}>
                      <Field label="Name"><Input value={editingItem.name} onChange={e => setEditingItem(f => ({ ...f, name: e.target.value }))} /></Field>
                      <Field label="Parent">
                        <Select value={editingItem.parent_id || ""} onChange={e => setEditingItem(f => ({ ...f, parent_id: e.target.value || null }))}>
                          <option value="">No parent</option>
                          {parentItems.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </Field>
                      <ItemLabelFields value={editingItem} onChange={ch => setEditingItem(f => ({ ...f, ...ch }))} />
                      <div className="hstack">
                        <Button variant="primary" size="sm" onClick={saveEditItem}>Save</Button>
                        <Button size="sm" onClick={() => setEditingItem(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="small ellipsis">↳ {child.name} <span className="xs faint">· {labelRuleText(child)}</span></span>
                      <div className="hstack" style={{ flexWrap: "nowrap" }}>
                        <Button variant="ghost" size="sm" onClick={() => setEditingItem({ ...child })}>Edit</Button>
                        <Button variant="ghost" size="sm" className={child.active === false ? "ok" : "muted"} onClick={() => togI(child.id, child.active)}>{child.active === false ? "Enable" : "Disable"}</Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>}
          </Card>
        ))}
      </div>}

      {tab === "printers" && <div>
        <p className="small muted" style={{ marginBottom: 14 }}>
          Email is the default receipt. Turn on <b>Paper receipts</b> for a store to show the Print button on the order confirmation screen.
        </p>
        {LOCS.map(loc => {
          const current = printerIps[loc.id] || "";
          const edited = printerEdits[loc.id] !== undefined ? printerEdits[loc.id] : current;
          const saving = printerSaving[loc.id];
          const savePrinter = async () => {
            setPrinterSaving(s => ({ ...s, [loc.id]: true }));
            const ip = (printerEdits[loc.id] || "").trim();
            await supabase.from("printer_settings").upsert({ location_id: loc.id, printer_ip: ip || null }, { onConflict: "location_id" });
            setPrinterIps(prev => ({ ...prev, [loc.id]: ip || null }));
            setPrinterEdits(e => { const n = { ...e }; delete n[loc.id]; return n; });
            setPrinterSaving(s => ({ ...s, [loc.id]: false }));
          };
          const paper = !!paperOn[loc.id];
          const togglePaper = async (next) => {
            setPaperOn(p => ({ ...p, [loc.id]: next }));
            const { error } = await supabase.from("printer_settings").upsert({ location_id: loc.id, paper_receipts_enabled: next }, { onConflict: "location_id" });
            if (error) { setPaperOn(p => ({ ...p, [loc.id]: paper })); alert("Could not save: " + error.message); }
          };
          return (
            <Card key={loc.id} tight style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <p style={{ fontWeight: 600 }}>{loc.name}</p>
                <Toggle on={paper} onChange={togglePaper} label={`Paper receipts ${paper ? "on" : "off"}`} />
              </div>
              <div className="hstack" style={{ flexWrap: "nowrap", opacity: paper ? 1 : 0.5 }}>
                <Input mono value={edited} onChange={e => setPrinterEdits(prev => ({ ...prev, [loc.id]: e.target.value }))} placeholder="e.g. 192.168.4.200" style={{ flex: 1 }} />
                <Button variant="primary" onClick={savePrinter} disabled={saving || edited === current}>{saving ? "Saving…" : "Save"}</Button>
              </div>
              {current && <p className="xs muted" style={{ marginTop: 6 }}>Saved printer address: {current}</p>}
            </Card>
          );
        })}
      </div>}
    </div>
  );
}
