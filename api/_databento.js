// Databento: official CME futures data (years of 1-minute candles) for the simulator and the Style lab.
// Needs DATABENTO_API_KEY (databento.com → Portal → API keys). Pay as you go; new accounts get free credit.
// Each month is fetched once as 1-minute candles and kept in the candle archive (_bars.js, the private
// Blob store), so the same month never costs twice; it's rolled up to 5 minutes, 15 minutes or 1 hour on read.
const ROOT = { gold: "GC", crude: "CL", natgas: "NG", silver: "SI", es: "ES" };
const TF = { "1m": 1, "5m": 5, "15m": 15, "60m": 60 };
const archive = require("./_bars");
const API = "https://hist.databento.com/v0/timeseries.get_range";

const key = () => process.env.DATABENTO_API_KEY || "";

// "ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol" — read by header name
function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const [it, io, ih, il, ic] = ["ts_event", "open", "high", "low", "close"].map(ix);
  if ([it, io, ih, il, ic].some((i) => i < 0)) throw new Error(`Unexpected Databento columns: ${lines[0].slice(0, 120)}`);
  const out = [];
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(",");
    const ts = c[it];
    const t = /^\d+$/.test(ts) ? Math.round(Number(ts) / 1e6) : Date.parse(ts); // nanoseconds, or ISO with pretty_ts
    const o = Number(c[io]), h = Number(c[ih]), l = Number(c[il]), cl = Number(c[ic]);
    if (Number.isFinite(t) && [o, h, l, cl].every(Number.isFinite)) out.push([t, o, h, l, cl]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// 1-minute → N-minute candles (aligned to the clock in UTC, which is aligned in New York too for 5/15/60)
function rollUp(bars, minutes) {
  if (minutes === 1) return bars;
  const span = minutes * 60e3, out = [];
  let cur = null;
  for (const [t, o, h, l, c] of bars) {
    const s = Math.floor(t / span) * span;
    if (!cur || cur[0] !== s) { if (cur) out.push(cur); cur = [s, o, h, l, c]; }
    else { cur[2] = Math.max(cur[2], h); cur[3] = Math.min(cur[3], l); cur[4] = c; }
  }
  if (cur) out.push(cur);
  return out;
}

async function fetchMonth(market, month, fetchImpl = fetch) {
  const root = ROOT[market];
  if (!root) throw new Error("Pick gold, crude, natgas, silver or es");
  if (!key()) throw new Error("Databento isn't connected — add DATABENTO_API_KEY in Vercel");
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const endD = new Date(Math.min(Date.UTC(y, m, 1), Date.now() - 864e5));
  const end = endD.toISOString().slice(0, 10);
  if (end <= start) throw new Error("That month isn't available yet");
  const q = new URLSearchParams({ dataset: "GLBX.MDP3", symbols: `${root}.v.0`, stype_in: "continuous", schema: "ohlcv-1m", start, end, encoding: "csv", pretty_px: "true", pretty_ts: "true", map_symbols: "true" });
  const r = await fetchImpl(`${API}?${q}`, { headers: { Authorization: "Basic " + Buffer.from(key() + ":").toString("base64") }, signal: AbortSignal.timeout(50000) });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 200);
    try { const j = JSON.parse(text); msg = j.detail || j.message || msg; } catch {}
    throw new Error(`Databento ${r.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return parseCsv(text);
}

// One month of 1-minute candles: from the archive (free) when Edge already bought it, otherwise
// from Databento once — a finished month then goes into the archive for good.
// Never in Redis: that database is small, in-memory and holds your journal — candles don't belong there.
// A warm function keeps the last few months in memory; the browser and Vercel's edge cache the replies.
const recent = new Map();
async function oneMinute(store, market, monthStr, fetchImpl = fetch) {
  const done = monthStr < new Date().toISOString().slice(0, 7), ck = `${market}:${monthStr}`;
  const hit = recent.get(ck);
  if (hit && (done || Date.now() - hit.at < 3600e3)) return hit.bars;
  if (done) { const a = await archive.get(market, monthStr).catch(() => null); if (a) return a; }
  const one = await fetchMonth(market, monthStr, fetchImpl);
  if (done) await archive.put(market, monthStr, one).catch(() => {}); // the archive is optional (e.g. a suspended Blob store)
  recent.set(ck, { at: Date.now(), bars: one });
  while (recent.size > 6) recent.delete(recent.keys().next().value);
  return one;
}

// a month of candles at the asked timeframe
// (".v.0" = the contract with the most volume each day, like TradingView's GC1! — the nearest expiry is often barely traded)
async function month(store, market, monthStr, tf = "5m", fetchImpl = fetch) {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) throw new Error("month must look like 2024-03");
  const mins = TF[tf];
  if (!mins) throw new Error("timeframe must be 1m, 5m, 15m or 60m");
  return rollUp(await oneMinute(store, market, monthStr, fetchImpl), mins);
}

// Fill the archive: buy every month in [from, to] that isn't there yet, until the time budget runs out.
// Call again with the returned `next` to continue. Months already archived cost nothing.
async function fill(store, market, from, to, budgetMs = 45000, fetchImpl = fetch) {
  if (!ROOT[market]) throw new Error("Pick gold, crude, natgas, silver or es");
  if (!archive.ready()) throw new Error("No Blob store connected — nowhere to keep the candles");
  const last = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const months = [];
  for (let [y, m] = (from < "2019-01" ? "2019-01" : from).split("-").map(Number); ; m++) {
    if (m > 12) { y++; m = 1; }
    const s = `${y}-${String(m).padStart(2, "0")}`;
    if (s > to || s > last) break;
    months.push(s);
  }
  const have = new Set(await archive.have(market)), t0 = Date.now(), stored = [];
  for (const mo of months) {
    if (have.has(mo)) continue;
    if (Date.now() - t0 > budgetMs) return { market, stored, next: mo, done: false };
    await archive.put(market, mo, await fetchMonth(market, mo, fetchImpl));
    stored.push(mo);
  }
  return { market, stored, next: null, done: true, have: have.size + stored.length };
}

module.exports = { key, parseCsv, rollUp, fetchMonth, month, fill, ROOT };
