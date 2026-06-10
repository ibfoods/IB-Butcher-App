import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";

export default async function handler(req, res) {
  const { code, state: locationId, error } = req.query;

  if (error) {
    return res.redirect(`/?gmailError=${encodeURIComponent(error)}&locationId=${locationId}`);
  }

  if (!code || !locationId) {
    return res.status(400).json({ error: "Missing code or locationId" });
  }

  // Debug: check env vars are present
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "Missing Google credentials", clientId: !!process.env.GOOGLE_CLIENT_ID, clientSecret: !!process.env.GOOGLE_CLIENT_SECRET });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing Supabase credentials", url: !!process.env.SUPABASE_URL, key: !!process.env.SUPABASE_SERVICE_ROLE_KEY });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);

    const { error: dbError } = await supabase.from("gmail_tokens").upsert({
      location_id: locationId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    }, { onConflict: "location_id" });

    if (dbError) {
      return res.status(500).json({ error: "DB error", details: dbError.message });
    }

    res.redirect(`/?gmailConnected=${locationId}`);
  } catch (err) {
    console.error("OAuth callback error:", err.message, err.stack);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
