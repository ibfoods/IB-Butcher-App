// TEMPORARY — throwaway branch only, never merged. Proves SUPABASE_JWT_SECRET is the
// secret Supabase verifies with: a token we sign must be accepted (200) and a token
// signed with a wrong secret must be rejected (401). Returns statuses only, no secrets.
import { createHmac } from "node:crypto";
const b64u = (x) => Buffer.from(x).toString("base64url");
function tok(secret) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: "authenticated", role: "authenticated", sub: "selftest", app_role: "clerk", iat: now, exp: now + 120 }));
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
export default async function handler(req, res) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return res.status(200).json({ ok: false, reason: "SUPABASE_JWT_SECRET not set on this deployment" });
  const url = `${process.env.SUPABASE_URL}/rest/v1/items?select=id&limit=1`;
  const apikey = "sb_publishable_g7JgVrxshCRHFqv4fp2eTw_kxx-zHly";
  const call = async (t) => { const r = await fetch(url, { headers: { apikey, Authorization: `Bearer ${t}` } }); return { status: r.status, body: (await r.text()).slice(0, 160) }; };
  const good = await call(tok(secret));
  const bad = await call(tok(secret + "-wrong"));
  return res.status(200).json({ ok: good.status === 200 && bad.status === 401, secretLength: secret.length, signedWithSecret: good, signedWithWrongSecret: bad });
}
