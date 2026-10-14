const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAlert } = require("../api/_alerttext");
const core = require("../api/_core");
const { memory } = require("../api/_store");
process.env.EDGE_HOOK_SECRET = "s3cret"; delete process.env.TELEGRAM_BOT_TOKEN;
const broker = { kind: "manual", label: "manual" };

const FVG = "A+ MNQ1! BUY limit 29187.50 · SL 29159.00 · TP 29273.00 (3R, FVG) · 1H demand 29132.75–29200.75 · 5m MSS at 29187.50 · with the 4H trend · 5m swing at 1.4R · highest target 29380.00 (6.8R) · zone filled 42% · volume 2.1× average ✓";
const MB = "6E1! SELL limit 1.16095 · SL 1.16140 · TP 1.15960 (1:3, MITIGATION BLOCK) · 1H supply 1.16120–1.16180 · zone filled 12% (under 30%: may go deeper) · volume 0.8× average (weak)";

test("TradingView app alert text → the setup a webhook would send", () => {
  const a = parseAlert(FVG);
  assert.equal(a.symbol, "MNQ1!"); assert.equal(a.dir, "long"); assert.equal(a.entry, 29187.5); assert.equal(a.sl, 29159); assert.equal(a.tp, 29273);
  assert.equal(a.kind, "FVG"); assert.equal(a.aplus, true); assert.equal(a.trend4h, 1); assert.equal(a.zoneBot, 29132.75); assert.equal(a.zoneTop, 29200.75);
  assert.equal(a.tpMax, 29380); assert.equal(a.rrMax, 6.8); assert.equal(a.fill, 0.42); assert.equal(a.vol, 2.1); assert.equal(a.liqR, 1.4);
  const b = parseAlert(MB);
  assert.equal(b.dir, "short"); assert.equal(b.kind, "MB"); assert.equal(b.aplus, false); assert.equal(b.fill, 0.12); assert.equal(b.vol, 0.8); assert.equal(b.rr, 3);
  assert.throws(() => parseAlert("hello"), /doesn't look like an Edge S&D alert/);
});

test("pasting an alert makes a takeable setup once (pasting it again finds the same one)", async () => {
  const store = memory();
  const now = Date.UTC(2026, 9, 14, 13, 35); // 09:35 New York
  const r = await core.action(store, broker, { action: "pasteAlert", text: FVG }, now);
  assert.ok(r.setupId); assert.equal(r.takeable, true);
  const again = await core.action(store, broker, { action: "pasteAlert", text: FVG }, now + 60e3);
  assert.equal(again.existing, true); assert.equal(again.setupId, r.setupId);
});
