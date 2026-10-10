// The tested strategies: London breakout (gold · crude · silver) and natural gas zones.
// Plan alert → setup alert → graded by the strategy's own checklist → taken with its own exits.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
delete process.env.OANDA_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
global.fetch = async () => { throw new Error("offline"); };

const { memory } = require("../api/_store");
const core = require("../api/_core");
const R = require("../api/_rules");
const { marketOf, futuresSpec, DEFAULT_SETTINGS } = require("../api/_config");
const { zonedTime } = require("../api/_time");
const broker = { kind: "manual", label: "manual" };
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York"); // a Tuesday
const S = (o = {}) => ({ ...DEFAULT_SETTINGS, ...o });

test("silver and the S&P 500 are markets, with their futures", () => {
  assert.equal(marketOf("COMEX:SIL1!"), "silver");
  assert.equal(marketOf("SI1!"), "silver");
  assert.equal(marketOf("XAGUSD"), "silver");
  assert.equal(marketOf("CME_MINI:MES1!"), "es");
  assert.equal(marketOf("MGC1!"), "gold");
  assert.equal(futuresSpec("SIL1!").pv, 1000);
  assert.equal(futuresSpec("MESZ2026").pv, 5);
});

test("London plan: both stop orders, sized for your risk", async () => {
  const store = memory();
  const r = await core.handleHook(store, broker, { secret: "s3cret", type: "plan", strategy: "london", symbol: "MCL1!", rangeHi: 71.2, rangeLo: 70.6, validMin: 300,
    legs: [{ dir: "long", entry: 71.2, sl: 70.6 }, { dir: "short", entry: 70.6, sl: 71.2 }] }, NY(3));
  assert.equal(r.json.legs, 2);
  const st = await core.state(store, broker, NY(3, 5));
  const p = st.plans[0];
  assert.equal(p.market, "crude");
  assert.equal(p.tpR, 3);
  assert.equal(p.legs[0].tp, 73);       // 71.2 + 3 × 0.6
  assert.equal(p.legs[0].be, null);     // no break-even in the plan
  assert.equal(p.legs[0].size.contract, "MCL");
  assert.equal(p.legs[0].size.qty, 1);  // $100 risk / $60 a contract
  assert.ok(st.log.some((l) => /CANCEL the other/.test(l.text)));
  // gone after the window
  const later = await core.state(store, broker, NY(9));
  assert.equal(later.plans.length, 0);
});

test("London breakout setup: own checklist, own exits, no break-even", async () => {
  const store = memory();
  let now = NY(4);
  const alert = { secret: "s3cret", type: "setup", strategy: "london", symbol: "MCL1!", dir: "long", entry: 71.2, sl: 70.6, tp: 99, rangeHi: 71.2, rangeLo: 70.6, rangeAtr: 1.4, trend: -1, stopOk: true };
  const r = await core.handleHook(store, broker, alert, now);
  assert.equal(r.json.grade, "A+"); // trend only matters for gold
  let st = await core.state(store, broker, now);
  const x = st.setups[0];
  assert.equal(x.tp, 73); // from the tested plan, not the alert's 99
  assert.deepEqual(x.xp, { tpR: 3, beR: 0 });
  assert.match(x.story.headline, /London broke the Asian range high/);

  // the alert means the stop order filled: Edge recorded the trade and asks you to check it
  assert.equal(x.status, "taken");
  assert.ok(r.json.autoTrade);
  let trade = st.open[0];
  assert.equal(trade.pending, true);
  assert.equal(trade.strategy, "london");
  assert.equal(trade.tpR, 3);
  assert.equal(trade.tp, 73);
  assert.equal(trade.units, 1); // default $100 risk / $60 a contract
  assert.ok(st.log.some((l) => /should have filled at 71\.200/.test(l.text)));
  // you fix the contracts (you used 4) and say how you feel
  ({ trade } = await core.action(store, broker, { action: "confirmTrade", tradeId: trade.id, units: 4, emotion: "calm" }, now));
  assert.equal(trade.pending, false);
  assert.equal(trade.riskUSD, 240);
  await assert.rejects(core.action(store, broker, { action: "confirmTrade", tradeId: trade.id, sl: 72 }, now), /stop must be below/);

  // +1R → no break-even any more: the stop stays where it is
  now += 10 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MCL1!", price: 71.75, high: 71.82, low: 71.5, bos15: "down" }, now);
  st = await core.state(store, broker, now);
  assert.ok(!st.log.some((l) => /R reached/.test(l.text)));
  // supply & demand's 15m structure exit doesn't apply to the tested strategies
  assert.ok(!st.log.some((l) => /structure just broke/.test(l.text)));
  // target at 3R closes it
  now += 60 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MCL1!", price: 73.01, high: 73.05, low: 72.6 }, now);
  st = await core.state(store, broker, now);
  assert.equal(st.journal[0].resultR, 3);
  assert.equal(st.journal[0].exitReason.split(" ")[0], "target");
});

