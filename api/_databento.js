// Databento: official CME futures data (years of 1-minute candles) for the simulator and the Style lab.
// Needs DATABENTO_API_KEY (databento.com → Portal → API keys). Pay as you go; new accounts get free credit.
// Each month is fetched once as 1-minute candles, rolled up to 5 minutes or 1 hour, and saved in Edge's
// storage, so the same month never costs twice.
const ROOT = { gold: "GC", crude: "CL", natgas: "NG", silver: "SI", es: "ES" };
const TF = { "5m": 5, "15m": 15, "60m": 60 };
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

// cached month of candles at the asked timeframe
// (".v.0" = the contract with the most volume each day, like TradingView's GC1! — the nearest expiry is often barely traded)
async function month(store, market, monthStr, tf = "5m", fetchImpl = fetch) {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) throw new Error("month must look like 2024-03");
  const mins = TF[tf];
  if (!mins) throw new Error("timeframe must be 5m, 15m or 60m");
  const ck = `db2:${market}:${monthStr}:${tf}`;
  const cached = await store.get(ck);
  const thisMonth = new Date().toISOString().slice(0, 7);
  if (cached && (monthStr < thisMonth || Date.now() - cached.at < 3600e3)) return cached.bars;
  const bars = rollUp(await fetchMonth(market, monthStr, fetchImpl), mins);
  await store.set(ck, { at: Date.now(), bars }).catch(() => {}); // too big for the store? just don't cache
  return bars;
}

module.exports = { key, parseCsv, rollUp, fetchMonth, month, ROOT };
