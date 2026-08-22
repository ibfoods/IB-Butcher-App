// api/print-relay.js
//
// The iPad browser calls THIS endpoint (same origin as butcherorders.ibfoods.com,
// so no mixed-content restriction applies at all — this is a normal HTTPS POST
// to our own domain). This function then forwards the job server-side to the
// local relay's public tunnel URL. Server-to-server requests are not subject
// to browser security policies, so this hop can freely reach the relay
// regardless of certificates, mixed content, or any of the restrictions that
// blocked every direct browser -> printer attempt.
//
// Env vars needed in Vercel (Project Settings -> Environment Variables):
//   EPSON_RELAY_URL_WOODBURY   e.g. https://epson-woodbury.ibfoods.com
//                               (or a Cloudflare Tunnel trycloudflare.com URL)
//   EPSON_RELAY_SECRET         must match RELAY_SHARED_SECRET on the relay device
//
// Add one EPSON_RELAY_URL_<LOCATION> var per location as each gets set up.
// This keeps the pattern in scope for using this same relay approach at
// Wantagh, Garden City, Maspeth, and New Hyde Park later without new app code.

const RELAY_URLS = {
  woodbury: process.env.EPSON_RELAY_URL_WOODBURY,
  wantagh: process.env.EPSON_RELAY_URL_WANTAGH,
  gardencity: process.env.EPSON_RELAY_URL_GARDENCITY,
  maspeth: process.env.EPSON_RELAY_URL_MASPETH,
  nhp: process.env.EPSON_RELAY_URL_NHP,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { locationId, order, orderItems, items, loc } = req.body || {};

    if (!locationId) {
      return res.status(400).json({ error: "locationId is required" });
    }

    const relayUrl = RELAY_URLS[locationId];
    if (!relayUrl) {
      return res.status(400).json({
        error: `No print relay configured for location "${locationId}". Set EPSON_RELAY_URL_${locationId.toUpperCase()} in Vercel env vars.`,
      });
    }

    const relayRes = await fetch(`${relayUrl}/print`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Secret": process.env.EPSON_RELAY_SECRET || "",
      },
      body: JSON.stringify({ order, orderItems, items, loc }),
      // Keep this reasonably short — if the relay/tunnel/printer chain is down,
      // fail fast so the app can offer the browser-print fallback quickly
      // instead of leaving the person staring at a spinner.
      signal: AbortSignal.timeout(25000),
    });

    const relayJson = await relayRes.json().catch(() => ({}));

    if (!relayRes.ok || !relayJson.ok) {
      return res.status(502).json({
        error: relayJson.error || `Relay returned ${relayRes.status}`,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("print-relay error:", err);
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? "Print relay timed out — printer or relay may be offline" : err.message,
    });
  }
}
