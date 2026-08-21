/**
 * IB Butcher App — Star TSP100IIIW Print Proxy
 * =============================================
 * Runs on a device on the PRIVATE WOODBURY (192.168.4.x) network.
 * The iPad browser can't open raw TCP sockets, so this tiny server acts as a bridge:
 *
 *   iPad browser  →  HTTP POST :3001/print  →  this server  →  TCP :9100  →  TSP100IIIW
 *
 * Setup:
 *   1. Copy this file + package.json to any Windows/Mac/PC on the Woodbury network
 *   2. npm install
 *   3. node server.cjs   (or: npx pm2 start server.cjs --name ib-print)
 *   4. Note the machine's IP on 192.168.4.x — put it in the Butcher App .env
 *
 * Endpoints:
 *   POST /print        — body: { commands: "<StarXpand JSON string>" }
 *   POST /print-raw    — body: raw ESC/POS bytes (Uint8Array → base64)
 *   GET  /status       — returns printer TCP reachability check
 *   GET  /health       — always 200, for uptime monitoring
 */

"use strict";

const http    = require("http");
const net     = require("net");
const os      = require("os");

// ── Config ────────────────────────────────────────────────────────────────────
const PRINTER_IP   = process.env.PRINTER_IP   || "192.168.4.200";
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || "9100");
const PROXY_PORT   = parseInt(process.env.PROXY_PORT   || "3001");
// Comma-separated list of allowed origins. Set to * in dev, lock down in prod.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",");

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)
    ? (origin || "*")
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400",
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data",  c => chunks.push(c));
    req.on("end",   () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Send raw bytes to the printer via TCP and wait for it to disconnect
 * (Star printers close the connection after receiving a complete job).
 */
function sendToStarPrinter(rawBytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(8_000);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      log(`TCP connected → ${PRINTER_IP}:${PRINTER_PORT}, sending ${rawBytes.length} bytes`);
      socket.write(rawBytes, (err) => {
        if (err) return done(err);
        // Star printers ACK by closing the connection — wait for that.
        socket.once("end",   () => done(null));
        socket.once("close", () => done(null));
      });
    });

    socket.on("timeout", () => done(new Error("TCP timeout — printer not responding")));
    socket.on("error",   done);
  });
}

/**
 * Quick reachability check — connect to port 9100, report open/closed.
 */
function checkPrinterReachable() {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(3_000);
    s.connect(PRINTER_PORT, PRINTER_IP, () => { s.destroy(); resolve(true); });
    s.on("error",   () => { s.destroy(); resolve(false); });
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}

// ── Star ESC/POS command helpers ──────────────────────────────────────────────
// These produce raw printer bytes for the TSP100IIIW's StarPRNT/ESC-POS emulation.
// The printer label size is 4.25 in × 2.75 in landscape = 612 × 396 dots @ 203 dpi
// (TSP100 series = 203 dpi, 72 mm print width ≈ 574 dots)

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;
const CR  = 0x0d;

/**
 * Build ESC/POS bytes for one IB Butcher label.
 * Layout mirrors the existing HTML label:
 *   Row 1: "IAVARONE BROS." centered, bold, large
 *   Row 2: "ibfoods.com" small, centered
 *   Divider
 *   Row 3: CUSTOMER:  <name>   ORDER: <daily_num>
 *   Divider
 *   Row 4: ITEM: <item>
 *   Row 5: <notes if any>
 *   Divider
 *   Row 6: PICKUP: <date time>  |  INV: <invoice>  |  LOC: <location>
 *   Cut
 */
function buildLabelBytes(label) {
  const { customerName, dailyNumber, itemLabel, notes, pickupDate, pickupTime, invoiceNumber, locationName } = label;
  const bytes = [];

  const push = (...vals) => bytes.push(...vals);
  const str  = (s = "") => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    return { nl: () => bytes.push(LF) };
  };
  const nl   = (n = 1) => { for (let i = 0; i < n; i++) bytes.push(LF); };

  // ── Initialize ────────────────────────────────────────────────────────────
  push(ESC, 0x40);              // ESC @ — initialize printer
  push(ESC, 0x61, 0x01);        // ESC a 1 — center align

  // ── Header: store name ────────────────────────────────────────────────────
  push(ESC, 0x45, 0x01);        // ESC E 1 — bold on
  push(GS,  0x21, 0x11);        // GS ! 0x11 — double width + double height
  str("IAVARONE BROS.").nl();
  push(GS,  0x21, 0x00);        // normal size
  push(ESC, 0x45, 0x00);        // bold off
  str("ibfoods.com").nl();

  // ── Divider ───────────────────────────────────────────────────────────────
  str("----------------------------------------").nl();

  // ── Customer + Order Number ───────────────────────────────────────────────
  push(ESC, 0x61, 0x00);        // left align
  push(ESC, 0x45, 0x01);        // bold on
  str(`CUSTOMER: ${customerName || "—"}`).nl();
  str(`ORDER #:  ${dailyNumber  || "—"}`).nl();
  push(ESC, 0x45, 0x00);        // bold off

  // ── Divider ───────────────────────────────────────────────────────────────
  str("----------------------------------------").nl();

  // ── Item ──────────────────────────────────────────────────────────────────
  push(GS,  0x21, 0x01);        // double height
  push(ESC, 0x45, 0x01);        // bold
  str(`ITEM: ${itemLabel || "—"}`).nl();
  push(GS,  0x21, 0x00);
  push(ESC, 0x45, 0x00);

  if (notes) {
    push(ESC, 0x45, 0x01);
    str(`NOTE: ${notes}`).nl();
    push(ESC, 0x45, 0x00);
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  str("----------------------------------------").nl();

  // ── Footer: three columns, tab-separated ─────────────────────────────────
  // ESC/POS tab stops: set at column 16 and 32 (roughly thirds of 40-char line)
  push(ESC, 0x44, 3, 15, 29, 0); // HT positions at 15, 29, end
  push(ESC, 0x61, 0x00);          // left
  str("PICKUP").nl();
  str("INV").nl();
  str("LOC").nl();

  // Values row — same tab trick
  push(ESC, 0x45, 0x01);
  const pickupStr = `${pickupDate}${pickupTime ? " " + pickupTime : ""}`.trim() || "—";
  str(pickupStr).nl();
  str(`#${invoiceNumber || "—"}`).nl();
  str(locationName || "—").nl();
  push(ESC, 0x45, 0x00);

  // ── Feed + Cut ────────────────────────────────────────────────────────────
  nl(3);
  push(ESC, 0x64, 0x05);         // ESC d 5 — feed 5 lines
  push(0x1d, 0x56, 0x42, 0x00);  // GS V B 0 — partial cut

  return Buffer.from(bytes);
}

