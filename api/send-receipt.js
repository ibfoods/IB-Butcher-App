import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://ib-butcher-app.vercel.app/api/auth/callback";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
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

function makeRawEmail({ from, to, subject, html }) {
  const boundary = "boundary_" + Date.now();
  const message = [
    `From: Iavarone Bros. <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
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

    const raw = makeRawEmail({
      from: fromEmail,
      to,
      subject: `Your Iavarone Bros. Order #${order.invoice_number} — Pickup ${fmtDate(order.pickup_date)}`,
      html,
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
