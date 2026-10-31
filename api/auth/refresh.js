// POST with Bearer token → fresh token for the same user (called while active)
import { admin, requireUser, mintToken, sessionLifetimeMin } from "../_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const claims = requireUser(req, res); if (!claims) return;
  const { data: user } = await admin().from("staff").select("id,name,username,role,location_id").eq("id", claims.sub).maybeSingle();
  if (!user) return res.status(401).json({ error: "User no longer exists." });
  return res.status(200).json({ token: mintToken(user, await sessionLifetimeMin()), user });
}
