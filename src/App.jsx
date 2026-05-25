import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const LOCS = [
  { id: "nhp", name: "New Hyde Park", address: "1538 Union Turnpike, Lake Success Center", city: "New Hyde Park, NY 11040", phone: "(516) 488-5600" },
  { id: "wantagh", name: "Wantagh", address: "1166 Wantagh Avenue", city: "Wantagh, NY 11793", phone: "(516) 781-6400" },
  { id: "maspeth", name: "Maspeth", address: "6900 Grand Avenue", city: "Maspeth, NY 11378", phone: "(718) 639-3623" },
  { id: "woodbury", name: "Woodbury", address: "7929 Jericho Turnpike", city: "Woodbury, NY 11797", phone: "(516) 921-5400" },
  { id: "gardencity", name: "Garden City", address: "140 7th Street", city: "Garden City, NY 11530", phone: "(516) 266-8800" },
];

const ROLES = { master_admin: "Master Admin", admin: "Admin", manager: "Manager", clerk: "Clerk" };
const SCOLOR = { pending: { bg: "#fff8e1", txt: "#e65100" }, completed: { bg: "#e8f5e9", txt: "#2e7d32" }, cancelled: { bg: "#ffebee", txt: "#c62828" } };

const tod = () => new Date().toISOString().split("T")[0];
const nowT = () => new Date().toTimeString().slice(0, 5);

function printReceipt(o, items, locs) {
  const item = items.find(i => i.id === o.item_id);
  const loc = locs.find(l => l.id === o.location_id);
  const w = window.open("", "_blank", "width=420,height=650");
  if (!w) { alert("Please allow popups to print."); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Order #${o.invoice_number}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;padding:20px;max-width:300px;margin:0 auto}
    h2{font-size:17px;text-align:center;letter-spacing:1px;margin:0 0 3px}
    .c{text-align:center}.s{font-size:10px;color:#666;text-align:center}
    .d{border-top:1px dashed #aaa;margin:10px 0}
    .big{font-size:40px;font-weight:bold;text-align:center;margin:4px 0;color:#8B1A2B}
    .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:8px 0 2px}
    .val{font-size:13px;font-weight:bold}
  </style></head><body>`);
  w.document.write(`<h2>IAVARONE BROS.</h2><p class="s">${loc?.address}<br>${loc?.city}<br>${loc?.phone}</p>`);
  w.document.write(`<div class="d"></div><p class="lbl">Daily order #</p><p class="big">${o.daily_number}</p>`);
  w.document.write(`<p class="lbl">Invoice</p><p class="val">#${o.invoice_number}</p>`);
  w.document.write(`<div class="d"></div><p class="lbl">Customer</p><p class="val">${o.customer_name}</p><p>${o.customer_phone}</p>`);
  w.document.write(`<div class="d"></div><p class="lbl">Item</p><p class="val">${item?.name || ""}</p>`);
  w.document.write(`<div class="d"></div><p class="lbl">Order placed</p><p>${o.order_date} at ${o.order_time}</p>`);
  w.document.write(`<p class="lbl">Pickup</p><p class="val">${o.pickup_date} at ${o.pickup_time}</p>`);
  if (o.notes) w.document.write(`<div class="d"></div><p class="lbl">Notes</p><p>${o.notes}</p>`);
  w.document.write(`<div class="d"></div><p class="c s">Taken by ${o.taken_by}</p>`);
  w.document.write(`<script>window.onload=function(){window.print();}<\/script></body></html>`);
  w.document.close();
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("login");
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [inv, setInv] = useState({});
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.from("users").select("*");
      const { data: o } = await supabase.from("orders").select("*");
      const { data: i } = await supabase.from("inventory").select("*");
      const { data: it } = await supabase.from("items").select("*");
      setUsers(u || []);
      setOrders(o || []);
      const invMap = {};
      (i || []).forEach(r => { invMap[`${r.location_id}_${r.item_id}`] = r.stock; });
      setInv(invMap);
      setItems(it || []);
      setReady(true);
    })();
  }, []);

  const refreshOrders = async () => { const { data } = await supabase.from("orders").select("*"); setOrders(data || []); };
  const refreshInv = async () => { const { data } = await supabase.from("inventory").select("*"); const m = {}; (data || []).forEach(r => { m[`${r.location_id}_${r.item_id}`] = r.stock; }); setInv(m); };
  const refreshItems = async () => { const { data } = await supabase.from("items").select("*"); setItems(data || []); };
  const refreshUsers = async () => { const { data } = await supabase.from("users").select("*"); setUsers(data || []); };

  const can = (min) => { const h = ["clerk", "manager", "admin", "master_admin"]; return h.indexOf(user?.role) >= h.indexOf(min); };
  const logout = () => { setUser(null); setView("login"); };

  if (!ready) return <div style={{ padding: "3rem", textAlign: "center", color: "#888" }}>Loading...</div>;
  if (view === "login") return <Login users={users} onLogin={u => { setUser(u); setView("orders"); }} />;

  const loc = user.location_id ? LOCS.find(l => l.id === user.location_id) : null;

  return (
    <div style={{ fontFamily: "system-ui,sans-serif", fontSize: 14, background: "#f5f5f5", minHeight: "100vh" }}>
      <Nav user={user} loc={loc} view={view} setView={setView} can={can} onLogout={logout} />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "1rem" }}>
        {view === "orders" && <Orders user={user} orders={orders} refresh={refreshOrders} inv={inv} refreshInv={refreshInv} items={items} can={can} />}
        {view === "new_order" && <NewOrder user={user} orders={orders} refresh={refreshOrders} inv={inv} refreshInv={refreshInv} items={items} setView={setView} />}
        {view === "reports" && <Reports orders={orders} items={items} user={user} />}
        {view === "inventory" && can("manager") && <Inventory inv={inv} refreshInv={refreshInv} items={items} user={user} />}
        {view === "admin" && can("admin") && <Admin users={users} refreshUsers={refreshUsers} items={items} refreshItems={refreshItems} user={user} can={can} />}
      </div>
    </div>
  );
}

function Login({ users, onLogin }) {
  const [f, setF] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const go = () => {
    const u = users.find(u => u.username === f.username && u.password === f.password);
    if (!u) { setErr("Invalid username or password."); return; }
    onLogin(u);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem", background: "#f5f5f5" }}>
      <div style={{ width: "100%", maxWidth: 320 }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#8B1A2B", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: 20, fontWeight: 700, color: "#fff" }}>IB</div>
          <p style={{ fontSize: 17, fontWeight: 500 }}>Iavarone Bros.</p>
          <p style={{ color: "#888", fontSize: 12 }}>Turkey Order System</p>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: 20 }}>
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Username</p>
            <input value={f.username} onChange={e => setF(x => ({ ...x, username: e.target.value }))} onKeyDown={e => e.key === "Enter" && go()} placeholder="Username" style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Password</p>
            <input type="password" value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} onKeyDown={e => e.key === "Enter" && go()} placeholder="Password" style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
          </div>
          {err && <p style={{ color: "#c62828", fontSize: 12, marginBottom: 10 }}>{err}</p>}
          <butto
