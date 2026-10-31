// POST { pin } or { username, password } → { token, user }
import { admin, mintToken, clientIp, sessionLifetimeMin } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { pin, username, password } = req.body || {};
  const ip = clientIp(req);
  const db = admin();
  let rows, error;
  if (pin !== undefined) {
    ({ data: rows, error } = await db.rpc("login_with_pin", { p_pin: String(pin), p_ip: ip }));
  } else if (username !== undefined) {
    ({ data: rows, error } = await db.rpc("login_with_password", { p_username: String(username), p_password: String(password || ""), p_ip: ip }));
  } else {
    return res.status(400).json({ error: "Missing credentials" });
  }
  if (error) {
    if (/too_many_attempts/.test(error.message)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes." });
    console.error("login error", error);
    return res.status(500).json({ error: "Sign-in failed. Try again." });
  }
  const user = rows?.[0];
  if (!user) return res.status(401).json({ error: pin !== undefined ? "PIN not recognized." : "Invalid username or password." });
  try {
    const token = mintToken(user, await sessionLifetimeMin());
    return res.status(200).json({ token, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
