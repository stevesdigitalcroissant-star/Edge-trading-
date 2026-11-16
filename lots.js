// Exact forex lot size for a dollar risk — the same maths the EdgeBridge EA does with MT5's tick values.
// 1 standard lot = 100,000 units of the first currency. Loss at the stop = |entry − stop| × 100,000 × (USD per 1 unit of the
// quote currency): 1 for …/USD pairs, 1 / USDJPY for …/JPY, 1 / USDCAD for USD/CAD, 1 / USDCHF for USD/CHF, GBPUSD for EUR/GBP.
// Lots are rounded DOWN to 0.01 so the real risk never goes over what you set. Browser (window.EdgeLots) and Node.
(function (root) {
  const QUOTE = { eurusd: "USD", gbpusd: "USD", audusd: "USD", nzdusd: "USD", usdjpy: "JPY", gbpjpy: "JPY", eurjpy: "JPY", usdcad: "CAD", usdchf: "CHF", eurgbp: "GBP" };
  const RATE_PAIR = { JPY: "usdjpy", CAD: "usdcad", CHF: "usdchf", GBP: "gbpusd" }; // the USD/xxx price that turns the quote currency into dollars
  const pipOf = (m) => (QUOTE[m] === "JPY" ? 0.01 : 0.0001);
  // usdPerQuote: dollars per 1 unit of the quote currency (1 for …/USD). For USD/JPY, USD/CAD, USD/CHF the entry price itself works.
  function usdPerQuote(m, entry, usdxxx) {
    const q = QUOTE[m];
    if (!q) return null;
    if (q === "USD") return 1;
    if (q === "GBP") return usdxxx > 0 ? usdxxx : null; // EUR/GBP: dollars per pound = today's GBP/USD
    const rate = m.startsWith("usd") ? entry : usdxxx; // e.g. GBP/JPY needs today's USD/JPY
    return rate > 0 ? 1 / rate : null;
  }
  function lots({ market, entry, stop, risk, usdxxx, contract = 100000, step = 0.01, min = 0.01 }) {
    entry = Number(entry); stop = Number(stop); risk = Number(risk);
    const conv = usdPerQuote(market, entry, Number(usdxxx));
    const dist = Math.abs(entry - stop);
    if (!conv || !(dist > 0) || !(risk > 0)) return null;
    const perLot = dist * contract * conv; // $ lost at the stop with 1 lot
    const raw = risk / perLot, l = Math.floor(raw / step + 1e-9) * step;
    const pips = dist / pipOf(market), pipUsd = pipOf(market) * contract * conv; // $ per pip for 1 lot
    return { lots: l >= min ? Math.round(l * 100) / 100 : 0, raw, pips: Math.round(pips * 10) / 10, pipUsdPerLot: Math.round(pipUsd * 100) / 100,
      riskAtLots: Math.round((l >= min ? l : 0) * perLot * 100) / 100, perLot: Math.round(perLot * 100) / 100, tooWide: l < min };
  }
  const api = { QUOTE, RATE_PAIR, pipOf, usdPerQuote, lots };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgeLots = api;
})(typeof window !== "undefined" ? window : null);
