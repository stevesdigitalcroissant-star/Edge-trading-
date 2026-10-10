// Semi-auto mode with a fake broker: Edge places the order, then moves the stop itself.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
global.fetch = async () => { throw new Error("offline"); };

const { memory } = require("../api/_store");
const core = require("../api/_core");
const { zonedTime } = require("../api/_time");
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");

function fakeBroker() {
  const b = {
    kind: "oanda", label: "fake", px: { XAU_USD: { bid: 2400, ask: 2400.3 } }, trades: {}, closed: {}, calls: [], n: 0,
    async account() { return { balance: 20000, currency: "USD" }; },
    async toUSD(x) { return x; },
    async prices() { return b.px; },
    async openTrades() { return Object.values(b.trades); },
    async trade(id) { return b.closed[id] || { ...b.trades[id], state: "OPEN" }; },
    async marketOrder(o) {
      b.calls.push(["order", o]);
      const id = String(++b.n);
      const price = b.px[o.instrument].ask;
      b.trades[id] = { brokerId: id, instrument: o.instrument, dir: o.dir, units: Math.floor(o.units), entry: price, currentSL: o.sl, tp: o.tp, openedAt: NY(9) };
      return { brokerId: id, price, units: Math.floor(o.units) };
    },
    async setOrders(id, inst, o) {
      b.calls.push(["set", id, o]);
      if (o.sl != null) b.trades[id].currentSL = o.sl;
      if (o.tp != null) b.trades[id].tp = o.tp;
    },
    async close(id) { b.calls.push(["close", id]); b.closed[id] = { ...b.trades[id], state: "CLOSED", exit: b.px.XAU_USD.bid, closedAt: NY(10) }; delete b.trades[id]; },
  };
  return b;
}

test("Edge places the order with SL + 3.2R TP and moves the stop to break-even at 2R", async () => {
  const store = memory();
  await store.set("settings", { beAtR: 2, beV2: true }); // break-even is off by default now; these tests check it still works when you turn it on
  const broker = fakeBroker();
  let now = NY(9);
  await core.action(store, broker, { action: "bias", market: "gold", answers: { dxy: 1, yields: 1 } }, now);
  await core.handleHook(store, broker, { secret: "s3cret", type: "setup", symbol: "XAUUSD", dir: "long", entry: 2400, sl: 2390, trend4h: 1, roomR: 6 }, now);
  const st = await core.state(store, broker, now);
  const { trade } = await core.action(store, broker, { action: "take", setupId: st.setups[0].id, emotion: "calm" }, now);
  assert.equal(trade.entry, 2400.3);
  assert.equal(Math.round(trade.units), 19); // $200 risk / $10.3 stop
  assert.equal(+trade.tp.toFixed(2), +(2400.3 + 3.2 * 10.3).toFixed(2));

  // price runs to +2R → stop goes to break-even on the broker
  broker.px.XAU_USD = { bid: 2421, ask: 2421.3 };
  now += 60e3;
  await core.syncTrades(store, broker, { now, force: true });
  const set = broker.calls.find((c) => c[0] === "set" && c[2].sl != null);
  assert.ok(set, "stop was moved");
  assert.equal(+set[2].sl.toFixed(3), +(2400.3 + 0.05 * 10.3).toFixed(3));

  // someone drags the TP further out (greed) → put back
  broker.trades["1"].tp = 2460;
  now += 60e3;
  await core.syncTrades(store, broker, { now, force: true });
  assert.equal(+broker.trades["1"].tp.toFixed(2), +trade.tp.toFixed(2));

  // closed at the target → journaled
  broker.px.XAU_USD = { bid: trade.tp, ask: trade.tp + 0.3 };
  await broker.close("1");
  await core.syncTrades(store, broker, { now: now + 60e3, force: true });
  const end = await core.state(store, broker, now + 120e3);
  assert.equal(end.open.length, 0);
  assert.equal(end.journal[0].resultR, 3.2);
  assert.ok(end.journal[0].ruleBreaks.length > 0, "the TP change is logged as a rule break");
});

test("a trade opened by hand on the broker is adopted as UNPLANNED", async () => {
  const store = memory();
  const broker = fakeBroker();
  broker.trades["9"] = { brokerId: "9", instrument: "NATGAS_USD", dir: "short", units: 1000, entry: 3.5, currentSL: 3.6, tp: null, openedAt: NY(9) };
  broker.px = { NATGAS_USD: { bid: 3.45, ask: 3.46 } };
  await core.syncTrades(store, broker, { now: NY(9, 5), force: true });
  const st = await core.state(store, broker, NY(9, 6));
  assert.equal(st.open[0].grade, "unplanned");
  assert.equal(st.open[0].market, "natgas");
  assert.ok(broker.trades["9"].tp < 3.5, "missing TP was set at 3.2R");
});
