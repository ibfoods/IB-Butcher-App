# IB Butcher App — Project Knowledge

_Last updated: November 13, 2026_

## RULES — read before touching anything (set by Mike, Nov 13, 2026)

1. **Wantagh is LIVE for the 2026 Thanksgiving season** — the only store running live this season
   (trial). Every Wantagh order is a real customer order. Woodbury, Garden City, Maspeth and
   New Hyde Park are NOT live.
2. **Nothing on a live order changes** — no numbers, items, dates, times, customers or status;
   no backfills, renumbering or cleanup — **unless Mike asks for that specific change.**
3. **Even when Mike asks, confirm with him before running it.** Show exactly what will change
   (which order, which field, old → new) and wait for a clear yes. A badly worded request must
   not be able to damage live data.
4. **Database changes are additive only** (new functions/tables/columns). Before running one,
   confirm it rewrites no existing order rows.
5. **Tests never run on Wantagh data.** Use a made-up store id that isn't in `LOCS` (e.g.
   `zz-test` inventory rows) or Woodbury, and clean up afterwards. Never create test *items* —
   items are shared by every store and would appear in Wantagh's picker.
6. **Before any data change, save the old values** in the private `backup` schema
   (see Backups below) so it can be undone.
7. **Going live with app changes needs Mike's go-ahead.** Build on a branch, test, report, then
   fast-forward `main` when he says go. Confirm the Vercel production deploy shows READY.
8. Butcher App only — never touch OrderHQ resources from this project. Explain outcomes to Mike in
   plain English; give numbered one-action steps for anything he must do.

## Start here — next session (set Nov 13, 2026)

**State:** Wantagh live (~100 orders, pickups mostly Nov 23–25). Nov 13 changes all live on `main`
(`ab8ea1e`). Previous production deploy is a one-click rollback in Vercel.

**Open items**
- **B&E 22/24 is oversold by 6** (4 in house, 10 ordered). Wantagh is handling it (get more from
  Bell & Evans or move customers to a bigger size). The 6 AM health email flags it until fixed.
- **Chris's order #84** (Wantagh, pickup Nov 24) — Mike is asking whether it's a test. Don't touch.
- **Joanna Gross** was renumbered #5 → #1 on Nov 13 (at Mike's request) but her emailed receipt
  says #5 — store needs to tell her or resend the receipt.
- **Daily Pickup List** — still on hold, no code. Spec + open decisions: Claude project doc
  `claude/Daily-Pickup-List-Spec.md`. Pickup rush is Nov 24–25, so it needs a go/no-go soon.
- **Printerless (Nov 13):** Wantagh runs printerless for the trial. The receipt-printer relay check
  was removed from the 6 AM health report; print code, relay and the per-store paper toggle stay
  (Mike: keep the capability, no alarm). Woodbury's paper toggle left as is.
- **Repos are still public** (`IB-Butcher-App`, `IB-Sandwich-App`) — Mike to switch to Private.
- Supabase advisors (Nov 13): `staff` view is SECURITY DEFINER (intentional — it hides PIN/password
  hashes; managers read staff through it); `app_role`/`is_admin`/`is_manager` lack a fixed
  search_path; any signed-in user can read all stores' orders at the DB level (screens filter by
  store). Low priority, after the holiday.
