# IB Butcher App — Project Knowledge

_Last updated: August 27, 2026_

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
- **Auth:** simple username/password login stored in Supabase `users` table (not real auth —
  plaintext-ish, role-based: clerk / manager / admin / master_admin)
- **Orders:** create, edit, cancel, delete (manager+), search/filter by location/date/name/invoice
- **Inventory:** parent/child shared-pool system (e.g. a "Turkey — Medium" pool covers both
  "plain" and "oven ready" child items drawing from one stock number)
- **Reports:** Popularity (item counts in date range), Production (order worksheet for kitchen),
  Contact List (dedup by email/phone, CSV export, full list + email-only list)
- **Receipt printing:** two paths —
  1. Browser print (popup, always-available fallback)
  2. Relay-based thermal print to Epson TM-T88VII (Woodbury) — see Printer section below
- **Label printing:** browser-based, one label per line item, 4.25in×2.75in landscape,
  logo + customer name + boxed order # + item + 3-col footer (pickup/invoice/location).
  "Print all labels for the day" button on Orders screen.
  - **⚠️ Open issue (Aug 2026):** system/label setting is configured as 4x2.75, but the
    actual physical Zebra label stock measures **2.5"** (not 2.75") on that dimension —
    needs re-measurement and a corrected layout before the next print run.
  - **Testing tool:** use [Labelary](https://labelary.com/viewer.html) (ZPL label viewer)
    to preview label layout/sizing changes before printing physical labels.
- **Email receipts:** Gmail API OAuth per-location (not SMTP — Workspace blocked SMTP auth).
  Each location has its own connected Gmail account so receipts come from e.g.
  woodbury@ibfoods.com with correct Reply-To. PDF receipt (via `pdfkit`) is attached to every
  email in addition to HTML body. Admin → Gmail tab shows live token-validated connection
  status per location with a Refresh button and Connect/Reconnect links.
- **Admin panel tabs:** Users, Items, Gmail, Printers
  - Printers tab: per-location printer IP input, stored in Supabase `printer_settings` table
    (`location_id text primary key, printer_ip text, updated_at timestamptz`)

## Printer Architecture — Relay + Named Cloudflare Tunnel (FULLY WORKING as of Aug 27, 2026)

### Why the relay exists
iPads run the app as a PWA over HTTPS. Browsers block direct connections from HTTPS pages
to local network devices — no printer brand changes this. The relay is the permanent solution.

### Flow
iPad PWA → Vercel `/api/print-relay` → Cloudflare Tunnel → Node.js relay on Woodbury PC → Epson printer (TCP port 9100)

### Woodbury Setup (confirmed working)
**Printer:** Epson TM-T88VII + OT-WL06 WiFi dongle
- IP: `192.168.30.31` (static)
- MAC: `DC:CD:2F:1E:38:70`
- Network: IBFWoodbury (WPA2-PSK, password: ibflmdpos1234)
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
2. If not reachable: use Epson TM Utility on iPhone → SimpleAP setup → IBFWoodbury / ibflmdpos1234 / static IP 192.168.30.31 / subnet 255.255.255.0 / gateway 192.168.30.1
3. After reconnecting, do a fresh WebConfig backup immediately

### Other 4 locations — printer rollout plan
- Recommended printer: **Star Micronics TSP143IV X4** (~$300) with **CloudPRNT**
- CloudPRNT eliminates the relay entirely: printer polls Star's cloud, app sends job to cloud, done
- WiFi only (no ethernet runs needed in stores)
- Requires: new `/api/cloudprnt` Vercel endpoint + receipt rendered as PNG or Star format
- Woodbury keeps existing relay — other 4 get CloudPRNT when purchased
- In-app setup wizard planned: Admin → Printers → Setup walks operator through everything

## RLS / Security
- RLS enabled on all public Supabase tables (fixed August 2026 security advisory)
- `printer_settings` protected with authenticated read/write policies
- No anonymous access to any table

## Known technical gotchas
- **Supabase project ref:** `gajafjiphrsvztcwofhe` — double-check this string, a prior typo caused bugs
- **Epson OT-WL06 dongle** is flaky — printer can lose WiFi config after power loss; WebConfig backup is the fix
- **Named tunnel credentials** live in `C:\Users\botta\.cloudflared\` — back these up if the PC is ever replaced
- **GitHub secret scanning** will reject any repo file containing a live PAT — never commit credentials
- **Vercel API** is not accessible from Claude's network (egress blocked) — Mike must do Vercel UI changes directly, or we write code that calls it from Vercel functions
- Mike prefers full file replacements over partial diffs for large files like App.jsx
- Git commits need `git config user.email` / `user.name` set first

## Related apps
- **IB Sandwich App** — `deliorder.ibfoods.com`, repo `ibfoods/IB-Sandwich-App`, Supabase project `jrdylryrawprhvefzfid`
- **OrderHQ** — eventual multi-tenant SaaS product, separate project/context

## Outstanding to-dos
- [ ] Clean up test orders in production data
- [ ] Add remaining staff users
- [ ] iPad + Star TSP143 label printer test pass
- [ ] Inventory levels double-check across all 5 locations
- [ ] Purchase Star TSP143IV X4 printers for other 4 locations
- [ ] Build CloudPRNT integration in app for non-Woodbury locations
- [ ] Build in-app operator setup wizard (Admin → Printers → Setup)
- [ ] Layout polish + full QA pass
- [ ] Fix Zebra label size mismatch (configured 4x2.75, actual stock measures 2.5" — verify with Labelary preview at https://labelary.com/viewer.html before reprinting)
- [ ] Write PRINTER_SETUP_NEW_LOCATION.md and PRINTER_ARCHITECTURE.md in repo
