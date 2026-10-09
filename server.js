// Run Edge on your own computer or a small server: `node server.js`
// (Node 18+, no installs). Settings come from the environment or a .env file
// next to this one. Unlike Vercel, this also checks your open trades every
// 10 seconds on its own, so the stop moves to break-even even between candles.
const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const hook = require("./api/hook");
const app = require("./api/app");
const coachApi = require("./api/coach");
const candles = require("./api/candles");
const { getStore } = require("./api/_store");
const { getBroker } = require("./api/_broker");
const { syncTrades } = require("./api/_core");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const STATIC = new Set(["/pine/edge_supply_demand.pine", "/index.html", "/app.js", "/coach.js", "/reader.js", "/practice.js", "/engine.js", "/replay.js", "/sw.js", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/app.css", "/icon.svg", "/manifest.webmanifest"]);

function wrap(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
  return res;
}

http.createServer((req, res) => {
  wrap(res);
  const url = new URL(req.url, "http://x");
  if (["/api/hook", "/api/app", "/api/coach"].includes(url.pathname)) {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
      ({ "/api/hook": hook, "/api/app": app, "/api/coach": coachApi })[url.pathname](req, res);
    });
    return;
  }
  if (url.pathname === "/api/candles") return candles(req, res);
  const p = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!STATIC.has(p)) return res.status(404).end("Not found");
  res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
  fs.createReadStream(path.join(__dirname, p)).pipe(res);
}).listen(process.env.PORT || 3000, () => {
  console.log(`Edge running on http://localhost:${process.env.PORT || 3000}  (broker: ${getBroker().label}, storage: ${getStore().kind})`);
});

if (getBroker().kind !== "manual") {
  setInterval(() => syncTrades(getStore(), getBroker(), { force: true }).catch((e) => console.error(e.message)), 10000);
}
