// Gmail send via the per-location OAuth tokens in Supabase. Shared by
// send-receipt (customer receipts) and notify-stock (manager alerts).
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const LOCATION_EMAIL = {
  woodbury:   "Woodbury@ibfoods.com",
  wantagh:    "Wantagh@ibfoods.com",
  gardencity: "Gardencity@ibfoods.com",
  maspeth:    "Maspeth@ibfoods.com",
  nhp:        "Newhydepark@ibfoods.com",
};

// Returns { gmail, from } or throws with a user-readable message.
export async function gmailFor(locationId) {
  const from = LOCATION_EMAIL[locationId];
  if (!from) throw new Error(`Unknown location: ${locationId}`);
  const { data: tokenRow, error } = await supabase.from("gmail_tokens").select("*").eq("location_id", locationId).maybeSingle();
  if (error || !tokenRow) throw new Error(`Gmail not connected for location: ${locationId}. Please connect Gmail in Admin settings.`);

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token, expiry_date: tokenRow.expiry_date });
  oauth2Client.on("tokens", async (tokens) => {
    await supabase.from("gmail_tokens").update({ access_token: tokens.access_token, expiry_date: tokens.expiry_date, updated_at: new Date().toISOString() }).eq("location_id", locationId);
  });
  return { gmail: google.gmail({ version: "v1", auth: oauth2Client }), from };
}

export const b64lines = (buf) => buf.toString("base64").replace(/(.{76})/g, "$1\r\n");

// Minimal HTML-only message (no attachments).
export function rawSimpleEmail({ from, to, subject, html, fromName = "Iavarone Bros." }) {
  const lines = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
    `Reply-To: ${from}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64lines(Buffer.from(html, "utf8")),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
