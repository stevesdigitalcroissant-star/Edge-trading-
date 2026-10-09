// The free chart reader: the ENTER signal read off the screen becomes a setup,
// and the price read off the screen drives the same trade manager.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
delete process.env.OANDA_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
global.fetch = async () => { throw new Error("offline"); };

const { memory } = require("../api/_store");
const core = require("../api/_core");
const { zonedTime } = require("../api/_time");
const broker = { kind: "manual", label: "manual" };
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");

test("signal read off the chart → setup → guided trade", async () => {
  const store = memory();
  let now = NY(9);
  await core.action(store, broker, { action: "bias", market: "gold", answers: { dxy: 1, yields: 1, fed: 0 } }, now);

  await assert.rejects(core.action(store, broker, { action: "chartSetup", symbol: "ES1!", dir: "long", entry: 5000, sl: 4990 }, now), /gold, crude/);
  await assert.rejects(core.action(store, broker, { action: "chartSetup", symbol: "MGC1!", dir: "long", entry: 4200, sl: 4210 }, now), /entry and stop/);

  const r = await core.action(store, broker, { action: "chartSetup", symbol: "MGC1!", dir: "long", entry: 4200, sl: 4195 }, now);
  assert.equal(r.grade, "A+");
  assert.equal(r.takeable, true);
  // reading the same signal again doesn't make a second setup
  const again = await core.action(store, broker, { action: "chartSetup", symbol: "MGC1!", dir: "long", entry: 4200, sl: 4195 }, now + 3000);
  assert.equal(again.setupId, r.setupId);
  assert.equal(again.existing, true);

  const { trade } = await core.action(store, broker, { action: "take", setupId: r.setupId, emotion: "calm", entry: 4200.5 }, now);
  assert.equal(trade.grade, "A+");

  // price read off the screen: still early → hold
  now += 60e3;
  let p = await core.action(store, broker, { action: "chartPrice", symbol: "MGC1!", price: 4203 }, now);
  assert.equal(p.trades.length, 1);
  assert.equal(p.trades[0].urgency, "info");
  assert.match(p.trades[0].text, /^Hold/);

  // +2R → move the stop now (and the phone was told)
  now += 60e3;
  p = await core.action(store, broker, { action: "chartPrice", symbol: "MGC1!", price: 4212 }, now);
  assert.equal(p.trades[0].urgency, "act_now");
  assert.match(p.trades[0].text, /break-even/);
  const st = await core.state(store, broker, now);
  assert.ok(st.log.some((l) => /break-even/.test(l.text)));

  await core.action(store, broker, { action: "beDone", tradeId: trade.id }, now);
  p = await core.action(store, broker, { action: "chartPrice", symbol: "MGC1!", price: 4208 }, now + 5000);
  assert.match(p.trades[0].text, /Hands off/);

  // target reached → trade recorded as closed at 3.2R
  p = await core.action(store, broker, { action: "chartPrice", symbol: "MGC1!", price: 4219 }, now + 10000);
  assert.equal(p.closed, 1);
  assert.equal(p.trades.length, 0);
  const done = await core.state(store, broker, now + 11000);
  assert.equal(done.journal[0].resultR, 3.2);
});

test("guide line for a short below its entry", () => {
  const s = { beAtR: 2, tpAtR: 3.2, beOffsetR: 0.05 };
  const t = { dir: "short", entry: 70, initialSL: 70.5, currentSL: 70.5, tp: 68.4, maxR: 0.4 };
  const g = core.guide(t, s, 70.3);
  assert.equal(g.r, -0.6);
  assert.equal(g.urgency, "warn");
  assert.match(g.text, /don't move it/);
});

test("a misread price never touches an open trade", async () => {
  const store = memory();
  const now = NY(9);
  const { trade } = await core.action(store, broker, { action: "manualOpen", market: "gold", dir: "long", entry: 4200, sl: 4195 }, now);
  await assert.rejects(core.action(store, broker, { action: "chartPrice", symbol: "MGC1!", price: 42078 }, now + 1000), /too far/);
  const st = await core.state(store, broker, now + 2000);
  assert.equal(st.open.length, 1);
  assert.equal(st.open[0].id, trade.id);
});
