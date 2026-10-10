const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../api/_rules");
const { mergeSettings, marketOf, biasFromFactors } = require("../api/_config");
const { zonedTime, dayKey } = require("../api/_time");
const { classify, recurringForWeek, blockingEvent } = require("../api/_news");

const s = mergeSettings({});
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York"); // Tuesday

test("TradingView symbols map to markets", () => {
  assert.equal(marketOf("OANDA:XAUUSD"), "gold");
  assert.equal(marketOf("COMEX:GC1!"), "gold");
  assert.equal(marketOf("OANDA:NATGASUSD"), "natgas");
  assert.equal(marketOf("NYMEX:NG1!"), "natgas");
  assert.equal(marketOf("OANDA:WTICOUSD"), "crude");
  assert.equal(marketOf("NYMEX:CL1!"), "crude");
  assert.equal(marketOf("TVC:USOIL"), "crude");
  assert.equal(marketOf("OANDA:EURUSD"), null);
});

test("time zones: 10:30 New York is 14:30 UTC in October", () => {
  assert.equal(new Date(NY(10, 30)).toISOString(), "2026-10-06T14:30:00.000Z");
  assert.equal(dayKey(NY(23, 59), "America/New_York"), "2026-10-06");
});

const setup = (o = {}) => ({ market: "gold", dir: "long", entry: 2400, sl: 2390, trend4h: 1, zoneFresh: true, bos15: true, close5: true, stopOk: true, roomR: 5, ...o });
const bias = { gold: { dir: "long", updated: NY(9) - 864e5 } };

test("all boxes ticked → A+", () => {
  const g = R.gradeSetup(setup(), { settings: s, bias, news: null, now: NY(9) });
  assert.equal(g.grade, "A+");
  assert.equal(g.blocks.length, 0);
});

test("each missing box drops a grade", () => {
  assert.equal(R.gradeSetup(setup({ zoneFresh: false }), { settings: s, bias, now: NY(9) }).grade, "A");
  assert.equal(R.gradeSetup(setup({ zoneFresh: false, roomR: 2 }), { settings: s, bias, now: NY(9) }).grade, "B");
  assert.equal(R.gradeSetup(setup({ trend4h: -1, zoneFresh: false, roomR: 2 }), { settings: s, bias, now: NY(9) }).grade, "C");
  // fundamentals against the trade, and outside gold's 03:00–12:00 window
  assert.equal(R.gradeSetup(setup(), { settings: s, bias: { gold: { dir: "short", updated: NY(9) } }, now: NY(9) }).grade, "A");
  assert.equal(R.gradeSetup(setup(), { settings: s, bias, now: NY(15) }).grade, "A");
  // stale bias doesn't count
  assert.equal(R.gradeSetup(setup(), { settings: s, bias: { gold: { dir: "long", updated: NY(9) - 9 * 864e5 } }, now: NY(9) }).grade, "A");
});

test("news blocks an A+ setup", () => {
  const ev = { title: "CPI", time: NY(8, 30), block: true, markets: ["gold"] };
  const g = R.gradeSetup(setup(), { settings: s, bias, news: blockingEvent([ev], "gold", NY(8, 10), s), now: NY(8, 10) });
  assert.equal(g.grade, "A+");
  assert.equal(g.blocks[0].id, "news");
  assert.equal(blockingEvent([ev], "gold", NY(9, 5), s), null);
});

test("A setups can always be taken (no A+ quota); B and C can't", () => {
  const graded = { grade: "A", blocks: [] };
  const guard = { ok: true, reasons: [] };
  const hist = (nonA) => Array.from({ length: 19 }, (_, i) => ({ grade: i < nonA ? "A" : "A+", openedAt: 1000 - i }));
  assert.equal(R.canTake({ graded, setup: setup(), guard, history: hist(0), settings: s, open: [] }).ok, true);
  assert.equal(R.canTake({ graded, setup: setup(), guard, history: hist(19), settings: s, open: [] }).ok, true);
  assert.equal(R.canTake({ graded: { grade: "B", blocks: [] }, setup: setup(), guard, history: [], settings: s, open: [] }).ok, false);
});

test("guardrails: trades per day, daily loss, cool-down", () => {
  const now = NY(11);
  const t = (o) => ({ openedAt: NY(4), closedAt: NY(5), resultR: 1, ...o });
  assert.equal(R.guardrails({ settings: s, journal: [], open: [], now }).ok, true);
  assert.equal(R.guardrails({ settings: s, journal: [t(), t()], open: [], now }).ok, false);
  const loss = R.guardrails({ settings: s, journal: [t({ resultR: -1, closedAt: NY(10, 30) })], open: [], now });
  assert.equal(loss.ok, false);
  assert.match(loss.reasons[0], /Cool-down/);
  assert.equal(R.guardrails({ settings: s, journal: [t({ resultR: -1, closedAt: NY(9) })], open: [], now }).ok, true);
  assert.equal(R.guardrails({ settings: { ...s, maxTradesPerDay: 9 }, journal: [t({ resultR: -1 }), t({ resultR: -1.05 })], open: [], now }).ok, false);
});

