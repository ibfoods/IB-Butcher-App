# Restoring the IB Butcher App from a backup

_Written Nov 3, 2026. Tested the same day: a backup with 1,200 orders and 1,600
order lines was restored into an empty database and matched the original row for row._

There are three layers of protection. Use the smallest one that fixes the problem.

| What happened | Use |
|---|---|
| Something went wrong in the last 7 days (bad change, deleted orders) | **Supabase's own daily backups** (Pro plan) — one-click restore |
| Older than 7 days, or the Supabase project itself is gone | **The nightly Drive backup** (this document) |
| The app is down on a pickup day | **The store spreadsheet** in Drive — open it on any phone |

---

## A. Pickup day, app is down (no restore needed)

1. Open Google Drive as mike@ibfoods.com → **IB Butcher App Backups** → the store's folder.
2. Open **"<Store> - upcoming orders"**. It lists every live order with pickup today
   or later: pickup date and time, order number, name, phone, items and notes.
3. It is as of the last nightly backup (about 2 AM). Orders taken after that are not on it.

## B. Restore within the last 7 days (Supabase)

1. supabase.com → project **ibfoods Butcher Project** (`gajafjiphrsvztcwofhe`) → **Database → Backups**.
2. Pick the day **before** the problem → **Restore**. The app is down for a few minutes while it runs.
3. Everything after that backup is lost. Note any orders taken since, so staff can re-enter them.

## C. Restore from the Drive backup

Do this into a **new, empty** Supabase project — never on top of the live one.

1. Download the backup from Drive → **IB Butcher App Backups → Full backup**.
   Files are named `ib-butcher-backup-YYYY-MM-DD-HHMM.json` (New York time).
2. On a computer with the repo and Node installed:
   `node scripts/restore-backup.mjs ib-butcher-backup-....json > restore.sql`
3. Create a new Supabase project (Pro). Open **SQL Editor**, paste `restore.sql`, **Run**.
   It rebuilds every table, rule and function, then loads the data. The last
   result shows row counts — they must match the counts at the top of `restore.sql`.
4. Point the app at the new project — in Vercel → ib-butcher-app → Settings → Environment Variables:
   - `SUPABASE_URL` → the new project's URL
   - `SUPABASE_SERVICE_ROLE_KEY` → the new project's service role key
   - `VITE_SUPABASE_ANON_KEY` → the new project's publishable key
   - `SUPABASE_JWT_SECRET` → the new project's **JWT secret** (Settings → JWT Keys).
     The app signs staff sessions with a shared secret (HS256). Newer Supabase projects
     may default to other key types — if there's no shared secret listed, add a
     shared-secret signing key there first. (Not yet tested on a brand-new project; check this when it's needed.)
   - also update the URL and publishable key in `src/supabase.js`
   Then redeploy.
5. In the app: Admin → **Gmail** → reconnect each store (Gmail keys are not in backups
   on purpose). Admin → **Backups** → reconnect the backup Drive.
6. Staff sign in with their usual PINs and passwords — those are restored (scrambled).

### What's in a backup
Every table in the app's database except: the stores' Gmail connection keys, the
sign-in attempt log, and the backup system's own settings. Each file also contains
the complete database structure (`schema_sql`), so the restore doesn't depend on
the repo's migration files being complete.

### Rules
- Restore into an empty project. Restoring on top of live data will fail (duplicate keys) — that's deliberate.
- After any restore, run Admin → Backups → **Run check now** and read the result.
