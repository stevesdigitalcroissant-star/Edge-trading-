// The Coach: Claude reads the chart (faked here), the fixed rules decide the instruction.
const test = require("node:test");
const assert = require("node:assert/strict");
global.fetch = async () => { throw new Error("offline"); };
const { memory } = require("../api/_store");
const coach = require("../api/_coach");
const core = require("../api/_core");
const { mergeSettings } = require("../api/_config");
const s = mergeSettings({});
const IMG = "data:image/jpeg;base64,AAAA";

const read = (o = {}) => ({
  chartReadable: true, platform: "TradingView", symbol: "MGC1!", market: "gold", timeframe: "5m", phase: "no_setup", direction: "none",
  checklist: Object.fromEntries(["trend4h", "freshZone", "bos15", "close5", "room", "stop"].map((k) => [k, { status: "pass", note: "" }])),
  grade: "none", position: { open: false, dir: "none", entry: null, stop: null, target: null, price: null },
  instruction: "No setup. Wait.", urgency: "info", reasoning: "", memory: "", ...o,
});
const fake = (outs) => {
  const calls = [];
  return { calls, beta: { messages: { create: async (req) => { calls.push(req); const o = outs.shift(); return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(o) }], usage: { input_tokens: 1, output_tokens: 1 } }; } } } };
};
const pos = (o) => ({ open: true, dir: "long", entry: 2400, stop: 2390, target: 2432, price: 2405, ...o });

test("rules override the model: break-even at 2R, target put back, no stop, A+ only", () => {
  const ctx = { settings: s, mode: "live" };
  assert.match(coach.applyRules(read({ phase: "in_trade", position: pos({ price: 2421 }) }), {}, ctx).instruction, /break-even, 2400\.50/);
  assert.match(coach.applyRules(read({ phase: "in_trade", position: pos({ target: 2460 }) }), {}, ctx).instruction, /back to 2432\.00/);
  assert.match(coach.applyRules(read({ phase: "in_trade", position: pos({ price: 2433 }) }), {}, ctx).instruction, /Take the profit/);
  const remembered = { trade: { dir: "long", entry: 2400, initialSL: 2390, maxR: 0 } };
  assert.match(coach.applyRules(read({ position: pos({ stop: 2385 }) }), remembered, ctx).instruction, /further away/);
  assert.match(coach.applyRules(read({ position: pos({ stop: null }) }), remembered, ctx).instruction, /stop loss is gone/);
  // break-even already done → the model's own instruction stands
  assert.equal(coach.applyRules(read({ position: pos({ stop: 2400.5, price: 2425 }), instruction: "Let it work." }), remembered, ctx).instruction, "Let it work.");
  assert.match(coach.applyRules(read({ phase: "entry_signal", grade: "B" }), {}, ctx).instruction, /not A plus/);
  assert.match(coach.applyRules(read({ phase: "entry_signal", grade: "A+" }), {}, { ...ctx, block: "CPI in 10 min" }).instruction, /Not now: CPI/);
  assert.equal(coach.applyRules(read({ phase: "entry_signal", grade: "A+", instruction: "Enter now." }), {}, { ...ctx, mode: "replay", block: "CPI" }).instruction, "Enter now.");
});

test("a practice trade seen on screen is journaled as practice when it closes", async () => {
  const store = memory();
  const ctx = { settings: s, bias: {}, mode: "replay" };
  const client = fake([
    read({ phase: "entry_signal", grade: "A+", instruction: "A+ confirmed. Enter." }),
    read({ phase: "in_trade", position: pos({ price: 2412 }) }),
    read({ phase: "in_trade", position: pos({ stop: 2400.5, price: 2431.5 }) }),
    read({ phase: "trade_closed", position: { open: false, dir: "none", entry: null, stop: null, target: null, price: 2432 } }),
  ]);
  for (let i = 0; i < 4; i++) await coach.check(store, { image: IMG, mode: "replay" }, ctx, client, 1000 + i);
  assert.equal(client.calls[0].model, "claude-opus-5-5");
  assert.equal(client.calls[0].messages[0].content[0].type, "image");
  process.env.EDGE_PASSWORD = "pw";
  const st = await core.state(store, { kind: "manual", label: "m" });
  assert.equal(st.journal.length, 0, "practice never counts as real");
  assert.equal(st.practice.length, 1);
  assert.equal(st.practice[0].resultR, 3.2);
  assert.equal(st.practice[0].grade, "A+");
});

test("daily cost guard", async () => {
  const store = memory();
  const ctx = { settings: { ...s, coachDailyChecks: 1 }, bias: {}, mode: "live" };
  await coach.check(store, { image: IMG }, ctx, fake([read()]));
  await assert.rejects(coach.check(store, { image: IMG }, ctx, fake([read()])), /limit/);
});
