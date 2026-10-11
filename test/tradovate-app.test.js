// Settings → Connect Tradovate: Edge signs in to check, saves the details sealed, and uses them for orders.
const test = require("node:test");
const assert = require("node:assert/strict");
for (const k of ["TRADOVATE_USERNAME", "TRADOVATE_PASSWORD", "TRADOVATE_CID", "TRADOVATE_SECRET", "OANDA_TOKEN", "TRADERSPOST_WEBHOOK_URL"]) delete process.env[k];
let good = true;
const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
global.fetch = async (url) => {
  const u = new URL(url), path = u.pathname.replace("/v1", "");
  if (path === "/auth/accesstokenrequest") return good ? json({ accessToken: "tok", expirationTime: new Date(Date.now() + 3600e3).toISOString() }) : json({ errorText: "Incorrect username or password" });
  if (path === "/account/list") return json([{ id: 9, name: "LIVE42", active: true }]);
  if (path === "/cashBalance/getcashbalancesnapshot") return json({ totalCashValue: 50123 });
  throw new Error("offline");
};
const { memory } = require("../api/_store");
const { brokerFor, connectTradovate, disconnectTradovate } = require("../api/_broker");

test("connect from the app → sealed, used for orders → disconnect", async () => {
  const store = memory();
  assert.equal((await brokerFor(store)).kind, "manual");
  good = false;
  await assert.rejects(connectTradovate(store, { username: "me", password: "bad", cid: "1", secret: "s", env: "live" }), /Incorrect username/);
  assert.equal(await store.get("tradovateConn"), null); // nothing saved when the sign-in fails
  await assert.rejects(connectTradovate(store, { username: "me" }), /all four/);
  good = true;
  const r = await connectTradovate(store, { username: "trader_steve_x", password: "hunter2", cid: "1", secret: "s3", env: "live" });
  assert.equal(r.account.name, "LIVE42");
  const raw = JSON.stringify(await store.get("tradovateConn"));
  assert.ok(!raw.includes("hunter2") && !raw.includes("trader_steve_x")); // encrypted at rest
  const b = await brokerFor(store);
  assert.equal(b.kind, "tradovate"); assert.equal(b.env, "live");
  assert.equal((await b.account()).balance, 50123);
  await disconnectTradovate(store);
  assert.equal((await brokerFor(store)).kind, "manual");
});
