// The candle archive: every month of 1-minute CME candles Edge has ever bought from Databento,
// kept forever in the project's private Blob store — one small gzipped file per market per month
// (edge-data/gold/2024-03.1m.json.gz). A month is paid for once; after that the simulator, the
// Style lab and strategy tests read it for free.
// Prices are stored as whole numbers (price × SCALE) and each candle relative to the one before,
// which keeps a month of gold 1-minute candles around 100 KB.
const zlib = require("zlib");

let blob = null;
try { blob = require("@vercel/blob"); } catch {}
const ready = () => !!(blob && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID));

const SCALE = { gold: 100, crude: 100, silver: 1000, natgas: 1000, es: 100 };
const path = (market, month) => `edge-data/${market}/${month}.1m.json.gz`;

// [[t, o, h, l, c], …] → { v, scale, t0, d: [Δminutes, o−prev c, h−o, o−l, c−o, …] }
function encode(market, bars) {
  const k = SCALE[market] || 1000, d = [];
  let pt = bars.length ? bars[0][0] : 0, pc = bars.length ? Math.round(bars[0][1] * k) : 0;
  for (const [t, o, h, l, c] of bars) {
    const O = Math.round(o * k), H = Math.round(h * k), L = Math.round(l * k), C = Math.round(c * k);
    d.push(Math.round((t - pt) / 60e3), O - pc, H - O, O - L, C - O);
    pt = t; pc = C;
  }
  return { v: 1, scale: k, t0: bars.length ? bars[0][0] : 0, c0: bars.length ? Math.round(bars[0][1] * k) : 0, d };
}
function decode(x) {
  const out = [], k = x.scale, d = x.d;
  let t = x.t0, pc = x.c0;
  for (let i = 0; i < d.length; i += 5) {
    t += d[i] * 60e3;
    const O = pc + d[i + 1], H = O + d[i + 2], L = O - d[i + 3], C = O + d[i + 4];
    out.push([t, O / k, H / k, L / k, C / k]);
    pc = C;
  }
  return out;
}

async function get(market, month) {
  if (!ready()) return null;
  try {
    const r = await blob.get(path(market, month), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    return decode(JSON.parse(zlib.gunzipSync(buf).toString()));
  } catch { return null; }
}
async function put(market, month, bars) {
  if (!ready() || !bars.length) return false;
  const body = zlib.gzipSync(JSON.stringify(encode(market, bars)), { level: 9 });
  await blob.put(path(market, month), body, { access: "private", contentType: "application/gzip", addRandomSuffix: false, allowOverwrite: true });
  return true;
}
// the months already in the archive for a market
async function have(market) {
  if (!ready()) return [];
  const out = [];
  let cursor;
  do {
    const r = await blob.list({ prefix: `edge-data/${market}/`, cursor, limit: 1000 });
    for (const b of r.blobs) { const m = /(\d{4}-\d{2})\.1m\.json\.gz$/.exec(b.pathname); if (m) out.push(m[1]); }
    cursor = r.hasMore ? r.cursor : null;
  } while (cursor);
  return out.sort();
}

module.exports = { ready, get, put, have, encode, decode, SCALE };
