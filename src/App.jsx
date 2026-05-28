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
const LOGO_URL = "/logo.jpg";

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
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

function printReceipt(order, orderItems, items, locs) {
  const loc = locs.find(l => l.id === order.location_id);
  const logoUrl = window.location.origin + LOGO_URL;
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
    .big{font-size:40px;font-weight:bold;text-align:center;margin:4px 0;color:#8B1A2B}
    .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:8px 0 2px}
    .val{font-size:13px;font-weight:bold;margin:1px 0}
    .logo{display:block;margin:0 auto 8px;width:70px;height:70px;object-fit:contain}
  </style></head><body>
    <img src="${logoUrl}" class="logo" />
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

function labelHTML(orders, orderItemsMap, items, locs) {
  const logoUrl = window.location.origin + LOGO_URL;
  const labelsHtml = orders.map(o => {
    const loc = locs.find(l => l.id === o.location_id);
    const lineItems = (orderItemsMap[o.id] || []);
    const itemLines = lineItems.map(li => {
      const item = items.find(i => i.id === li.item_id);
      return `<div class="item">${li.quantity > 1 ? `${li.quantity}x ` : ""}${item?.name || ""}</div>`;
    }).join("");
    return `
      <div class="label">
        <div class="top-row">
          <div class="logo-area">
            <img src="${logoUrl}" class="logo" />
            <span class="website">www.ibfoods.com</span>
          </div>
          <div class="daily-num">${o.daily_number}</div>
        </div>
        <div class="customer">${o.customer_name}</div>
        ${itemLines}
        <div class="bottom-row">
          <div class="details">
            <div class="detail-line"><span class="lbl">Pickup</span> ${fmtDate(o.pickup_date)} at ${fmtTime(o.pickup_time)}</div>
            <div class="detail-line"><span class="lbl">Invoice</span> #${o.invoice_number}</div>
            <div class="detail-line"><span class="lbl">Location</span> ${loc?.name || ""}</div>
            ${o.notes ? `<div class="detail-line notes"><span class="lbl">Notes</span> ${o.notes}</div>` : ""}
          </div>
          <div class="qr-placeholder">
            <div class="qr-box"></div>
            <div class="qr-text">Scan for<br/>instructions</div>
          </div>
        </div>
      </div>
    `;
  }).join('<div class="page-break"></div>');

  return `<!DOCTYPE html><html><head><title>Labels</title><style>
    @page { size: 4in 2.5in landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: white; }
    .label { width: 4in; height: 2.5in; padding: 0.12in 0.15in; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .page-break { page-break-after: always; }
    .top-row { display: flex; justify-content: space-between; align-items: flex-start; }
    .logo-area { display: flex; flex-direction: column; align-items: flex-start; }
    .logo { width: 0.55in; height: 0.55in; object-fit: contain; }
    .website { font-size: 6pt; color: #666; margin-top: 2px; }
    .daily-num { font-size: 52pt; font-weight: 900; line-height: 1; color: #000; text-align: right; }
    .customer { font-size: 16pt; font-weight: 700; line-height: 1.1; margin: 0.03in 0 0.01in; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .item { font-size: 8.5pt; font-weight: 500; color: #333; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .bottom-row { display: flex; justify-content: space-between; align-items: flex-end; }
    .details { flex: 1; }
    .detail-line { font-size: 7.5pt; line-height: 1.4; }
    .lbl { font-weight: 700; text-transform: uppercase; font-size: 6pt; letter-spacing: 0.5px; }
    .notes { color: #444; margin-top: 2px; }
    .qr-placeholder { display: flex; flex-direction: column; align-items: center; margin-left: 0.1in; }
    .qr-box { width: 0.6in; height: 0.6in; border: 1.5px dashed #999; }
    .qr-text { font-size: 5.5pt; color: #999; text-align: center; margin-top: 2px; line-height: 1.3; }
  </style></head><body>
    ${labelsHtml}
    <script>
      window.onload = function() {
        var imgs = document.querySelectorAll('img');
        var loaded = 0;
        if (imgs.length === 0) { window.print(); return; }
        imgs.forEach(function(img) {
          if (img.complete) { loaded++; if (loaded === imgs.length) window.print(); }
          else { img.onload = function() { loaded++; if (loaded === imgs.length) window.print(); }; }
        });
      };
    <\/script>
  </body></html>`;
}

function printLabels(orders, orderItemsMap, items, locs) {
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow popups to print."); return; }
  w.document.write(labelHTML(orders, orderItemsMap, items, locs));
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
  const [orderItems, setOrderItems] = useState([]);
  const [inv, setInv] = useState({});
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.from("users").select("*");
      const { data: o } = await supabase.from("orders").select("*");
      const { data: oi } = await supabase.from("order_items").select("*");
      const { data: i } = await supabase.from("inventory").select("*");
      const { data: it } = await supabase.from("items").select("*");
      setUsers(u || []);
      setOrders(o || []);
      setOrderItems(oi || []);
      const invMap = {};
      (i || []).forEach(r => { invMap[`${r.location_id}_${r.item_id}`] = r.stock; });
      setInv(invMap);
      setItems(it || []);
      setReady(true);
    })();
  }, []);

  const refreshOrders = useCallback(async () => {
    const { data: o } = await supabase.from("orders").select("*");
    const { data: oi } = await supabase.from("order_items").select("*");
    setOrders(o || []);
    setOrderItems(oi || []);
  }, []);
  const refreshInv = useCallback(async () => { const { data } = await supabase.from("inventory").select("*"); const m = {}; (data || []).forEach(r => { m[`${r.location_id}_${r.item_id}`] = r.stock; }); setInv(m); }, []);
  const refreshItems = useCallback(async () => { const { data } = await supabase.from("items").select("*"); setItems(data || []); }, []);
  const refreshUsers = useCallback(async () => { const { data } = await supabase.from("users").select("*"); setUsers(data || []); }, []);

  const orderItemsMap = {};
  orderItems.forEach(oi => {
    if (!orderItemsMap[oi.order_id]) orderItemsMap[oi.order_id] = [];
    orderItemsMap[oi.order_id].push(oi);
  });

  const can = (min) => { const h = ["clerk", "manager", "admin", "master_admin"]; return h.indexOf(user?.role) >= h.indexOf(min); };
  const logout = () => { setUser(null); setView("login"); };

  if (!ready) return <div style={{ padding: "3rem", textAlign: "center", color: "#888" }}>Loading...</div>;
  if (view === "login") return <Login users={users} onLogin={u => { setUser(u); setView("orders"); }} />;

  const loc = user.location_id ? LOCS.find(l => l.id === user.location_id) : null;

  return (
    <div style={{ fontFamily: "system-ui,sans-serif", fontSize: 14, background: "#f5f5f5", minHeight: "100vh" }}>
      <Nav user={user} loc={loc} view={view} setView={setView} can={can} onLogout={logout} />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "1rem" }}>
        {view === "orders" && <Orders user={user} orders={orders} orderItemsMap={orderItemsMap} refresh={refreshOrders} inv={inv} refreshInv={refreshInv} items={items} can={can} />}
        {view === "new_order" && <NewOrder user={user} orders={orders} refresh={refreshOrders} inv={inv} refreshInv={refreshInv} items={items} setView={setView} />}
        {view === "reports" && <Reports orders={orders} orderItemsMap={orderItemsMap} items={items} user={user} />}
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
          <p style={{ color: "#888", fontSize: 12 }}>Butcher Order System</p>
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

