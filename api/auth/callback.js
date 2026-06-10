import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  const { code, state: locationId, error } = req.query;

  if (error) {
    return res.status(200).json({ error, locationId, step: "google_error" });
  }

  if (!code || !locationId) {
    return res.status(400).json({ error: "Missing code or locationId" });
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: "Missing Google creds" });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Missing Supabase creds" });
  }

  try {
    // Exchange code for tokens
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);

    // Save using Supabase JS client with node-fetch
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
      global: { fetch },
    });

    const { error: dbError } = await supabase.from("gmail_tokens").upsert({
      location_id: locationId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "location_id" });

    if (dbError) {
      return res.status(500).json({ error: "DB save failed", details: dbError.message });
    }

    res.redirect(`/?gmailConnected=${locationId}`);
  } catch (err) {
    return res.status(500).json({ error: err.message, type: err.constructor.name });
  }
}
