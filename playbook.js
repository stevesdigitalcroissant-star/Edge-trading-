// Your strategy in one place — the steps the Today planner asks you to tick, the Coach teaches, and the
// simulator scores every practice trade against. Works in the browser (window.EdgePlaybook) and in Node.
(function (root) {
  const STEPS = [
    { id: "htf", icon: "🔭", title: "Big picture first", short: "4H trend · where's price?", req: true,
      text: "Open the 4H: is it trending up, down, or ranging? With the 4H trend your odds are better. Note the big 4H zones — a move often stops at one." },
    { id: "zone", icon: "🧱", title: "A 1H supply or demand zone", short: "The base before the explosive move", req: true,
      text: "On the 1H: the base candles right before an explosive move. Best when mature (more than 10 1H candles old), narrow (no wider than ¾ of a normal 1H candle) and not an instant retest (3 candles or less)." },
    { id: "rr", icon: "📏", title: "Room to run", short: "2R or more to the leg high / low", req: true,
      text: "From your entry to the high (demand) or low (supply) of the move that left the zone: at least 2R of room. Less = price will likely stall there." },
    { id: "trend", icon: "〰️", title: "A clean pullback", short: "Not choppy on the way back", req: true,
      text: "Price should come back to the zone in a steady, clean way. A choppy, messy approach (big overlapping candles) means nobody's in control — skip unless it's an A+ zone." },
    { id: "entry", icon: "🎯", title: "5m CHoCH, then your entry", short: "FVG · breaker · mitigation block", req: true,
      text: "Inside the zone, wait for the 5m change of character (CHoCH) your way. Enter on the pullback into its fair value gap, breaker block or mitigation block. No CHoCH = no entry yet." },
    { id: "stop", icon: "🛡️", title: "Stop behind the zone", short: "Past the swing of the 5m move", req: true,
      text: "The stop goes past the zone and the swing of the 5m move that made the CHoCH — where your idea is wrong." },
    { id: "liq", icon: "📊", title: "Strong volume on the break", short: "1.5× average or more", req: false,
      text: "The explosive move out of the zone on strong volume shows real buyers or sellers. It's a bonus — we're still testing how much it helps." },
    { id: "session", icon: "⏰", title: "Your hours and limits", short: "03:00–11:00 New York · 2 trades max", req: true,
      text: "Only 03:00–11:00 New York (00:00–08:00 Vancouver). Two trades a day at most, one per market group, no trades 30 minutes either side of big news. Target 1:3 (10R max)." },
  ];
  const MANAGE = [
    "Hands off — let it hit the stop or the 1:3 target.",
    "Want more? Lock in profit at +3R and let it run, never past 10R.",
    "Never move the stop further away.",
  ];
  const QUIZ = [
    ["What do you look at first?", ["The 5m chart", "The 4H trend and the big zones", "The news"], 1, "Big picture first: the 4H tells you which way the odds lean."],
    ["Where does the 1H demand zone go?", ["On the explosive candle itself", "On the base candles right before the explosive move", "On the last swing high"], 1, "The base — the hesitation candles before the explosion."],
    ["Price comes back to a zone after only 2 candles. What is it?", ["A mature zone — take it", "An instant retest — the weakest kind", "A breaker"], 1, "Instant retests (3 candles or less) are the weakest zones. Mature zones (more than 10 candles) are the best."],
    ["The leg high is 1.4R above your entry.", ["Fine — target is 3R anyway", "Not enough room — under 2R"], 1, "Price usually stalls at the leg high. You need 2R of room or more."],
    ["Price is in your zone but the 5m hasn't made a CHoCH yet.", ["Enter now, it's the zone", "Wait — no CHoCH, no entry"], 1, "The CHoCH is your proof that buyers / sellers showed up."],
    ["After the 5m CHoCH, where do you enter?", ["On the pullback into the FVG, breaker or mitigation block", "At market, right after the break", "At the far side of the zone"], 0, "On the pullback into the entry pattern the CHoCH left."],
    ["It's 11:40 New York and a perfect setup shows up.", ["Take it", "Skip — your hours are 03:00–11:00 New York"], 1, "Your edge was measured 03:00–11:00 New York. Outside it, no trades."],
    ["You've taken 2 trades today.", ["One more if it's A+", "Done for the day"], 1, "Two trades a day, max."],
  ];
  const api = { STEPS, MANAGE, QUIZ, required: STEPS.filter((s) => s.req).map((s) => s.id), byId: Object.fromEntries(STEPS.map((s) => [s.id, s])) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgePlaybook = api;
})(typeof window !== "undefined" ? window : null);
