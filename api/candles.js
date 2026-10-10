// GET /api/candles?m=gold — the last ~60 days of 5-minute futures candles (free Yahoo
// Finance chart data: GC=F gold, CL=F crude, NG=F natural gas) for the replay.
// Public market data, so no sign-in; cached at Vercel's edge for 30 minutes.
const SYMBOLS = { gold: "GC=F", crude: "CL=F", natgas: "NG=F", silver: "SI=F", es: "ES=F" };

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
const INTERVALS = { "5m": 59, "15m": 59, "60m": 729 };

async function load(market, days = 59, interval = "5m") {
  const sym = SYMBOLS[market];
  if (!sym) throw new Error("Pick gold, crude, natgas, silver or es");
  let last;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${days}d&includePrePost=true`, {
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
    // ?src=db&fill=1&from=2019-01&to=2026-09 — buy the missing months into the archive (each month once, ever)
    // ?src=db&have=1 — which months are archived
    if (url.searchParams.get("src") === "db" && url.searchParams.get("have")) return res.status(200).json({ market, months: await require("./_bars").have(market) });
    if (url.searchParams.get("src") === "db" && url.searchParams.get("fill")) {
      const r = await db.fill(require("./_store").getStore(), market, url.searchParams.get("from") || "2019-01", url.searchParams.get("to") || "2099-12");
      return res.status(200).json(r);
    }
    if (url.searchParams.get("src") === "db") {
      const tf = url.searchParams.get("i") || "5m", month = url.searchParams.get("month") || "";
      const bars = await db.month(require("./_store").getStore(), market, month, tf);
      res.setHeader("Cache-Control", month < new Date().toISOString().slice(0, 7) ? "public, s-maxage=86400" : "public, s-maxage=1800");
      return res.status(200).json({ market, source: "databento", month, interval: tf, bars });
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
