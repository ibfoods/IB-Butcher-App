// App session tokens. Minted by /api/auth/login, verified here and by Supabase
// RLS (signed with the project's JWT secret, role=authenticated, plus app claims).
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SECRET = process.env.SUPABASE_JWT_SECRET;
export const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sign = (data) => b64u(createHmac("sha256", SECRET).update(data).digest());

// lifetimeMin: how long the token is valid. The idle timeout is enforced by the
// app; this is the hard ceiling (tokens are refreshed while the user is active).
export function mintToken(user, lifetimeMin) {
  if (!SECRET) throw new Error("SUPABASE_JWT_SECRET is not set in Vercel.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({
    aud: "authenticated", role: "authenticated",
    sub: user.id, app_role: user.role, location_id: user.location_id, name: user.name,
    iat: now, exp: now + lifetimeMin * 60,
  }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function verifyToken(token) {
  try {
    if (!SECRET || !token) return null;
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const expected = Buffer.from(sign(`${h}.${p}`));
    const got = Buffer.from(s);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

// For API handlers: returns claims or sends 401 and returns null.
export function requireUser(req, res, minRole = "clerk") {
  const auth = req.headers.authorization || "";
  const claims = verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (!claims) { res.status(401).json({ error: "Please sign in again." }); return null; }
  const order = ["clerk", "manager", "admin", "master_admin"];
  if (order.indexOf(claims.app_role) < order.indexOf(minRole)) { res.status(403).json({ error: "Not allowed." }); return null; }
  return claims;
}

export const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

export async function sessionLifetimeMin() {
  const { data } = await admin().from("app_settings").select("value").eq("key", "session_timeout_minutes").maybeSingle();
  const idle = parseInt(data?.value ?? "240", 10);
  // "Never" → 30 days; otherwise at least 12h so an active shift isn't cut off mid-order
  return idle === 0 ? 60 * 24 * 30 : Math.max(idle, 60 * 12);
}
