import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";

// Known Workspace mailbox per location (tokens are scoped to gmail.send only,
// so we can't read the profile — display the expected account instead)
const LOCATION_EMAILS = {
  woodbury: "woodbury@ibfoods.com",
  wantagh: "wantagh@ibfoods.com",
  gardencity: "gardencity@ibfoods.com",
  maspeth: "maspeth@ibfoods.com",
  nhp: "newhydepark@ibfoods.com",
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { data: rows, error } = await supabase
    .from("gmail_tokens")
    .select("location_id, access_token, refresh_token, expiry_date, updated_at");

  if (error) return res.status(500).json({ error: error.message });
  if (!rows || rows.length === 0) return res.status(200).json({ statuses: {} });

  const statuses = {};

  await Promise.all(rows.map(async (row) => {
    try {
      if (!row.refresh_token) throw new Error("No refresh token stored");

      const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth2Client.setCredentials({ refresh_token: row.refresh_token });

      // The only scope we hold is gmail.send, so the real test is: can we still
      // mint an access token from the refresh token? If Google refuses, the
      // grant was revoked (password change, app removed, etc.).
      const { credentials } = await oauth2Client.refreshAccessToken();
      if (!credentials?.access_token) throw new Error("Refresh returned no access token");

      await supabase.from("gmail_tokens").update({
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date,
        updated_at: new Date().toISOString(),
      }).eq("location_id", row.location_id);

      statuses[row.location_id] = {
        connected: true,
        email: LOCATION_EMAILS[row.location_id] || null,
        updated_at: row.updated_at,
      };
    } catch (err) {
      statuses[row.location_id] = {
        connected: false,
        error: err.message,
        updated_at: row.updated_at,
      };
    }
  }));

  res.status(200).json({ statuses });
}
