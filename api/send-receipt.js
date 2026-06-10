import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LOCATION_EMAIL = {
  woodbury:   "Woodbury@ibfoods.com",
  wantagh:    "Wantagh@ibfoods.com",
  gardencity: "Gardencity@ibfoods.com",
  maspeth:    "Maspeth@ibfoods.com",
  nhp:        "Newhydepark@ibfoods.com",
};

const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
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

function buildEmailHtml(order, orderItems, items, loc) {
  const itemLines = (orderItems || []).map(li => {
    const item = (items || []).find(i => i.id === li.item_id);
    return `<tr>
      <td style="padding:6px 0;border-bottom:1px dotted #ddd;font-weight:bold;font-size:13px;">${item?.name || ""}</td>
      <td style="padding:6px 0;border-bottom:1px dotted #ddd;text-align:right;color:#666;font-size:12px;">x${li.quantity}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;font-size:12px;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:320px;margin:0 auto;background:#fff;border-radius:10px;padding:24px;border:1px solid #e0e0e0;">
    <div style="text-align:center;margin-bottom:16px;">
      <p style="font-size:17px;font-weight:bold;letter-spacing:1px;margin:0 0 4px;">IAVARONE BROS.</p>
      <p style="font-size:11px;color:#666;margin:0;">${loc?.address || ""}<br>${loc?.city || ""}<br>${loc?.phone || ""}</p>
    </div>
    <hr style="border:none;border-top:1px dashed #aaa;margin:12px 0;">
    <div style="text-align:center;margin:8px 0;">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 2px;">Daily Order #</p>
      <p style="font-size:42px;font-weight:bold;color:#8B1A2B;margin:0;line-height:1;">${order.daily_number}</p>
    </div>
    <hr style="border:none;border-top:1px dashed #aaa;margin:12px 0;">
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 2px;">Customer</p>
    <p style="font-size:13px;font-weight:bold;margin:0 0 8px;">${order.customer_name}</p>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 2px;">Phone</p>
    <p style="font-size:13px;margin:0 0 8px;">${order.customer_phone}</p>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 2px;">Pickup</p>
    <p style="font-size:13px;font-weight:bold;margin:0 0 8px;">${fmtDate(order.pickup_date)} at ${fmtTime(order.pickup_time)}</p>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 2px;">Invoice</p>
    <p style="font-size:13px;margin:0 0 8px;">#${order.invoice_number}</p>
    <hr style="border:none;border-top:1px dashed #aaa;margin:12px 0;">
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 6px;">Items</p>
    <table style="width:100%;border-collapse:collapse;">${itemLines}</table>
    ${order.notes ? `<hr style="border:none;border-top:1px dashed #aaa;margin:12px 0;"><p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin:0 0 4px;">Notes</p><p style="font-size:13px;margin:0;">${order.notes}</p>` : ""}
    <hr style="border:none;border-top:1px dashed #aaa;margin:12px 0;">
    <p style="text-align:center;font-size:11px;color:#888;">Taken by ${takenByInitials(order.taken_by)}</p>
  </div>
</body></html>`;
}

function buildReceiptPdf(order, orderItems, items, loc) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [288, 700], margin: 20, autoFirstPage: true });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const RED = "#8B1A2B";
    const GRAY = "#666666";
    const pageW = 288;
    const mid = pageW / 2;

    // Header
    doc.fontSize(13).fillColor(RED).font("Helvetica-Bold")
      .text("IAVARONE BROS.", 20, 22, { align: "center", width: pageW - 40 });
    doc.fontSize(8).fillColor(GRAY).font("Helvetica")
      .text(loc?.address || "", 20, 38, { align: "center", width: pageW - 40 })
      .text(`${loc?.city || ""}   ${loc?.phone || ""}`, { align: "center", width: pageW - 40 });

    // Divider
    let y = doc.y + 8;
    doc.moveTo(20, y).lineTo(pageW - 20, y).dash(3, { space: 3 }).strokeColor("#aaaaaa").stroke().undash();
    y += 10;

    // Order number
    doc.fontSize(8).fillColor(GRAY).font("Helvetica")
      .text("DAILY ORDER #", 20, y, { align: "center", width: pageW - 40 });
    y += 12;
    doc.fontSize(36).fillColor(RED).font("Helvetica-Bold")
      .text(String(order.daily_number), 20, y, { align: "center", width: pageW - 40 });
    y = doc.y + 6;

    // Divider
    doc.moveTo(20, y).lineTo(pageW - 20, y).dash(3, { space: 3 }).strokeColor("#aaaaaa").stroke().undash();
    y += 10;

    // Fields
    const field = (label, value) => {
      doc.fontSize(7).fillColor(GRAY).font("Helvetica")
        .text(label, 20, y, { width: pageW - 40 });
      y = doc.y + 1;
      doc.fontSize(11).fillColor("#111111").font("Helvetica-Bold")
        .text(value || "", 20, y, { width: pageW - 40 });
      y = doc.y + 6;
    };

    field("CUSTOMER", order.customer_name);
    field("PHONE", order.customer_phone);
    field("PICKUP", `${fmtDate(order.pickup_date)} at ${fmtTime(order.pickup_time)}`);
    field("INVOICE", `#${order.invoice_number}`);

    // Divider
    doc.moveTo(20, y).lineTo(pageW - 20, y).dash(3, { space: 3 }).strokeColor("#aaaaaa").stroke().undash();
    y += 8;

    // Items
    doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("ITEMS", 20, y, { width: pageW - 40 });
    y = doc.y + 4;

    (orderItems || []).forEach(li => {
      const item = (items || []).find(i => i.id === li.item_id);
      if (!item) return;
      doc.fontSize(10).fillColor("#111111").font("Helvetica-Bold")
        .text(item.name, 20, y, { width: pageW - 60, continued: false });
      doc.fontSize(10).fillColor(GRAY).font("Helvetica")
        .text(`x${li.quantity}`, pageW - 50, y, { width: 30, align: "right" });
      y = doc.y + 2;
      doc.moveTo(20, y).lineTo(pageW - 20, y).strokeColor("#eeeeee").lineWidth(0.5).stroke().lineWidth(1);
      y += 4;
    });

    // Notes
    if (order.notes) {
      doc.moveTo(20, y).lineTo(pageW - 20, y).dash(3, { space: 3 }).strokeColor("#aaaaaa").stroke().undash();
      y += 8;
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("NOTES", 20, y, { width: pageW - 40 });
      y = doc.y + 2;
      doc.fontSize(10).fillColor("#111111").font("Helvetica")
        .text(order.notes, 20, y, { width: pageW - 40 });
      y = doc.y + 6;
    }

    // Footer
    doc.moveTo(20, y).lineTo(pageW - 20, y).dash(3, { space: 3 }).strokeColor("#aaaaaa").stroke().undash();
    y += 8;
    doc.fontSize(9).fillColor(GRAY).font("Helvetica")
      .text(`Taken by ${takenByInitials(order.taken_by)}`, 20, y, { align: "center", width: pageW - 40 });

    doc.end();
  });
}

