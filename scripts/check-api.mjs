// Build-time safety check for the server functions in /api.
//
// Runs before `vite build` (see package.json). Every api/*.js file is bundled
// in memory with esbuild, which fails on:
//   - syntax errors (the Oct 31 `\"./_auth.js\"` typo that broke receipts)
//   - imports of local files that don't exist
//   - imports of names a local file doesn't export
// If any file fails, the build fails, and Vercel keeps the last good version
// live instead of deploying a broken one.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const apiDir = join(root, "api");

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".js")) files.push(p);
  }
})(apiDir);

let esbuild;
try { esbuild = await import("esbuild"); }
catch { console.error("check-api: esbuild not found (it ships with Vite) — cannot check /api."); process.exit(1); }

let failed = 0;
for (const file of files) {
  try {
    await esbuild.build({
      entryPoints: [file],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",   // npm packages are checked by npm, not here
      write: false,
      logLevel: "silent",
    });
  } catch (err) {
    failed++;
    const msgs = (err.errors || []).map(e => `    ${e.location ? `${relative(root, e.location.file)}:${e.location.line}  ` : ""}${e.text}`);
    console.error(`✗ ${relative(root, file)}\n${msgs.join("\n") || "    " + err.message}`);
  }
}

if (failed) {
  console.error(`\ncheck-api: ${failed} server file(s) would crash on load. Build stopped so the live site keeps working.`);
  process.exit(1);
}
console.log(`check-api: all ${files.length} server files load cleanly.`);
