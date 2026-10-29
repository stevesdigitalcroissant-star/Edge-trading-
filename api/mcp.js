// /api/mcp — a read-only door into Edge for David, the voice assistant (an MCP server, JSON over HTTP).
// David sends the key made in Settings → David as a Bearer token. Every tool here only READS:
// nothing can place, change or close a trade, move a stop, or touch the broker or the rules.
const { getStore } = require("./_store");
const { brokerFor } = require("./_broker");
const { state } = require("./_core");
const auth = require("./_auth");

const PROTOCOL = "2025-06-18";
const MY_MARKETS = ["6j", "natgas", "6e", "nq", "ym", "silver", "copper", "6a", "gold"];
const ALL_MARKETS = [...MY_MARKETS, "es", "rty", "6b", "crude", "zn", "zb"];
const none = { type: "object", properties: {} };
const TOOLS = [
  { name: "edge_today", description: "Today in Edge: the live plans (orders, stop, target, break-even, contracts), the game plan, open trades, guardrails (trades left today, daily loss limit, cool-downs), big news coming up, the weekly bias per market, last prices and the close-out time.", inputSchema: none },
  { name: "edge_setups", description: "The latest setups Edge found, with their grade (A+/A/B/C), why, whether they can be taken now and their status.", inputSchema: none },
  { name: "edge_journal", description: "The trade journal: each trade's market, direction, grade, emotion before the trade, result in R and notes, plus stats (win rate, total R by grade, emotion, market) and missed A+ setups. practice: true reads the FX Replay practice log instead.", inputSchema: { type: "object", properties: { practice: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } } } },
  { name: "edge_coach", description: "What Edge's chart coach last saw and said in the current screen-watching session (live or FX Replay practice).", inputSchema: none },
  { name: "edge_market", description: "The market right now, read with Edge's own supply & demand rules (the same as the home chart and the TradingView scanner), from Yahoo futures candles (they can run a few minutes behind). With a market: price, 1H trend and breaks of structure, the 4H trend, the live 1H zone (top, bottom, wick part, how much is filled, 30% line), the 4H zone, whether price is in a zone, liquidity taken and resting on the 1H, whether orders are allowed now (03:00-11:00 New York), what to wait for, and the last 3 hours of 5-minute candles. Without a market: a quick board of his 9 markets (price, 4H and 15m trend).", inputSchema: { type: "object", properties: { market: { type: "string", enum: ALL_MARKETS } } } },
  { name: "edge_scan", description: "Which of his 9 markets make sense to look at right now for a potential trade: every market read with Edge's supply & demand rules (1H zone, 4H trend, liquidity, fill) and ranked best first, with its stage (in the zone and what to wait for, how far from the zone, or no setup and why). Use it when he asks what to look at, what's setting up, or for the session plan; then use edge_market on the top one or two for detail.", inputSchema: none },
  { name: "edge_rules", description: "Edge's rules and settings: risk, daily limits, sessions, break-even and exit levels, and the strategies it trades.", inputSchema: none },
];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const nyMin = (t) => { const p = Object.fromEntries(nyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Number(p.hour) * 60 + Number(p.minute); };
// 5-minute candles → 1H on the clock, 4H from 18:00 New York like the CME day (as the home chart does)
function agg(raw, tf) {
  const out = [], ms = tf * 60e3;
  for (const [t, o, h, l, c] of raw) {
    const k = tf === 240 ? t - (((nyMin(t) - 1080 + 1440) % 240) * 60e3) - (t % 60e3) : Math.floor(t / ms) * ms;
    const b = out[out.length - 1];
    if (b && b.t === k) { b.h = Math.max(b.h, h); b.l = Math.min(b.l, l); b.c = c; } else out.push({ t: k, o, h, l, c });
  }
  return out;
}
// a liquidity pool in words: buy-side = stops above highs, sell-side = stops below lows
const pool = (x) => ({ side: x.d > 0 ? "buy-side (above highs)" : "sell-side (below lows)", level: x.lvl, ...(x.t1 ? { swept: iso(x.t1), how: x.how } : {}), touches: x.touches });
const iso = (t) => (t ? new Date(t).toISOString().slice(0, 16) + "Z" : null);
// One market by Edge's rules: the read, liquidity, and the 1H ATR.
async function readOne(m) {
  const { load } = require("./candles"), E = require("../sdchart.js");
  const raw = await load(m, 59, "5m");
  if (!raw.length) throw new Error("No candles for " + m);
  const last = raw[raw.length - 1], h1 = agg(raw, 60), h4 = agg(raw, 240);
  const st = E.read(h1, h4, last[4], nyMin(Date.now()));
  const liq = (() => { try { return E.liquidity(h1.slice(0, -1)); } catch { return null; } })();
  let atr = null;
  for (let i = 1; i < h1.length - 1; i++) { const b = h1[i], tr = Math.max(b.h - b.l, Math.abs(b.h - h1[i - 1].c), Math.abs(b.l - h1[i - 1].c)); atr = atr == null ? tr : (atr * 13 + tr) / 14; }
  return { raw, last, st, liq, atr };
}

// Which markets are worth a look now: each market's stage by his rules, best first.
// Points: in the 1H zone (3) or close to it (2 within 0.5 ATR, 1 within 1.5), the zone with the 4H trend (1),
// liquidity on the right side swept last (1), filled 30% or more (1); minus 2 if price went past the far edge.
async function scan() {
  const rows = await Promise.all(MY_MARKETS.map(async (m) => {
    try {
      const { last, st, liq, atr } = await readOne(m), price = last[4], z = st.zone;
      if (!z) return { market: m, price, score: -1, stage: st.status, with4h: null };
      const dist = z.d > 0 ? price - z.top : z.bot - price, far = z.d > 0 ? price < z.bot : price > z.top;
      const distATR = atr ? Math.round((Math.max(0, dist) / atr) * 10) / 10 : null, fill = st.fill != null ? Math.round(st.fill * 100) : null;
      const liqOk = liq && liq.bias === z.d;
      let score = 0;
      if (st.inZone) score += 3; else if (distATR != null && distATR <= 0.5) score += 2; else if (distATR != null && distATR <= 1.5) score += 1;
      if (st.with4h) score += 1;
      if (liqOk) score += 1;
      if (st.inZone && fill != null && fill >= 30) score += 1;
      if (far) score -= 2;
      const side = z.d > 0 ? "buy (demand)" : "sell (supply)";
      const stage = far ? "price went through the far side of the zone: likely dead, wait for a new one"
        : st.inZone ? `IN the 1H ${side} zone, ${fill ?? 0}% filled${fill != null && fill < 30 ? " (under 30%: may go deeper)" : ""}: watch the 5m for the shift (MSS / CHoCH), then the breaker, FVG or mitigation entry`
        : `${distATR} × 1H ATR from the 1H ${side} zone: set an alert at the zone, don't chase`;
      return { market: m, price, score, side, stage, zoneTop: z.top, zoneBottom: z.bot, distanceATR: distATR, filledPct: fill, with4h: st.with4h, liquidity: liqOk ? "the right side was swept last (fuel)" : liq && liq.bias ? "the wrong side was swept last" : "no clear sweep", ordersOpenNow: st.ordersOpen };
    } catch (e) { return { market: m, score: -9, error: e.message }; }
  }));
  rows.sort((a, b) => b.score - a.score);
  return { note: "Ranked by Edge's supply & demand rules on Yahoo candles (can lag a few minutes). Score = how close to a setup, not a signal: the 5m shift and the entry still have to happen, and Edge's TAKE/SKIP, news and limits still decide. Orders only 03:00-11:00 New York.", rows };
}

async function market(m) {
  const { load } = require("./candles");
  if (!m) {
    const T = require("../trend.js");
    return { note: "Quick board (15-minute candles, Yahoo, may lag a few minutes). Ask for one market for the full supply & demand read.", rows: await Promise.all(MY_MARKETS.map(async (k) => {
      try { const bars = await load(k, 20, "15m"), r = T.both(bars, 15), last = bars[bars.length - 1]; return { market: k, price: last && last[4], at: iso(last && last[0]), trend4h: r.h4.dir, trend15m: r.m15 ? r.m15.dir : 0, verdict: r.verdict.text }; }
      catch (e) { return { market: k, error: e.message }; }
    })) };
  }
  const { raw, last, st, liq } = await readOne(m);
  const zone = (z) => z && { dir: z.d > 0 ? "demand (buy)" : "supply (sell)", top: z.top, bottom: z.bot, wickEdge: z.wick ?? null, line30: z.l30 ?? null, since: iso(z.t) };
  return {
    market: m, price: last[4], candleTime: iso(last[0]), source: "Yahoo futures, 5-minute candles (can lag a few minutes)", newYorkTime: `${String(Math.floor(nyMin(Date.now()) / 60)).padStart(2, "0")}:${String(nyMin(Date.now()) % 60).padStart(2, "0")}`,
    status: st.status, ordersOpenNow: st.ordersOpen,
    trend1h: st.trend, breaksSameWay: st.cnt, trend4h: st.t4, zoneWith4h: st.with4h,
    zone1h: zone(st.zone), filledPct: st.fill != null ? Math.round(st.fill * 100) : null, inZone1h: st.inZone, olderZone1h: zone(st.older),
    zone4h: zone(st.zone4), inZone4h: st.inZone4,
    breaks1h: (st.breaks || []).map((b) => ({ kind: b.mss ? "MSS" : "BOS", dir: b.d > 0 ? "up" : "down", level: b.lvl ?? b.level ?? null, at: iso(b.t1) })),
    liquidity1h: liq && {
      bias: liq.bias > 0 ? "up (sell-side was swept last)" : liq.bias < 0 ? "down (buy-side was swept last)" : "none",
      takenRecently: (liq.taken || []).slice(-3).map(pool), restingNearest: (liq.resting || []).slice(0, 4).map(pool),
    },
    last5m: raw.slice(-36).map(([t, o, h, l, c]) => [iso(t).slice(11, 16), o, h, l, c]),
    note: "trend: 1 = up, -1 = down, 0 = none. last5m = [time UTC, open, high, low, close].",
  };
}

async function run(name, args, s) {
  const now = s ? s.now : Date.now();
  switch (name) {
    case "edge_today": return {
      now: new Date(now).toISOString(), plans: s.plans, gameplan: s.gameplan, open: s.open, guard: s.guard, prop: s.prop, closeOut: s.closeOut,
      news: (s.news.events || []).filter((e) => e.time < now + 24 * 3600e3), newsOk: s.news.ok, bias: s.bias, prices: s.prices,
      broker: s.broker && { kind: s.broker.kind, label: s.broker.label },
    };
    case "edge_setups": return s.setups.map((x) => pick(x, ["id", "at", "market", "symbol", "strategy", "kind", "dir", "grade", "g", "status", "entry", "sl", "tp", "size", "story"]));
    case "edge_journal": {
      const n = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      return args.practice ? { trades: s.practice.slice(0, n), stats: s.practiceStats } : { trades: s.journal.slice(0, n), stats: s.stats, missed: s.missed, aPlusShare: s.share };
    }
    case "edge_coach": return s.coach && s.coach.session ? s.coach.session : { note: "No coach session yet." };
    case "edge_rules": return { settings: s.settings, strategies: s.strategies, markets: s.markets };
    case "edge_scan": return scan();
    case "edge_market": return market(args.market && ALL_MARKETS.includes(args.market) ? args.market : null);
  }
  throw new Error("Unknown tool");
}

const reply = (res, id, result) => res.status(200).json({ jsonrpc: "2.0", id, result });
const fail = (res, id, code, message) => res.status(200).json({ jsonrpc: "2.0", id, error: { code, message } });

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const store = getStore();
  if (!(await auth.davidAuthorized(store, req.headers).catch(() => false))) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="edge", error="invalid_token"');
    return res.status(401).json({ error: "Make a David key in Edge → Settings → David." });
  }
  let msg;
  try { msg = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; } catch { return fail(res, null, -32700, "Parse error"); }
  if (Array.isArray(msg)) return fail(res, null, -32600, "Batches aren't supported");
  const { id = null, method, params = {} } = msg;
  if (id === null || id === undefined) return res.status(202).end(); // notifications need no answer
  try {
    if (method === "initialize") return reply(res, id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "edge", version: "1.0.0" }, instructions: "Edge is the owner's trading co-pilot. These tools only read it." });
    if (method === "ping") return reply(res, id, {});
    if (method === "tools/list") return reply(res, id, { tools: TOOLS });
    if (method === "tools/call") {
      if (!TOOLS.some((t) => t.name === params.name)) return fail(res, id, -32602, "Unknown tool");
      const s = params.name === "edge_market" || params.name === "edge_scan" ? null : await state(store, await brokerFor(store));
      const text = JSON.stringify(await run(params.name, params.arguments || {}, s));
      return reply(res, id, { content: [{ type: "text", text: text.length > 60000 ? text.slice(0, 60000) + " …(cut)" : text }] });
    }
    return fail(res, id, -32601, "Method not found");
  } catch (e) {
    return reply(res, id, { content: [{ type: "text", text: "Edge error: " + e.message }], isError: true });
  }
};

module.exports.TOOLS = TOOLS;
