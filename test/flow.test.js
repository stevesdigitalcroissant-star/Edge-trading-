// End to end in manual mode: alert → grade → take → heartbeat → break-even → target.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
process.env.EDGE_PASSWORD = "pw";
delete process.env.OANDA_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
global.fetch = async () => { throw new Error("offline"); }; // calendar feed unavailable → built-in schedule only

const { memory } = require("../api/_store");
const core = require("../api/_core");
const { zonedTime } = require("../api/_time");
const broker = { kind: "manual", label: "manual" };
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York"); // Tue — no weekly report in the gold window

test("full A+ trade, managed by the rules", async () => {
  const store = memory();
  await store.set("settings", { beAtR: 2, beV2: true }); // break-even is off by default now; these tests check it still works when you turn it on
  let now = NY(9);
  await core.action(store, broker, { action: "bias", market: "gold", answers: { dxy: 1, yields: 1, fed: 0 } }, now);

  const bad = await core.handleHook(store, broker, { secret: "nope", type: "setup" }, now);
  assert.equal(bad.status, 401);

  const alert = { secret: "s3cret", type: "setup", symbol: "XAUUSD", tv: "OANDA:XAUUSD", dir: "long", entry: 2400, sl: 2390, tp: 2432, trend4h: 1, zoneFresh: true, bos15: true, close5: true, stopOk: true, roomR: 4 };
  const r = await core.handleHook(store, broker, JSON.stringify(alert), now);
  assert.equal(r.json.grade, "A+");
  assert.equal(r.json.takeable, true);

  let st = await core.state(store, broker, now);
  const setupId = st.setups[0].id;
  assert.equal(st.setups[0].g.take.ok, true);

  // emotions block the trade and start a break
  await assert.rejects(core.action(store, broker, { action: "take", setupId, emotion: "fomo" }, now), /FOMO/);
  await assert.rejects(core.action(store, broker, { action: "take", setupId, emotion: "calm" }, now + 60e3), /Walk away|weren't calm/);

  // 15 min later the setup itself has expired — no late entries
  now += 16 * 60e3;
  await assert.rejects(core.action(store, broker, { action: "take", setupId, emotion: "calm" }, now), /expired/);

  // a new alert, taken calmly
  await core.handleHook(store, broker, alert, now);
  st = await core.state(store, broker, now);
  const fresh = st.setups.find((x) => x.status === "open" && x.g.take.ok);
  const { trade } = await core.action(store, broker, { action: "take", setupId: fresh.id, emotion: "calm" }, now);
  assert.equal(trade.tp, 2432);
  assert.equal(Math.round(trade.units), 10); // $100 risk / $10 stop

  // a second gold setup is refused while the first is open
  await core.handleHook(store, broker, alert, now);
  st = await core.state(store, broker, now);
  assert.equal(st.setups[0].g.take.ok, false);

  // heartbeat: price reaches +2R → you're told to move the stop
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "XAUUSD", price: 2415, high: 2420.5, low: 2412 }, now);
  st = await core.state(store, broker, now);
  assert.equal(st.open[0].maxR, 2.05);
  assert.ok(st.log.some((l) => /break-even/.test(l.text)));
  await core.action(store, broker, { action: "beDone", tradeId: trade.id }, now);

  // dips back, stop is at break-even so it survives… then hits 3.2R
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "XAUUSD", price: 2410, high: 2416, low: 2401 }, now);
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "XAUUSD", price: 2431, high: 2433, low: 2420 }, now);
  st = await core.state(store, broker, now);
  assert.equal(st.open.length, 0);
  assert.equal(st.journal[0].resultR, 3.2);
  assert.equal(st.journal[0].exitReason.startsWith("target"), true);
  assert.equal(st.stats.aPlus.totalR, 3.2);
});

