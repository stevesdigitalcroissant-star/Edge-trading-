// The strategy engine (used by the replay): same rules as the script, on generated prices.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine");

// 60 days of 5m gold-like bars: trending legs with pullbacks (seeded, so the test is stable)
function market(seed = 7, days = 60) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const bars = [];
  let p = 2400, drift = 0, leg = 0;
  const t0 = Date.UTC(2026, 6, 1, 22, 0);
  for (let i = 0; i < days * 288; i++) {
    if (leg-- <= 0) { drift = (rnd() - 0.5) * 0.9; leg = 40 + Math.floor(rnd() * 200); }
    const o = p, c = o + drift + (rnd() - 0.5) * 4;
    const h = Math.max(o, c) + rnd() * 1.5, l = Math.min(o, c) - rnd() * 1.5;
    bars.push({ t: t0 + i * 300e3, o, h, l, c });
    p = c;
  }
  return bars;
}

test("finds setups and follows each one to a single result", () => {
  let enters = 0, zones = 0, bos = { "4H": 0, "15m": 0, "5m": 0 };
  const outcomes = new Set();
  for (const seed of [1, 5, 9, 14, 31, 40, 116, 126]) {
    const bars = market(seed);
    const res = E.run(bars, "gold");
    assert.equal(res.states.length, bars.length);
    let open = null;
    for (const ev of res.events) {
      if (ev.type === "zone") zones++;
      if (ev.type === "bos") bos[ev.tf]++;
      if (ev.type === "enter") {
        enters++;
        if (open) assert.ok(open.closed, "a new A+ only after the previous one ended");
        open = { ...ev, closed: false, be: false };
        const s = res.states[ev.i];
        assert.equal(s.inSess, true);
        const k = ev.dir;
        assert.ok(k * (ev.entry - ev.sl) > 0, "stop on the right side");
        assert.ok(Math.abs(ev.tp - (ev.entry + k * 3.2 * Math.abs(ev.entry - ev.sl))) < 1e-9);
        assert.ok(ev.swept, "A+ needs liquidity taken");
        const p = E.panel(res, ev.i);
        assert.ok(p.steps.every(([, ok]) => ok), `all five steps done at ENTER: ${JSON.stringify(p.steps)}`);
      }
      if (ev.type === "be") { assert.ok(open && !open.closed); open.be = true; }
      if (ev.type === "exit") {
        assert.ok(open && !open.closed, "an exit belongs to an open trade");
        assert.ok(ev.i > open.i);
        if (ev.outcome === "flat") assert.ok(((E.nyMin(bars[ev.i].t) % 1440) + 1440) % 1440 >= 16 * 60 + 40, "close-out only at 16:40 or later");
        if (ev.outcome === "be") assert.ok(open.be);
        outcomes.add(ev.outcome);
        open.closed = true;
      }
    }
  }
  assert.ok(zones > 10, `zones ${zones}`);
  assert.ok(bos["4H"] > 10 && bos["15m"] > 50 && bos["5m"] > 100, JSON.stringify(bos));
  assert.ok(enters >= 5, `A+ setups: ${enters}`);
  assert.ok(["be", "sl", "flat"].every((o) => outcomes.has(o)), [...outcomes].join());
});

test("4H candles follow the CME day (18:00 New York), daylight saving included", () => {
  const summer = Date.UTC(2026, 6, 1, 22, 0); // 18:00 EDT
  const winter = Date.UTC(2026, 11, 1, 23, 0); // 18:00 EST
  assert.equal(((E.nyMin(summer) % 1440) + 1440) % 1440, 18 * 60);
  assert.equal(((E.nyMin(winter) % 1440) + 1440) % 1440, 18 * 60);
});

test("the panel talks like the script", () => {
  const res = E.run(market(3, 20), "gold");
  const p = E.panel(res, res.states.length - 1);
  assert.equal(p.steps.length, 5);
  assert.ok(typeof p.doNow === "string" && p.doNow.length > 10);
});
