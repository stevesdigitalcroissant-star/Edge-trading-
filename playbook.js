// Your strategy in one place — the steps the Today planner asks you to tick, the Coach teaches, and the
// simulator scores every practice trade against. Works in the browser (window.EdgePlaybook) and in Node.
(function (root) {
  // Oct 2026: Fib first. Three Fibs (4H swing → 1H swing → the POI's own leg) must point at the same small box,
  // a level that matters sits there, and the 5m / 1m shows the turn. Being backtested on 2019–2026 before Edge alerts on it.
  const NOTE = "New Fib rules — still being tested on your 2019–2026 data. Until the results are in, trade them small.";
  const STEPS = [
    { id: "htf", icon: "🔭", title: "Big picture: the levels that matter", short: "4H line · 1 month to 1 year back", req: true,
      text: "Open the 4H as a line chart and look back as far as it takes — a month, 3 months, a year. Mark the levels price turned at 3 times or more, far apart in time. Those are the walls: where price is now, which ones are above and below you?" },
    { id: "trend", icon: "📐", title: "4H Fib on the latest big swing", short: "Price back in 0.5 – 0.79", req: true,
      text: "Draw the Fib on the most recent 4H swing that's clearly done — price moved away from it by about 3 normal 4H candles (3× ATR). Trade in the direction of that swing, only once price has pulled back to 0.5 – 0.79: buy in the cheap half of an up swing, sell in the expensive half of a down swing. Near 0 = chasing — skip." },
    { id: "fib1", icon: "📐", title: "1H Fib on the latest swing inside it", short: "Its 0.62 – 0.79 lines up", req: true,
      text: "Inside that 4H pullback, draw the Fib on the latest finished 1H swing (the one going your way). Its OTE pocket, 0.62 – 0.79, should sit on or overlap the 4H 0.5 – 0.79 area." },
    { id: "zone", icon: "🧱", title: "The POI and its own Fib", short: "Supply · demand · support / resistance", req: true,
      text: "Find the point of interest in that area: a supply or demand zone, or a support / resistance level from the big picture. Draw the Fib on the leg that left it. When the 4H, the 1H and this POI Fib all land within about half a normal 1H candle of each other, that's your box. No overlap = no trade." },
    { id: "rr", icon: "📏", title: "Room for the 1:3", short: "No big wall within 3R", req: true,
      text: "From your entry to the 1:3 target, nothing from the big picture is in the way. A level with 3+ touches inside 3R blocks the trade — skip it, or wait for one that's clear." },
    { id: "entry", icon: "🎯", title: "5m or 1m: the turn, then the entry", short: "CHoCH · then FVG or retest", req: true,
      text: "Only when price is inside your box: wait for the 5m (or 1m) change of character your way. Enter on the pullback into the fair value gap or the retest it left. In the box but no CHoCH = no entry yet." },
    { id: "stop", icon: "🛡️", title: "Stop past the 1.0", short: "Where the idea is wrong", req: true,
      text: "The stop goes past the swing of the 5m / 1m move that made the CHoCH, and never inside the box. If the POI Fib's 1.0 (the start of its leg) breaks, the idea is dead." },
    { id: "liq", icon: "📊", title: "Volume: a look, not a rule", short: "Info only · tested on your data", req: false,
      text: "Strong volume on the move out of the zone feels convincing, but on your own data (2023 → 2026) setups won about the same with strong, normal or weak volume. Look at it if you like — don't let it change your decision." },
    { id: "session", icon: "⏰", title: "Your hours and limits", short: "03:00–11:00 New York · 2 trades max", req: true,
      text: "Only 03:00–11:00 New York (00:00–08:00 Vancouver). Two trades a day at most, one per market group, no trades 30 minutes either side of big news. Target 1:3 (10R max)." },
  ];
  const MANAGE = [
    "Hands off — let it hit the stop or the 1:3 target.",
    "Want more? Lock in profit at +3R and aim for the −1.0 Fib extension, never past 10R.",
    "Never move the stop further away.",
  ];
  const QUIZ = [
    ["What do you look at first?", ["The 5m chart", "The 4H line chart, as far back as the levels go", "The news"], 1, "Big picture first: old levels — even from a year ago — decide where price stops."],
    ["Which 4H swing gets the Fib?", ["The latest swing that's clearly finished (price moved ~3× ATR away)", "Any swing you like", "The one still forming"], 0, "A fixed rule: the latest finished swing. A swing still forming keeps moving your Fib."],
    ["Down swing on the 4H, price is back at 0.15. Sell?", ["Yes — trend is down", "No — that's chasing; wait for 0.5 – 0.79"], 1, "Sell in the expensive half. On your own trades, 0.5 – 0.79 paid about 3× more per trade than chasing."],
    ["Your 4H, 1H and POI Fibs don't overlap.", ["Take it anyway at the POI", "Skip — no box, no trade"], 1, "The edge is the overlap. A single Fib line on its own is no better than a random line."],
    ["A level price turned at 4 times sits 2R from your entry.", ["Fine — target is 3R anyway", "Skip — a big wall blocks the 1:3"], 1, "Big-picture levels stop moves. You need the path to 3R clear."],
    ["Price is in your box but the 5m hasn't made a CHoCH yet.", ["Enter now, it's the box", "Wait — no CHoCH, no entry"], 1, "The CHoCH is your proof that buyers / sellers showed up."],
    ["After the CHoCH, where do you enter?", ["On the pullback into the FVG or the retest", "At market, right after the break", "At the far side of the box"], 0, "On the pullback into what the CHoCH left behind."],
    ["It's 11:40 New York and a perfect setup shows up.", ["Take it", "Skip — your hours are 03:00–11:00 New York"], 1, "Your edge was measured 03:00–11:00 New York. Outside it, no trades."],
  ];
  const api = { NOTE, STEPS, MANAGE, QUIZ, required: STEPS.filter((s) => s.req).map((s) => s.id), byId: Object.fromEntries(STEPS.map((s) => [s.id, s])) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgePlaybook = api;
})(typeof window !== "undefined" ? window : null);
