const test = require("node:test"), assert = require("node:assert");
const T = require("../trend.js");
// a clean staircase: up legs then a pullback — bodies only
const mk = (closes, t0 = Date.UTC(2026, 0, 5, 23), step = 15) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return [t0 + i * step * 60e3, o, Math.max(o, c) + 0.01, Math.min(o, c) - 0.01, c]; });
test("body structure: a close above the last swing high turns the trend up, below the last low turns it down", () => {
  const up = [10, 11, 12, 11.5, 11, 11.2, 12.5, 13, 12.6, 12.2, 12.4, 13.5];
  assert.strictEqual(T.read(T.roll(mk(up), 15)).dir, 1);
  const dn = [13, 12, 11, 11.5, 12, 11.8, 10.5, 10, 10.4, 10.8, 10.6, 9.5];
  assert.strictEqual(T.read(T.roll(mk(dn), 15)).dir, -1);
});
test("verdict: agree → buys/sells only; disagree → wait with the flip level", () => {
  assert.strictEqual(T.verdict({ dir: 1 }, { dir: 1 }).text, "Buys only");
  assert.strictEqual(T.verdict({ dir: -1 }, { dir: -1 }).cls, "sell");
  const w = T.verdict({ dir: 1 }, { dir: -1, hi: 4.951 });
  assert.strictEqual(w.cls, "wait"); assert.match(w.hint, /above 4\.951/);
  assert.strictEqual(T.verdict({ dir: 0 }, { dir: 1 }).cls, "wait");
});
test("4H candles start at 18:00 New York", () => {
  const t = Date.UTC(2026, 0, 6, 0, 30); // 19:30 New York (winter) → the 18:00 candle
  assert.strictEqual(T.roll([[t, 1, 1, 1, 1]], 240)[0].t, Date.UTC(2026, 0, 5, 23, 0));
});
