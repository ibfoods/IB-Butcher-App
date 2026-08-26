# IB Butcher App — Project Knowledge

_Last updated: August 26, 2026_

## What it is
A custom order-management web app for Iavarone Bros. (IB Foods), a 5-location specialty
Italian market on Long Island. Built for the butcher department: staff take turkey/meat
orders by phone or in person, track shared inventory pools, print receipts and labels,
and email confirmations to customers.

## Live / Repo / Infra
- **Live URL:** butcherorders.ibfoods.com
- **GitHub repo:** `ibfoods/IB-Butcher-App`
- **Hosting:** Vercel, project `ib-butcher-app`, under `ibfoods' projects` org
- **DNS:** Cloudflare (nameservers ANTON/LUCY) -> CNAME `butcherorders` -> `cname.vercel-dns.com`
- **Database:** Supabase project "ibfoods Butcher Project" -- `gajafjiphrsvztcwofhe.supabase.co`
- **Stack:** React + Vite frontend, Vercel serverless functions (`/api`) for backend, Supabase for data/auth storage

## Locations (hardcoded in App.jsx `LOCS`)
| id | Name | Address | Phone |
|---|---|---|---|
| nhp | New Hyde Park | 1538 Union Turnpike, Lake Success Center | (516) 488-5600 |
| wantagh | Wantagh | 1166 Wantagh Avenue | (516) 781-6400 |
| maspeth | Maspeth | 6900 Grand Avenue | (718) 639-3623 |
| woodbury | Woodbury | 7929 Jericho Turnpike | (516) 921-5400 |
| gardencity | Garden City | 140 7th Street | (516) 266-8800 |

Location Gmail logins (for OAuth / reference): `{location}@ibfoods.com` e.g.
woodbury@ibfoods.com / wantagh@ibfoods.com / gardencity@ibfoods.com / maspeth@ibfoods.com /
newhydepark@ibfoods.com.

## Core features
- **Auth:** simple username/password login stored in Supabase `users` table (not real auth --
  plaintext-ish, role-based: clerk / manager / admin / master_admin)
- **Orders:** create, edit, cancel, delete (manager+), search/filter by location/date/name/invoice
- **Inventory:** parent/child shared-pool system (e.g. a "Turkey -- Medium" pool covers both
  "plain" and "oven ready" child items drawing from one stock number)
- **Reports:** Popularity (item counts in date range), Production (order worksheet for kitchen),
  Contact List (dedup by email/phone, CSV export, full list + email-only list)
- **Receipt printing:** two paths --
  1. Browser print (popup, always-available fallback)
  2. Relay-based thermal print to Epson TM-T88VII (see Printer Architecture below)
- **Label printing:** browser-based, one label per line item, 4.25in x 2.75in landscape,
  logo + customer name + boxed order # + item + 3-col footer (pickup/invoice/location).
  "Print all labels for the day" button on Orders screen.
- **Email receipts:** Gmail API OAuth per-location (not SMTP -- Workspace blocked SMTP auth).
  Each location has its own connected Gmail account so receipts come from e.g.
  woodbury@ibfoods.com with correct Reply-To. PDF receipt (via `pdfkit`) is attached to every
  email in addition to HTML body. Admin -> Gmail tab shows live token-validated connection
  status per location with a Refresh button and Connect/Reconnect links.
- **Admin panel tabs:** Users, Items, Gmail, Printers
  - Printers tab: per-location printer IP input, stored in Supabase `printer_settings` table
    (`location_id text primary key, printer_ip text, updated_at timestamptz`).
    NOTE: `printer_settings` is only accessed by the Admin UI (authenticated users only).
    The relay reads printer targets from Vercel env vars, NOT Supabase.

## Printer Architecture -- Relay System

### Why the relay exists
iOS PWA home-screen icons get an isolated browser context with no address bar and no way to
accept certificate exceptions. Every direct browser->printer approach fails. The relay is the
only viable path.

### Architecture
```
iPad (home-screen icon)
  -> HTTPS POST to butcherorders.ibfoods.com/api/print-relay  [Vercel -- clean cert]
    -> Cloudflare Tunnel (outbound-only from desktop, no port forwarding needed)
      -> relay/epson-server.cjs on Mike's desktop  [Node.js, port 3002]
        -> TCP port 9100  ->  Epson TM-T88VII at 192.168.30.31
```

### Woodbury -- confirmed working end-to-end
- Printer: Epson TM-T88VII + OT-WL06 WiFi dongle
- Printer IP: 192.168.30.31, MAC DC:CD:2F:1E:38:70, port 9100
- Network: IBFWoodbury (WPA2-PSK, password ibflmdpos1234)
- Relay machine: Mike's desktop at 192.168.30.57, relay deployed to C:\ib-relay
- Vercel env var: EPSON_RELAY_URL_WOODBURY = current Cloudflare Tunnel URL
- Vercel Auth must remain OFF (Settings -> Deployment Protection)