function makeRawEmail({ from, to, subject, html, pdfBuffer, pdfFilename }) {
  const boundary = "boundary_" + Date.now();
  const lines = [
    `From: Iavarone Bros. <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
  ];

  if (pdfBuffer && pdfFilename) {
    lines.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${pdfFilename}"`,
      `Content-Disposition: attachment; filename="${pdfFilename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      pdfBuffer.toString("base64"),
    );
  }

  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, locationId, order, orderItems, items, loc } = req.body;

  if (!to || !locationId || !order) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Get stored tokens for this location
  const { data: tokenRow, error: tokenError } = await supabase
    .from("gmail_tokens")
    .select("*")
    .eq("location_id", locationId)
    .maybeSingle();

  if (tokenError || !tokenRow) {
    return res.status(400).json({ error: `Gmail not connected for location: ${locationId}. Please connect Gmail in Admin settings.` });
  }

  const fromEmail = LOCATION_EMAIL[locationId];
  if (!fromEmail) {
    return res.status(400).json({ error: `Unknown location: ${locationId}` });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2Client.setCredentials({
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expiry_date: tokenRow.expiry_date,
    });

    // Auto-refresh token if needed and save new tokens
    oauth2Client.on("tokens", async (tokens) => {
      await supabase.from("gmail_tokens").update({
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date,
        updated_at: new Date().toISOString(),
      }).eq("location_id", locationId);
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const html = buildEmailHtml(order, orderItems, items, loc);
    const pdfBuffer = await buildReceiptPdf(order, orderItems, items, loc);
    const pdfFilename = `IB-Order-${order.invoice_number}.pdf`;

    const raw = makeRawEmail({
      from: fromEmail,
      to,
      subject: `Your Iavarone Bros. Order #${order.invoice_number} - Pickup ${fmtDate(order.pickup_date)}`,
      html,
      pdfBuffer,
      pdfFilename,
    });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Gmail API send error:", err);
    res.status(500).json({ error: err.message });
  }
}