test("trade management: break-even at 2R, TP at 3.2R, greed checks", () => {
  const tr = { dir: "long", entry: 100, initialSL: 99, currentSL: 99, tp: 103.2 };
  assert.deepEqual(R.evaluateTrade(tr, { price: 101.5 }, s).actions, []);
  const at2 = R.evaluateTrade(tr, { price: 101.4, high: 102.05 }, s);
  assert.equal(at2.maxR, 2.05);
  assert.equal(at2.actions[0].type, "moveSL");
  assert.equal(at2.actions[0].price, 100.05);
  // already at break-even → nothing more to do
  assert.deepEqual(R.evaluateTrade({ ...tr, currentSL: 100.05 }, { price: 102.5 }, s).actions, []);
  // TP pushed further away → back to 3.2R
  const greedy = R.evaluateTrade({ ...tr, tp: 105 }, { price: 100.5 }, s);
  assert.equal(greedy.actions[0].type, "setTP");
  assert.equal(greedy.actions[0].price, 103.2);
  // stop widened → rule break
  assert.ok(R.evaluateTrade({ ...tr, currentSL: 98 }, { price: 100 }, s).actions.some((a) => a.code === "widened"));
  // shorts mirror
  const sh = R.evaluateTrade({ dir: "short", entry: 100, initialSL: 101, currentSL: 101, tp: 96.8 }, { price: 98.6, low: 97.9 }, s);
  assert.equal(sh.maxR, 2.1);
  assert.equal(sh.actions[0].price, 99.95);
});

test("exit reasons", () => {
  const tr = { dir: "long", entry: 100, initialSL: 99, beMoved: true };
  assert.equal(R.exitReason(tr, 103.2, s), "target");
  assert.equal(R.exitReason(tr, 100.05, s), "break-even");
  assert.equal(R.exitReason(tr, 99, s), "stop");
  assert.equal(R.exitReason(tr, 101.5, s), "closed early (profit)");
});

test("bias score", () => {
  assert.equal(biasFromFactors({ a: 1, b: 1, c: 0 }).dir, "long");
  assert.equal(biasFromFactors({ a: -1, b: -1, c: 1, d: -1 }).dir, "short");
  assert.equal(biasFromFactors({ a: 1, b: -1 }).dir, "neutral");
});

test("news relevance and the built-in weekly energy reports", () => {
  assert.deepEqual(classify({ title: "CPI m/m", country: "USD", impact: "High" }).markets.sort(), ["crude", "es", "gold", "natgas", "silver"]);
  assert.deepEqual(classify({ title: "Natural Gas Storage", country: "USD", impact: "Low" }), { markets: ["natgas"], block: true });
  assert.deepEqual(classify({ title: "German ZEW", country: "EUR", impact: "High" }).markets, []);
  const rec = recurringForWeek(NY(9), []);
  const ng = rec.find((e) => /natural gas/i.test(e.title));
  assert.equal(new Date(ng.time).toISOString(), "2026-10-08T14:30:00.000Z"); // Thursday 10:30 NY
  // the feed's own listing (e.g. moved for a holiday) replaces the built-in one
  const feed = [{ title: "Natural Gas Storage", time: zonedTime(2026, 10, 9, 10, 30, "America/New_York") }];
  assert.ok(!recurringForWeek(NY(9), feed).some((e) => /natural gas/i.test(e.title)));
});

test("futures: sized in whole contracts, never above the risk limit", () => {
  const s2 = mergeSettings({ accountSize: 50000, riskPct: 0.5 }); // $250 risk
  const mgc = R.orderSize({ symbol: "MGC1!", entry: 2400, sl: 2392 }, s2); // $8 × $10 = $80 per contract
  assert.deepEqual([mgc.qty, mgc.riskPerContract, mgc.totalRisk, mgc.stopTicks], [3, 80, 240, 80]);
  const gc = R.orderSize({ symbol: "COMEX:GC1!", entry: 2400, sl: 2392 }, s2); // $800 per contract
  assert.equal(gc.qty, 0);
  const mcl = R.orderSize({ symbol: "MCLX2026", entry: 70, sl: 70.4 }, s2); // 0.40 × $100 = $40
  assert.equal(mcl.qty, 6);
  const qg = R.orderSize({ symbol: "NYMEX:QG1!", entry: 3.5, sl: 3.55 }, s2); // 0.05 × $2500 = $125
  assert.equal(qg.qty, 2);
  assert.equal(R.orderSize({ symbol: "OANDA:XAUUSD", entry: 2400, sl: 2390 }, s2).kind, "cfd");
});

test("the setup is explained in plain words, step by step per timeframe", () => {
  const { story } = require("../api/_story");
  const st = story({ market: "gold", dir: "long", entry: 2652.4, sl: 2644.4, zoneTop: 2648, zoneBot: 2641.5, lvl4h: 2671.2, lvl15: 2650.1, lvl5: 2651.8, opp: 2690, roomR: 4.7 }, s);
  assert.deepEqual(st.steps.map((x) => x.tf), ["4H", "4H", "15m", "5m"]);
  assert.match(st.steps[0].text, /closed above 2671\.20/);
  assert.match(st.steps[1].text, /demand zone \(2641\.50 – 2648\.00\)/);
  assert.match(st.plan.text, /At 2668\.40 \(\+2R\) move the stop to break-even\. Target 2678\.00/);
  const sh = story({ market: "natgas", dir: "short", entry: 3.412, sl: 3.448, lvl15: 3.418 }, s);
  assert.match(sh.headline, /SELL — downtrend, fresh 4H supply/);
  assert.match(sh.steps[2].text, /closed below 3\.418: sellers took control/);
});

test("zone visits: a later visit is A+ once liquidity was taken; no sweep on the first visit is A", () => {
  const g = (o) => R.gradeSetup(setup(o), { settings: s, bias, now: NY(9) }).grade;
  assert.equal(g({ zoneFresh: false, sweep: true }), "A+");
  assert.equal(g({ zoneFresh: true, sweep: false }), "A");
  assert.equal(g({ zoneFresh: false, sweep: false }), "B");
});
