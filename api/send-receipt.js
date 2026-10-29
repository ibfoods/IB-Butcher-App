import PDFDocument from "pdfkit";
import { WORDMARK_B64, WORDMARK_BUFFER, WORDMARK_W, WORDMARK_H } from "./_logo.js";
import { gmailFor, b64lines } from "./_gmail.js";
import { orderNumberText, orderMonthText, orderSeqText, qtyText } from "./_order.js";

const RED = "#900027";

const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
};
const fmtDateLong = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};
const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};
const takenByInitials = (name) => {
  if (!name) return "";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const firstName = (full) => (full || "").trim().split(" ")[0] || "there";

function buildEmailHtml(order, orderItems, items, loc) {
  const itemRows = (orderItems || []).map(li => {
    const item = (items || []).find(i => i.id === li.item_id);
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#222;">${esc(item?.name || "")}${li.note ? `<div style="font-size:12px;color:#777;margin-top:2px;">${esc(li.note)}</div>` : ""}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#666;text-align:right;white-space:nowrap;vertical-align:top;">${esc(qtyText(item, li.quantity))}</td>
    </tr>`;
  }).join("");

  const cell = (label, value, bold) => `
    <td style="padding:0 6px 14px 0;vertical-align:top;width:50%;">
      <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#999;margin-bottom:3px;">${label}</div>
      <div style="font-size:14px;color:#222;${bold ? "font-weight:bold;" : ""}">${value}</div>
    </td>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e4;">

  <!-- Header -->
  <tr><td style="background:#fff;padding:28px 24px 18px;text-align:center;border-bottom:4px solid ${RED};">
    <img src="cid:iblogo" width="300" alt="Iavarone Bros. — Quality Foods" style="display:block;margin:0 auto;width:300px;max-width:100%;height:auto;">
    <div style="color:#777;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin-top:12px;">${esc(loc?.name || "")}</div>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:26px 24px 8px;">
    <div style="font-size:16px;color:#222;margin-bottom:6px;">Hi ${esc(firstName(order.customer_name))},</div>
    <div style="font-size:14px;color:#555;line-height:1.5;">Thanks for your order. Here's your confirmation — please bring this email or mention your order number at pickup.</div>
  </td></tr>

  <!-- Order number -->
  <tr><td style="padding:12px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5f6;border:1px solid #efe1e4;border-radius:10px;">
      <tr><td style="padding:16px;text-align:center;">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${RED};">Your order number</div>
        <div style="font-size:48px;font-weight:bold;color:${RED};line-height:1.1;margin-top:2px;">${esc(orderNumberText(order))}</div>
        <div style="font-size:12px;color:#888;margin-top:4px;">${esc(loc?.name || "")} · pickup ${esc(fmtDate(order.pickup_date))}</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Pickup -->
  <tr><td style="padding:8px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid ${RED};background:#fafafa;border-radius:0 8px 8px 0;">
      <tr><td style="padding:12px 14px;">
        <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#999;margin-bottom:3px;">Pickup</div>
        <div style="font-size:16px;font-weight:bold;color:#222;">${esc(fmtDateLong(order.pickup_date))} at ${esc(fmtTime(order.pickup_time))}</div>
        <div style="font-size:13px;color:#555;margin-top:4px;">${esc(loc?.name || "")} · ${esc(loc?.address || "")}, ${esc(loc?.city || "")}</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Customer -->
  <tr><td style="padding:20px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${cell("Name", esc(order.customer_name), true)}
      ${cell("Phone", esc(order.customer_phone), false)}
    </tr></table>
  </td></tr>

  <!-- Items -->
  <tr><td style="padding:4px 24px 0;">
    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#999;border-bottom:2px solid ${RED};padding-bottom:6px;">Your Order</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
  </td></tr>

  ${order.notes ? `<tr><td style="padding:18px 24px 0;">
    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#999;margin-bottom:4px;">Notes</div>
    <div style="font-size:14px;color:#222;line-height:1.5;">${esc(order.notes)}</div>
  </td></tr>` : ""}

  <!-- Footer -->
  <tr><td style="padding:26px 24px 24px;">
    <div style="border-top:1px solid #eee;padding-top:16px;font-size:12px;color:#777;line-height:1.6;text-align:center;">
      Questions or changes? Just reply to this email or call <a href="tel:${esc((loc?.phone || "").replace(/\D/g, ""))}" style="color:${RED};text-decoration:none;font-weight:bold;">${esc(loc?.phone || "")}</a>.<br>
      <span style="color:#aaa;">Order taken by ${esc(takenByInitials(order.taken_by))}</span>
    </div>
  </td></tr>

</table>
<div style="font-size:11px;color:#aaa;margin-top:14px;text-align:center;">Iavarone Bros. · ${esc(loc?.address || "")}, ${esc(loc?.city || "")}</div>
<div style="font-size:10px;color:#bbb;margin-top:8px;text-align:center;">Made by <a href="https://orderhq.app" style="color:#999;text-decoration:none;font-weight:bold;">OrderHQ</a></div>
</td></tr></table>
</body></html>`;
}

function buildReceiptPdf(order, orderItems, items, loc) {
  return new Promise((resolve, reject) => {
    const pageW = 288;
    const M = 22;
    const W = pageW - M * 2;
    const doc = new PDFDocument({ size: [pageW, 720], margin: M, autoFirstPage: true });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GRAY = "#666666";
    const LIGHT = "#999999";
    const INK = "#111111";
    const dash = (y) => { doc.moveTo(M, y).lineTo(pageW - M, y).dash(3, { space: 3 }).strokeColor("#bbbbbb").lineWidth(1).stroke().undash(); };
    const label = (t, y, opts = {}) => doc.fontSize(7).fillColor(LIGHT).font("Helvetica").text(t.toUpperCase(), M, y, { width: W, characterSpacing: 1, ...opts });

    // Header: wordmark on white, maroon rule
    const lw = W, lh = Math.round(lw * WORDMARK_H / WORDMARK_W);
    try { doc.image(WORDMARK_BUFFER(), M, 22, { width: lw }); } catch (_) { doc.fontSize(14).fillColor(RED).font("Helvetica-Bold").text("IAVARONE BROS.", M, 30, { align: "center", width: W }); }
    doc.fontSize(8).fillColor("#777777").font("Helvetica").text((loc?.name || "").toUpperCase(), M, 22 + lh + 8, { align: "center", width: W, characterSpacing: 1.5 });
    doc.rect(0, 22 + lh + 24, pageW, 4).fill(RED);

    let y = 22 + lh + 44;

    // Order number block
    label(`${orderMonthText(order)} order #`, y, { align: "center" });
    y += 11;
    doc.fontSize(40).fillColor(RED).font("Helvetica-Bold").text(orderSeqText(order), M, y, { align: "center", width: W });
    y = doc.y + 2;
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(`${loc?.name || ""} · pickup ${fmtDate(order.pickup_date)}`, M, y, { align: "center", width: W });
    y = doc.y + 10;
    dash(y); y += 12;

    // Pickup (emphasized)
    doc.rect(M, y, 3, 34).fill(RED);
    doc.fontSize(7).fillColor(LIGHT).font("Helvetica").text("PICKUP", M + 12, y + 1, { width: W - 12, characterSpacing: 1 });
    doc.fontSize(11).fillColor(INK).font("Helvetica-Bold").text(`${fmtDateLong(order.pickup_date)} at ${fmtTime(order.pickup_time)}`, M + 12, y + 11, { width: W - 12 });
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(`${loc?.address || ""}, ${loc?.city || ""}`, M + 12, doc.y + 1, { width: W - 12 });
    y = Math.max(doc.y, y + 34) + 12;

    // Customer
    label("Customer", y); y += 10;
    doc.fontSize(11).fillColor(INK).font("Helvetica-Bold").text(order.customer_name || "", M, y, { width: W });
    y = doc.y + 1;
    doc.fontSize(10).fillColor(GRAY).font("Helvetica").text(order.customer_phone || "", M, y, { width: W });
    y = doc.y + 10;
    dash(y); y += 12;

    // Items
    label("Your order", y); y += 12;
    (orderItems || []).forEach(li => {
      const item = (items || []).find(i => i.id === li.item_id);
      if (!item) return;
      doc.fontSize(10).fillColor(INK).font("Helvetica-Bold").text(item.name, M, y, { width: W - 52 });
      doc.fontSize(10).fillColor(GRAY).font("Helvetica").text(qtyText(item, li.quantity), pageW - M - 48, y, { width: 48, align: "right" });
      if (li.note) { doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(li.note, M, doc.y + 1, { width: W - 52 }); }
      y = doc.y + 3;
      doc.moveTo(M, y).lineTo(pageW - M, y).strokeColor("#eeeeee").lineWidth(0.5).stroke().lineWidth(1);
      y += 6;
    });

    // Notes
    if (order.notes) {
      y += 4;
      label("Notes", y); y += 10;
      doc.fontSize(10).fillColor(INK).font("Helvetica").text(order.notes, M, y, { width: W });
      y = doc.y + 8;
    }

    // Footer
    y += 4; dash(y); y += 12;
    doc.fontSize(8).fillColor(GRAY).font("Helvetica")
      .text(`Questions? Call ${loc?.phone || ""}`, M, y, { align: "center", width: W });
    doc.fontSize(7).fillColor(LIGHT).text(`Order taken by ${takenByInitials(order.taken_by)}`, M, doc.y + 3, { align: "center", width: W });
    doc.fontSize(6).fillColor("#bbbbbb").text("Made by OrderHQ", M, doc.y + 10, { align: "center", width: W, link: "https://orderhq.app" });

    doc.end();
  });
}

// Multipart: mixed( related( html + inline logo ), pdf attachment )
function makeRawEmail({ from, to, subject, html, pdfBuffer, pdfFilename }) {
  const mixed = "mixed_" + Date.now();
  const related = "related_" + Date.now();
  const b64 = b64lines;

  const lines = [
    `From: Iavarone Bros. <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    ``,
    `--${mixed}`,
    `Content-Type: multipart/related; boundary="${related}"`,
    ``,
    `--${related}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64(Buffer.from(html, "utf8")),
    `--${related}`,
    `Content-Type: image/png`,
    `Content-Transfer-Encoding: base64`,
    `Content-ID: <iblogo>`,
    `Content-Disposition: inline; filename="iavarone-bros.png"`,
    ``,
    b64(Buffer.from(WORDMARK_B64, "base64")),
    `--${related}--`,
  ];

  if (pdfBuffer && pdfFilename) {
    lines.push(
      `--${mixed}`,
      `Content-Type: application/pdf; name="${pdfFilename}"`,
      `Content-Disposition: attachment; filename="${pdfFilename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64(pdfBuffer),
    );
  }

  lines.push(`--${mixed}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, locationId, order, orderItems, items, loc } = req.body;

  if (!to || !locationId || !order) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let gm;
  try { gm = await gmailFor(locationId); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    const { gmail, from: fromEmail } = gm;
    const html = buildEmailHtml(order, orderItems, items, loc);
    const pdfBuffer = await buildReceiptPdf(order, orderItems, items, loc);
    const pdfFilename = `IB-Order-${(loc?.name || locationId).replace(/\s+/g, "")}-${orderNumberText(order).replace(/[\s#]/g, "")}.pdf`;

    const raw = makeRawEmail({
      from: fromEmail,
      to,
      subject: `Your Iavarone Bros. order ${orderNumberText(order)} — pickup ${fmtDateLong(order.pickup_date)} at ${fmtTime(order.pickup_time)}`,
      html,
      pdfBuffer,
      pdfFilename,
    });

    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Gmail API send error:", err);
    res.status(500).json({ error: err.message });
  }
}
