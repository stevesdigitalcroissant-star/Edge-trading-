// The setup explained in plain words — what happened on each timeframe and the plan.
// Built from the levels the TradingView script sends, so it says exactly what the chart shows.
const { MARKETS } = require("./_config");

const fx = (x) => (x == null ? "—" : Math.abs(x) >= 100 ? Number(x).toFixed(2) : Number(x).toFixed(3));

function story(x, s) {
  const long = x.dir !== "short";
  const name = MARKETS[x.market] ? MARKETS[x.market].name : x.symbol;
  const k = long ? 1 : -1;
  const risk = Math.abs(x.entry - x.sl);
  const be = x.entry + k * s.beAtR * risk, tp = x.entry + k * s.tpAtR * risk;
  const zone = long ? "demand" : "supply", opp = long ? "supply" : "demand";
  const word = long ? "above" : "below", arrow = long ? "↑" : "↓";
  const zoneTxt = x.zoneBot != null && x.zoneTop != null ? ` (${fx(x.zoneBot)} – ${fx(x.zoneTop)})` : "";

  const steps = [
    { tf: "4H", color: "c4h", title: `Trend ${long ? "UP" : "DOWN"} ${arrow}`, text: `A 4H candle closed ${word} ${x.lvl4h != null ? fx(x.lvl4h) : "the last swing"} — break of structure. We only look for ${long ? "buys" : "sells"}.` },
    { tf: "4H", color: "c4h", title: `Fresh ${zone} zone`, text: `Price came back into the 4H ${zone} zone${zoneTxt}${x.zoneFresh === false ? " — not the first touch" : " for the first time"}.` },
    ...(x.sweep ? [{ tf: "Liquidity", color: "liq", title: "Stops taken $$$", text: `Price ${long ? "dipped below" : "pushed above"} the ${x.sweepName || "nearby " + (long ? "lows" : "highs")}${x.sweepLvl != null ? ` (${fx(x.sweepLvl)})` : ""} — where traders' stops sit — then came back. That's the fuel for the move.` }] : []),
    { tf: "15m", color: "c15", title: `15m break ${arrow}`, text: `A 15-minute candle closed ${word} ${x.lvl15 != null ? fx(x.lvl15) : "the last swing"}: buyers${long ? "" : "' support"} ${long ? "took control" : "gave way"} at the zone.` },
    { tf: "5m", color: "c5", title: `5m entry ${arrow}`, text: `A 5-minute candle closed ${word} ${x.lvl5 != null ? fx(x.lvl5) : "the last swing"} → entry ${fx(x.entry)}.` },
  ];
  const i15 = steps.findIndex((p) => p.tf === "15m");
  if (!long) steps[i15].text = `A 15-minute candle closed below ${x.lvl15 != null ? fx(x.lvl15) : "the last swing"}: sellers took control at the zone.`;

  const plan = {
    entry: x.entry, sl: x.sl, be, tp,
    text: `Stop ${fx(x.sl)} (${long ? "below" : "above"} the reaction ${long ? "low" : "high"}). At ${fx(be)} (+${s.beAtR}R) move the stop to break-even. Target ${fx(tp)} (+${s.tpAtR}R)` +
      (x.opp != null ? ` — the 4H ${opp} zone starts at ${fx(x.opp)}${x.roomR != null ? `, ${Number(x.roomR).toFixed(1)}R away` : ""}.` : ` — no opposing 4H zone in the way.`),
  };
  const swept = x.sweep ? `, ${x.sweepName || "liquidity"} taken` : "";
  const headline = `${name} ${long ? "BUY" : "SELL"} — ${long ? "uptrend" : "downtrend"}, fresh 4H ${zone}${swept}, 15m + 5m broke ${long ? "up" : "down"}`;
  const short = `${long ? "Uptrend" : "Downtrend"} · fresh 4H ${zone}${x.sweep ? ` · ${x.sweepName || "liquidity"} swept` : ""} · 15m + 5m broke ${long ? "up" : "down"}. ${long ? "Buy" : "Sell"} ${fx(x.entry)} · SL ${fx(x.sl)} · TP ${fx(tp)}`;
  return { headline, steps, plan, short };
}

module.exports = { story };
