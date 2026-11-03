// Daily check + nightly backup.
//
// Scheduled (vercel.json crons). Vercel calls GET /api/ops with
// "Authorization: Bearer $CRON_SECRET" and names the schedule in x-vercel-cron-schedule:
//   backup: "5 6 * * *" and "5 7 * * *" (UTC) — runs only when it is 2 AM in New York
//   health: "0 10 * * *" and "0 11 * * *" (UTC) — runs only when it is 6 AM in New York
//   (two entries each so the times stay right across daylight-saving changes;
//    on Hobby a job may fire any time within its hour)
//
// From Admin → Backups (signed-in admin):
//   GET  /api/ops?task=status        last backup + last check + Drive connection
//   POST /api/ops?task=backup        back up now
//   POST /api/ops?task=health        run the check now (shown on screen; no email)
//   POST /api/ops?task=drive-start   returns the Google sign-in link for the backup Drive

import { requireUser } from "./_auth.js";
import { runBackup, etParts } from "./_backup.js";
import { runHealth, sendReport, recordHealth } from "./_health.js";
import { connectUrl, getSetting, setSetting } from "./_drive.js";

const CRON_TASKS = { "5 6 * * *": "backup", "5 7 * * *": "backup", "0 10 * * *": "health", "0 11 * * *": "health" };
const isCron = (req) => !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
const baseUrl = (req) => `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

async function backupAndRecord(reason) {
  try {
    return await runBackup({ reason });
  } catch (e) {
    console.error("Backup failed:", e);
    const fail = { ok: false, at: new Date().toISOString(), reason, error: e.message };
    // Keep the last good backup's details; just note the failure next to it
    const prev = (await getSetting("backup_last").catch(() => null)) || {};
    await setSetting("backup_last", prev.ok ? { ...prev, last_failure: fail } : fail).catch(() => {});
    return fail;
  }
}

export default async function handler(req, res) {
  const schedule = req.headers["x-vercel-cron-schedule"];
  const task = req.query.task || CRON_TASKS[schedule];

  // ── Scheduled runs ─────────────────────────────────────────────────────────
  if (req.method === "GET" && (task === "backup" || task === "health") && isCron(req)) {
    const { date, hour } = etParts();
    const wantHour = task === "backup" ? 2 : 6;
    if (hour !== wantHour && req.query.force !== "1") return res.status(200).json({ skipped: `It is ${hour}:xx in New York; this runs at ${wantHour} AM.` });

    // Don't run twice on the same day
    const runKey = `last_run_${task}`;
    const ran = await getSetting(runKey);
    if (ran?.date === date && req.query.force !== "1") return res.status(200).json({ skipped: "Already ran today." });
    await setSetting(runKey, { date });

    if (task === "backup") return res.status(200).json(await backupAndRecord("scheduled"));
    const rep = await runHealth({ base: baseUrl(req) });
    const mail = await sendReport(rep);
    await recordHealth(rep, mail);
    return res.status(200).json({ problems: rep.problems, warnings: rep.warnings, mail });
  }

  // ── Admin screen ───────────────────────────────────────────────────────────
  const claims = requireUser(req, res, "admin");
  if (!claims) return;

  if (req.method === "GET" && task === "status") {
    const [drive, backup, health] = await Promise.all([getSetting("drive"), getSetting("backup_last"), getSetting("health_last")]);
    return res.status(200).json({
      drive: drive?.refresh_token ? { connected: true, email: drive.email, connected_at: drive.connected_at, folder_link: drive.folders?.root_link || null } : { connected: false },
      backup, health,
      cron_ready: !!process.env.CRON_SECRET,
    });
  }
  if (req.method === "POST" && task === "backup") return res.status(200).json(await backupAndRecord(`manual (${claims.name})`));
  if (req.method === "POST" && task === "health") {
    const rep = await runHealth({ base: baseUrl(req) });
    await recordHealth(rep, { sent: false, manual: claims.name });
    return res.status(200).json(rep);
  }
  if (req.method === "POST" && task === "drive-start") return res.status(200).json({ url: connectUrl() });

  return res.status(400).json({ error: "Unknown task." });
}
