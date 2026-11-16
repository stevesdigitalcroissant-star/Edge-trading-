// Your strategy in one place — the steps the Today planner asks you to tick, the Coach teaches, and the
// simulator scores every practice trade against. Works in the browser (window.EdgePlaybook) and in Node.
(function (root) {
  // Oct 2026, tested on 2019–2026 (9 markets, realistic costs): supply & demand + the 3 big-picture rules (with the 4H
  // trend, no wall inside 3R, not chasing) = +0.51R a trade on 134 trades, worst dip 8.6R, held 2019–22 and 2023–26.
  // 30 Oct 2026: started over — simple support & resistance (his own levels), Heikin Ashi + regular candles, 80 SMA.
  // 16 Nov 2026: started over again — forex on MetaTrader 5 (Tradeify FX), the INEVITRADE model moved up a level:
  // 4H / 1H for bias and zones, 15m for the entry. Backtest (EURUSD, GBPUSD, AUDUSD, USDJPY, GBPJPY, EURJPY from the
  // CME currency futures, 2019–2026, 1 pip majors / 2 pips crosses all-in): about −0.1R a trade on the rules alone —
  // the screen-read (sweep, displacement, clean POI) is what has to add the edge, so journal every trade.
  const NOTE = "Forex on MT5 (16 Nov): points of interest marked before the session (previous day high / low, 1H gaps, the New York open), then the 15m entry — sweep, change of character, limit at the 15m gap midpoint, stop past the move, 1:3 or more. TradingView script: Edge · FX Playbook.";
  const STEPS = [
    { id: "prep", icon: "📰", title: "Prepare before the open", short: "News + points of interest", req: true,
      text: "Be at the desk by 8:45 New York time. Check the red-folder news (the Bias tab and the news card) — if something big lands in the morning, let the dust settle first. Mark your points of interest on the 15m: previous day high and low, the unfilled 1H fair value gaps, the New York open line." },
    { id: "bias", icon: "🧭", title: "Top-down bias", short: "Daily / 4H / 1H agree", req: true,
      text: "Trade with the bigger picture: the 4H and 1H trend (top-right panel) and your weekly fundamental bias. Compare the pairs — if one is clearly stronger, that's the one to buy (or the weaker one to sell)." },
    { id: "poi", icon: "🎯", title: "Price reacts at a point of interest", short: "PDH / PDL or a 1H gap", req: true,
      text: "No trade until price reaches one of your marked areas and reacts: it sweeps the previous day low / high (runs the stops) or taps a 1H fair value gap — and then moves away strongly (displacement)." },
    { id: "choch", icon: "🔀", title: "15m change of character", short: "Closes through the last swing", req: true,
      text: "After the sweep, a 15m candle closes above the last lower high (for a buy) — or below the last higher low (for a sell). Even better if it also breaks the liquidity inflection level (the level price kept reacting to)." },
    { id: "entry", icon: "📐", title: "Limit at the 15m gap midpoint", short: "50–61.8% of the move", req: true,
      text: "Draw the Fibonacci from the sweep low to the top of the move that broke structure (bottom to top for a buy). Your limit goes at the midpoint of the big displacement gap it left — around 50%, inside 38.2–78.6%. The FX Playbook script draws it; Edge sends it to MT5." },
    { id: "stop", icon: "🛡️", title: "Stop past the move · target 1:3+", short: "Next gap or PDH / PDL", req: true,
      text: "Stop just past the low (buy) / high (sell) of the move — below the order block. Target the next fair value gap or the previous day high / low, at least 1:3. Same $ risk every trade; Edge checks the prop firm's daily and max loss before it sends." },
    { id: "journal", icon: "📓", title: "Journal it while you trade", short: "Tick the checklist, then walk away", req: true,
      text: "Tick the checklist in the Send to MT5 form as you place it — so you always know why you took the trade. Set an alert and step away from the desk: no staring at every tick. After the session, review in bar replay and tell David what you'd change." },
  ];
  const MANAGE = [
    "Once price breaks the high (buy) / low (sell) of the move, stop to break-even.",
    "Otherwise hands off — let it hit the stop or the target. Never move the stop further away.",
    "Funded account: no opening, closing or changing trades 10 minutes either side of red-folder news.",
  ];
  const QUIZ = [
    ["Your 15m chart shows a perfect change of character, but price hasn't touched any point of interest yet.", ["Take it", "Wait — no point of interest, no trade"], 1, "The 15m signal only counts after price reacts at a level you marked before the session."],
    ["Where does the limit go?", ["At the midpoint of the 15m fair value gap the move left", "At the high of the breakout candle"], 0, "Midpoint of the gap — usually 50–61.8% of the move."],
    ["The target is only 1:1.8 away from the previous day high.", ["Take it anyway", "Skip — under 1:3"], 1, "Your minimum is 1:3."],
    ["Big Fed decision at 10:00 New York time.", ["Trade the open as usual", "Wait for the dust to settle"], 1, "Let the news land and the market settle before you look for your model."],
  ];
  const api = { NOTE, STEPS, MANAGE, QUIZ, required: STEPS.filter((s) => s.req).map((s) => s.id), byId: Object.fromEntries(STEPS.map((s) => [s.id, s])) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgePlaybook = api;
})(typeof window !== "undefined" ? window : null);