- Clean up `auth-selftest` and `atomic-stock` branches on GitHub (this session can't delete branches).

**Turkey inventory — how the count works (Nov 13)**
- `inventory.stock` = **left to sell**, not total on hand. A new order takes stock off when saved;
  cancel / delete / edit give back or adjust. Typing a number on the Inventory screen *replaces*
  the count — it does NOT subtract orders already taken.
- So when a store gives totals (on hand or on order), the correct count is
  **total − all active (non-cancelled) orders for that pool with pickup today or later.**
  Pools: `coalesce(items.parent_id, items.id)` — plain + oven-ready children share one pool.
- Nov 13 Wantagh totals from Chris (B&E = in house, Fresh = on order): B&E Organic 18/22 6,
  B&E 10/12 40, 14/16 32, 18/20 48, 22/24 4, 24/26 20, 26/28 16; Fresh 10–14 32, 14–16 48,
  16–20 130, 24–28 50. Counts were set from these; prior values in `backup.inventory_2026_11_13`.
- Before that, stores kept typing 10 back in when a pool ran low, so pre-Nov-13 counts mean nothing.

**Shipped Nov 13** (`sql/2026-11-13_atomic_stock.sql`, commits `3a2d92b`, `ab8ea1e`)
- **Stock changes happen inside the database in one step:** `apply_stock_changes(location,
  {pool: ±n}, allow_negative)` locks the inventory rows, checks there's enough, applies all
  changes or none. Fixes two iPads saving at once losing a deduction / both taking the last one.
  App helper `stockChange()` in `App.jsx`. New order: check + take off first, give back if the
  order then fails to save; manager override retries with oversell allowed. Edit/cancel/delete
  always apply. Tested on fake store `zz-test` (refusal, all-or-nothing, override, give-back,
  untracked skip, anon blocked); Wantagh counts verified unchanged by the tests.
- **Delete now gives stock back** (skipped if the order was already cancelled — cancel already did).
- **Place order ignores a second tap** while the first is saving (`submitLock` ref). This caused
  the duplicate (later cancelled) Pat Gallicchio / Joanna Gross orders on Oct 30–31.
- **Editing an order keeps the customer's number.** It used to write `daily_number = order_seq`
  on every edit; older Wantagh orders have a told number ≠ `order_seq`, so Chris's edit turned
  Vincent Colletti #7 into #4 (duplicating Janice Bendernagel). Now the told number changes only
  when the order moves store or month (after the clerk confirms).
- Remaining direct inventory write is the Inventory screen recount — intentional.

**Data changes made Nov 13 (all at Mike's request; old values in `backup` schema)**
- Joanna Gross Wantagh #5 → **#1** (`backup.renumber_2026_11_13`); Pat Gallicchio keeps #5.
- Chris Iavarone's test order (Wantagh #1, pickup Nov 25) deleted
  (`backup.orders_deleted_2026_11_13`, `backup.order_items_deleted_2026_11_13`).
- Vincent Colletti #4 → back to **#7** (`backup.renumber_2026_11_13`).
- Wantagh turkey counts set from Chris's totals (`backup.inventory_2026_11_13`).

**Order numbers — data rule:** `daily_number` is the number the customer was told and is what the
app shows. `order_seq` is the hidden unique counter. For older Wantagh orders they differ
(Joanna Gross 1/10, William Rathner 2/6, M Crowe 3/2, Vincent Colletti 7/4, Janice Bendernagel 4/12,
Pat Gallicchio 5/11, M Malise 6/3, M Goldmacher 9/5, Ann Mitchell 10/7). Never "fix" that.
The health check flags duplicate told numbers among active orders.

**Backups & daily check (built Nov 3)** — `api/ops.js`, `api/_backup.js`, `api/_health.js`,
`docs/RESTORE.md`. Nightly 2 AM ET backup to Drive (mike@ibfoods.com → "IB Butcher App Backups",
per-store folders + an "upcoming orders" sheet per store for pickup day if the app is down).
6 AM ET health check emailed to mike@ibfoods.com. Admin → Backups shows status / run now.

**Tooling notes (Nov 13)**
- Supabase connector `Supabase_IB_Butcher` reaches this project directly (SQL, migrations, advisors).
- Vercel connector can read deploy status: project `prj_Bq3fHEXBIsOIm457qq81u5hRuCJF`,
  team `team_4Kqx8nQwNXsVYy5TR9ZgduKt` — use it to confirm a production deploy is READY.
- SQL `DELETE` through the connector can be auto-cancelled pending confirmation — get Mike's OK
  in chat, then run the delete on its own.
- Push access: attach the repo with push access; commit as Mike Bottari <bottari.mike@gmail.com>.

## Previous start-here (Oct 31, 2026)

**State:** UI rework + ordering rework + auth hardening are all LIVE on main. Wantagh has been taking
real Thanksgiving orders on the app (started without Mike's sign-off). Treat production data as real.

**Open items**
- Pat Gallicchio and Joanna Gross (Wantagh, pickup Nov 24) both hold **#5** — both got emailed receipts.
  When Chris is back: call one, give them a new number (e.g. #11), then set `daily_number` on that order.
- Chris Iavarone's Wantagh order (Nov 25, #1, placed Oct 22) is probably a test — confirm with Chris.
- Woodbury relay (`relay/epson-server.cjs`) on the store PC still runs old code — update from repo.
- Zebra label test print (footer PICKUP / PHONE / LOCATION) not yet seen on paper.
- Alert email per store not set (Admin → Store settings). Sign-in timeout set to 5 min by Mike.
- Possible: per-store "Taking orders" switch so stores can't go live without approval.
- `auth-selftest` branch on GitHub is a throwaway — delete it (this session can't delete branches).
- **Daily Pickup List** — ON HOLD until Tue Nov 3 (Mike is asking the stores how pickup day should run). Spec, findings and pending decisions: Claude project doc `claude/Daily-Pickup-List-Spec.md`. No code written.
- Revoke the old GitHub PAT that used to live in the Claude project knowledge doc (removed Oct 31; unused).

**Auth (Oct 31)** — see `sql/2026-10-31_auth_hardening.sql`
- Login: `/api/auth/login` → Postgres `login_with_pin` / `login_with_password` (bcrypt, SECURITY DEFINER,
  service role only, 10 failures/IP/15 min) → HS256 JWT signed with Vercel `SUPABASE_JWT_SECRET`
  (= Supabase **Legacy JWT secret**). RLS requires that token on every table; anon has no grants;
  `users` is closed to clients (managers read the `staff` view); staff CRUD via `/api/users`.
- **Never revoke the Legacy JWT secret** in Supabase → JWT Keys. The project is migrated to new signing
  keys and the legacy secret is "still used / verify only"; revoking it locks everyone out.
- On Supabase, pgcrypto lives in the `extensions` schema — SECURITY DEFINER functions that call
  `crypt()` need `search_path = public, extensions`. (Login was broken ~15 min on Oct 31 because of this.)
- No one can see PINs/passwords anymore; managers reset them in Admin → Users.

**Order numbers**
- `order_seq` = hidden unique key per store per pickup month (`next_order_seq`). `daily_number` = the
  number the customer was given; **the app displays `daily_number`**. New orders write both equal.
- Legacy Wantagh orders keep their told numbers. Wantagh Nov displays 1–10 (one dup #5); next new is #15.
- **Rule: before any backfill/renumber, check for live orders customers were already given numbers for.**

**Backups** — private `backup` schema (not exposed to the API): `orders_deleted_2026_10_31`,
`order_items_deleted_2026_10_31`, `customers_deleted_2026_10_31` (32 test orders / 19 test customers
removed Oct 31), `renumber_2026_10_31` (old numbers of 6 renumbered no-email Wantagh orders).

**Other Oct 30–31 changes**: sticky nav (New order + Orders; desk tabs under More on phones); login
persists across reloads; idle timeout setting (5 min…never); sign-out/timeout does a full reload and
devices detect new builds; customer email required on new orders (fakes rejected); first/last name
are separate fields in Customers edit, Admin → Users, and the contact list + CSV.

## Previous start-here (Oct 29, 2026)

**Branch `ui-foundation` holds the full UI cleanup + ordering rework. NOT merged.** Mike reviews
on the Vercel preview, then merge to `main`. Restore point: branch `backup/pre-ui-foundation-2026-10-29`
(= old main `e4b6228`). The Supabase migration (`sql/2026-10-29_ordering_rework.sql`) is already
applied to the live DB and is additive — old code still works against it.

What landed (see `claude/UI-Cleanup-Proposal-2026-10-29.md` in the Claude project for the spec):
- **Tokens + components** (`src/App.css`, `src/ui.jsx`): one brand red `#900027`, 15px body,
  44px tap targets, inline SVG icons (no emoji). `App.css` was never imported before — it is now.
- **Item picker** (`src/ItemPicker.jsx`): category → product → Plain/Oven Ready → qty + note.
  Driven by `items.category` / `items.short_name`; pools never appear as a line. Decimal qty for
  `sold_by = lb`. Sold-out pills disabled for clerks; managers can pick them.
- **Stock enforcement**: fresh inventory read at submit; `items.tracked` decides whether a pool
  blocks. Clerk → error; manager → confirm → order saved with `stock_override`, pool goes negative
  ("Oversold by N" in Inventory), `/api/notify-stock` emails `printer_settings.alert_email`.
- **Monthly order number**: `orders.order_seq` from `next_order_seq(location, pickup_date)`
  (counter table `order_counters`, row-locked, keyed on pickup month). Shown as "Nov #12"
  (`src/orderFmt.js`, `api/_order.js`). Editing pickup month or store renumbers (with confirm).
  New orders write `daily_number` = `order_seq`; edits keep the told `daily_number` (see Nov 13); `invoice_number` still
  assigned but shown nowhere (only under "Details" as "Ref").
- **Mark complete removed** — status is pending / cancelled only.
- **Item notes** (`order_items.note`): picker, modal, email/PDF/thermal receipts, production
  report, and the label (item note on its own label; order note on the first label only).
- **Units everywhere**: `qtyText()` → "4 lb" / "× 4" / "4 people". Popularity report groups
  by unit. Production report leads with quantity.
- **Edit order now adjusts inventory** by the delta (it never did before).
- **Detail modal rebuilt**; nav has a filled **New order** button; Admin → **Store settings**
  (paper toggle, alert email, Test print via the relay); Admin → Items has pill label, category,
  counted toggle. Printer-IP field removed (relay uses Vercel env vars).
- **RLS fix**: `printer_settings` only allowed `authenticated`; the app is `anon`, so the paper
  toggle/alert email could never save. Policy now matches the other tables.
- "Made by OrderHQ" on login + receipt footers. `public/brand/orderhq-wordmark.svg`.

Not verified on hardware: the Zebra label footer now reads PICKUP / PHONE / LOCATION and the
box caption is "NOV ORDER" — test-print one label. Thermal receipt relay (`relay/epson-server.cjs`)
changed the same way; the relay on the Woodbury PC must be updated from the repo.

## Previous start-here (Oct 16, 2026)

**Decision: email-only receipts for now.** Paper/thermal printing is on hold.
1. **Email receipt design pass** (top priority). Send a sample receipt to Mike's inbox first so
   he can see the current design as a customer would, then polish. Current state (Sept 12):
   wordmark header on white + maroon rule (#900027), greeting, large order number, pickup
   callout, items, branded footer, inline CID logo, PDF receipt attached (pdfkit).
   Code: `api/send-receipt.js`, logo in `api/_logo.js`, wordmark in `public/brand/`.
2. Turn Woodbury's paper-receipt toggle OFF (Admin → Printers) once email-only is confirmed.
3. Security follow-ups:
   - Both repos (`IB-Butcher-App`, `IB-Sandwich-App`) are **public** — Mike to switch to Private.
     History scan Oct 16: no API keys/tokens committed; exposed only WiFi password (now removed
     from this file, still in git history), tunnel ID, internal IPs. Sandwich repo has the
     Supabase anon key in commit 143a694 (anon = public by design; fine if RLS is on).
   - Rotate the old GitHub PAT and Vercel API token (both pasted in past chats). The PAT is no
     longer needed — see GitHub access below.
   - Change IBFWoodbury WiFi password at some point (low priority; Epson needs it too).
   - Supabase connector in Claude currently only sees the OrderHQ org — reconnect it to the
     ibfoods Supabase account so Claude can run advisors / migrations directly.
4. Then: Zebra label physical test, other open to-dos below.

**GitHub access (Oct 16):** `ibfoods` is a GitHub *personal account* (not an org). The Claude
GitHub App is now installed on it, so Claude pushes directly — no PAT needed. OrderHQ lives
separately under the `orderhq-app` org; keep IB work in `ibfoods/*` repos only.

**Shipped Oct 16:** Customers screen store filter — pills (All stores + 5 stores, with counts),
defaults to the active store; a customer appears under a store if it's their home store or
they've ordered there; home store falls back to most-ordered store when `home_location_id`
is null; home store editable in customer Edit. Frontend only, no DB change.

## What it is
A custom order-management web app for Iavarone Bros. (IB Foods), a 5-location specialty
Italian market on Long Island. Built for the butcher department: staff take turkey/meat
orders by phone or in person, track shared inventory pools, print receipts and labels,
and email confirmations to customers.

## Live / Repo / Infra
- **Live URL:** butcherorders.ibfoods.com
- **GitHub repo:** `ibfoods/IB-Butcher-App`
- **Hosting:** Vercel, project `ib-butcher-app`, under `ibfoods' projects` org
- **DNS:** Cloudflare (nameservers ANTON/LUCY) → CNAME `butcherorders` → `cname.vercel-dns.com`
- **Database:** Supabase project "ibfoods Butcher Project" — `gajafjiphrsvztcwofhe.supabase.co`
- **Stack:** React + Vite frontend, Vercel serverless functions (`/api`) for backend, Supabase for data/auth storage

## Locations (hardcoded in App.jsx `LOCS`)
| id | Name | Address | Phone |
|---|---|---|---|
| nhp | New Hyde Park | 1538 Union Turnpike, Lake Success Center | (516) 488-5600 |
| wantagh | Wantagh | 1166 Wantagh Avenue | (516) 781-6400 |
| maspeth | Maspeth | 6900 Grand Avenue | (718) 639-3623 |
| woodbury | Woodbury | 7929 Jericho Turnpike | (516) 921-5400 |
| gardencity | Garden City | 140 7th Street | (516) 266-8800 |

Location Gmail logins (for OAuth / reference): `{location}@ibfoods.com` — e.g.
woodbury@ibfoods.com / wantagh@ibfoods.com / gardencity@ibfoods.com / maspeth@ibfoods.com /
newhydepark@ibfoods.com.

## Core features (as of today)
- **Auth:** 4-digit PIN (unique across stores) or username/password, hashed (bcrypt), checked
  server-side (`/api/auth/login`) → signed token required by RLS on every table (Oct 31).
  Roles: clerk / manager / admin / master_admin. Clerks are locked to their home store.
- **Orders:** create, edit, cancel, delete (manager+), search/filter by location/date/name/invoice
- **Inventory:** parent/child shared-pool system (e.g. a "Turkey — Medium" pool covers both
  "plain" and "oven ready" child items drawing from one stock number)
- **Reports:** Popularity (item counts in date range), Production (order worksheet for kitchen),
  Contact List (dedup by email/phone, CSV export, full list + email-only list)
- **Receipts:** email is primary. **Receipt printers dropped Nov 3, 2026** (no Epson rollout, no
  Star CloudPRNT); Woodbury relay code and paper toggle left in place for now. Old notes:
  1. Browser print (popup, always-available fallback)
  2. Relay-based thermal print to Epson TM-T88VII (Woodbury) — see Printer section below
- **Label printing:** two distinct labels —
  1. **Customer receipt (Epson):** the printed receipt itself, via `printReceipt()` /
     `printReceiptBrowser()` in `App.jsx` — goes through the relay/browser-print path
     alongside the order confirmation. Not a "label" in the physical-sticker sense.
  2. **Production label (Zebra GK420t):** one physical label per unit, applied to product
     for kitchen/staff use. Current code (`labelHTML()` / `printLabels()` in `App.jsx`,
     lines ~116–214) is browser-based (HTML/CSS popup print) — **being replaced with raw
     ZPL**, decision made Sept 2026.
     - **Printer:** Zebra GK420t, 203 dpi, **USB-connected directly to the desktop**
       (not networked). Thermal transfer/direct thermal.
     - **Why moving off browser print:** browser printing goes through the Windows/Zebra
       OS print driver, which has its own margin/scaling/stock-size settings independent
       of the app's CSS — this was the root cause of the earlier "configured 4x2.75 but
       measures 2.5"" sizing bug. The app's own CSS was actually already correct at
       4in×2.5in (`@page` and `.label` in `labelHTML()`) — **the mismatch was at the
       Windows driver level, not in the code.**
     - **New approach:** raw ZPL sent directly to the printer via **Zebra Browser Print**
       (Zebra's official free local agent — runs on the desktop with the USB printer,
       exposes a local JS API). ZPL addresses the print head in dots, bypassing the OS
       driver entirely, so `^PW`/`^LL` can be set to match real stock size exactly.
       203 dpi → 4in = 812 dots wide, 2.5in = 508 dots tall.
     - **Template built and visually confirmed correct** (Sept 2026) at
       `/zpl/production-label-template.zpl` in this repo. Includes:
       - IB monogram logo, embedded as a 132×132-dot 1-bit `^GFA` graphic (converted from
         the brand SVG via `cairosvg` → Pillow threshold → hex-packed bytes — see
         `/zpl/logo_to_zpl.py`, reusable if the logo ever changes)
       - Customer name + phone (under CUSTOMER label)
       - Boxed daily order number (top right)
       - Item name, notes
       - 3-col footer: Pickup / Invoice / Location
     - **Per-unit label logic (important, not yet implemented in app code):** each
       physical unit needs its own label — e.g. an order line "2x Turkey" must produce
       **2 separate identical labels**, not one label with a "2x" prefix. The old
       `labelHTML()` did the latter (prefix-based). ZPL handles this via `^PQ{n},0,0,N`
       (print quantity directive) at the end of the label — set `n` to the line item's
       `quantity`. **Still to build:** the actual `printLabelsZPL()` function that loops
       order line items, fills the ZPL template per item, and sends each via Zebra
       Browser Print (`^PQ` for the copy count, or loop + reprint — either works).
     - **Known open issue:** label appeared rotated when previewed in the Labelary
       viewer (had to manually rotate to view correctly) — orientation not yet resolved.
       Needs testing against the actual physical printer, or a ZPL rotation field
       (`^POI`/`^FWX` etc.) — **next session should start here.**
     - **Testing tool:** [Labelary](https://labelary.com/viewer.html) — paste ZPL, set
       density **8 dpmm (203 dpi)**, size **4 x 2.5** (inches).
     - **Not yet done:** bundle Zebra's `BrowserPrint-3.0.x.min.js` into `/public`
       (same pattern as the Epson ePOS SDK), confirm Browser Print agent installed on
       the Woodbury desktop, wire up `printLabelsZPL()`.
- **Email receipts:** Gmail API OAuth per-location (not SMTP — Workspace blocked SMTP auth).
  Each location has its own connected Gmail account so receipts come from e.g.
  woodbury@ibfoods.com with correct Reply-To. PDF receipt (via `pdfkit`) is attached to every
  email in addition to HTML body. Admin → Gmail tab shows live token-validated connection
  status per location with a Refresh button and Connect/Reconnect links.
- **Admin panel tabs:** Users, Items, Gmail, Printers
  - Printers tab: per-location printer IP input, stored in Supabase `printer_settings` table
    (`location_id text primary key, printer_ip text, updated_at timestamptz`)

## Zebra label printing — BUILT Oct 28, 2026
- Labels now print straight to the Zebra GK420t in ZPL through **Zebra Browser Print**
  (local helper at `http://localhost:9100`). Code: `src/zebraPrint.js` (Browser Print client
  copied verbatim from OrderHQ; butcher layout renderer; label-count rule).
- Facts (proven in OrderHQ): 203 dpi; 4.25 x 2.75 in stock feeds the WIDE way, no rotation;
  `^PW831` (4.09 in head); 0.12 in margins; lowest text >= 0.22 in above the bottom edge.
  The old `/zpl` template (`^PW812 ^LL508`, 4 x 2.5) is superseded — don't use it.
- Every label button (order detail, Orders day button, Reports -> Production) uses `LabelPrint`:
  Zebra is the default; the browser print window is the backup (now sized 4.25 x 2.75).
  Managers+ see the Zebra status line + download link when Browser Print isn't found.
- Orders day-labels button now always shows when search is empty (uses the picked date,
  or today on Upcoming/All) and shows the count.
- Label count rule (OrderHQ): items have `sold_by` (each | lb | person) and `label_mode`
  (default | each | line). Default: sold each -> one label per piece ("1 of 3"); sold by
  lb/person -> one label per line ("5 LB"). Qty < 2 or decimal -> always 1 label.
  Migration: `sql/2026-10-28_item_label_settings.sql` (must be run in Supabase SQL editor).
- Order quantities are still whole numbers only (parseInt in the order form).
- First real ZPL print (Oct 28, Wantagh test order #1026) confirmed good on paper:
  `docs/label-photos/2026-10-28-first-zebra-zpl-print.jpg` — reference for future layout tweaks.
- Only labels go to the Zebra. Reports (Popularity, Production worksheet) print via the browser
  dialog on letter paper (`@page size: letter`). Chrome remembers the last printer picked in the
  dialog, so pick the regular printer once per computer.
- Print-all: single-day views (Today/Tomorrow/picked date) show a bar above the list;
  Upcoming/All show a "Print all N labels" button on each date header.

## Printer Architecture — Relay + Named Cloudflare Tunnel (Woodbury only — receipt printers dropped Nov 3, 2026; kept for reference)

### Why the relay exists
iPads run the app as a PWA over HTTPS. Browsers block direct connections from HTTPS pages
to local network devices — no printer brand changes this. The relay is the permanent solution.

### Flow
iPad PWA → Vercel `/api/print-relay` → Cloudflare Tunnel → Node.js relay on Woodbury PC → Epson printer (TCP port 9100)

### Woodbury Setup (confirmed working)
**Printer:** Epson TM-T88VII + OT-WL06 WiFi dongle
- IP: `192.168.30.31` (static)
- MAC: `DC:CD:2F:1E:38:70`
- Network: IBFWoodbury (WPA2-PSK, password: ask Mike, not stored in this repo)
- Port: 9100 (raw ESC/POS TCP)
- WebConfig backup saved — if printer loses WiFi, restore via WebConfig before redoing SimpleAP

**PC relay:** `C:\ib-relay` on Mike's desktop (192.168.30.57)
- Files: `epson-server.cjs`, `cloudflared.exe`, `package.json`, `run-relay.bat`, `start-ib-relay.bat`
- Relay listens on port 3002
- Logs: `C:\ib-relay\relay.log` and `C:\ib-relay\tunnel.log`

**Named Cloudflare Tunnel:** `epson-woodbury` (tunnel ID: `f702e23b-73aa-4dba-b176-275f79889a27`)
- Permanent URL: `https://epson-woodbury.ibfoods.com` — **never changes, Vercel never needs updating**
- Credentials: `C:\Users\botta\.cloudflared\f702e23b-73aa-4dba-b176-275f79889a27.json`
- Config: `C:\Users\botta\.cloudflared\config.yml`
- Cloudflare account: Mike@ibfoods.com, zone: ibfoods.com

**Vercel env var:** `EPSON_RELAY_URL_WOODBURY` = `https://epson-woodbury.ibfoods.com`

**Auto-start:** Windows Task Scheduler task "IB-Relay-Startup" runs `start-ib-relay.bat` on every login
- `start-ib-relay.bat` kills any existing node/cloudflared, starts `run-relay.bat` (Node), waits 3s, starts named tunnel
- `run-relay.bat` sets `PRINTER_IP=192.168.30.31` and runs `epson-server.cjs`
- Shows Windows toast notification "IB Relay started — printer ready" on success
- Two minimized CMD windows remain in taskbar while running — do not close them

**To re-register Task Scheduler** (if ever needed): right-click `install-startup.bat` → Run as administrator

### If printer loses WiFi after power outage
1. Open WebConfig at `192.168.30.31` (if reachable) → try Restore from backup first
2. If not reachable: use Epson TM Utility on iPhone → SimpleAP setup → IBFWoodbury / (WiFi password from Mike) / static IP 192.168.30.31 / subnet 255.255.255.0 / gateway 192.168.30.1
3. After reconnecting, do a fresh WebConfig backup immediately

### Other 4 locations — printer rollout plan (CANCELLED Nov 3, 2026)
- Recommended printer: **Star Micronics TSP143IV X4** (~$300) with **CloudPRNT**
- CloudPRNT eliminates the relay entirely: printer polls Star's cloud, app sends job to cloud, done
- WiFi only (no ethernet runs needed in stores)
- Requires: new `/api/cloudprnt` Vercel endpoint + receipt rendered as PNG or Star format
- Woodbury keeps existing relay — other 4 get CloudPRNT when purchased
- In-app setup wizard planned: Admin → Printers → Setup walks operator through everything

## RLS / Security
- RLS on every public table; every policy requires the signed app token (Oct 31). Anonymous
  callers have no grants. `users` is closed to the browser — managers read the `staff` view.
- `apply_stock_changes` runs as the caller (SECURITY INVOKER); `authenticated` may execute it, anon may not.
- Server-only tables (no policies, service role only): `users`, `ops_settings`, `login_attempts`, `order_counters`.

## Known technical gotchas
- **Supabase project ref:** `gajafjiphrsvztcwofhe` — double-check this string, a prior typo caused bugs
- **Epson OT-WL06 dongle** is flaky — printer can lose WiFi config after power loss; WebConfig backup is the fix
- **Named tunnel credentials** live in `C:\Users\botta\.cloudflared\` — back these up if the PC is ever replaced
- **GitHub secret scanning** will reject any repo file containing a live PAT — never commit credentials
- **Vercel API** is not reachable from the shell; the Vercel connector can read deployments. Env var changes are still Mike's job in the Vercel UI.
- Mike prefers full file replacements over partial diffs for large files like App.jsx
- Git commits need `git config user.email` / `user.name` set first

## Related apps
- **IB Sandwich App** — `deliorder.ibfoods.com`, repo `ibfoods/IB-Sandwich-App`, Supabase project `jrdylryrawprhvefzfid`
- **OrderHQ** — eventual multi-tenant SaaS product, separate project/context

## Outstanding to-dos
- [ ] Daily Pickup List — decide go/no-go (see Start here)
- [ ] Make both repos private; rotate the old GitHub PAT + Vercel token
- [ ] Per-store "taking orders" switch so a store can't go live without approval
- [ ] Set an alert email per store (Admin → Store settings) — needed for oversell emails
- [ ] Before other stores go live: staff users, items, inventory counts per store
- [ ] After the holiday: per-store database lock on orders; advisor cleanup (search_path)
- [ ] Zebra label footer (PICKUP / PHONE / LOCATION) — confirm on paper

## Brand assets
- **Circle monogram** (`public/logo.jpg`, black IB circle "Since 1927") — used on the app login screen and in-app; keep it there.
- **Wordmark** (`public/brand/iavarone-wordmark.svg` + `.png`, maroon script "Iavarone Bros. — Quality Foods", brand color `#900027`) — used in the customer receipt email header and PDF receipt header. The PNG is embedded base64 in `api/_logo.js` for the serverless function (inline CID image in email, `doc.image` in pdfkit).
- Rule: wordmark for anything customer-facing (email, PDF, printed receipts going forward); circle monogram for internal/app UI.
