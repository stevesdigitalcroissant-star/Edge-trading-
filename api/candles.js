// GET /api/candles?m=gold — the last ~60 days of 5-minute futures candles (free Yahoo
// Finance chart data: GC=F gold, CL=F crude, NG=F natural gas) for the replay.
// Public market data, so no sign-in; cached at Vercel's edge for 30 minutes.
const SYMBOLS = { gold: "GC=F", crude: "CL=F", natgas: "NG=F", silver: "SI=F", es: "ES=F", nq: "NQ=F", ym: "YM=F", copper: "HG=F" };
// the trend board also watches these busy futures (trend only — no chart or sizing for them in Edge yet)
const EXTRA = { rty: "RTY=F", "6e": "6E=F", "6b": "6B=F", "6j": "6J=F", "6a": "6A=F", zn: "ZN=F", zb: "ZB=F" };
const BOARD = [["es", "S&P 500", "ES"], ["nq", "Nasdaq", "NQ"], ["ym", "Dow", "YM"], ["rty", "Russell", "RTY"], ["crude", "Crude", "CL"], ["natgas", "Nat gas", "NG"], ["gold", "Gold", "GC"], ["silver", "Silver", "SI"], ["copper", "Copper", "HG"], ["6e", "Euro", "6E"], ["6b", "Pound", "6B"], ["6j", "Yen", "6J"], ["6a", "Aussie", "6A"], ["zn", "10-yr note", "ZN"], ["zb", "30-yr bond", "ZB"]];

function parse(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || "No candles in the reply");
  const q = r.indicators.quote[0], out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue;
    out.push([r.timestamp[i] * 1000, +o.toFixed(4), +h.toFixed(4), +l.toFixed(4), +c.toFixed(4)]);
  }
  return out;
}

// Yahoo keeps 5m/15m candles for 60 days and 1-hour candles for 2 years
const INTERVALS = { "5m": 59, "15m": 59, "60m": 729, "1d": 3650 }; // daily: 10 years, for the big picture (weekly / daily zones)

async function load(market, days = 59, interval = "5m") {
  const sym = SYMBOLS[market] || EXTRA[market];
  if (!sym) throw new Error("Pick gold, crude, natgas, silver, es or nq");
  let last;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${days >= 3650 ? "10y" : days + "d"}&includePrePost=true`, {
        headers: { "User-Agent": "Mozilla/5.0 (Edge trading co-pilot)", Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`price data ${r.status}`);
      return parse(await r.json());
    } catch (e) { last = e; }
  }
  throw last;
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const market = url.searchParams.get("m") || "gold";
    // Databento: ?src=db&month=2024-03&i=5m (years back) · ?status=1 says whether it's connected
    const db = require("./_databento");
    if (url.searchParams.get("status")) return res.status(200).json({ databento: !!db.key(), yahoo: true });
    // ?quote=nq — the latest price for an open trade's live P&L (Yahoo; CME futures there run a few minutes behind)
    if (url.searchParams.get("quote")) {
      const mk = url.searchParams.get("quote"), sym = SYMBOLS[mk] || EXTRA[mk];
      if (!sym) return res.status(400).json({ error: "unknown market" });
      let last;
      for (const host of ["query1", "query2"]) {
        try {
          const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d&includePrePost=true`, { headers: { "User-Agent": "Mozilla/5.0 (Edge trading co-pilot)", Accept: "application/json" } });
          if (!r.ok) throw new Error(`price data ${r.status}`);
          const m = ((await r.json()).chart.result || [])[0].meta;
          res.setHeader("Cache-Control", "public, s-maxage=3, max-age=3");
          return res.status(200).json({ market: mk, price: m.regularMarketPrice, at: (m.regularMarketTime || 0) * 1000, delayMin: m.exchangeDataDelayedBy || 0 });
        } catch (e) { last = e; }
      }
      return res.status(502).json({ error: last ? last.message : "no price" });
    }
    // ?src=db&fill=1&from=2019-01&to=2026-09 — buy the missing months into the archive (each month once, ever)
    // ?src=db&have=1 — which months are archived
    // Databento data is licensed to you: only your signed-in app (or your private data downloader) may load it
    if (url.searchParams.get("src") === "db") {
      const store = require("./_store").getStore();
      const dt = process.env.EDGE_DATA_TOKEN, given = req.headers["x-edge-data"];
      const okToken = dt && given && require("crypto").timingSafeEqual(require("crypto").createHash("sha256").update(String(given)).digest(), require("crypto").createHash("sha256").update(dt).digest());
      if (!okToken && !(await require("./_auth").authorized(store, req.headers))) return res.status(401).json({ error: "Sign in to Edge to load these prices." });
    }
    // ?src=db&hist=1h&to=2023-12 — the 13 months of 1-hour candles before that month (the big picture for practice)
    if (url.searchParams.get("src") === "db" && url.searchParams.get("hist")) {
      const bars = await db.hourly(market, url.searchParams.get("to") || "");
      res.setHeader("Cache-Control", "private, max-age=604800");
      return res.status(200).json({ market, source: "databento", interval: "60m", bars });
    }
    if (url.searchParams.get("src") === "db" && url.searchParams.get("have")) return res.status(200).json({ market, months: await require("./_bars").have(market) });
    if (url.searchParams.get("src") === "db" && url.searchParams.get("fill")) {
      const r = await db.fill(require("./_store").getStore(), market, url.searchParams.get("from") || "2019-01", url.searchParams.get("to") || "2099-12");
      return res.status(200).json(r);
    }
    if (url.searchParams.get("src") === "db") {
      const tf = url.searchParams.get("i") || "5m", month = url.searchParams.get("month") || "";
      const bars = await db.month(require("./_store").getStore(), market, month, tf);
      res.setHeader("Cache-Control", month < new Date().toISOString().slice(0, 7) ? "private, max-age=604800" : "private, max-age=1800"); // your browser keeps it; never a shared cache
      return res.status(200).json({ market, source: "databento", month, interval: tf, bars });
    }
    // ?trend=1 — the 4H and 15m trend of every market on the board (20 days of 15-minute candles each), 5 min cache
    if (url.searchParams.get("trend")) {
      const T = require("../trend.js");
      const rows = await Promise.all(BOARD.map(async ([k, name, code]) => {
        try { const bars = await load(k, 20, "15m"); const r = T.both(bars, 15), last = bars[bars.length - 1];
          return { k, name, code, price: last ? last[4] : null, at: last ? last[0] : null, h4: r.h4.dir, m15: r.m15 ? r.m15.dir : 0, v: r.verdict.cls, text: r.verdict.text, hint: r.verdict.hint, flipUp: r.m15 ? r.m15.hi : null, flipDn: r.m15 ? r.m15.lo : null };
        } catch (e) { return { k, name, code, error: e.message }; }
      }));
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=300");
      return res.status(200).json({ at: Date.now(), rows });
    }
    // ?tail=1 — just the last day of 5-minute candles, refreshed every minute (the home chart's live edge)
    if (url.searchParams.get("tail")) {
      const bars = await load(market, 5, "5m"); // 5 days: on a weekend the last day has no candles
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=60");
      return res.status(200).json({ market, symbol: SYMBOLS[market], interval: "5m", bars });
    }
    const interval = INTERVALS[url.searchParams.get("i")] ? url.searchParams.get("i") : "5m";
    const bars = await load(market, INTERVALS[interval], interval);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ market, symbol: SYMBOLS[market], interval, bars });
  } catch (e) {
    res.status(502).json({ error: `Couldn't load candles: ${e.message}` });
  }
};
module.exports.parse = parse;