// ── Request router ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const hdrs   = corsHeaders(origin);
  const url    = req.url.split("?")[0];

  // Pre-flight
  if (req.method === "OPTIONS") {
    res.writeHead(204, hdrs);
    return res.end();
  }

  // Health check
  if (url === "/health" && req.method === "GET") {
    res.writeHead(200, { ...hdrs, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  // Printer status
  if (url === "/status" && req.method === "GET") {
    const reachable = await checkPrinterReachable();
    const code = reachable ? 200 : 503;
    res.writeHead(code, { ...hdrs, "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      reachable,
      printer: `${PRINTER_IP}:${PRINTER_PORT}`,
      ts: Date.now(),
    }));
  }

  // ── POST /print — StarXpand JSON command string → raw bytes via star lib ──
  // The browser builds the StarXpand JSON command string using the star-io10-web
  // builder (which runs in the browser), then POSTs the JSON string here.
  // We relay it as UTF-8 bytes to the printer — Star printers accept the JSON
  // command format directly over TCP when running StarPRNT emulation.
  if (url === "/print" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const json = JSON.parse(body.toString("utf8"));

      // Accept either:
      //   { commands: "<StarXpand JSON string>" }    ← from star-io10-web builder
      //   { labels: [ { customerName, ... } ] }      ← ESC/POS fallback
      let rawBytes;

      if (json.commands) {
        // StarXpand JSON command string — send as-is (UTF-8) to printer
        rawBytes = Buffer.from(json.commands, "utf8");
        log(`/print — StarXpand commands, ${rawBytes.length} bytes`);
      } else if (json.labels && Array.isArray(json.labels)) {
        // ESC/POS fallback — build bytes from label data
        const parts = json.labels.map(buildLabelBytes);
        rawBytes = Buffer.concat(parts);
        log(`/print — ESC/POS fallback, ${json.labels.length} label(s), ${rawBytes.length} bytes`);
      } else {
        res.writeHead(400, { ...hdrs, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Body must contain `commands` or `labels`" }));
      }

      await sendToStarPrinter(rawBytes);
      log(`/print — success`);
      res.writeHead(200, { ...hdrs, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      log(`/print — ERROR: ${err.message}`);
      res.writeHead(500, { ...hdrs, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // ── POST /print-raw — base64-encoded raw bytes ────────────────────────────
  if (url === "/print-raw" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const json = JSON.parse(body.toString("utf8"));
      if (!json.data) {
        res.writeHead(400, { ...hdrs, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Body must contain `data` (base64)" }));
      }
      const rawBytes = Buffer.from(json.data, "base64");
      log(`/print-raw — ${rawBytes.length} bytes`);
      await sendToStarPrinter(rawBytes);
      res.writeHead(200, { ...hdrs, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      log(`/print-raw — ERROR: ${err.message}`);
      res.writeHead(500, { ...hdrs, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // 404
  res.writeHead(404, { ...hdrs, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  // Show all local IPs so you know what URL to put in the app
  const ifaces = os.networkInterfaces();
  const ips = Object.values(ifaces)
    .flat()
    .filter(i => i && i.family === "IPv4" && !i.internal)
    .map(i => i.address);

  log("═══════════════════════════════════════════════");
  log(` IB Butcher Print Proxy — listening on :${PROXY_PORT}`);
  log(` Printer target: ${PRINTER_IP}:${PRINTER_PORT}`);
  log(` This machine's IPs: ${ips.join(", ")}`);
  log(` Set VITE_PRINT_SERVER_URL=http://<this-machine-ip>:${PROXY_PORT} in .env`);
  log("═══════════════════════════════════════════════");
});

server.on("error", (err) => {
  log(`Server error: ${err.message}`);
  process.exit(1);
});
