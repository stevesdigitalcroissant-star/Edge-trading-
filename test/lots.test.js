// Lot sizes: dollars at risk ÷ (stop distance × 100,000 × USD per quote unit), rounded down to 0.01.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lots.js");

test("…/USD pairs: $10 a pip per lot", () => {
  const r = L.lots({ market: "eurusd", entry: 1.0850, stop: 1.0830, risk: 25 }); // 20 pips
  assert.equal(r.pips, 20); assert.equal(r.pipUsdPerLot, 10); assert.equal(r.lots, 0.12); assert.equal(r.riskAtLots, 24);
});
test("USD/JPY uses its own price; GBP/JPY needs USD/JPY", () => {
  const u = L.lots({ market: "usdjpy", entry: 154.212, stop: 154.05, risk: 25 }); // 16.2 pips at ~$6.48
  assert.equal(u.lots, 0.23); assert.ok(u.riskAtLots <= 25);
  const g = L.lots({ market: "gbpjpy", entry: 200.12, stop: 200.40, risk: 25, usdxxx: 150 }); // 28 pips at $6.67
  assert.equal(g.lots, 0.13); assert.ok(g.riskAtLots <= 25 && g.riskAtLots > 24);
  assert.equal(L.lots({ market: "gbpjpy", entry: 200.12, stop: 200.4, risk: 25 }), null, "no USD/JPY rate → no guess");
});
test("USD/CAD, USD/CHF; never over the risk; too-wide stops say so", () => {
  const c = L.lots({ market: "usdcad", entry: 1.3700, stop: 1.3670, risk: 25 });
  assert.equal(c.lots, 0.11); assert.ok(c.riskAtLots <= 25);
  assert.equal(L.lots({ market: "eurusd", entry: 1.1, stop: 1.0, risk: 25 }).tooWide, true);
});

test("EUR/GBP uses today's GBP/USD", () => {
  const r = L.lots({ market: "eurgbp", entry: 0.8345, stop: 0.8330, risk: 25, usdxxx: 1.3195 }); // 15 pips at $13.20
  assert.ok(Math.abs(r.pipUsdPerLot - 13.195) < 0.01); assert.equal(r.lots, 0.12); assert.ok(r.riskAtLots <= 25);
  assert.equal(L.lots({ market: "eurgbp", entry: 0.8345, stop: 0.833, risk: 25 }), null);
});
