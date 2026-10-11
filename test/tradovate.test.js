// Tradovate direct: Edge signs in, places the bracket (limit + stop + target) on the front-month contract,
// sees the fill, moves the stop at +3R and records the close when the target fills — all against a fake Tradovate.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
Object.assign(process.env, { TRADOVATE_USERNAME: "me", TRADOVATE_PASSWORD: "pw", TRADOVATE_CID: "123", TRADOVATE_SECRET: "sec", TRADOVATE_ENV: "demo" });
delete process.env.OANDA_TOKEN; delete process.env.TRADERSPOST_WEBHOOK_URL;
const calls = [], orders = {}, fillPx = {};
let next = 100;
const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url), body = opts.body ? JSON.parse(opts.body) : null, path = u.pathname.replace("/v1", "");
  if (!u.host.startsWith("demo.tradovateapi.com")) throw new Error("offline");
  calls.push({ path, body });
  if (path === "/auth/accesstokenrequest") return json({ accessToken: "tok", expirationTime: new Date(Date.now() + 3600e3).toISOString() });
  if (path === "/account/list") return json([{ id: 7, name: "DEMO123", active: true }]);
  if (path === "/cashBalance/getcashbalancesnapshot") return json({ totalCashValue: 50000 });
  if (path === "/contract/suggest") return json([{ id: 1, name: "MGCG7", contractMaturityId: 11 }, { id: 2, name: "MGCZ6", contractMaturityId: 10 }]);
  if (path === "/contractMaturity/items") return json([{ id: 10, expirationDate: "2026-12-29T00:00Z", isFront: true }, { id: 11, expirationDate: "2027-02-24T00:00Z" }]);
  if (path === "/order/placeOSO") { const o = { orderId: next++, oso1Id: next++, oso2Id: next++ }; for (const k of Object.values(o)) orders[k] = "Working"; return json(o); }
  if (path === "/order/item") return json({ id: Number(u.searchParams.get("id")), ordStatus: orders[u.searchParams.get("id")] });
  if (path === "/fill/deps") return json([{ price: fillPx[u.searchParams.get("masterid")] ?? 2399.9, qty: 5 }]);
  if (path === "/order/modifyorder" || path === "/order/cancelorder" || path === "/order/liquidatePosition") return json({ ok: true });
  if (path === "/contract/find") return json({ id: 2, name: "MGCZ6" });
  return json({});
};
const { memory } = require("../api/_store");
const { getBroker } = require("../api/_broker");
const core = require("../api/_core");
const PB = require("../playbook.js");
const { zonedTime } = require("../api/_time");
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");

test("plan a trade → bracket on Tradovate → fill → stop moved at +3R → target", async () => {
  const store = memory(), broker = getBroker();
  assert.equal(broker.kind, "tradovate");
  let now = NY(9);
  const r = await core.action(store, broker, { action: "planTrade", market: "gold", dir: "long", entry: 2400, sl: 2395, tp: 2420, riskUSD: 250, emotion: "calm", checks: PB.required, send: true }, now);
  const oso = calls.find((c) => c.path === "/order/placeOSO").body;
  assert.deepEqual({ sym: oso.symbol, act: oso.action, qty: oso.orderQty, type: oso.orderType, px: oso.price, sl: oso.bracket1.stopPrice, tp: oso.bracket2.price, acct: oso.accountSpec },
    { sym: "MGCZ6", act: "Buy", qty: 5, type: "Limit", px: 2400, sl: 2395, tp: 2420, acct: "DEMO123" });
  const ids = r.order.trade.tv;
  let st = await core.state(store, broker, now);
  assert.equal(st.broker.account.name, "DEMO123");
  assert.equal(st.orders.length, 1);

  // Tradovate fills the limit
  orders[ids.orderId] = "Filled"; now += 60e3;
  st = await core.state(store, broker, now);
  assert.equal(st.orders.length, 0); assert.equal(st.open.length, 1);
  assert.equal(st.open[0].entry, 2399.9);

  // +3R on the chart → Edge moves the stop on Tradovate to lock in +1R
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2414, high: 2415.5, low: 2412 }, now);
  const mod = calls.find((c) => c.path === "/order/modifyorder");
  assert.equal(mod.body.orderId, ids.stopId);
  assert.ok(Math.abs(mod.body.stopPrice - 2404.8) < 1e-6); // +1R from the real fill (2399.9, risk 4.9)
  st = await core.state(store, broker, now);
  assert.ok(Math.abs(st.open[0].currentSL - 2404.8) < 1e-6);
  assert.ok(!st.log.some((l) => /moved back/.test(l.text))); // the untouched target isn't flagged

  // a new 15m swing low above the stop → Edge trails the stop behind it on Tradovate (2 ticks below)
  now += 5 * 60e3;
  await core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2416, high: 2416.5, low: 2413, swing15Low: 2410 }, now);
  const mods = calls.filter((c) => c.path === "/order/modifyorder");
  assert.ok(Math.abs(mods[mods.length - 1].body.stopPrice - 2409.8) < 1e-6);
  st = await core.state(store, broker, now);
  assert.ok(Math.abs(st.open[0].currentSL - 2409.8) < 1e-6);

  // the target fills on Tradovate → journal
  orders[ids.tpId] = "Filled"; fillPx[ids.tpId] = 2420; now += 60e3;
  st = await core.state(store, broker, now + 5000);
  assert.equal(st.open.length, 0);
  assert.ok(st.journal[0].resultR > 3);
});
