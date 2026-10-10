// GET /api/history?m=gold&from=2025-01&months=3 — years of free history for testing the rules:
// Dukascopy's 1-minute candles (spot gold, WTI crude, natural gas CFDs), turned into 5-minute
// candles. One file per day; prices come as integers, scaled per instrument. Public data, cached.
const lzma = require("lzma");
const zlib = require("zlib");

// Gold also from Binance's public archive: PAXG (a token backed 1:1 by gold) — 5m candles, monthly zip files.
// Trades 24/7, so weekends have candles too; the price follows spot gold closely.
function unzipFirst(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip");
  const cd = buf.readUInt32LE(e + 16);
  const method = buf.readUInt16LE(cd + 10), size = buf.readUInt32LE(cd + 20), local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return method === 0 ? data : zlib.inflateRawSync(data);
}
async function paxgMonth(y, m) {
  const url = `https://data.binance.vision/data/spot/monthly/klines/PAXGUSDT/5m/PAXGUSDT-5m-${y}-${String(m).padStart(2, "0")}.zip`;
  const r = await fetch(url);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`gold archive ${r.status}`);
  const csv = unzipFirst(Buffer.from(await r.arrayBuffer())).toString("utf8");
  const out = [];
  for (const line of csv.split("\n")) {
    const c = line.split(",");
    if (c.length < 5 || !/^\d/.test(c[0])) continue;
    let t = Number(c[0]); if (t > 1e14) t = Math.floor(t / 1000); // newer files use microseconds
    out.push([t, +c[1], +c[2], +c[3], +c[4]]);
  }
  return out;
}

const INSTR = { gold: { sym: "XAUUSD", range: [500, 10000] }, crude: { sym: "LIGHT.CMD.USD", range: [10, 300] }, natgas: { sym: "GAS.CMD.USD", range: [0.5, 30] } };

function decode(buf) {
  if (!buf || !buf.length) return Buffer.alloc(0);
  const out = lzma.decompress(Array.from(buf));
  return typeof out === "string" ? Buffer.from(out, "utf8") : Buffer.from(out.map((x) => x & 255));
}

// prices are integers: find the power of ten that puts them in the instrument's normal range
function scaleFor(raw, [lo, hi]) {
  for (const d of [1, 10, 100, 1000, 10000, 100000, 1000000]) { const v = raw / d; if (v >= lo && v <= hi) return d; }
  return 1000;
}

async function day(sym, y, mo, d) {
  const url = `https://datafeed.dukascopy.com/datafeed/${sym}/${y}/${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}/BID_candles_min_1.bi5`;
  for (let tries = 0; tries < 4; tries++) {
    if (tries) await new Promise((ok) => setTimeout(ok, 800 * 2 ** tries)); // busy → wait and retry
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Edge trading co-pilot)" } });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`history ${r.status}`);
      const b = decode(Buffer.from(await r.arrayBuffer()));
      const base = Date.UTC(y, mo, d), rows = [];
      for (let o = 0; o + 24 <= b.length; o += 24) rows.push([base + b.readInt32BE(o) * 1000, b.readInt32BE(o + 4), b.readInt32BE(o + 12), b.readInt32BE(o + 16), b.readInt32BE(o + 8), b.readFloatBE(o + 20)]); // file order: time, open, close, low, high, volume → [t, open, low, high, close, volume]
      return rows;
    } catch (e) { if (tries === 3) throw e; }
  }
  return [];
}

// 1-minute rows [t, open, low, high, close, volume] → 5-minute bars, skipping flat no-volume minutes
function toFive(rows, div) {
  const out = [];
  let cur = null;
  for (const [t, o, l, h, c, v] of rows) {
    if (!(v > 0)) continue;
    const k = Math.floor(t / 300e3) * 300e3;
    if (!cur || cur[0] !== k) { if (cur) out.push(cur); cur = [k, o / div, h / div, l / div, c / div]; }
    else { cur[2] = Math.max(cur[2], h / div); cur[3] = Math.min(cur[3], l / div); cur[4] = c / div; }
  }
  if (cur) out.push(cur);
  return out.map(([t, o, h, l, c]) => [t, +o.toFixed(5), +h.toFixed(5), +l.toFixed(5), +c.toFixed(5)]);
}

async function load(market, from, months) {
  const ins = INSTR[market];
  if (!ins) throw new Error("Pick gold, crude or natgas");
  const [y0, m0] = from.split("-").map(Number);
  const days = [];
  for (let k = 0; k < months; k++) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12), mo = (m0 - 1 + k) % 12; // Dukascopy months are 0-based
    const n = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() !== 6 && Date.UTC(y, mo, d) < Date.now() - 864e5) days.push([y, mo, d]);
  }
  const rows = [];
  for (let k = 0; k < days.length; k += 2) {
    const got = await Promise.all(days.slice(k, k + 2).map(([y, mo, d]) => day(ins.sym, y, mo, d)));
    for (const g of got) rows.push(...g);
  }
  rows.sort((a, b) => a[0] - b[0]);
  if (!rows.length) return { bars: [], div: null };
  const div = scaleFor(rows[Math.floor(rows.length / 2)][1], ins.range);
  return { bars: toFive(rows, div), div };
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const market = url.searchParams.get("m") || "gold";
    const from = /^\d{4}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : "2025-01";
    const months = Math.max(1, Math.min(3, Number(url.searchParams.get("months")) || 1));
    if (url.searchParams.get("src") === "paxg") {
      if (market !== "gold") throw new Error("The free long history is only available for gold");
      const [y, m] = from.split("-").map(Number);
      const bars = [];
      for (let k = 0; k < months; k++) bars.push(...(await paxgMonth(y + Math.floor((m - 1 + k) / 12), ((m - 1 + k) % 12) + 1)));
      res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).json({ market, from, months, source: "binance PAXG (tracks spot gold)", bars });
    }
    const { bars, div } = await load(market, from, months);
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ market, from, months, source: "dukascopy", scale: div, bars });
  } catch (e) {
    res.status(502).json({ error: `Couldn't load history: ${e.message}` });
  }
};
module.exports.decode = decode;
module.exports.toFive = toFive;
module.exports.unzipFirst = unzipFirst;
