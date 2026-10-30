// Your strategy in one place — the steps the Today planner asks you to tick, the Coach teaches, and the
// simulator scores every practice trade against. Works in the browser (window.EdgePlaybook) and in Node.
(function (root) {
  // Oct 2026, tested on 2019–2026 (9 markets, realistic costs): supply & demand + the 3 big-picture rules (with the 4H
  // trend, no wall inside 3R, not chasing) = +0.51R a trade on 134 trades, worst dip 8.6R, held 2019–22 and 2023–26.
  // 30 Oct 2026: started over — simple support & resistance (his own levels), Heikin Ashi + regular candles, 80 SMA.
  const NOTE = "New, simple rules (30 Oct): your own support & resistance, Heikin Ashi + regular candles, the 80 SMA. TradingView script: Edge · S/R Watch.";
  const STEPS = [
    { id: "htf", icon: "📏", title: "Your levels", short: "Support & resistance you drew", req: true,
      text: "Draw your support and resistance on the chart — the clear levels price has turned at before. Put them in the S/R Watch script so it can watch every pair for you." },
    { id: "zone", icon: "🔔", title: "Price comes to your level", short: "Once — then it has to leave first", req: true,
      text: "The script alerts you when price touches one of your levels. That level then stays quiet until price has moved well away from it — so you only hear about real returns, not price sitting on the line." },
    { id: "trend", icon: "📈", title: "The 80 SMA agrees", short: "Buy above it · sell below it", req: true,
      text: "At support, only buy if price is above the 80 SMA. At resistance, only sell if price is below it." },
    { id: "entry", icon: "🕯️", title: "Heikin Ashi turns, the candle closes back", short: "Your entry signal", req: true,
      text: "At support: the Heikin Ashi candle turns green AND the regular candle closes back above the level. At resistance: Heikin Ashi turns red AND the candle closes back below. That's the entry — the script alerts it as a BUY / SELL setup." },
    { id: "stop", icon: "🛡️", title: "Stop past the level", short: "Where the level has failed", req: true,
      text: "The stop goes on the other side of the level, past the touch candle — if price gets there, the level didn't hold." },
    { id: "session", icon: "⏰", title: "Your limits", short: "Same size every trade · max 2 a day", req: true,
      text: "Same risk on every trade, two trades a day at most, no trades right around big news." },
  ];
  const MANAGE = [
    "Hands off — let it hit the stop or the target.",
    "Never move the stop further away.",
  ];
  const QUIZ = [
    ["Price touched your support an hour ago and never left. It dips into it again. New alert?", ["Yes", "No — it has to leave the level first"], 1, "A level only counts again after price has moved well away from it."],
    ["Price is at support, the Heikin Ashi candle just turned green, but price is below the 80 SMA.", ["Buy", "Wait — the 80 SMA doesn't agree"], 1, "At support you only buy above the 80 SMA."],
    ["At resistance, which signal do you wait for?", ["Heikin Ashi turns red and the candle closes back below the level", "Any red candle"], 0, "The Heikin Ashi flip plus a regular close back below the level."],
    ["Where does the stop go on a buy at support?", ["Below the level, past the touch candle", "Right on the level"], 0, "On the other side of the level — where it has clearly failed."],
  ];
  const api = { NOTE, STEPS, MANAGE, QUIZ, required: STEPS.filter((s) => s.req).map((s) => s.id), byId: Object.fromEntries(STEPS.map((s) => [s.id, s])) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgePlaybook = api;
})(typeof window !== "undefined" ? window : null);
