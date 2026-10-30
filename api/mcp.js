// /api/mcp — Edge for David, the voice assistant (an MCP server, JSON over HTTP). David sends the key made in
// Settings → David as a Bearer token. He reads Edge, and writes only three things: journal entries / notes, his notes
// on how Steve trades, and Steve's support & resistance levels. Nothing here can place, change or close a trade, move a
// stop, or touch the broker or the risk rules.
// Strategy (30 Oct 2026, started over): simple support & resistance Steve draws himself — levels watched on the 15m,
// entry on the 5m (Heikin Ashi flips his way + the candle closes back on the right side of the level), the 80 SMA
// agrees, with the Daily / 4H / 1H trend for context.
const { getStore } = require("./_store");
const { brokerFor } = require("./_broker");
const { state } = require("./_core");
const auth = require("./_auth");

const PROTOCOL = "2025-06-18";
const MY_MARKETS = ["6j", "natgas", "6e", "nq", "ym", "silver", "copper", "6a", "gold"];
const ALL_MARKETS = [...MY_MARKETS, "es", "rty", "6b", "crude", "zn", "zb"];
const none = { type: "object", properties: {} };
const STR = { type: "string" }, NUM = { type: "number" }, MK = { type: "string", enum: ALL_MARKETS };
const TOOLS = [
  { name: "edge_today", description: "Today in Edge: open trades, guardrails (trades left today, daily loss limit, cool-downs), big news coming up, last prices and the close-out time.", inputSchema: none },
  { name: "edge_market", description: "One market the way Steve trades now (simple support & resistance): price; the trend on the Daily, 4H and 1H (price vs the 80 SMA and its slope); the 15m and 5m — 80 SMA side and the last Heikin Ashi candles (did one just flip?); his saved levels with the nearest support and resistance and how far away they are (in 15m ATR, 'at the level' when within 0.25); and the last 2 hours of 15m candles. Without a market: a quick board of all his markets. Yahoo futures candles, a few minutes behind.", inputSchema: { type: "object", properties: { market: MK } } },
  { name: "edge_scan", description: "Which of his markets is closest to one of HIS support / resistance levels right now, best first, with the Daily / 4H / 1H trend and the 80 SMA side — use it when he asks what to watch. Markets without saved levels are listed so you can ask him for them.", inputSchema: none },
  { name: "edge_levels", description: "Steve's support & resistance levels per market (the ones he drew). Read them before talking about levels.", inputSchema: none },
  { name: "edge_levels_set", description: "Save Steve's levels for one market when he tells you them (replaces that market's list; send [] to clear). Repeat them back to him first.", inputSchema: { type: "object", properties: { market: MK, levels: { type: "array", items: NUM, maxItems: 12 } }, required: ["market", "levels"] } },
  { name: "edge_journal", description: "His trade journal: each trade's market, direction, entry, stop, target, result in R, emotion and notes, plus stats. Check it before writing, so the same trade isn't logged twice.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } } },
  { name: "edge_journal_write", description: "Write in his journal what you saw him do. New trade: market, dir, entry, stop (target, exit, resultR if known), emotion, followedRules, notes, tags (e.g. 'waited for the HA flip', 'entered early', 'moved stop'). To add to a trade already there (Edge records broker fills itself), pass its id with your notes / result — notes are added, never replaced. Say back what you wrote.", inputSchema: { type: "object", properties: { id: STR, market: MK, dir: { type: "string", enum: ["long", "short"] }, entry: NUM, stop: NUM, target: NUM, exit: NUM, resultR: NUM, openedAt: STR, closedAt: STR, emotion: { type: "string", enum: ["calm", "fomo", "revenge", "bored", "scared", "confident"] }, followedRules: { type: "boolean" }, notes: STR, tags: { type: "array", items: STR, maxItems: 10 } } } },
  { name: "edge_style", description: "Your notes on how Steve trades — his strengths, habits, recurring mistakes and the rules he keeps — newest first. Read them at the start of a session so your feedback builds on what you already learned.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } } } },
  { name: "edge_style_write", description: "Save one thing you learned about how Steve trades (a strength, habit, mistake or rule he follows), in one or two plain sentences, with an example from today if you have one.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["strength", "habit", "mistake", "rule", "goal"] }, note: STR, market: MK }, required: ["kind", "note"] } },
  { name: "edge_rules", description: "His strategy in steps (simple support & resistance, Heikin Ashi + regular candles, the 80 SMA) and his risk settings and limits.", inputSchema: none },
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
// ---------- the market, Steve's way: trends (Daily / 4H / 1H vs the 80 SMA), 15m / 5m Heikin Ashi, distance to his levels
const sma = (v, n) => (v.length >= n ? v.slice(-n).reduce((a, b) => a + b, 0) / n : null);
function trendOf(bars, n = 80) { // up: above a rising 80 SMA · down: below a falling one · mixed otherwise
  const c = bars.map((b) => b.c), now = sma(c, n), before = sma(c.slice(0, -5), n), last = c[c.length - 1];
  if (now == null || before == null) return { dir: "not enough data" };
  const dir = last > now && now > before ? "up" : last < now && now < before ? "down" : "mixed";
  return { dir, close: last, sma80: +now.toPrecision(7), above80: last > now };
}
function heikin(bars) { const out = []; let o = null; for (const b of bars) { const c = (b.o + b.h + b.l + b.c) / 4; o = o == null ? (b.o + b.c) / 2 : (o + out[out.length - 1].c) / 2; out.push({ o, c, green: c > o }); } return out; }
function atrOf(bars, n = 14) { let a = null; for (let i = 1; i < bars.length; i++) { const b = bars[i], tr = Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)); a = a == null ? tr : (a * (n - 1) + tr) / n; } return a; }
async function readOne(m, levels) {
  const { load } = require("./candles");
  const [raw, daily] = await Promise.all([load(m, 59, "5m"), load(m, 400, "1d").catch(() => [])]);
  if (!raw.length) throw new Error("No candles for " + m);
  const bar = ([t, o, h, l, c]) => ({ t, o, h, l, c }), m5 = raw.map(bar), m15 = agg(raw, 15), h1 = agg(raw, 60), h4 = agg(raw, 240), d1 = daily.map(bar);
  const price = m5[m5.length - 1].c, atr15 = atrOf(m15.slice(-120)), ha15 = heikin(m15.slice(-60)), ha5 = heikin(m5.slice(-60));
  const tf = (bars) => { const t = trendOf(bars); return t; }, side = (bars) => { const t = trendOf(bars); return t.above80 == null ? null : t.above80 ? "above" : "below"; };
  const lv = (levels || []).map(Number).filter(Number.isFinite), sup = lv.filter((v) => v <= price).sort((a, b) => b - a)[0], res = lv.filter((v) => v > price).sort((a, b) => a - b)[0];
  const dist = (v) => (v == null || !atr15 ? null : Math.round((Math.abs(price - v) / atr15) * 100) / 100);
  const flip = (ha) => { const a = ha[ha.length - 2], b = ha[ha.length - 1]; return a && b && a.green !== b.green ? (b.green ? "just turned green" : "just turned red") : b && (b.green ? "green" : "red"); };
  const trends = { daily: tf(d1).dir || "no data", h4: tf(h4).dir, h1: tf(h1).dir };
  const agree = ["up", "down"].find((d) => trends.daily === d && trends.h4 === d && trends.h1 === d) || "mixed";
  return { m, price, m5, m15, atr15, trends, agree, sma15: side(m15), sma5: side(m5), ha15: flip(ha15), ha5: flip(ha5), levels: lv, sup, res, dSup: dist(sup), dRes: dist(res) };
}
async function savedLevels(store) { return (await store.get("levels")) || {}; }

async function scan(store) {
  const L = await savedLevels(store);
  const rows = await Promise.all(MY_MARKETS.map(async (m) => {
    try {
      const r = await readOne(m, L[m]), near = [r.dSup, r.dRes].filter((x) => x != null), d = near.length ? Math.min(...near) : null;
      const which = d == null ? null : d === r.dSup ? `support ${r.sup}` : `resistance ${r.res}`;
      return { market: m, price: r.price, nearestLevel: which, distanceATR15: d, atLevel: d != null && d <= 0.25, trend: r.trends, allTrendsAgree: r.agree, sma80_15m: r.sma15, ha15m: r.ha15, ha5m: r.ha5, levelsSaved: r.levels.length };
    } catch (e) { return { market: m, error: e.message }; }
  }));
  rows.sort((a, b) => (a.distanceATR15 ?? 99) - (b.distanceATR15 ?? 99));
  return { note: "Closest to one of HIS levels first (distance in 15m ATR; 'at the level' within 0.25). No levels saved = ask him for them (edge_levels_set). Yahoo candles, a few minutes behind. Entry is on the 5m: Heikin Ashi flips his way + the candle closes back on the right side + the 80 SMA agrees.", rows };
}

async function market(store, m) {
  const L = await savedLevels(store);
  if (!m) return { note: "Quick board — ask for one market for the full read.", rows: (await scan(store)).rows };
  const r = await readOne(m, L[m]), hhmm = (t) => iso(t).slice(11, 16);
  return {
    market: m, price: r.price, candleTime: iso(r.m5[r.m5.length - 1].t), newYorkTime: `${String(Math.floor(nyMin(Date.now()) / 60)).padStart(2, "0")}:${String(nyMin(Date.now()) % 60).padStart(2, "0")}`,
    source: "Yahoo futures (can lag a few minutes)",
    trend: { ...r.trends, allAgree: r.agree, how: "up = price above a rising 80 SMA, down = below a falling one, mixed otherwise" },
    m15: { sma80: r.sma15, heikinAshi: r.ha15 }, m5: { sma80: r.sma5, heikinAshi: r.ha5 },
    levels: { saved: r.levels, nearestSupport: r.sup ?? null, distanceToSupportATR15: r.dSup, nearestResistance: r.res ?? null, distanceToResistanceATR15: r.dRes, atr15: r.atr15 && +r.atr15.toPrecision(5) },
    last2h15m: r.m15.slice(-8).map((b) => [hhmm(b.t), b.o, b.h, b.l, b.c]),
    note: "Candles = [time UTC, open, high, low, close]. His entry: at support, the 5m Heikin Ashi turns green + a 5m close back above the level + above the 80 SMA (mirror at resistance).",
  };
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const when = (v, d) => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? t : d; };
const clip = (v, n) => String(v || "").slice(0, n);

async function run(name, args, s, store) {
  const now = s ? s.now : Date.now();
  switch (name) {
    case "edge_today": return {
      now: new Date(now).toISOString(), open: s.open, guard: s.guard, prop: s.prop, closeOut: s.closeOut,
      news: (s.news.events || []).filter((e) => e.time < now + 24 * 3600e3), newsOk: s.news.ok, prices: s.prices,
      broker: s.broker && { kind: s.broker.kind, label: s.broker.label },
    };
    case "edge_journal": {
      const n = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      return { trades: s.journal.slice(0, n), stats: s.stats };
    }
    case "edge_rules": return { strategy: require("../playbook.js").STEPS.map((x) => ({ step: x.title, what: x.text })), settings: pick(s.settings, ["riskUSD", "maxTradesPerDay", "dailyLossR", "minR", "maxR", "sessions"]), markets: s.markets };
    case "edge_scan": return scan(store);
    case "edge_market": return market(store, args.market && ALL_MARKETS.includes(args.market) ? args.market : null);
    case "edge_levels": return { levels: await savedLevels(store), note: "Per market, the support / resistance prices Steve gave you." };
    case "edge_levels_set": {
      if (!ALL_MARKETS.includes(args.market)) throw new Error("Which market?");
      const L = await savedLevels(store), v = (Array.isArray(args.levels) ? args.levels : []).map(num).filter((x) => x != null).slice(0, 12).sort((a, b) => b - a);
      if (v.length) L[args.market] = v; else delete L[args.market];
      await store.set("levels", L);
      return { saved: { market: args.market, levels: v } };
    }
    case "edge_journal_write": {
      const tags = (Array.isArray(args.tags) ? args.tags : []).map((t) => clip(t, 60)).slice(0, 10), stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
      const line = args.notes ? `[David ${stamp}] ${clip(args.notes, 1500)}` : "";
      if (args.id) { // add to a trade already in the journal: notes are appended, never replaced
        const j = await store.hget("journal", String(args.id));
        if (!j) throw new Error("No journal trade with that id — check edge_journal.");
        const exit = num(args.exit) ?? j.exit, R = num(args.resultR) ?? (exit != null && j.initialSL != null && j.entry != null ? Math.round(((j.dir === "short" ? -1 : 1) * (exit - j.entry) / Math.abs(j.entry - j.initialSL)) * 100) / 100 : j.resultR);
        const upd = { ...j, exit, resultR: R ?? null, note: [j.note, line].filter(Boolean).join("\n"), tags: [...new Set([...(j.tags || []), ...tags])], emotion: args.emotion || j.emotion, followedRules: args.followedRules ?? j.followedRules, byDavid: true };
        await store.hset("journal", upd.id, upd);
        return { updated: pick(upd, ["id", "market", "dir", "entry", "exit", "resultR", "note", "tags", "emotion", "followedRules"]) };
      }
      if (!ALL_MARKETS.includes(args.market) || !["long", "short"].includes(args.dir) || num(args.entry) == null || num(args.stop) == null) throw new Error("A new trade needs market, dir, entry and stop.");
      const entry = num(args.entry), stop = num(args.stop), exit = num(args.exit), risk = Math.abs(entry - stop);
      if (!risk || (args.dir === "long" ? stop > entry : stop < entry)) throw new Error(args.dir === "long" ? "On a buy the stop goes below the entry." : "On a sell the stop goes above the entry.");
      const R = num(args.resultR) ?? (exit != null ? Math.round(((args.dir === "short" ? -1 : 1) * (exit - entry) / risk) * 100) / 100 : null);
      const id = `david:${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const t = { id, source: "david", byDavid: true, market: args.market, dir: args.dir, entry, initialSL: stop, currentSL: stop, tp: num(args.target), exit, resultR: R,
        openedAt: when(args.openedAt, now), closedAt: exit != null || R != null ? when(args.closedAt, now) : null, emotion: args.emotion || null, followedRules: args.followedRules ?? null,
        grade: args.followedRules === false ? "unplanned" : "A+", ruleBreaks: args.followedRules === false ? ["didn't follow the rules"] : [], tags, note: line, maxR: null };
      await store.hset("journal", id, t);
      return { written: pick(t, ["id", "market", "dir", "entry", "initialSL", "tp", "exit", "resultR", "emotion", "followedRules", "tags", "note"]) };
    }
    case "edge_style": return { notes: await store.lrange("david:style", Math.min(Math.max(Number(args.limit) || 60, 1), 200)) };
    case "edge_style_write": {
      if (!clip(args.note, 1).length) throw new Error("What did you learn?");
      const n = { at: new Date(now).toISOString(), kind: ["strength", "habit", "mistake", "rule", "goal"].includes(args.kind) ? args.kind : "habit", market: ALL_MARKETS.includes(args.market) ? args.market : null, note: clip(args.note, 600) };
      await store.lpush("david:style", n, 300);
      return { saved: n };
    }
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
    if (method === "initialize") return reply(res, id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "edge", version: "1.0.0" }, instructions: "Edge is Steve's trading co-pilot. His strategy: simple support & resistance he draws himself — levels watched on the 15m, entry on the 5m when the Heikin Ashi candle flips his way and the candle closes back on the right side of the level, with the 80 SMA agreeing; Daily / 4H / 1H trend for context. Guide him by voice, give honest feedback, and write what you see in his journal (edge_journal_write) and what you learn about him (edge_style_write). You can never place, change or close a trade." });
    if (method === "ping") return reply(res, id, {});
    if (method === "tools/list") return reply(res, id, { tools: TOOLS });
    if (method === "tools/call") {
      if (!TOOLS.some((t) => t.name === params.name)) return fail(res, id, -32602, "Unknown tool");
      const light = ["edge_market", "edge_scan", "edge_levels", "edge_levels_set", "edge_style", "edge_style_write"].includes(params.name) || (params.name === "edge_journal_write");
      const s = light ? null : await state(store, await brokerFor(store));
      const text = JSON.stringify(await run(params.name, params.arguments || {}, s, store));
      return reply(res, id, { content: [{ type: "text", text: text.length > 60000 ? text.slice(0, 60000) + " …(cut)" : text }] });
    }
    return fail(res, id, -32601, "Method not found");
  } catch (e) {
    return reply(res, id, { content: [{ type: "text", text: "Edge error: " + e.message }], isError: true });
  }
};

module.exports.TOOLS = TOOLS;
