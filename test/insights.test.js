const test = require("node:test");
const assert = require("node:assert/strict");
const { insights } = require("../insights");
const at = (d, h) => Date.UTC(2026, 8, d, h); // September 2026, UTC

test("needs 5 closed trades before saying anything", () => {
  const r = insights([{ resultR: 1, openedAt: at(1, 8) }], { tz: "Asia/Dubai" });
  assert.equal(r.ready, false);
  assert.equal(r.need, 5);
});

test("finds your best market, best hours and what mood costs you", () => {
  const j = [];
  // crude in the Dubai morning: winners; gold in the Dubai evening: losers, often on FOMO
  for (let i = 0; i < 6; i++) j.push({ market: "crude", dir: "long", resultR: 2, openedAt: at(1 + i, 6), closedAt: at(1 + i, 8), emotion: "calm" });
  for (let i = 0; i < 6; i++) j.push({ market: "gold", dir: "short", resultR: -1, openedAt: at(1 + i, 16), closedAt: at(1 + i, 17), emotion: i < 3 ? "fomo" : "calm", ruleBreaks: i < 2 ? ["closed early (greed/fear)"] : [] });
  const r = insights(j, { tz: "Asia/Dubai" });
  assert.equal(r.ready, true);
  const titles = r.items.map((x) => x.title).join(" | ");
  assert.match(titles, /best market: Crude oil/);
  assert.match(titles, /Gold is costing you/);
  assert.match(titles, /You trade best 10:00–12:00 your time/); // 06:00 UTC = 10:00 Dubai
  assert.match(titles, /mood shows/);
  assert.ok(r.items.length <= 6);
});
