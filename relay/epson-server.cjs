/**
 * IB Butcher App — Epson TM-T88VII Print Proxy
 * =============================================
 * Same pattern as the existing Star TSP100IIIW proxy (print-server/server.cjs),
 * adapted for the Epson TM-T88VII. Epson invented ESC/POS, so the raw command
 * set below is native to this printer — no ePOS SDK, no SSL, no self-signed
 * certificate dance required. Port 9100 is the standard raw/JetDirect-style
 * socket port that Epson TM printers listen on by default (same as almost
 * every network receipt/label printer on the market).
 *
 *   iPad browser  →  HTTPS POST to OUR domain (/api/print-relay)
 *                  →  Vercel serverless function (server-side, no browser
 *                     security restrictions apply here)
 *                  →  HTTPS POST to this relay's public tunnel URL
 *                  →  this relay  →  raw TCP :9100  →  Epson TM-T88VII
 *
 * Why this exists:
 *   The iPad browser can only make same-origin HTTPS requests without hitting
 *   mixed-content blocking. A direct browser → printer connection (ws:// or
 *   http://) is blocked categorically by iOS Safari regardless of printer
 *   settings, certificates, or firmware — this is true for ANY local device,
 *   not just this printer. Routing through our own domain + a relay sidesteps
 *   the restriction entirely instead of fighting it.
 *
 * Setup:
 *   1. Copy this file + package.json to any always-on device on the
 *      PRIVATE WOODBURY network (old PC, Mac mini, Raspberry Pi — anything
 *      that can stay powered on and run Node).
 *   2. npm install
 *   3. node epson-server.cjs   (or: npx pm2 start epson-server.cjs --name ib-epson-print --restart-delay 3000)
 *   4. Expose it publicly over HTTPS with a stable hostname using a tunnel —
 *      Cloudflare Tunnel (free, recommended) or Tailscale Funnel both work.
 *      Example with Cloudflare Tunnel:
 *        cloudflared tunnel --url http://localhost:3002
 *      This gives you a URL like https://random-words.trycloudflare.com
 *      (or a permanent one if you set up a named tunnel on ibfoods.com's
 *      Cloudflare account, e.g. epson-woodbury.ibfoods.com).
 *   5. Put that HTTPS tunnel URL into the Vercel environment variable
 *      EPSON_RELAY_URL_WOODBURY (see api/print-relay.js).
 *
 * Endpoints:
 *   POST /print   — body: { order, orderItems, items, loc } (same shape the
 *                   app already builds for printReceipt())
 *   GET  /status  — returns printer TCP reachability check
 *   GET  /health  — always 200, for uptime monitoring / tunnel health checks
 */

"use strict";

const http = require("http");
const net = require("net");
const os = require("os");

// ── Config ────────────────────────────────────────────────────────────────
const PRINTER_IP = process.env.PRINTER_IP || "192.168.4.155";
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || "9100");
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3002");
const RELAY_SHARED_SECRET = process.env.RELAY_SHARED_SECRET || ""; // set this and check it below before trusting a request — the tunnel URL is public

// ── Helpers ───────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendToPrinter(rawBytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(8000);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      log(`TCP connected -> ${PRINTER_IP}:${PRINTER_PORT}, sending ${rawBytes.length} bytes`);
      socket.write(rawBytes, (err) => {
        if (err) return done(err);
        socket.once("close", () => done(null));
      });
    });
    socket.on("timeout", () => done(new Error("TCP timeout - printer not responding")));
    socket.on("error", done);
  });
}

function checkPrinterReachable() {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(3000);
    s.connect(PRINTER_PORT, PRINTER_IP, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => {
      s.destroy();
      resolve(false);
    });
    s.on("timeout", () => {
      s.destroy();
      resolve(false);
    });
  });
}

