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
  assert.equal(R.round(p.legs[0].be, 2), 71.8);       // +1R
  assert.equal(p.legs[0].size.contract, "MCL");
  assert.equal(p.legs[0].size.qty, 1);  // $100 risk / $60 a contract
  assert.ok(st.log.some((l) => /CANCEL the other/.test(l.text)));
  // gone after the window
  const later = await core.state(store, broker, NY(9));
  assert.equal(later.plans.length, 0);
});

test("London breakout setup: own checklist, own exits, break-even at +1R for crude", async () => {
  const store = memory();
  let now = NY(4);
  const alert = { secret: "s3cret", type: "setup", strategy: "london", symbol: "MCL1!", dir: "long", entry: 71.2, sl: 70.6, tp: 99, rangeHi: 71.2, rangeLo: 70.6, rangeAtr: 1.4, trend: -1, stopOk: true };
  const r = await core.handleHook(store, broker, alert, now);
  assert.equal(r.json.grade, "A+"); // trend only matters for gold
  let st = await core.state(store, broker, now);
  const x = st.setups[0];
  assert.equal(x.tp, 73); // from the tested plan, not the alert's 99
  assert.deepEqual(x.xp, { tpR: 3, beR: 1 });
  assert.match(x.story.headline, /London broke the Asian range high/);

  const { trade } = await core.action(store, broker, { action: "take", setupId: x.id, emotion: "calm", riskUSD: 250 }, now);
  assert.equal(trade.strategy, "london");
  assert.equal(trade.tpR, 3);
  assert.equal(trade.units, 4); // $250 / $60 a contract → 4 contracts
  assert.equal(trade.tp, 73);

  // +1R → move the stop to break-even (not the settings' 2R)
  now += 10 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MCL1!", price: 71.75, high: 71.82, low: 71.5, bos15: "down" }, now);
  st = await core.state(store, broker, now);
  assert.ok(st.log.some((l) => /\+1R reached/.test(l.text)));
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
  assert.deepEqual(R.exits(z, S()), { tpR: 3.2, beR: 2 }); // a raw setup without its plan attached → your settings
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