function Orders({ user, orders, orderItemsMap, refresh, inv, refreshInv, items, can }) {
  const [search, setSearch] = useState("");
  const [lf, setLf] = useState(user.location_id || "");
  const [df, setDf] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const filtered = orders.filter(o => {
    if (!showCancelled && o.status === "cancelled") return false;
    if (lf && o.location_id !== lf) return false;
    if (df && o.pickup_date !== df) return false;
    if (search && !o.customer_name.toLowerCase().includes(search.toLowerCase()) && !String(o.invoice_number).includes(search)) return false;
    return true;
  }).sort((a, b) => b.invoice_number - a.invoice_number);

  const openDetail = (o) => {
    setDetail(o);
    setEditing(false);
    setEditForm(null);
  };

  const startEdit = (o) => {
    const nameParts = o.customer_name.split(" ");
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
    const firstName = nameParts.slice(0, nameParts.length > 1 ? -1 : 1).join(" ");
    setEditForm({
      firstName,
      lastName,
      customer_phone: o.customer_phone,
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
        const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", o.location_id).eq("item_id", li.item_id).maybeSingle();
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

  return (
    <div>
      {detail && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 20, maxWidth: 440, width: "100%", border: "1px solid #e8e8e8", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ fontWeight: 500 }}>Order #{detail.invoice_number}</p>
              <button onClick={() => { setDetail(null); setEditing(false); }} style={{ background: "none", border: "none", fontSize: 20, color: "#888", cursor: "pointer" }}>×</button>
            </div>

            {!editing ? (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {[
                      ["Customer", detail.customer_name],
                      ["Phone", detail.customer_phone],
                      ["Pickup", `${fmtDate(detail.pickup_date)} at ${fmtTime(detail.pickup_time)}`],
                      ["Invoice", `#${detail.invoice_number}`],
                      ["Location", LOCS.find(l => l.id === detail.location_id)?.name],
                      ["Order placed", `${fmtDate(detail.order_date)} at ${fmtTime(detail.order_time)}`],
                      ["Daily #", `#${detail.daily_number}`],
                      ["Taken by", detail.taken_by],
                      ["Status", detail.status],
                      ...(detail.notes ? [["Notes", detail.notes]] : [])
                    ].map(([k, v]) => (
                      <tr key={k}><td style={{ color: "#888", width: "35%", fontSize: 12, padding: "5px 0" }}>{k}</td><td style={{ padding: "5px 0" }}>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 10, borderTop: "0.5px solid #eee", paddingTop: 10 }}>
                  <p style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Items</p>
                  {(orderItemsMap[detail.id] || []).map((li, i) => {
                    const item = items.find(x => x.id === li.item_id);
                    return <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0", borderBottom: "1px dotted #eee" }}>
                      <span>{item?.name}</span>
                      <span style={{ color: "#888" }}>x{li.quantity}</span>
                    </div>;
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => startEdit(detail)} style={{ flex: 1, background: "#fff", color: "#555", border: "1px solid #ddd", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => { setDetail(null); setTimeout(() => printReceipt(detail, orderItemsMap[detail.id] || [], items, LOCS), 200); }} style={{ flex: 1, background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Print receipt</button>
                  <button onClick={() => { setDetail(null); setTimeout(() => printLabels([detail], { [detail.id]: orderItemsMap[detail.id] || [] }, items, LOCS), 200); }} style={{ flex: 1, background: "#fff", color: "#8B1A2B", border: "1px solid #8B1A2B", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Print label</button>
                </div>
                {detail.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={() => complete(detail.id)} style={{ flex: 1, background: "#e8f5e9", color: "#2e7d32", border: "none", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Mark complete</button>
                    <button onClick={() => cancel(detail.id)} style={{ flex: 1, background: "#ffebee", color: "#c62828", border: "none", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Cancel order</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>First name</p><input value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} style={inp} /></div>
                  <div><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Last name</p><input value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} style={inp} /></div>
                </div>
                <div style={{ marginBottom: 10 }}><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Phone</p><input value={editForm.customer_phone} onChange={e => setEditForm(f => ({ ...f, customer_phone: formatPhone(e.target.value) }))} style={inp} /></div>
                {!user.location_id && <div style={{ marginBottom: 10 }}><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Location</p><select value={editForm.location_id} onChange={e => setEditForm(f => ({ ...f, location_id: e.target.value }))} style={inp}>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Pickup date</p><input type="date" value={editForm.pickup_date} onChange={e => setEditForm(f => ({ ...f, pickup_date: e.target.value }))} style={inp} /></div>
                  <div><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Pickup time</p><input type="time" value={editForm.pickup_time} onChange={e => setEditForm(f => ({ ...f, pickup_time: e.target.value }))} style={inp} /></div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Items</p>
                  {editForm.lineItems.map((li, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <select value={li.item_id} onChange={e => setEditForm(f => ({ ...f, lineItems: f.lineItems.map((x, idx) => idx === i ? { ...x, item_id: e.target.value } : x) }))} style={{ ...inp, flex: 3 }}>
                        {items.filter(x => x.active !== false).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <input type="number" min={1} value={li.quantity} onChange={e => setEditForm(f => ({ ...f, lineItems: f.lineItems.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x) }))} style={{ ...inp, width: 60, flex: "none" }} />
                      {editForm.lineItems.length > 1 && <button onClick={() => setEditForm(f => ({ ...f, lineItems: f.lineItems.filter((_, idx) => idx !== i) }))} style={{ background: "none", border: "none", color: "#c62828", fontSize: 18, cursor: "pointer", padding: "0 4px" }}>×</button>}
                    </div>
                  ))}
                  <button onClick={() => setEditForm(f => ({ ...f, lineItems: [...f.lineItems, { item_id: items[0]?.id || "", quantity: 1 }] }))} style={{ fontSize: 12, color: "#8B1A2B", background: "none", border: "1px solid #8B1A2B", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>+ Add item</button>
                </div>
                <div style={{ marginBottom: 12 }}><p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Notes</p><textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inp, height: 58, resize: "vertical" }} /></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveEdit} style={{ flex: 1, background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Save changes</button>
                  <button onClick={() => setEditing(false)} style={{ flex: 1, background: "#fff", color: "#555", border: "1px solid #ddd", borderRadius: 8, padding: 9, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or invoice #" style={{ flex: 1, minWidth: 140, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
        {!user.location_id && <select value={lf} onChange={e => setLf(e.target.value)} style={{ minWidth: 130, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }}><option value="">All locations</option>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <input type="date" value={df} onChange={e => setDf(e.target.value)} style={{ minWidth: 130, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#888", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />
          Show cancelled
        </label>
      </div>

      {filtered.length === 0 ? <p style={{ color: "#888", textAlign: "center", padding: "2rem" }}>No orders found.</p> :
        filtered.map(o => {
          const loc = LOCS.find(l => l.id === o.location_id);
          const sc = SCOLOR[o.status] || { bg: "#eee", txt: "#666" };
          const lineItems = orderItemsMap[o.id] || [];
          const itemSummary = lineItems.map(li => {
            const item = items.find(i => i.id === li.item_id);
            return `${li.quantity > 1 ? `${li.quantity}x ` : ""}${item?.name || ""}`;
          }).join(", ");
          return (
            <div key={o.id} onClick={() => openDetail(o)} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "10px 14px", marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, opacity: o.status === "cancelled" ? 0.6 : 1 }}>
              <div style={{ textAlign: "center", minWidth: 40 }}>
                <p style={{ fontSize: 20, fontWeight: 700, color: "#8B1A2B", lineHeight: 1, margin: 0 }}>#{o.daily_number}</p>
                <p style={{ fontSize: 9, color: "#aaa", margin: 0 }}>#{o.invoice_number}</p>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{o.customer_name}</p>
                <p style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{itemSummary}</p>
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Pickup: {fmtDate(o.pickup_date)} {fmtTime(o.pickup_time)} · {loc?.name}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, background: sc.bg, color: sc.txt, fontWeight: 500 }}>{o.status}</span>
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
  const [lineItems, setLineItems] = useState([{ item_id: items[0]?.id || "", quantity: 1 }]);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("12:00");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const handlePhone = e => setPhone(formatPhone(e.target.value));
  const addLineItem = () => setLineItems(li => [...li, { item_id: items[0]?.id || "", quantity: 1 }]);
  const removeLineItem = i => setLineItems(li => li.filter((_, idx) => idx !== i));
  const updateLineItem = (i, field, val) => setLineItems(li => li.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

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

    await supabase.from("orders").insert(newOrder);

    const orderItemRows = lineItems.map(li => ({
      order_id: newOrder.id,
      item_id: li.item_id,
      quantity: parseInt(li.quantity) || 1,
    }));
    await supabase.from("order_items").insert(orderItemRows);

    for (const li of lineItems) {
      const k = `${locationId}_${li.item_id}`;
      const currentStock = inv[k] ?? null;
      if (currentStock !== null) {
        const { data: existing } = await supabase.from("inventory").select("*").eq("location_id", locationId).eq("item_id", li.item_id).maybeSingle();
        if (existing) await supabase.from("inventory").update({ stock: Math.max(0, existing.stock - (parseInt(li.quantity) || 1)) }).eq("id", existing.id);
      }
    }
    await refreshInv();
    await refresh();
    setDone(true);
    setTimeout(() => { printReceipt(newOrder, orderItemRows, items, LOCS); setView("orders"); }, 300);
  };

  if (done) return <div style={{ textAlign: "center", padding: "3rem" }}><p style={{ fontSize: 32 }}>✓</p><p style={{ fontWeight: 500, marginTop: 8 }}>Order placed!</p></div>;

  return (
    <div style={{ maxWidth: 520 }}>
      <p style={{ fontSize: 15, fontWeight: 500, marginBottom: "1rem" }}>New order</p>
      {!user.location_id && <F label="Location"><select value={locationId} onChange={e => setLocationId(e.target.value)} style={inp}>{LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <F label="First name"><input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" style={inp} /></F>
        <F label="Last name"><input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" style={inp} /></F>
      </div>
      <F label="Phone number"><input value={phone} onChange={handlePhone} placeholder="(xxx) xxx-xxxx" style={inp} /></F>
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Items</p>
        {lineItems.map((li, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <select value={li.item_id} onChange={e => updateLineItem(i, "item_id", e.target.value)} style={{ ...inp, flex: 3 }}>
              {items.filter(x => x.active !== false).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input type="number" min={1} value={li.quantity} onChange={e => updateLineItem(i, "quantity", e.target.value)} style={{ ...inp, width: 60, flex: "none" }} />
            {lineItems.length > 1 && <button onClick={() => removeLineItem(i)} style={{ background: "none", border: "none", color: "#c62828", fontSize: 18, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>×</button>}
          </div>
        ))}
        <button onClick={addLineItem} style={{ fontSize: 12, color: "#8B1A2B", background: "none", border: "1px solid #8B1A2B", borderRadius: 7, padding: "5px 12px", cursor: "pointer", marginTop: 2 }}>+ Add item</button>
      </div>
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

function Reports({ orders, orderItemsMap, items, user }) {
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

  const popMap = {};
  fil.forEach(o => {
    (orderItemsMap[o.id] || []).forEach(li => {
      if (!popMap[li.item_id]) popMap[li.item_id] = 0;
      popMap[li.item_id] += parseInt(li.quantity) || 1;
    });
  });
  const pop = items.map(i => ({ item: i, count: popMap[i.id] || 0 })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  const prod = [...fil].sort((a, b) => a.location_id.localeCompare(b.location_id) || a.daily_number - b.daily_number);

  const printPop = () => {
    const ln = loc ? LOCS.find(l => l.id === loc)?.name : "All Locations";
    const logoUrl = window.location.origin + LOGO_URL;
    const html = `<!DOCTYPE html><html><head><title>Popularity Report</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
      h2{margin:0 0 3px}p.sub{margin:0 0 12px;color:#666}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;border-bottom:2px solid #000;padding:6px 8px;font-size:10px;text-transform:uppercase}
      td{padding:6px 8px;border-bottom:1px solid #eee;font-size:12px}
      .logo{width:50px;height:50px;object-fit:contain;margin-bottom:8px}
    </style></head><body>
      <img src="${logoUrl}" class="logo" />
      <h2>Popularity Report — Iavarone Bros.</h2>
      <p class="sub">Pickup: ${fmtDate(from) === fmtDate(to) ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`} · ${ln}</p>
      <table><thead><tr><th>Qty</th><th>Item</th></tr></thead><tbody>
        ${pop.map(r => `<tr><td>${r.count}</td><td>${r.item.name}</td></tr>`).join("")}
      </tbody></table>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Allow popups to print."); return; }
    w.document.write(html);
    w.document.close();
  };

  const printProd = () => {
    const ln = loc ? LOCS.find(l => l.id === loc)?.name : "All Locations";
    const logoUrl = window.location.origin + LOGO_URL;
    const html = `<!DOCTYPE html><html><head><title>Production</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
      h2{margin:0 0 3px}p.sub{margin:0 0 12px;color:#666}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;border-bottom:2px solid #000;padding:6px 8px;font-size:10px;text-transform:uppercase}
      td{padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;vertical-align:top}
      .logo{width:50px;height:50px;object-fit:contain;margin-bottom:8px}
    </style></head><body>
      <img src="${logoUrl}" class="logo" />
      <h2>Production Report — Iavarone Bros.</h2>
      <p class="sub">Pickup: ${fmtDate(from) === fmtDate(to) ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`} · ${ln}</p>
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
        {type === "popularity" && <button onClick={printPop} style={{ ...inp, width: "auto", background: "#fff", cursor: "pointer" }}>Print</button>}
        {type === "production" && <>
          <button onClick={printProd} style={{ ...inp, width: "auto", background: "#fff", cursor: "pointer" }}>Print</button>
          <button onClick={() => printLabels(prod, orderItemsMap, items, LOCS)} style={{ ...inp, width: "auto", background: "#fff", cursor: "pointer", color: "#8B1A2B", borderColor: "#8B1A2B" }}>Print labels</button>
        </>}
      </div>
      {type === "popularity" && <div>
        <p style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>{fil.length} orders · pickup {fmtDate(from) === fmtDate(to) ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`}</p>
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
              <thead><tr style={{ borderBottom: "1px solid #eee" }}>{["#", "Invoice", "Location", "Customer", "Phone", "Items", "Pickup", "Notes"].map(h => <th key={h} style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, color: "#888", fontWeight: 500, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{prod.map(o => {
                const l = LOCS.find(l => l.id === o.location_id);
                const lineItems = (orderItemsMap[o.id] || []).map(li => {
                  const it = items.find(i => i.id === li.item_id);
                  return `${li.quantity > 1 ? `${li.quantity}x ` : ""}${it?.name || ""}`;
                });
                return <tr key={o.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "7px 8px", fontWeight: 700, color: "#8B1A2B" }}>{o.daily_number}</td>
                  <td style={{ padding: "7px 8px", color: "#888" }}>#{o.invoice_number}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{l?.name}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{o.customer_name}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{o.customer_phone}</td>
                  <td style={{ padding: "7px 8px" }}>{lineItems.map((li, i) => <div key={i}>{li}</div>)}</td>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{fmtDate(o.pickup_date)} {fmtTime(o.pickup_time)}</td>
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
  const [editingUser, setEditingUser] = useState(null);

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

  const saveEdit = async () => {
    await supabase.from("users").update({
      name: editingUser.name,
      username: editingUser.username,
      password: editingUser.password,
      role: editingUser.role,
      location_id: editingUser.location_id || null,
    }).eq("id", editingUser.id);
    await refreshUsers();
    setEditingUser(null);
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

        {users.map(u => {
          const isEditing = editingUser?.id === u.id;
          return <div key={u.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: "10px 14px", marginBottom: 5 }}>
            {isEditing ? (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input value={editingUser.name} onChange={e => setEditingUser(f => ({ ...f, name: e.target.value }))} placeholder="Full name" style={inp} />
                  <input value={editingUser.username} onChange={e => setEditingUser(f => ({ ...f, username: e.target.value }))} placeholder="Username" style={inp} />
                  <input type="password" value={editingUser.password} onChange={e => setEditingUser(f => ({ ...f, password: e.target.value }))} placeholder="Password" style={inp} />
                  <select value={editingUser.role} onChange={e => setEditingUser(f => ({ ...f, role: e.target.value }))} style={inp}>
                    <option value="clerk">Clerk</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                    {can("master_admin") && <option value="master_admin">Master Admin</option>}
                  </select>
                  <select value={editingUser.location_id || ""} onChange={e => setEditingUser(f => ({ ...f, location_id: e.target.value || null }))} style={inp}>
                    <option value="">All locations</option>
                    {LOCS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveEdit} style={{ fontSize: 12, padding: "6px 14px", background: "#8B1A2B", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer" }}>Save</button>
                  <button onClick={() => setEditingUser(null)} style={{ fontSize: 12, padding: "6px 14px", background: "none", border: "1px solid #ddd", borderRadius: 7, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{u.name} <span style={{ fontWeight: 400, color: "#888" }}>@{u.username}</span></p>
                  <p style={{ fontSize: 11, color: "#888", margin: 0 }}>{ROLES[u.role]} · {u.location_id ? LOCS.find(l => l.id === u.location_id)?.name : "All locations"}</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setEditingUser({ ...u })} style={{ fontSize: 12, color: "#8B1A2B", background: "none", border: "none", cursor: "pointer" }}>Edit</button>
                  {u.id !== user.id && <button onClick={() => remU(u.id)} style={{ fontSize: 12, color: "#c62828", background: "none", border: "none", cursor: "pointer" }}>Remove</button>}
                </div>
              </div>
            )}
          </div>;
        })}
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
