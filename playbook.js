// Your strategy in one place — the steps the Today planner asks you to tick, the Coach teaches, and the
// simulator scores every practice trade against. Works in the browser (window.EdgePlaybook) and in Node.
(function (root) {
  const STEPS = [
    { id: "htf", icon: "🔭", title: "Big picture first", short: "Weekly · daily · 4H zones marked", req: true,
      text: "Mark the weekly, daily and 4H supply & demand zones before anything else. Is price near one? A trend usually ends at a higher-timeframe zone." },
    { id: "trend", icon: "🧭", title: "Trend from breaks of structure", short: "Daily over 4H over 15m", req: true,
      text: "Read the trend from breaks of structure — the daily first, then the 4H. Trade with it, or counter-trend only from a 4H (or higher) zone." },
    { id: "zone", icon: "🧱", title: "A fresh 15m zone", short: "The base before the explosive move", req: true,
      text: "The 15m zone is the base — the hesitation candles right before the explosive move — refined from wick to body. Fresh: touched once at most without breaking structure, not born inside a range, from the strong swing toward the weak one." },
    { id: "liq", icon: "💧", title: "Liquidity taken", short: "Bonus, not required", req: false,
      text: "Inducement or liquidity swept into the zone fuels the move. It's a bonus — a trade without it can still be good." },
    { id: "entry", icon: "🎯", title: "5m / 1m change of character", short: "Limit at the start of the FVG", req: true,
      text: "Inside the zone, wait for a 5m or 1m change of character your way. The limit goes at the beginning of its fair value gap — not the middle." },
    { id: "stop", icon: "🛡️", title: "Stop behind the swing", short: "Of that 5m / 1m move", req: true,
      text: "The stop goes behind the swing of the 5m / 1m move that made the change of character." },
    { id: "rr", icon: "📐", title: "3R or more", short: "Never under 3R · 10R max", req: true,
      text: "Aim for the opposing liquidity: at least 3R, at most 10R. Under 3R there's no trade." },
    { id: "session", icon: "⏰", title: "Your session and limits", short: "London or New York · 2 trades max", req: true,
      text: "Only in the London or New York session. Two trades a day at most, same dollar risk every time." },
  ];
  const MANAGE = [
    "Hands off until +3R.",
    "At +3R lock in profit, then trail the stop behind each new 15m swing.",
    "Never move the stop further away. Let it run to the target (10R max).",
  ];
  const QUIZ = [
    ["Before you look for an entry on the 15m, what comes first?", ["The 1m chart", "The weekly, daily and 4H zones", "The news"], 1, "Big picture first: the higher-timeframe zones tell you where a move is likely to stop."],
    ["The daily trend is down, the 4H is up. Which matters more?", ["The daily", "The 4H", "Neither"], 0, "Daily over 4H over 15m. Counter-trend only from a 4H (or higher) zone."],
    ["Where does the 15m demand zone go?", ["On the explosive candle itself", "On the base candles right before the explosive move", "On the last swing high"], 1, "The base — the hesitation candles before the explosion — refined from wick to body."],
    ["Price is in your zone and the 5m makes a change of character. Where's the limit?", ["The middle of the fair value gap", "The start of the fair value gap", "At market, right now"], 1, "The beginning of the gap, not the middle."],
    ["Where does the stop go?", ["Behind the swing of the 5m / 1m move", "A fixed 10 points away", "Inside the zone"], 0, "Behind the swing of the move that made the change of character."],
    ["Your target is the nearest liquidity, 2.4R away.", ["Take it — 2.4R is fine", "Skip it — under 3R"], 1, "Never under 3R."],
    ["You're up 3R and the target is 7R away.", ["Close it, bank it", "Lock profit and trail behind new 15m swings", "Move the stop further to give it room"], 1, "Lock in at +3R, then trail behind each new 15m swing."],
  ];
  const api = { STEPS, MANAGE, QUIZ, required: STEPS.filter((s) => s.req).map((s) => s.id), byId: Object.fromEntries(STEPS.map((s) => [s.id, s])) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgePlaybook = api;
})(typeof window !== "undefined" ? window : null);
