// Staff management. GET list (manager+), POST create, PUT update, DELETE remove.
// Hashing happens in Postgres (set_user_credentials); plaintext never persists.
import { admin, requireUser } from "../_auth.js";

const ROLES = ["clerk", "manager", "admin", "master_admin"];

export default async function handler(req, res) {
  const claims = requireUser(req, res, "manager"); if (!claims) return;
  const db = admin();
  const isAdmin = ["admin", "master_admin"].includes(claims.app_role);
  const canTouch = (u) => isAdmin || (u.role === "clerk" && u.location_id === claims.location_id);

  if (req.method === "GET") {
    const { data, error } = await db.from("staff").select("*").order("name");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: data });
  }

  const body = req.body || {};
  if (req.method === "POST") {
    const { name, username, password, pin, role, location_id } = body;
    if (!name || !username || !password || !location_id) return res.status(400).json({ error: "Name, username, password and home store are required." });
    const newRole = isAdmin ? (ROLES.includes(role) ? role : "clerk") : "clerk";
    if (newRole === "master_admin" && claims.app_role !== "master_admin") return res.status(403).json({ error: "Not allowed." });
    const newLoc = isAdmin ? location_id : claims.location_id;
    const { data: dup } = await db.from("users").select("id").ilike("username", username).maybeSingle();
    if (dup) return res.status(400).json({ error: "Username taken." });
    const { data: created, error } = await db.from("users").insert({ name, username, role: newRole, location_id: newLoc }).select("id").single();
    if (error) return res.status(500).json({ error: error.message });
    const { error: ce } = await db.rpc("set_user_credentials", { p_user: created.id, p_password: password, p_pin: pin ? String(pin) : null });
    if (ce) { await db.from("users").delete().eq("id", created.id); return res.status(400).json({ error: ce.message.replace(/^.*?: /, "") }); }
    return res.status(200).json({ ok: true, id: created.id });
  }

  if (req.method === "PUT") {
    const { id, name, username, password, pin, role, location_id } = body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const { data: existing } = await db.from("staff").select("*").eq("id", id).maybeSingle();
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (!canTouch(existing)) return res.status(403).json({ error: "Not allowed." });
    const patch = {};
    if (name) patch.name = name;
    if (username) patch.username = username;
    if (isAdmin && role && ROLES.includes(role)) {
      if (role === "master_admin" && claims.app_role !== "master_admin") return res.status(403).json({ error: "Not allowed." });
      patch.role = role;
    }
    if (isAdmin && location_id) patch.location_id = location_id;
    if (Object.keys(patch).length) {
      const { error } = await db.from("users").update(patch).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
    }
    if ((password && password !== "") || pin !== undefined) {
      const { error: ce } = await db.rpc("set_user_credentials", { p_user: id, p_password: password || null, p_pin: pin === undefined ? null : String(pin ?? "") });
      if (ce) return res.status(400).json({ error: ce.message.replace(/^.*?: /, "") });
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = body;
    if (!id || id === claims.sub) return res.status(400).json({ error: "Can't remove yourself." });
    const { data: existing } = await db.from("staff").select("*").eq("id", id).maybeSingle();
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (!canTouch(existing)) return res.status(403).json({ error: "Not allowed." });
    const { error } = await db.from("users").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}
