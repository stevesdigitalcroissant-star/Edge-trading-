// Edge ↔ MetaTrader 5: the EA's key, the prop-firm checks before sending, the one-request cycle (report up, orders down),
// acks, closed trades into the journal — and setups from TradingView's FX Playbook.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
const st = require("../api/_store");
const store = st.memory();
st.useStore(store);
const M = require("../api/_mt5");
const mt5 = require("../api/mt5");

function call(method, body, key) {
  return new Promise((ok) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j }); }, end(t) { ok({ code: this.code, t }); } };
    mt5({ method, url: "/api/mt5", body, headers: key ? { authorization: "Bearer " + key } : {} }, res);
  });
}
const acct = (over = {}) => ({ login: "123", server: "TradeifyFX-Live", currency: "USD", balance: 5000, equity: 5000, dayPnl: 0, positions: [], orders: [], closed: [], acks: [], ...over });

test("the EA needs its key; Edge refuses to send while MT5 isn't connected", async () => {
  assert.equal((await call("POST", acct())).code, 401);
  await assert.rejects(M.queue(store, { market: "eurusd", side: "buy", entry: 1.08, sl: 1.079, tp: 1.083, riskUSD: 25 }), /isn't connected/);
});

test("send → the EA's next report gets the order back; ack → done; closed trade → journal in R", async () => {
  const { key } = await M.newKey(store);
  assert.match(key, /^edge_mt_/);
  assert.equal((await call("POST", acct(), key)).t, "", "nothing waiting yet");
  assert.equal((await M.read(store)).connected, true);
  await assert.rejects(M.queue(store, { market: "eurusd", side: "buy", entry: 1.08, sl: 1.081, tp: 1.083, riskUSD: 25 }), /stop below the entry/);
  await assert.rejects(M.queue(store, { market: "gold", side: "buy", entry: 2400, sl: 2390, tp: 2430, riskUSD: 25 }), /forex pairs/);
  const { queued } = await M.queue(store, { market: "eurusd", side: "buy", type: "limit", entry: 1.08, sl: 1.079, tp: 1.083, riskUSD: 25 });
  const lines = (await call("POST", acct(), key)).t.split("\n");
  assert.deepEqual(lines[0].split("|"), [queued.id, "open", "EURUSD", "buy", "limit", "1.08", "1.079", "1.083", "25"]);
  assert.equal((await call("POST", acct(), key)).t, "", "not sent twice");
  await call("POST", acct({ acks: [{ id: queued.id, ok: true, ticket: "555", volume: 0.25, err: "" }], orders: [{ ticket: "555", symbol: "EURUSD", type: "buy_limit", volume: 0.25, price: 1.08, sl: 1.079, tp: 1.083, comment: "edge:" + queued.id }] }), key);
  const r = await M.read(store);
  assert.equal(r.recent.find((c) => c.id === queued.id).status, "done");
  assert.equal(r.orders[0].edge, queued.id);
  const t0 = Math.floor(Date.now() / 1000);
  await call("POST", acct({ balance: 5075, equity: 5075, dayPnl: 75, closed: [{ position: "555", symbol: "EURUSD", type: "buy", volume: 0.25, open: 1.08, close: 1.083, profit: 75, openTime: t0 - 3600, closeTime: t0, comment: "edge:" + queued.id }] }), key);
  const j = await store.hget("journal", "mt5:555");
  assert.equal(j.resultR, 3); assert.equal(j.market, "eurusd"); assert.equal(j.dir, "long"); assert.equal(j.viaEdge, true);
  await call("POST", acct({ closed: [{ position: "555", symbol: "EURUSD", type: "buy", volume: 0.25, open: 1.08, close: 1.083, profit: 75, openTime: t0 - 3600, closeTime: t0, comment: "edge:" + queued.id }] }), key);
  assert.equal(Object.keys(await store.hgetall("journal")).filter((k) => k === "mt5:555").length, 1, "journaled once");
});

test("prop-firm rules: daily loss room, max-loss floor and trades a day are checked before sending", async () => {
  const { key } = await M.newKey(store);
  await call("POST", acct({ equity: 4560, balance: 4600, dayPnl: -120 }), key);
  await assert.rejects(M.queue(store, { market: "gbpjpy", side: "sell", entry: 200, sl: 200.3, tp: 199.1, riskUSD: 50 }), /\$30 left before the \$150 daily/);
  await call("POST", acct({ equity: 4540, balance: 4540, dayPnl: 0 }), key);
  await assert.rejects(M.queue(store, { market: "gbpjpy", side: "sell", entry: 200, sl: 200.3, tp: 199.1, riskUSD: 40 }), /max-loss floor/);
  await M.setRules(store, { maxTrades: 1 });
  await call("POST", acct(), key);
  await assert.rejects(M.queue(store, { market: "usdjpy", side: "buy", entry: 150, sl: 149.8, tp: 150.6, riskUSD: 25 }), /trades today/);
  await assert.rejects(M.setRules(store, { floor: 6000 }), /below the account size/);
});

test("TradingView FX Playbook setups land in Edge, ready to send", async () => {
  const { handleHook } = require("../api/_core");
  const ok = await handleHook(store, null, { secret: "s3cret", type: "fx", pair: "GBPJPY", tv: "OANDA:GBPJPY", side: "sell", entry: 200.12, sl: 200.4, tp: 199.2, tf: "15", trend: { d: -1, h4: -1, h1: -1 } });
  assert.equal(ok.status, 200);
  const L = await require("../api/_fxsetup").fxRead(store);
  assert.equal(L[0].market, "gbpjpy"); assert.equal(L[0].rr, 3.3);
  assert.equal((await handleHook(store, null, { secret: "s3cret", type: "fx", pair: "GBPJPY", side: "sell", entry: 200, sl: 199, tp: 201 })).status, 400, "stop on the wrong side");
  assert.ok((await handleHook(store, null, { secret: "s3cret", type: "fx", pair: "BTCUSD", side: "buy", entry: 1, sl: 0.9, tp: 1.3 })).json.ignored);
});
