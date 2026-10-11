// Plan a trade (Today): your playbook ticked, 3R–10R, sized for your $ risk → a limit that fills from the
// chart heartbeat, then locks in +1R at +3R.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
delete process.env.OANDA_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
global.fetch = async () => { throw new Error("offline"); };

const { memory } = require("../api/_store");
const core = require("../api/_core");
const PB = require("../playbook.js");
const { zonedTime } = require("../api/_time");
const broker = { kind: "manual", label: "manual" };
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");

test("planned trade: rules enforced, limit fills, profit locked at +3R", async () => {
  const store = memory();
  let now = NY(9);
  const base = { action: "planTrade", market: "gold", dir: "long", entry: 2400, sl: 2395, tp: 2420, riskUSD: 250, emotion: "calm", checks: PB.required };
  await assert.rejects(core.action(store, broker, { ...base, tp: 2410 }, now), /never under 3R/);
  await assert.rejects(core.action(store, broker, { ...base, tp: 2460 }, now), /maximum/);
  await assert.rejects(core.action(store, broker, { ...base, checks: ["htf"] }, now), /Not ticked yet/);
  const r = await core.action(store, broker, base, now);
  assert.equal(r.order.trade.units, 5); // $250 / ($5 × $10 per MGC point)
  let st = await core.state(store, broker, now);
  assert.equal(st.orders.length, 1);
  assert.equal(st.open.length, 0);

  // price trades down into the limit → it's a trade now
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2401, high: 2403, low: 2399.5 }, now);
  st = await core.state(store, broker, now);
  assert.equal(st.orders.length, 0);
  assert.equal(st.open.length, 1);
  assert.ok(st.log.some((l) => /limit filled/.test(l.text)));

  // +3R → lock in +1R
  now += 10 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2414, high: 2415.5, low: 2412 }, now);
  st = await core.state(store, broker, now);
  assert.ok(st.log.some((l) => /lock in \+1R/.test(l.text) && /2405/.test(l.text)));
  await core.action(store, broker, { action: "beDone", tradeId: st.open[0].id }, now);
  st = await core.state(store, broker, now);
  assert.equal(st.open[0].currentSL, 2405);
});

test("a limit that never fills is cancelled when price runs to the target", async () => {
  const store = memory();
  let now = NY(9);
  await core.action(store, broker, { action: "planTrade", market: "gold", dir: "short", entry: 2400, sl: 2405, tp: 2385, riskUSD: 250, checks: PB.required }, now);
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2386, high: 2398, low: 2384 }, now);
  const st = await core.state(store, broker, now);
  assert.equal(st.orders.length, 0);
  assert.equal(st.open.length, 0);
  assert.ok(st.log.some((l) => /without filling/.test(l.text)));
});
