import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Fetch all stored tokens
  const { data: rows, error } = await supabase
    .from("gmail_tokens")
    .select("location_id, access_token, refresh_token, expiry_date, updated_at");

  if (error) return res.status(500).json({ error: error.message });
  if (!rows || rows.length === 0) return res.status(200).json({ statuses: {} });

  const statuses = {};

  await Promise.all(rows.map(async (row) => {
    try {
      const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth2Client.setCredentials({
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        expiry_date: row.expiry_date,
      });

      // Save refreshed tokens if they auto-refresh
      oauth2Client.on("tokens", async (tokens) => {
        await supabase.from("gmail_tokens").update({
          access_token: tokens.access_token,
          expiry_date: tokens.expiry_date,
          updated_at: new Date().toISOString(),
        }).eq("location_id", row.location_id);
      });

      // Lightweight call — just fetch the Gmail profile
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });

      statuses[row.location_id] = {
        connected: true,
        email: profile.data.emailAddress,
        updated_at: row.updated_at,
      };
    } catch (err) {
      // Token is invalid or revoked
      statuses[row.location_id] = {
        connected: false,
        error: err.message,
        updated_at: row.updated_at,
      };
    }
  }));

  res.status(200).json({ statuses });
}
