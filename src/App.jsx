import { useState, useEffect, useCallback } from "react";
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
const inp = { width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 };

const LOGO_URL = "/Iavarone-MONOGRAM 2024_black social.png";

function formatPhone(val) {
  const digits = val.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}

function printReceipt(o, items, locs) {
  const item = items.find(i => i.id === o.item_id);
  const loc = locs.find(l => l.id === o.location_id);
  const logoUrl = window.location.origin + LOGO_URL;
  const html = `<!DOCTYPE html><html><head><title>Order #${o.invoice_number}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;padding:20px;max-width:300px;margin:0 auto}
    h2{font-size:17px;text-align:center;letter-spacing:1px;margin:0 0 3px}
    .c{text-align:center}.s{font-size:10px;color:#666;text-align:center}
    .d{border-top:1px dashed #aaa;margin:10px 0}
    .big{font-size:40px;font-weight:bold;text-align:center;margin:4px 0;color:#8B1A2B}
    .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:8px 0 2px}
    .val{font-size:13px;font-weight:bold}
    .logo{display:block;margin:0 auto 8px;width:60px;height:60px;object-fit:contain}
  </style></head><body>
    <img src="${logoUrl}" class="logo" />
    <h2>IAVARONE BROS.</h2>
    <p class="s">${loc?.address}<br>${loc?.city}<br>${loc?.phone}</p>
    <div class="d"></div>
    <p class="lbl">Daily order #</p><p class="big">${o.daily_number}</p>
    <p class="lbl">Invoice</p><p class="val">#${o.invoice_number}</p>
    <div class="d"></div>
    <p class="lbl">Customer</p><p class="val">${o.customer_name}</p><p>${o.customer_phone}</p>
    <div class="d"></div>
    <p class="lbl">Item</p><p class="val">${item?.name || ""}</p>
    <div class="d"></div>
    <p class="lbl">Order placed</p><p>${o.order_date} at ${o.order_time}</p>
    <p class="lbl">Pickup</p><p class="val">${o.pickup_date} at ${o.pickup_time}</p>
    ${o.notes ? `<div class="d"></div><p class="lbl">Notes</p><p>${o.notes}</p>` : ""}
    <div class="d"></div>
    <p class="c s">Taken by ${o.taken_by}</p>
    <script>
      window.onload = function() {
        var img = document.querySelector('img');
        if (img.complete) { window.print(); }
        else { img.onload = function() { window.print(); }; }
      };
    <\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Please allow popups to print."); return; }
  w.document.write(html);
  w.document.close();
}

function F({ label, children }) {
  return <div style={{ marginBottom: 12 }}><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{label}</p>{children}</div>;
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

  const refreshOrders = useCallback(async () => { const { data } = await supabase.from("orders").select("*"); setOrders(data || []); }, []);
  const refreshInv = useCallback(async () => { const { data } = await supabase.from("inventory").select("*"); const m = {}; (data || []).forEach(r => { m[`${r.location_id}_${r.item_id}`] = r.stock; }); setInv(m); }, []);
  const refreshItems = useCallback(async () => { const { data } = await supabase.from("items").select("*"); setItems(data || []); }, []);
  const refreshUsers = useCallback(async () => { const { data } = await supabase.from("users").select("*"); setUsers(data || []); }, []);

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const go = () => {
    const u = users.find(u => u.username === username && u.password === password);
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
            <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Username" style={inp} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Password</p>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Password" style={inp} />
          </div>
          {err && <p style={{ color: "#c62828", fontSize: 12, marginBottom: 10 }}>{err}</p>}
          <button onClick={go} style={{ width: "100%", background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 8, padding: 10, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Sign in</button>
        </div>
      </div>
    </div>
  );
}

function Nav({ user, loc, view, setView, can, onLogout }) {
  const tabs = [
    { id: "orders", label: "Orders" },
    { id: "new_order", label: "New order" },
    { id: "reports", label: "Reports" },
    ...(can("manager") ? [{ id: "inventory", label: "Inventory" }] : []),
    ...(can("admin") ? [{ id: "admin", label: "Admin" }] : []),
  ];
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "10px 1rem 0" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#8B1A2B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>IB</div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500 }}>Iavarone Bros. {loc ? `— ${loc.name}` : "— All Locations"}</p>
              <p style={{ fontSize: 11, color: "#888" }}>{user.name} · {ROLES[user.role]}</p>
            </div>
          </div>
          <button onClick={onLogout} style={{ fontSize: 12, color: "#888", background: "none", border: "1px solid #ddd", borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}>Sign out</button>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{ fontSize: 12, padding: "7px 12px", background: "none", border: "none", borderBottom: view === t.id ? "2px solid #8B1A2B" : "2px solid transparent", color: view === t.id ? "#8B1A2B" : "#888", fontWeight: view === t.id ? 500 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Orders({ user, orders, refresh, inv, refreshInv, items, can }) {
  const [search, setSearch] = useState("");
  const [lf, setLf] = useState(user.location_id || "");
  const [df, setDf] = useState("");
  const [detail, setDetail] = useState(null);

  const filtered = orders.filter(o => {
    if (lf && o.location_id !== lf) return false;
    if (df && o.pickup_date !== df) return false;
    if (search && !o.customer_name.toLowerCase().includes(search.toLowerCase()) && !String(o.invoice_number).includes(search)) return false;
    return true;
  }).sort((a, b) => b.invoice_number - a.invoice_number);

  const cancel = async id => {
    if (!confirm("Cancel this order?")) return;
    const o = orders.find(x => x.id === id);
    if (o) {
      const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", o.location_id).eq("item_id", o.item_id).maybeSingle();
      if (existing) await supabase.from("inventory").update({ stock: existing.stock + 1 }).eq("id", existing.id);
      await refreshInv();
    }
    await supabase.from("orders").update({ status: "cancelled" }).eq("id", id);
    await refresh();
  };

  const complete = async id => {
    await supabase.from("orders").update({ status: "completed" }).eq("id", id);
    await refresh();
  };

  return (
    <div>
      {detail && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 20, maxWidth: 400, width: "100%", border: "1px solid #e8e8e8" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ fontWeight: 500 }}>Order #{detail.invoice_number}</p>
              <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", fontSize: 20, color: "#888", cursor: "pointer" }}>×</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[["Customer", detail.customer_name], ["Phone", detail.customer_phone], ["Item", items.find(i => i.id === detail.item_id)?.name], ["Location", LOCS.find(l => l.id === detail.location_id)?.name], ["Order date", `${detail.order_date} at ${detail.order_time}`], ["Pickup", `${detail.pickup_date} at ${detail.pickup_time}`], ["Daily #", `#${detail.daily_number}`], ["Invoice", `#${detail.invoice_number}`], ["Taken by", detail.taken_by], ["Status", detail.status], ...(detail.notes ? [["Notes", detail.notes]] : [])].map(([k, v]) => (
                  <tr key={k}><td style={{ color: "#888", width: "35%", fontSize: 12, padding: "5px 0" }}>{k}</td><td style={{ padding: "5px 0" }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => { setDetail(null); setTimeout(() => printReceipt(detail, items, LOCS), 200); }} style={{ marginTop: 12, width: "100%", background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Print receipt</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or invoice #" style={{ flex: 1, minWidth: 140, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
        {!user.location_id && <select value={lf} onChange={e => setLf(e.target.value)} style={{ minWidth: 130, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }}><option value="">All locations</option>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <input type="date" value={df} onChange={e => setDf(e.target.value)} style={{ minWidth: 130, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
      </div>
      {filtered.length === 0 ? <p style={{ color: "#888", textAlign: "center", padding: "2rem" }}>No orders found.</p> :
        filtered.map(o => {
          const item = items.find(i => i.id === o.item_id);
          const loc = LOCS.find(l => l.id === o.location_id);
          const sc = SCOLOR[o.status] || { bg: "#eee", txt: "#666" };
          return (
            <div key={o.id} onClick={() => setDetail(o)} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "10px 14px", marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ textAlign: "center", minWidth: 40 }}>
                <p style={{ fontSize: 20, fontWeight: 700, color: "#8B1A2B", lineHeight: 1, margin: 0 }}>#{o.daily_number}</p>
                <p style={{ fontSize: 9, color: "#aaa", margin: 0 }}>#{o.invoice_number}</p>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{o.customer_name}</p>
                <p style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{item?.name}</p>
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Pickup: {o.pickup_date} {o.pickup_time} · {loc?.name}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, background: sc.bg, color: sc.txt, fontWeight: 500 }}>{o.status}</span>
                {can("manager") && o.status === "pending" && (
                  <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => complete(o.id)} style={{ fontSize: 10, padding: "2px 7px", background: "#e8f5e9", color: "#2e7d32", border: "none", borderRadius: 5, cursor: "pointer" }}>Done</button>
                    <button onClick={() => cancel(o.id)} style={{ fontSize: 10, padding: "2px 7px", background: "#ffebee", color: "#c62828", border: "none", borderRadius: 5, cursor: "pointer" }}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

function NewOrder({ user, orders, refresh, inv, refreshInv, items, setView }) {
  const locs = user.location_id ? LOCS.filter(l => l.id === user.location_id) : LOCS;
  const [locationId, setLocationId] = useState(user.location_id || locs[0]?.id || "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("12:00");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const k = `${locationId}_${itemId}`;
  const stock = inv[k] ?? null;

  const handlePhone = e => setPhone(formatPhone(e.target.value));

  const submit = async () => {
    if (!firstName.trim()) { setErr("First name required."); return; }
    if (!lastName.trim()) { setErr("Last name required."); return; }
    if (!phone.trim()) { setErr("Phone required."); return; }
    if (!pickupDate) { setErr("Pickup date required."); return; }
    if (stock !== null && stock <= 0) { setErr("Out of stock at this location."); return; }

    const orderDate = tod();
    const orderTime = nowT();

    const { data: allOrders } = await supabase.from("orders").select("invoice_number, daily_number, location_id, order_date");
    const maxInvoice = (allOrders || []).reduce((m, o) => Math.max(m, o.invoice_number || 0), 999);
    const invoiceNumber = maxInvoice + 1;
    const dailyNumber = (allOrders || []).filter(o => o.location_id === locationId && o.order_date === orderDate).length + 1;
    const customerName = `${firstName.trim()} ${lastName.trim()}`;

    const newOrder = {
      id: `ord_${Date.now()}`,
      location_id: locationId,
      customer_name: customerName,
      customer_phone: phone,
      item_id: itemId,
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

    await supabase.from("orders").insert(newOrder);

    if (stock !== null) {
      const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", locationId).eq("item_id", itemId).maybeSingle();
      if (existing) await supabase.from("inventory").update({ stock: stock - 1 }).eq("id", existing.id);
      await refreshInv();
    }

    await refresh();
    setDone(true);
    setTimeout(() => { printReceipt(newOrder, items, LOCS); setView("orders"); }, 300);
  };

  if (done) return <div style={{ textAlign: "center", padding: "3rem" }}><p style={{ fontSize: 32 }}>✓</p><p style={{ fontWeight: 500, marginTop: 8 }}>Order placed!</p></div>;

  return (
    <div style={{ maxWidth: 500 }}>
      <p style={{ fontSize: 15, fontWeight: 500, marginBottom: "1rem" }}>New order</p>
      {!user.location_id && <F label="Location"><select value={locationId} onChange={e => setLocationId(e.target.value)} style={inp}>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <F label="First name"><input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" style={inp} /></F>
        <F label="Last name"><input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" style={inp} /></F>
      </div>
      <F label="Phone number"><input value={phone} onChange={handlePhone} placeholder="(xxx) xxx-xxxx" style={inp} /></F>
      <F label="Item">
        <select value={itemId} onChange={e => setItemId(e.target.value)} style={inp}>
          {items.filter(i => i.active !== false).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        {stock !== null && <p style={{ fontSize: 11, marginTop: 3, color: stock <= 0 ? "#c62828" : stock <= 5 ? "#e65100" : "#2e7d32" }}>{stock <= 0 ? "⚠ Out of stock" : stock <= 5 ? `⚠ Low stock (${stock} left)` : `${stock} in stock`}</p>}
      </F>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <F label="Pickup date"><input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)} style={inp} /></F>
        <F label="Pickup time"><input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} style={inp} /></F>
      </div>
      <F label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, height: 58, resize: "vertical" }} placeholder="Special instructions..." /></F>
      {err && <p style={{ color: "#c62828", fontSize: 12, marginBottom: 10 }}>{err}</p>}
      <button onClick={submit} style={{ width: "100%", background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 8, padding: 11, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Place order & print receipt</button>
    </div>
  );
}

function Reports({ orders, items, user }) {
  const [type, setType] = useState("popularity");
  const [from, setFrom] = useState(tod());
  const [to, setTo] = useState(tod());
  const [loc, setLoc] = useState(user.location_id || "");

  const fil = orders.filter(o => {
    if (loc && o.location_id !== loc) return false;
    if (o.pickup_date < from || o.pickup_date > to) return false;
    if (o.status === "cancelled") return false;
    return true;
  });

  const pop = items.map(i => ({ item: i, count: fil.filter(o => o.item_id === i.id).length })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  const prod = [...fil].sort((a, b) => a.location_id.localeCompare(b.location_id) || a.daily_number - b.daily_number);

  const printProd = () => {
    const ln = loc ? LOCS.find(l => l.id === loc)?.name : "All Locations";
    const logoUrl = window.location.origin + LOGO_URL;
    const html = `<!DOCTYPE html><html><head><title>Production</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
      h2{margin:0 0 3px}p.sub{margin:0 0 12px;color:#666}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;border-bottom:2px solid #000;padding:6px 8px;font-size:10px;text-transform:uppercase}
      td{padding:6px 8px;border-bottom:1px solid #eee;font-size:12px}
      .logo{width:50px;height:50px;object-fit:contain;margin-bottom:8px}
    </style></head><body>
      <img src="${logoUrl}" class="logo" />
      <h2>Production Report — Iavarone Bros.</h2>
      <p class="sub">Pickup: ${from === to ? from : `${from} to ${to}`} · ${ln}</p>
      <table><thead><tr>
        <th>#</th><th>Invoice</th><th>Location</th><th>Customer</th><th>Phone</th><th>Item</th><th>Pickup time</th><th>Notes</th>
      </tr></thead><tbody>
        ${prod.map(o => {
          const it = items.find(i => i.id === o.item_id);
          const l = LOCS.find(l => l.id === o.location_id);
          return `<tr><td>${o.daily_number}</td><td>#${o.invoice_number}</td><td>${l?.name||""}</td><td>${o.customer_name}</td><td>${o.customer_phone}</td><td>${it?.name||""}</td><td>${o.pickup_time}</td><td>${o.notes||""}</td></tr>`;
        }).join("")}
      </tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Allow popups to print."); return; }
    w.document.write(html);
    w.document.close();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...inp, minWidth: 130, width: "auto" }}>
          <option value="popularity">Popularity</option>
          <option value="production">Production</option>
        </select>
        {!user.location_id && <select value={loc} onChange={e => setLoc(e.target.value)} style={{ ...inp, minWidth: 130, width: "auto" }}><option value="">All locations</option>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, minWidth: 130, width: "auto" }} />
        <span style={{ color: "#888", fontSize: 12 }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, minWidth: 130, width: "auto" }} />
        {type === "production" && <button onClick={printProd} style={{ ...inp, width: "auto", background: "#fff", cursor: "pointer" }}>Print</button>}
      </div>
      {type === "popularity" && <div>
        <p style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>{fil.length} orders · pickup {from === to ? from : `${from} – ${to}`}</p>
        {pop.length === 0 ? <p style={{ color: "#888", textAlign: "center", padding: "1.5rem" }}>No orders in this range.</p> :
          pop.map(r => <div key={r.item.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "9px 14px", marginBottom: 6, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#8B1A2B", minWidth: 32, textAlign: "center" }}>{r.count}</span>
            <span style={{ fontSize: 13 }}>{r.item.name}</span>
          </div>)
        }
      </div>}
      {type === "production" && <div>
        <p style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>{prod.length} orders</p>
        {prod.length === 0 ? <p style={{ color: "#888", textAlign: "center", padding: "1.5rem" }}>No orders in this range.</p> :
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "1px solid #eee" }}>{["#", "Invoice", "Location", "Customer", "Phone", "Item", "Pickup", "Notes"].map(h => <th key={h} style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, color: "#888", fontWeight: 500, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{prod.map(o => {
                const it = items.find(i => i.id === o.item_id);
                const l = LOCS.find(l => l.id === o.location_id);
                return <tr key={o.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "7px 8px", fontWeight: 700, color: "#8B1A2B" }}>{o.daily_number}</td>
                  <td style={{ padding: "7px 8px", color: "#888" }}>#{o.invoice_number}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{l?.name}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{o.customer_name}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{o.customer_phone}</td>
                  <td style={{ padding: "7px 8px" }}>{it?.name}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{o.pickup_date} {o.pickup_time}</td>
                  <td style={{ padding: "7px 8px", color: "#888" }}>{o.notes}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        }
      </div>}
    </div>
  );
}

function Inventory({ inv, refreshInv, items, user }) {
  const locs = user.location_id ? LOCS.filter(l => l.id === user.location_id) : LOCS;
  const set = async (lid, iid, val) => {
    const stock = Math.max(0, parseInt(val) || 0);
    const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", lid).eq("item_id", iid).maybeSingle();
    if (existing) await supabase.from("inventory").update({ stock }).eq("id", existing.id);
    else await supabase.from("inventory").insert({ location_id: lid, item_id: iid, stock });
    await refreshInv();
  };
  return (
    <div>
      <p style={{ fontSize: 15, fontWeight: 500, marginBottom: "1rem" }}>Inventory</p>
      {locs.map(loc => <div key={loc.id} style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#8B1A2B", marginBottom: 8 }}>{loc.name}</p>
        {items.filter(i => i.active !== false).map(item => {
          const stock = inv[`${loc.id}_${item.id}`] ?? 0;
          return <div key={item.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "9px 14px", marginBottom: 5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, flex: 1 }}>{item.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => set(loc.id, item.id, stock - 1)} style={{ width: 26, height: 26, borderRadius: "50%", background: "none", border: "1px solid #ddd", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
              <input type="number" defaultValue={stock} key={`${loc.id}_${item.id}_${stock}`} min={0} onBlur={e => set(loc.id, item.id, e.target.value)} style={{ width: 50, textAlign: "center", padding: "5px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
              <button onClick={() => set(loc.id, item.id, stock + 1)} style={{ width: 26, height: 26, borderRadius: "50%", background: "none", border: "1px solid #ddd", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
              <span style={{ fontSize: 11, minWidth: 60, color: stock <= 0 ? "#c62828" : stock <= 5 ? "#e65100" : "#2e7d32" }}>{stock <= 0 ? "Out of stock" : stock <= 5 ? `Low (${stock})` : `${stock} units`}</span>
            </div>
          </div>;
        })}
      </div>)}
    </div>
  );
}

function Admin({ users, refreshUsers, items, refreshItems, user, can }) {
  const [tab, setTab] = useState("users");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("clerk");
  const [locationId, setLocationId] = useState("");
  const [ni, setNi] = useState("");
  const [ue, setUe] = useState("");
  const [ie, setIe] = useState("");

  const addU = async () => {
    if (!name || !username || !password) { setUe("All fields required."); return; }
    if (users.find(u => u.username === username)) { setUe("Username taken."); return; }
    await supabase.from("users").insert({ name, username, password, role, location_id: locationId || null });
    await refreshUsers();
    setName(""); setUsername(""); setPassword(""); setRole("clerk"); setLocationId(""); setUe("");
  };
  const remU = async id => {
    if (id === user.id) return;
    if (!confirm("Remove user?")) return;
    await supabase.from("users").delete().eq("id", id);
    await refreshUsers();
  };
  const addI = async () => {
    if (!ni.trim()) { setIe("Name required."); return; }
    await supabase.from("items").insert({ id: `item_${Date.now()}`, name: ni.trim(), active: true });
    await refreshItems();
    setNi(""); setIe("");
  };
  const togI = async (id, active) => {
    await supabase.from("items").update({ active: !active }).eq("id", id);
    await refreshItems();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: "1rem" }}>
        {["users", "items"].map(t => <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, padding: "6px 14px", background: tab === t ? "#8B1A2B" : "#fff", color: tab === t ? "#fff" : "#888", border: "1px solid #ddd", borderRadius: 7, cursor: "pointer" }}>{t === "users" ? "Users" : "Items"}</button>)}
      </div>
      {tab === "users" && <div>
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Add user</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={inp} />
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" style={inp} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" style={inp} />
            <select value={role} onChange={e => setRole(e.target.value)} style={inp}>
              <option value="clerk">Clerk</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              {can("master_admin") && <option value="master_admin">Master Admin</option>}
            </select>
            <select value={locationId} onChange={e => setLocationId(e.target.value)} style={inp}>
              <option value="">All locations</option>
              {LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {ue && <p style={{ color: "#c62828", fontSize: 12, marginBottom: 8 }}>{ue}</p>}
          <button onClick={addU} style={{ fontSize: 12, padding: "6px 14px", background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer" }}>Add user</button>
        </div>
        {users.map(u => <div key={u.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "10px 14px", marginBottom: 5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{u.name} <span style={{ fontWeight: 400, color: "#888" }}>@{u.username}</span></p>
            <p style={{ fontSize: 11, color: "#888", margin: 0 }}>{ROLES[u.role]} · {u.location_id ? LOCS.find(l => l.id === u.location_id)?.name : "All locations"}</p>
          </div>
          {u.id !== user.id && <button onClick={() => remU(u.id)} style={{ fontSize: 12, color: "#c62828", background: "none", border: "none", cursor: "pointer" }}>Remove</button>}
        </div>)}
      </div>}
      {tab === "items" && <div>
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Add item</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={ni} onChange={e => setNi(e.target.value)} placeholder="Item name" style={{ ...inp, flex: 1 }} onKeyDown={e => e.key === "Enter" && addI()} />
            <button onClick={addI} style={{ fontSize: 12, padding: "7px 14px", background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Add item</button>
          </div>
          {ie && <p style={{ color: "#c62828", fontSize: 12, marginTop: 6 }}>{ie}</p>}
        </div>
        {items.map(item => <div key={item.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "10px 14px", marginBottom: 5, display: "flex", alignItems: "center", justifyContent: "space-between", opacity: item.active === false ? 0.45 : 1 }}>
          <span style={{ fontSize: 13 }}>{item.name}</span>
          <button onClick={() => togI(item.id, item.active)} style={{ fontSize: 12, color: item.active === false ? "#2e7d32" : "#888", background: "none", border: "none", cursor: "pointer" }}>{item.active === false ? "Enable" : "Disable"}</button>
        </div>)}
      </div>}
    </div>
  );
}
