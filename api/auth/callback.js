import { google } from "googleapis";

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

  // Debug env
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: "Missing Google creds", hasId: !!CLIENT_ID, hasSecret: !!CLIENT_SECRET });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Missing Supabase creds", hasUrl: !!SUPABASE_URL, hasKey: !!SUPABASE_KEY });
  }

  try {
    // Exchange code for tokens
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);

    // Save to Supabase via direct fetch
    const payload = {
      location_id: locationId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
      updated_at: new Date().toISOString(),
    };

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/gmail_tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!dbRes.ok) {
      const text = await dbRes.text();
      return res.status(500).json({ error: "DB save failed", status: dbRes.status, body: text });
    }

    res.redirect(`/?gmailConnected=${locationId}`);
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0, 500) });
  }
}
