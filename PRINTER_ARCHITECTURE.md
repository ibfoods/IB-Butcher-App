# Epson Printer Connectivity — Diagnosis & Path Forward

_Written the night of 8/21/2026 after a full-day, ultimately unsuccessful, live
troubleshooting session. This document exists so the next session starts from
a documented decision, not another round of guessing._

## What we confirmed today (all solid, none of this needs redoing)

- Printer network config is correct: WPA2-Personal, SSID `PRIVATE WOODBURY`,
  DHCP-assigned IP **192.168.4.155** (verify this hasn't changed — DHCP leases
  can rotate), signal strength Excellent, WiFi dongle (OT-WL06) properly seated
  and functioning.
- `public/epos-2.27.0.js` is correctly bundled locally and loads over HTTPS —
  the original mixed-content **script loading** issue is fully fixed and confirmed
  live.
- The app's `printReceipt()` function in `src/App.jsx` currently connects via
  `ePosDev.connect(printerIp, 8043, callback)` — port 8043 is correct per
  Epson's official SDK reference (8008 = HTTP, 8043 = SSL/TLS), and the earlier
  invalid `{ ssl: true }` option has been removed.
- Despite all of the above, printing from the iPad still times out.

## Root cause, fully diagnosed (not guessed)

The printer's SSL/TLS service on port 8043 uses a **self-signed certificate**
by default. <cite>Epson's own WebConfig reference guide confirms this explicitly.</cite>
A background WebSocket connection (`wss://`) to a host presenting a
self-signed cert fails silently in the browser — there's no interactive warning
dialog like there is for a normal page navigation, so it just looks like a
timeout.

Epson's fix for this is a printer feature called **Automatic Certificate
Update**, which fetches a real CA-signed certificate from Epson's own
certificate authority. This is independently confirmed by Odoo's official
Point of Sale documentation, which integrates with this exact printer family
for exactly this reason. **However**, per Odoo's own docs, using that feature
correctly requires two more things we have not yet done:

1. A **Time Server** configured on the printer (Device Management → Date and
   Time → Time Server) — certificate validation fails if the printer's clock
   isn't accurate.
2. The app must connect using a **special certified hostname derived from the
   printer's serial number** (something like
   `<hash-of-serial>.omnilinkcert.epson.biz`) — **not the raw LAN IP** —
   because a public certificate authority cannot issue a valid certificate for
   a private IP address like 192.168.4.155. Epson's SDK has a
   `connectHostName` method specifically for this.

This is a legitimate, documented path, but it's non-trivial: it requires
printer-side setup (cert + time server), a code change to compute and use the
right hostname instead of an IP, and the printer needs outbound internet
access to actually reach Epson's certificate service.

## Two paths forward

### Path A — Finish the certificate route (lower effort, some risk)

1. On the printer's WebConfig: **Network Security → SSL/TLS → Automatic
   Certificate Update** → enable, set an update time.
2. **Device Management → Date and Time → Time Server** → enable, point at
   `be.pool.ntp.org` or another NTP server, 10 min interval.
3. Apply — printer restarts.
4. Update `printReceipt()` in `App.jsx` to use `connectHostName` (or manually
   compute the SHA-256 → Base32 → `.omnilinkcert.epson.biz` hostname) instead
   of the raw `printerIp` when connecting on port 8043.
5. Test.

Risk: this is printer-firmware-feature-dependent, requires the store's
internet/DNS to reach Epson's cert service cleanly, and — even once working —
still fundamentally depends on Epson-specific quirks that would need to be
re-solved for every future printer/location.

### Path B — Local relay + tunnel (recommended, more setup, permanent fix)

Bypass the browser-to-printer connection category entirely. This is the
pattern real POS platforms (Star Cloud Print, Epson Server Direct Print,
PrintNode) actually use in production, and it's **already proven working in
this exact codebase** for the Star label printer (`print-server/server.cjs`).

```
iPad browser → HTTPS POST to butcherorders.ibfoods.com/api/print-relay
             (same-origin — zero browser security restrictions apply)
           → Vercel serverless function (server-side — no browser sandbox)
           → HTTPS POST to a local relay's public tunnel URL
           → local relay (small always-on Node process in the store)
           → raw TCP socket, port 9100 → Epson TM-T88VII
```

Port 9100 is Epson's raw ESC/POS socket port — <cite>confirmed as standard
across Epson TM printers, no HTTP wrapper, no certificate, no ePOS SDK
required at all</cite>. This sidesteps the entire SSL/mixed-content saga from
today, permanently, and the same pattern extends cleanly to every future
location and printer without re-solving certificate issues each time.

**Files already built tonight, ready to deploy, untested against live
hardware (needs someone on-site):**

- `relay/epson-server.cjs` — the local relay (adapted from the working Star
  proxy, using raw ESC/POS bytes matching the existing receipt layout)
- `relay/package.json` — its dependencies/config
- `api/print-relay.js` — the same-origin Vercel endpoint the app will call

**What's needed to finish Path B:**

1. Pick an always-on device at Woodbury to run the relay (old PC, Mac mini,
   even a cheap always-on box — it just needs to stay powered and on the
   PRIVATE WOODBURY network).
2. `npm install` in the `relay/` folder, run `epson-server.cjs`.
3. Install a tunnel tool to get a stable public HTTPS URL for that device.
   **Cloudflare Tunnel** is free and works well with a domain we already
   control (ibfoods.com is already on Cloudflare DNS per earlier project
   notes) — can set up a permanent hostname like
   `epson-woodbury.ibfoods.com` instead of a random `trycloudflare.com` URL.
4. Set `EPSON_RELAY_URL_WOODBURY` and `EPSON_RELAY_SECRET` in Vercel's
   environment variables.
5. Wire `App.jsx`'s print button to call `/api/print-relay` — this hasn't
   been wired into the live UI yet (intentionally — didn't want to touch the
   live print flow without being able to test it same-day).

## Recommendation

Given OrderHQ is about to become a real, multi-tenant, lawyer-reviewed
product — **Path B is the right long-term investment**, not just a workaround
for tonight. It removes an entire category of printer-vendor-specific,
certificate-dependent fragility that would otherwise need to be re-diagnosed
for every future customer's hardware. Path A is worth a quick shot first
since it's low-effort if it happens to work, but Path B is what should
actually ship.