test("gold London setup against the 1-hour trend is an A (still takeable); outside the window it's blocked", () => {
  const ctx = { settings: S(), bias: {}, now: NY(5), news: null };
  const base = { strategy: "london", market: "gold", dir: "long", entry: 2410, sl: 2400, rangeHi: 2410, rangeLo: 2400, status: "open" };
  assert.equal(R.gradeSetup({ ...base, trend: 1 }, ctx).grade, "A+");
  assert.equal(R.gradeSetup({ ...base, trend: -1 }, ctx).grade, "A");
  const late = R.gradeSetup({ ...base, trend: 1 }, { ...ctx, now: NY(9) });
  assert.equal(late.grade, "B");
  assert.ok(late.checks.find((c) => c.id === "window" && !c.pass));
  // silver needs a big enough Asian range
  const sv = R.gradeSetup({ ...base, market: "silver", rangeAtr: 1.1 }, ctx);
  assert.ok(sv.checks.find((c) => c.id === "rangesize" && !c.pass));
});

test("natural gas zone: too young or touched too often is not the setup", () => {
  const ctx = { settings: S(), bias: {}, now: NY(7), news: null };
  const z = { strategy: "ngzone", market: "natgas", dir: "long", entry: 3.1, sl: 3.05, zoneTop: 3.1, zoneBot: 3.06, zoneAgeDays: 9, touch: 1 };
  assert.equal(R.gradeSetup(z, ctx).grade, "A+");
  assert.equal(R.gradeSetup({ ...z, zoneAgeDays: 2 }, ctx).grade, "B");
  assert.equal(R.gradeSetup({ ...z, touch: 3 }, ctx).grade, "B");
  assert.equal(R.gradeSetup(z, { ...ctx, now: NY(10) }).grade, "B"); // between the two windows
  assert.equal(R.gradeSetup(z, { ...ctx, now: NY(11, 30) }).grade, "A+");
  assert.deepEqual(R.exits(z, S()), { tpR: 3.2, beR: 0 }); // a raw setup without its plan attached → your settings (no break-even)
  assert.deepEqual(R.exits({ ...z, tpR: 3, beR: 2 }, S()), { tpR: 3, beR: 2 });
  assert.deepEqual(R.exits({ tpR: 2, beR: 0 }, S()), { tpR: 2, beR: 0 }); // 0 = never move to break-even
});

test("planned strategy orders skip the loss cool-down; gas zones don't use up the daily count; gold and silver never together", () => {
  const s = S();
  const now = NY(5);
  const loss = { market: "gold", resultR: -1, closedAt: now - 10 * 60e3, openedAt: now - 60 * 60e3 };
  const two = [loss, { market: "crude", resultR: 1, closedAt: now - 5 * 60e3, openedAt: now - 50 * 60e3 }];
  const guard = R.guardrails({ settings: s, journal: two, open: [], now, cooldownUntil: 0 });
  assert.deepEqual(guard.codes.sort(), ["count", "lossCool"]);
  const graded = { grade: "A+", blocks: [] };
  const london = { strategy: "london", market: "silver" };
  const ng = { strategy: "ngzone", market: "natgas" };
  const sd = { market: "crude" };
  const take = (setup, open = []) => R.canTake({ graded, setup, guard, history: [], settings: s, open });
  assert.equal(take(sd).ok, false);
  assert.deepEqual(take(london).why, ["You've taken your 2 trades today. Done until tomorrow."]);
  assert.equal(take(ng).ok, true);
  const g1 = R.guardrails({ settings: s, journal: [], open: [], now, cooldownUntil: 0 });
  const silverWhileGold = R.canTake({ graded, setup: london, guard: g1, history: [], settings: s, open: [{ market: "gold" }] });
  assert.match(silverWhileGold.why.join(" "), /Gold and silver move together/);
});