test("a trade that comes back after break-even closes flat, not as a loss", async () => {
  const store = memory();
  const now = NY(9);
  const { trade } = await core.action(store, broker, { action: "manualOpen", market: "crude", dir: "short", entry: 70, sl: 70.5 }, now);
  assert.equal(trade.grade, "unplanned");
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "WTICOUSD", price: 69.2, high: 69.5, low: 68.95 }, now + 1);
  await core.action(store, broker, { action: "beDone", tradeId: trade.id }, now + 2);
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "WTICOUSD", price: 70.1, high: 70.2, low: 69.3 }, now + 3);
  const st = await core.state(store, broker, now + 4);
  assert.equal(st.journal[0].resultR, 0.05);
  assert.match(st.journal[0].exitReason, /break-even/);
  assert.equal(st.stats.unplanned.n, 1);
});

test("S&D scanner alert (1H zone · 5m shift) → graded, taken as a limit", async () => {
  const store = memory();
  const now = NY(9, 35);
  const alert = { secret: "s3cret", type: "setup", strategy: "sd", symbol: "M6E1!", tv: "CME:M6E1!", dir: "long", entry: 1.0852, sl: 1.0840, tp: 1.0876, rr: 2, kind: "FVG", zoneTop: 1.0850, zoneBot: 1.0838, mss: 1.0849, liq: 1.0862, liqR: 0.83, validMin: 240 };
  const r = await core.handleHook(store, broker, JSON.stringify(alert), now);
  assert.equal(r.json.grade, "S&D");
  assert.equal(r.json.takeable, true);
  const st = await core.state(store, broker, now);
  const x = st.setups[0];
  assert.equal(x.market, "6e");
  assert.equal(x.strategy, "sd");
  assert.equal(x.expires, now + 240 * 60e3);
  const out = await core.action(store, broker, { action: "take", setupId: x.id, emotion: "calm", riskUSD: 425 }, now);
  assert.equal(out.order.trade.strategy, "sd");
  assert.equal(out.order.trade.lockR, null);
  assert.equal(out.order.trade.contract, "M6E");
  assert.equal(out.order.trade.units, 13); // $15 a contract → 13 = $195, closest to the $190 aim under the $210 max
  // outside 02:00–11:30 New York it is graded C and not takeable
  const late = await core.handleHook(store, broker, JSON.stringify(alert), NY(13));
  assert.equal(late.json.takeable, false);
});

test("S&D setup: your own limit, stop, target and contracts", async () => {
  const store = memory();
  const now = NY(9, 35);
  const alert = { secret: "s3cret", type: "setup", strategy: "sd", symbol: "MGC1!", tv: "COMEX:MGC1!", dir: "long", entry: 2651.4, sl: 2647.2, tp: 2664, rr: 3, kind: "FVG", zoneTop: 2652.8, zoneBot: 2645.9, mss: 2650.1, validMin: 240 };
  await core.handleHook(store, broker, JSON.stringify(alert), now);
  const x = (await core.state(store, broker, now)).setups[0];
  await assert.rejects(core.action(store, broker, { action: "take", setupId: x.id, emotion: "calm", sl: 2655 }, now), /stop goes below/);
  const out = await core.action(store, broker, { action: "take", setupId: x.id, emotion: "calm", entry: 2651, sl: 2647, tp: 2661, qty: 8 }, now);
  const t = out.order.trade;
  assert.deepEqual([t.entry, t.initialSL, t.tp, t.units], [2651, 2647, 2661, 8]);
  assert.equal(t.riskUSD, 320);
});

test("S&D alert from a crude chart is ignored", async () => {
  const store = memory();
  const now = NY(9, 35);
  const r = await core.handleHook(store, broker, JSON.stringify({ secret: "s3cret", type: "setup", strategy: "sd", symbol: "MCL1!", tv: "NYMEX:MCL1!", dir: "long", entry: 60, sl: 59.8, tp: 60.6, rr: 3, validMin: 240 }), now);
  assert.equal(r.json.ignored, true);
  assert.equal((await core.state(store, broker, now)).setups.length, 0);
});
