// The prop engine: account from trades, trailing drawdown, autopilot sizing, consistency cap, pass simulation, payout.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../prop.js");
const NY = (d, h) => Date.parse(`2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00-04:00`);
const cfg = { size: 50000, target: 3000, dd: 2000, ddType: "eod", ddLockAt: 50100, dailyLoss: 1000, consistencyPct: 40, minDays: 2, phase: "eval", anchor: { balance: 50000, hwm: 50000, at: NY(1, 0) } };

test("EOD trailing drawdown, daily room, consistency cap, protect mode", () => {
  const trades = [{ closedAt: NY(5, 9), usd: 900 }, { closedAt: NY(6, 9), usd: 750 }, { closedAt: NY(7, 9), usd: -250 }];
  const a = P.account(trades, cfg, NY(7, 12));
  assert.equal(a.balance, 51400);
  assert.equal(a.peak, 51650); // EOD high after day 2 (today's loss doesn't move it)
  assert.equal(a.floor, 49650); // EOD high 51650 − 2000 (it stops trailing once it reaches 50100)
  assert.equal(a.room, 1750);
  assert.equal(a.dailyRoom, 750);
  assert.equal(a.toTarget, 1600);
  assert.equal(a.consistCap, 1450); // 40% of 3000 = 1200 a day; today is −250 so far
  const ap = P.autopilot(a, cfg, { base: 250 });
  assert.equal(ap.usd, 250); // ¼ of 1750, half of 750 → base 250 stands
  const big = P.account([{ closedAt: NY(5, 9), usd: 1200 }], cfg, NY(5, 12));
  assert.equal(P.autopilot(big, cfg, { base: 250 }).usd, 0); // today's 40% is made: stop for the day
  const near = P.account([...trades, { closedAt: NY(8, 9), usd: 1100 }], cfg, NY(9, 12));
  const ap2 = P.autopilot(near, cfg, { base: 250 });
  assert.equal(ap2.mode, "protect"); // $500 to go → a 3R winner at $165 passes
  assert.equal(ap2.usd, 165);
});
test("failed / passed stop the autopilot; pass simulation and payout", () => {
  assert.equal(P.autopilot(P.account([{ closedAt: NY(5, 9), usd: -2100 }], cfg, NY(5, 12)), cfg).usd, 0);
  const sim = P.simulate(P.account([], cfg, NY(5, 1)), cfg, null, { setupsPerDay: 1.5, days: 10, runs: 500 });
  assert.ok(sim.passN > 0 && sim.passN < 1 && sim.fail >= 0);
  const funded = { ...cfg, phase: "funded", payout: { minDays: 5, minWinningDays: 3, minWinningDayProfit: 100, buffer: 2100, cap: 2000, processingDays: 3 } };
  const t = [5, 6, 7, 8, 9].map((d) => ({ closedAt: NY(d, 9), usd: 900 }));
  const pay = P.payout(P.account(t, funded, NY(9, 12)), funded, NY(9, 12));
  assert.equal(pay.winDays, 5); assert.equal(pay.safe, 2000); assert.equal(pay.eligible, true); assert.ok(pay.paidBy);
});
