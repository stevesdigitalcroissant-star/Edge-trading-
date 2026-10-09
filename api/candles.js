// GET /api/candles?m=gold — the last ~60 days of 5-minute futures candles (free Yahoo
// Finance chart data: GC=F gold, CL=F crude, NG=F natural gas) for the replay.
// Public market data, so no sign-in; cached at Vercel's edge for 30 minutes.
const SYMBOLS = { gold: "GC=F", crude: "CL=F", natgas: "NG=F" };

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

async function load(market, days = 59) {
  const sym = SYMBOLS[market];
  if (!sym) throw new Error("Pick gold, crude or natgas");
  let last;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=${days}d&includePrePost=true`, {
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
    const bars = await load(market);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ market, symbol: SYMBOLS[market], bars });
  } catch (e) {
    res.status(502).json({ error: `Couldn't load candles: ${e.message}` });
  }
};
module.exports.parse = parse;