// ── Formatting helpers (mirrors the logic already in App.jsx) ─────────────
function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y.slice(2)}`;
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}
function takenByInitials(name) {
  if (!name) return "";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ── ESC/POS byte builder for a receipt ─────────────────────────────────────
// Same content/layout as the existing browser-fallback receipt and the
// ePOS-SDK version in App.jsx, just built as raw command bytes instead.
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function buildReceiptBytes({ order, orderItems, items, loc }) {
  const bytes = [];
  const push = (...vals) => bytes.push(...vals);
  const str = (s = "") => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const nl = (n = 1) => {
    for (let i = 0; i < n; i++) bytes.push(LF);
  };
  const line = (ch = "-", n = 32) => {
    str(ch.repeat(n));
    nl();
  };

  const takenBy = takenByInitials(order.taken_by);

  push(ESC, 0x40); // initialize

  // Header
  push(ESC, 0x61, 0x01); // center
  push(ESC, 0x45, 0x01); // bold on
  push(GS, 0x21, 0x11); // double width + height
  str("IAVARONE BROS.");
  nl();
  push(GS, 0x21, 0x00);
  push(ESC, 0x45, 0x00);
  str(loc?.address || "");
  nl();
  str(loc?.city || "");
  nl();
  str(loc?.phone || "");
  nl();
  line();

  // Daily number
  str("DAILY ORDER #");
  nl();
  push(ESC, 0x45, 0x01);
  push(GS, 0x21, 0x22); // triple-ish size
  str(String(order.daily_number));
  nl();
  push(GS, 0x21, 0x00);
  push(ESC, 0x45, 0x00);
  line();

  // Customer block
  push(ESC, 0x61, 0x00); // left
  str("CUSTOMER");
  nl();
  push(ESC, 0x45, 0x01);
  str(order.customer_name || "");
  nl();
  push(ESC, 0x45, 0x00);
  str("PHONE");
  nl();
  str(order.customer_phone || "");
  nl();
  str("PICKUP");
  nl();
  str(`${fmtDate(order.pickup_date)} at ${fmtTime(order.pickup_time)}`);
  nl();
  str("INVOICE");
  nl();
  str(`#${order.invoice_number}`);
  nl();
  line();

  // Items
  str("ITEMS");
  nl();
  orderItems.forEach((li) => {
    const item = items.find((i) => i.id === li.item_id);
    const name = item?.name || "";
    const qty = `x${li.quantity}`;
    const pad = 32 - name.length - qty.length;
    str(`${name}${" ".repeat(Math.max(1, pad))}${qty}`);
    nl();
  });

  if (order.notes) {
    line();
    str("NOTES");
    nl();
    str(order.notes);
    nl();
  }

  line();
  push(ESC, 0x61, 0x01); // center
  str(`Taken by ${takenBy}`);
  nl(4);
  push(GS, 0x56, 0x42, 0x00); // partial cut

  return Buffer.from(bytes);
}

// ── Request router ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  const json = (obj, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url === "/health" && req.method === "GET") return json({ ok: true, ts: Date.now() });

  if (url === "/status" && req.method === "GET") {
    const reachable = await checkPrinterReachable();
    return json({ reachable, printer: `${PRINTER_IP}:${PRINTER_PORT}` }, reachable ? 200 : 503);
  }

  if (url === "/print" && req.method === "POST") {
    try {
      if (RELAY_SHARED_SECRET) {
        const auth = req.headers["x-relay-secret"];
        if (auth !== RELAY_SHARED_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
      }
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8"));
      const bytes = buildReceiptBytes(payload);
      await sendToPrinter(bytes);
      log("/print - success");
      return json({ ok: true });
    } catch (err) {
      log(`/print - ERROR: ${err.message}`);
      return json({ ok: false, error: err.message }, 500);
    }
  }

  json({ error: "Not found" }, 404);
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  const ifaces = os.networkInterfaces();
  const ips = Object.values(ifaces)
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  log("===================================================");
  log(` IB Epson Print Relay — listening on :${PROXY_PORT}`);
  log(` Printer target: ${PRINTER_IP}:${PRINTER_PORT}`);
  log(` This machine's IPs: ${ips.join(", ")}`);
  log(` Next: expose this port via a tunnel (Cloudflare Tunnel recommended)`);
  log(` to get a stable HTTPS URL, then set it as EPSON_RELAY_URL_WOODBURY`);
  log(` in Vercel env vars.`);
  log("===================================================");
});

server.on("error", (err) => {
  log(`Server error: ${err.message}`);
  process.exit(1);
});
