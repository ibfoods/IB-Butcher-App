import { requireUser } from "./_auth.js";
// Emails the store's alert address when a manager overrides a sold-out item.
// Sent from that store's own Gmail (same OAuth tokens as receipts).
import { gmailFor, supabase, rawSimpleEmail } from "./_gmail.js";
import { orderNumberText, qtyText } from "./_order.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d) => { if (!d) return ""; const [y, m, day] = d.split("-"); return `${m}/${day}/${y.slice(2)}`; };
const fmtTime = (t) => { if (!t) return ""; const [h, m] = t.split(":"); const hour = parseInt(h); return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireUser(req, res, "clerk")) return;
  const { locationId, order, overs, loc, placedBy } = req.body || {};
  if (!locationId || !order || !Array.isArray(overs) || overs.length === 0) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { data: settings } = await supabase.from("printer_settings").select("alert_email").eq("location_id", locationId).maybeSingle();
  const to = (settings?.alert_email || "").trim();
  if (!to) return res.status(200).json({ ok: false, skipped: "no_alert_email" });

  let gm;
  try { gm = await gmailFor(locationId); }
  catch (e) { return res.status(200).json({ ok: false, skipped: e.message }); }

  const rows = overs.map(o => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;">${esc(o.itemName)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${esc(qtyText(o.item, o.requested))}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;color:#c62828;font-weight:bold;">${esc(String(o.available))}</td>
  </tr>`).join("");

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f2f2f2;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;border-radius:10px;">
    <tr><td style="padding:18px 22px;border-bottom:4px solid #900027;">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#900027;font-weight:bold;">Stock override · ${esc(loc?.name || locationId)}</div>
      <div style="font-size:18px;color:#222;margin-top:4px;">An order was placed for a sold-out item</div>
    </td></tr>
    <tr><td style="padding:18px 22px 6px;font-size:14px;color:#333;line-height:1.6;">
      <b>${esc(placedBy || "A manager")}</b> overrode the stock check on order <b>${esc(orderNumberText(order))}</b>
      for <b>${esc(order.customer_name)}</b> (${esc(order.customer_phone || "")}), pickup <b>${esc(fmtDate(order.pickup_date))} at ${esc(fmtTime(order.pickup_time))}</b>.
    </td></tr>
    <tr><td style="padding:6px 22px 18px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
        <tr style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#999;">
          <th style="text-align:left;padding:6px 10px;">Item</th><th style="text-align:right;padding:6px 10px;">Ordered</th><th style="text-align:right;padding:6px 10px;">Pool had</th>
        </tr>${rows}
      </table>
      <div style="font-size:12px;color:#777;margin-top:14px;">Inventory for this pool now shows the oversold amount. Adjust it in the app under Inventory once stock is sorted out.</div>
    </td></tr>
  </table>
  <div style="font-size:10px;color:#bbb;margin-top:10px;text-align:center;">IB Butcher App · Made by OrderHQ</div>
  </body></html>`;

  try {
    const raw = rawSimpleEmail({ from: gm.from, to, fromName: "IB Butcher App", subject: `Stock override — ${loc?.name || locationId} order ${orderNumberText(order)}`, html });
    await gm.gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("notify-stock send error:", err);
    return res.status(500).json({ error: err.message });
  }
}
