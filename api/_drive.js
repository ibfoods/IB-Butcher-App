// Backup Drive connection (one Google account, e.g. mike@ibfoods.com).
//
// Permission is drive.file: the app can only see and change files it created
// itself. It cannot read anything else in that Drive. The refresh token lives
// in ops_settings (server-only table, no browser access).

import { google } from "googleapis";
import { createHmac, timingSafeEqual } from "node:crypto";
import { admin } from "./_auth.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Same redirect the store Gmail connections use (already registered in Google Cloud).
export const REDIRECT_URI = "https://butcherorders.ibfoods.com/api/auth/callback";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const ROOT_FOLDER_NAME = "IB Butcher App Backups";
export const FULL_FOLDER_NAME = "Full backup";
export const STORES = [
  { id: "wantagh", name: "Wantagh" },
  { id: "woodbury", name: "Woodbury" },
  { id: "nhp", name: "New Hyde Park" },
  { id: "gardencity", name: "Garden City" },
  { id: "maspeth", name: "Maspeth" },
];

const FOLDER = "application/vnd.google-apps.folder";

// ── settings (ops_settings key/value) ────────────────────────────────────────
export async function getSetting(key) {
  const { data, error } = await admin().from("ops_settings").select("value, updated_at").eq("key", key).maybeSingle();
  if (error) throw new Error(`ops_settings read failed: ${error.message}`);
  return data ? { ...data.value, _updated_at: data.updated_at } : null;
}
export async function setSetting(key, value) {
  const clean = { ...value }; delete clean._updated_at;
  const { error } = await admin().from("ops_settings").upsert({ key, value: clean, updated_at: new Date().toISOString() });
  if (error) throw new Error(`ops_settings write failed: ${error.message}`);
}

// ── OAuth state: signed so only our own "Connect" button can start a link ───
const SECRET = process.env.SUPABASE_JWT_SECRET || "";
const sig = (s) => createHmac("sha256", SECRET).update(s).digest("base64url");
export function makeState() {
  const body = `drive.${Math.floor(Date.now() / 1000) + 15 * 60}`;
  return `${body}.${sig(body)}`;
}
export function checkState(state) {
  const m = /^(drive\.(\d+))\.([\w-]+)$/.exec(state || "");
  if (!m || !SECRET) return false;
  if (Number(m[2]) < Date.now() / 1000) return false;
  const a = Buffer.from(sig(m[1])), b = Buffer.from(m[3]);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const oauthClient = () => new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

export function connectUrl() {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
    state: makeState(),
    hd: "ibfoods.com",
    login_hint: "mike@ibfoods.com",
  });
}

// Called by /api/auth/callback when state is a drive state.
export async function finishConnect(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a long-lived key. Remove the app's access at myaccount.google.com/permissions and connect again.");
  client.setCredentials(tokens);
  const drive = google.drive({ version: "v3", auth: client });
  const about = await drive.about.get({ fields: "user(emailAddress)" });
  const prev = (await getSetting("drive")) || {};
  const conn = { refresh_token: tokens.refresh_token, email: about.data.user?.emailAddress || null, connected_at: new Date().toISOString(), folders: prev.email === about.data.user?.emailAddress ? prev.folders : undefined };
  await setSetting("drive", conn);
  await ensureFolders(drive, conn);
  return conn;
}

// Returns { drive, conn } or throws "not connected".
export async function driveClient() {
  const conn = await getSetting("drive");
  if (!conn?.refresh_token) throw new Error("Backup Drive is not connected (Admin → Backups → Connect backup Drive).");
  const client = oauthClient();
  client.setCredentials({ refresh_token: conn.refresh_token });
  return { drive: google.drive({ version: "v3", auth: client }), conn, client };
}

// ── folders ──────────────────────────────────────────────────────────────────
async function folderAlive(drive, id) {
  if (!id) return false;
  try {
    const r = await drive.files.get({ fileId: id, fields: "id, trashed" });
    return !r.data.trashed;
  } catch { return false; }
}
async function makeFolder(drive, name, parent) {
  const r = await drive.files.create({
    requestBody: { name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) },
    fields: "id, webViewLink",
  });
  return r.data;
}

// Creates any missing folders (also repairs if someone trashed one) and saves ids.
export async function ensureFolders(drive, conn) {
  const f = conn.folders || {};
  let changed = false;
  if (!(await folderAlive(drive, f.root))) {
    const r = await makeFolder(drive, ROOT_FOLDER_NAME);
    f.root = r.id; f.root_link = r.webViewLink; f.full = null; f.stores = {}; changed = true;
  }
  if (!(await folderAlive(drive, f.full))) { f.full = (await makeFolder(drive, FULL_FOLDER_NAME, f.root)).id; changed = true; }
  f.stores = f.stores || {};
  for (const s of STORES) {
    if (!(await folderAlive(drive, f.stores[s.id]))) { f.stores[s.id] = (await makeFolder(drive, s.name, f.root)).id; changed = true; }
  }
  if (!f.readme || !(await folderAlive(drive, f.readme))) {
    const r = await drive.files.create({
      requestBody: { name: "How to restore.txt", parents: [f.root] },
      media: { mimeType: "text/plain", body: RESTORE_NOTE },
      fields: "id",
    });
    f.readme = r.data.id; changed = true;
  }
  if (changed) { conn.folders = f; await setSetting("drive", conn); }
  return f;
}

const RESTORE_NOTE = `IB Butcher App — backups

Full backup/
  One file per night (ib-butcher-backup-YYYY-MM-DD-HHMM.json). Each file holds
  every order, customer, item, staff login (scrambled) and setting, plus the
  full database structure. 30 nights are kept, plus the 1st of every month.
  This is what we restore from. Restore steps are in the app's code:
  docs/RESTORE.md in the IB-Butcher-App repository.

Store folders (Wantagh, Woodbury, ...)
  "<Store> - upcoming orders": a spreadsheet of every live order with a pickup
  date of today or later, as of the last nightly backup. If the app is down on
  a pickup day, open this on any phone or computer and run the counter from it.

Not included on purpose: the stores' Gmail connection keys (reconnect Gmail in
Admin if you ever restore) and the sign-in attempt log.

The app can only see files it created itself. Renaming or moving these folders
is fine. If one is deleted, the app makes a new one on the next backup.
`;
