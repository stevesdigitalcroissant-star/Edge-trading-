// Placing the trade from the app: Edge sends the order to Tradovate through TradersPost,
// then sends the break-even move at +2R. Also: no liquidity sweep = not A+.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
process.env.TRADERSPOST_WEBHOOK_URL = "https://webhooks.traderspost.io/trading/webhook/test/abc";
const sent = [];
global.fetch = async (url, opts) => {
  if (String(url).startsWith("https://webhooks.traderspost.io")) { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ success: true }), { status: 200 }); }
  throw new Error("offline");
};
const { memory } = require("../api/_store");
const { getBroker } = require("../api/_broker");
const core = require("../api/_core");
const { zonedTime } = require("../api/_time");
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");
const setup = (o = {}) => ({ secret: "s3cret", type: "setup", symbol: "MGC1!", tv: "COMEX:MGC1!", dir: "long", entry: 2652.4, sl: 2644.4, trend4h: 1, zoneFresh: true, bos15: true, close5: true, stopOk: true, roomR: 4.7, sweep: true, sweepName: "Asian low", sweepLvl: 2645.9, ...o });

test("no liquidity sweep → not A+", async () => {
  const store = memory();
  const broker = getBroker();
  await core.action(store, broker, { action: "bias", market: "gold", answers: { dxy: 1, yields: 1 } }, NY(9));
  assert.equal((await core.handleHook(store, broker, setup({ sweep: false }), NY(9))).json.grade, "A");
  assert.equal((await core.handleHook(store, broker, setup(), NY(9))).json.grade, "A+");
});

test("take from the app → order, break-even and close sent to Tradovate", async () => {
  sent.length = 0;
  const store = memory();
  const broker = getBroker();
  assert.equal(broker.kind, "traderspost");
  await core.action(store, broker, { action: "settings", patch: { accountSize: 50000, riskPct: 0.5, beAtR: 2 } }, NY(9)); // break-even on (off by default now)
  await core.action(store, broker, { action: "bias", market: "gold", answers: { dxy: 1, yields: 1 } }, NY(9));
  await core.handleHook(store, broker, setup(), NY(9));
  const st = await core.state(store, broker, NY(9));
  assert.match(st.setups[0].story.headline, /Asian low taken/);
  await core.action(store, broker, { action: "take", setupId: st.setups[0].id, emotion: "calm" }, NY(9));
  assert.deepEqual(
    { ticker: sent[0].ticker, action: sent[0].action, quantity: sent[0].quantity, stop: sent[0].stopLoss.stopPrice, tp: sent[0].takeProfit.limitPrice, type: sent[0].orderType },
    { ticker: "MGC1!", action: "buy", quantity: 3, stop: 2644.4, tp: 2678, type: "market" },
  );
  // price reaches +2R → break-even is sent once
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2666, high: 2668.6, low: 2660 }, NY(9, 5));
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2669, high: 2670, low: 2664 }, NY(9, 10));
  assert.equal(sent.filter((x) => x.action === "breakeven").length, 1);
  // closing from the app sends an exit
  const open = (await core.state(store, broker, NY(9, 11))).open[0];
  assert.equal(open.beMoved, true);
  await core.action(store, broker, { action: "close", tradeId: open.id, exit: 2670 }, NY(9, 12));
  assert.equal(sent.at(-1).action, "exit");
  assert.equal((await core.state(store, broker, NY(9, 13))).journal[0].resultR, 2.2);
});