test("contracts from the dollars you type", () => {
  const s = S({ accountSize: 50000, riskPct: 0.5 });
  const setup = { symbol: "MGC1!", entry: 2410, sl: 2400, market: "gold" };
  assert.equal(R.orderSize(setup, s).qty, 2);          // $250 / $100 a contract
  assert.equal(R.orderSize(setup, s, 2410, 640).qty, 6); // $640 → 6 (never above)
});

test("replayed trades go to the practice journal with the strategy's own result", async () => {
  const store = memory();
  const now = NY(12);
  await core.action(store, broker, { action: "backtestLog", strategy: "london", market: "crude", dir: "long", outcome: "tp", date: "2025-03-04" }, now);
  await core.action(store, broker, { action: "backtestLog", strategy: "ngzone", market: "natgas", dir: "short", outcome: "flat", r: "0.6", rulesOk: false }, now);
  await assert.rejects(core.action(store, broker, { action: "backtestLog", strategy: "london", market: "natgas", outcome: "tp" }, now), /Pick a strategy/);
  await assert.rejects(core.action(store, broker, { action: "backtestLog", strategy: "london", market: "gold", outcome: "flat" }, now), /close-out/);
  const st = await core.state(store, broker, now);
  assert.equal(st.journal.length, 0); // never counts as real trading
  const crude = st.practice.find((t) => t.market === "crude");
  assert.equal(crude.resultR, 3);
  assert.equal(crude.grade, "A+");
  const gas = st.practice.find((t) => t.market === "natgas");
  assert.equal(gas.resultR, 0.6);
  assert.equal(gas.grade, "unplanned");
});

test("an auto-recorded trade you didn't take can be removed", async () => {
  const store = memory();
  const now = NY(4);
  const r = await core.handleHook(store, broker, { secret: "s3cret", type: "setup", strategy: "london", symbol: "MGC1!", dir: "short", entry: 2400, sl: 2410, rangeHi: 2410, rangeLo: 2400, trend: -1, stopOk: true }, now);
  await core.action(store, broker, { action: "dismissTrade", tradeId: r.json.autoTrade }, now);
  const st = await core.state(store, broker, now);
  assert.equal(st.open.length, 0);
  assert.equal(st.journal.length, 0);
  assert.equal(st.setups[0].status, "skipped");
});

test("your style (from the Style lab) changes the stop, target and break-even of London orders", async () => {
  const store = memory();
  const now = NY(3);
  await core.action(store, broker, { action: "settings", patch: { style: { crude: { stopFrac: 0.5, tpR: 4, beR: 1.5 } } } }, now);
  await assert.rejects(core.action(store, broker, { action: "settings", patch: { style: { gold: { stopFrac: 0.1, tpR: 2, beR: 1 } } } }, now), /Style/);
  await core.handleHook(store, broker, { secret: "s3cret", type: "plan", strategy: "london", symbol: "MCL1!", rangeHi: 71.2, rangeLo: 70.6, legs: [{ dir: "long", entry: 71.2, sl: 70.6 }] }, now);
  let st = await core.state(store, broker, now);
  assert.equal(R.round(st.plans[0].legs[0].sl, 2), 70.9);  // half the box
  assert.equal(R.round(st.plans[0].legs[0].tp, 2), 72.4);  // 4R of 0.3
  assert.match(st.plans[0].name, /your style/);
  const r = await core.handleHook(store, broker, { secret: "s3cret", type: "setup", strategy: "london", symbol: "MCL1!", dir: "long", entry: 71.2, sl: 70.6, rangeHi: 71.2, rangeLo: 70.6, stopOk: true }, NY(4));
  assert.equal(r.json.grade, "A+");
  st = await core.state(store, broker, NY(4));
  assert.equal(st.setups[0].sl, 70.9);
  assert.deepEqual(st.setups[0].xp, { tpR: 4, beR: 1.5 });
  // back to the tested plan
  await core.action(store, broker, { action: "settings", patch: { style: { crude: null } } }, now);
  assert.equal((await core.state(store, broker, now)).settings.style.crude, undefined);
});
