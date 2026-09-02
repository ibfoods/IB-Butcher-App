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
- [ ] Zebra production label: resolve rotation issue seen in Labelary preview, test on
      physical GK420t, install Zebra Browser Print agent on Woodbury desktop, build
      `printLabelsZPL()` in `App.jsx` (see Label printing section above for full context —
      template is done and visually confirmed, integration is not).
- [ ] Write PRINTER_SETUP_NEW_LOCATION.md and PRINTER_ARCHITECTURE.md in repo
