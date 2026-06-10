import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";

export default function handler(req, res) {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ error: "locationId required" });

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.send"],
    state: locationId,
    prompt: "consent",
  });

  res.redirect(url);
}
