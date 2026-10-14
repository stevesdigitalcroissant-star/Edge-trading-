// A trade from a screenshot: what's missing is asked for, it's tracked, 2 hours later Edge asks how it went.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
global.fetch = async () => { throw new Error("offline"); };
const { memory } = require("../api/_store");
const { getBroker } = require("../api/_broker");
const core = require("../api/_core");
const TS = require("../api/_tradeshot");
const { zonedTime } = require("../api/_time");
const NY = (h, m = 0) => zonedTime(2026, 10, 14, h, m, "America/New_York");

test("screenshot read → fields + what's missing", async () => {
  const fake = { beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ readable: true, symbol: "MNQZ2026", dir: "long", entry: 25000, stop: 24980, target: 25060, contracts: null, status: "open", exit: null, pnlUSD: null, notes: "" }) }] }) } } };
  const { fields, missing } = TS.shotFields(await TS.readTradeShot("data:image/png;base64,AAAA", fake));
  assert.equal(fields.market, "nq");
  assert.equal(fields.contract, "MNQ");
  assert.deepEqual(missing, ["contracts"]);
});

test("logged trade: tracked, asked once 2 hours later, 'won' closes it at the target", async () => {
  const store = memory(), broker = getBroker();
  await store.set("settings", { notify: {} });
  const r = await core.action(store, broker, { action: "shotLog", market: "nq", dir: "long", entry: 25000, sl: 24980, tp: 25060, units: 5, contract: "MNQ", status: "open" }, NY(9, 0));
  assert.equal(r.trade.riskUSD, 200); // 20 points × $2 × 5
  assert.equal(r.trade.askAt, NY(11, 0));
  await core.tick(store, broker, NY(10, 0));
  let log = await store.lrange("log", 50);
  assert.ok(!log.some((l) => /win or lose/.test(l.text)));
  await core.tick(store, broker, NY(11, 1));
  await core.tick(store, broker, NY(11, 2));
  log = await store.lrange("log", 50);
  assert.equal(log.filter((l) => /win or lose/.test(l.text)).length, 1);
  // still open → asked again an hour later
  await core.action(store, broker, { action: "tradeResult", tradeId: r.trade.id, outcome: "open" }, NY(11, 5));
  assert.equal((await store.hget("trades", r.trade.id)).askAt, NY(12, 5));
  await core.action(store, broker, { action: "tradeResult", tradeId: r.trade.id, outcome: "win" }, NY(11, 30));
  const j = await store.hget("journal", r.trade.id);
  assert.equal(j.exit, 25060);
  assert.equal(j.resultR, 3);
  assert.equal(await store.hget("trades", r.trade.id), null);
});

test("a closed trade on the screenshot goes straight to the journal with its P&L", async () => {
  const store = memory(), broker = getBroker();
  const r = await core.action(store, broker, { action: "shotLog", market: "nq", dir: "short", entry: 25000, sl: 25020, tp: 24940, units: 5, contract: "MNQ", status: "closed", pnlUSD: -200 }, NY(9, 0));
  assert.equal(r.closed, true);
  const j = await store.hget("journal", r.tradeId);
  assert.equal(j.usd, -200);
  assert.equal(j.exit, 25020);
  assert.equal(j.resultR, -1);
});

test("passed → funded: the funded rules, a fresh $25K balance, $100 a trade, eval trades no longer count", async () => {
  const store = memory(), broker = getBroker();
  await core.action(store, broker, { action: "propSave", cfg: { firm: "mffu", plan: "builder25", phase: "eval", size: 25000, target: 1500, dd: 1000, ddType: "eod", dailyLoss: 600, maxMicros: 20, baseRisk: 200, anchor: { balance: 26600, hwm: 26600 } } }, NY(8, 0));
  const r = await core.action(store, broker, { action: "propFunded", risk: 100 }, NY(9, 0));
  assert.equal(r.prop.phase, "funded");
  assert.equal(r.prop.target, null);
  assert.equal(r.prop.consistencyPct, 50);
  assert.equal(r.prop.payout.buffer, 1100);
  assert.equal(r.prop.anchor.balance, 25000);
  const st = await core.state(store, broker, NY(9, 5));
  assert.equal(st.settings.sdRiskTarget, 100);
  assert.equal(st.settings.sdRiskMax, 100);
  assert.equal(st.prop.acct.balance, 25000);
  assert.equal(st.prop.auto.usd, 100);
  await assert.rejects(core.action(store, broker, { action: "propFunded", risk: 5000 }, NY(9, 0)));
});