### Woodbury network context
- SonicWall at 192.168.30.230 -- password unknown, installed by POS company. DO NOT factory reset.
- Archer C5 TP-Link at 192.168.30.100 (admin/admin) -- wired ports + BCSE WiFi for scales only.
  Not useful for finding IBFWoodbury devices.
- TL-WA1201 AC1200 access point in Mike's office -- broadcasts IBFWoodbury.

### Relay files in repo
- `relay/epson-server.cjs` -- Node.js HTTP server, builds ESC/POS bytes, sends to printer over TCP 9100
- `relay/package.json` -- no npm dependencies, pure Node built-ins
- `api/print-relay.js` -- Vercel serverless function, reads EPSON_RELAY_URL_{LOCATION} env vars,
  forwards job to tunnel URL. Does NOT touch Supabase.

### Manual startup commands (temporary -- Task Scheduler not yet configured)
Run both in separate CMD windows on Mike's desktop at Woodbury:

  cd C:\ib-relay && node -e "process.env.PRINTER_IP='192.168.30.31'; require('./epson-server.cjs')"
  cd C:\ib-relay && cloudflared.exe tunnel --url http://localhost:3002

After tunnel starts, copy the trycloudflare.com URL and update EPSON_RELAY_URL_WOODBURY in Vercel.

### Vercel env vars (one per location as each gets set up)
- EPSON_RELAY_URL_WOODBURY  -- active
- EPSON_RELAY_URL_WANTAGH   -- not yet set up
- EPSON_RELAY_URL_GARDENCITY -- not yet set up
- EPSON_RELAY_URL_MASPETH   -- not yet set up
- EPSON_RELAY_URL_NHP       -- not yet set up

EPSON_RELAY_SECRET was removed -- the tunnel URL itself is the security layer.

## Supabase RLS status (as of August 26, 2026)
All 7 tables in the public schema have RLS enabled. printer_settings was the last one --
it was flagged by Supabase security advisory dated Aug 23 and fixed Aug 26.
No app code changes were needed. Policies added: authenticated read + authenticated write (ALL).

| Table | RLS |
|-------|-----|
| users | enabled |
| items | enabled |
| orders | enabled |
| inventory | enabled |
| order_items | enabled |
| gmail_tokens | enabled |
| printer_settings | enabled (fixed Aug 26) |

## Priority next steps (in order)
1. Windows Task Scheduler auto-start for relay + Cloudflare Tunnel -- no visible CMD windows on boot
2. Named Cloudflare Tunnel with permanent subdomain (e.g. epson-woodbury.ibfoods.com) so
   EPSON_RELAY_URL_WOODBURY never needs updating after a restart
3. Roll out relay architecture to Wantagh, Garden City, Maspeth, New Hyde Park
4. In-app operator setup wizard in Admin -> Printers: download .bat file, paste tunnel URL
   back into app to auto-update Vercel -- no operator ever needs to touch Vercel directly
5. Documentation: PRINTER_SETUP_NEW_LOCATION.md and PRINTER_ARCHITECTURE.md in repo
6. General app: layout polish, full QA pass, remaining staff users, inventory verification
   across all 5 locations

## Known technical gotchas
- iOS PWA home-screen icon context cannot accept cert exceptions -- relay is the only path.
- Windows env var trailing spaces cause ENOTFOUND in Node.js on a valid IP -- looks like DNS
  failure but isn't. Check for trailing spaces if relay throws unexpected connection errors.
- GitHub CDN caches raw file downloads -- add cache-busting query param (e.g. ?t=2) after commits.
- GitHub secret scanning blocks PAT tokens in file content -- Contents API PUT returns 409/422.
  Store the PAT only in Claude project context, never commit it to the repo.
- Epson TM Utility SimpleAP setup + factory reset (SW pinhole on back) is the recovery path
  when a printer ends up on the wrong network.
- ePOS SDK communicates over WebSocket on port 8008. The relay uses raw TCP 9100 (ESC/POS).
- Supabase project ref is gajafjiphrsvztcwofhe -- a prior typo (gsjafjjphrvzctcwofhe) caused
  a long-running bug. Double-check this string if Supabase calls start failing.
- Mike prefers full file replacements over partial diffs for large files like App.jsx.

## Related apps (same family, separate repos)
- IB Sandwich App -- deliorder.ibfoods.com, repo ibfoods/IB-Sandwich-App,
  Supabase project jrdylryrawprhvefzfid. Customer-facing PWA, iPad kiosk ordering flow.
  Parked to-do: Gmail OAuth email receipts (reuse Butcher App pattern).
- OrderHQ -- eventual multi-tenant SaaS product this app's patterns feed into,
  with IB as the reference customer.

## Other printers
- Star TSP143IIIW -- used for label printing on desktop browsers, out of scope for relay work.
  star-io10-web npm package only supports USB (WebUSB), not LAN/TCP.
