import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://ib-butcher-app.vercel.app/api/auth/callback";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { code, state: locationId, error } = req.query;

  if (error) {
    return res.redirect(`/?gmailError=${encodeURIComponent(error)}&locationId=${locationId}`);
  }

  if (!code || !locationId) {
    return res.status(400).json({ error: "Missing code or locationId" });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);

    await supabase.from("gmail_tokens").upsert({
      location_id: locationId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    }, { onConflict: "location_id" });

    res.redirect(`/?gmailConnected=${locationId}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`/?gmailError=${encodeURIComponent(err.message)}&locationId=${locationId}`);
  }
}
