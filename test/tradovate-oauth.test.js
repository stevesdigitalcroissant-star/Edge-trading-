// Connect Tradovate like TradingView: Tradovate's sign-in page → back with a code → token saved (sealed),
// renewed before it runs out; once it has run out, Edge asks you to reconnect.
const test = require("node:test");
const assert = require("node:assert/strict");
for (const k of ["TRADOVATE_USERNAME", "TRADOVATE_PASSWORD", "TRADOVATE_CID", "TRADOVATE_SECRET", "OANDA_TOKEN", "TRADERSPOST_WEBHOOK_URL"]) delete process.env[k];
Object.assign(process.env, { TRADOVATE_OAUTH_CLIENT_ID: "edge-client", TRADOVATE_OAUTH_CLIENT_SECRET: "shh" });
const seen = [];
const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/json" } });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url); seen.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers && opts.headers.Authorization });
  if (u.pathname === "/auth/oauthtoken") return JSON.parse(opts.body).code === "good" ? json({ access_token: "tokA", expires_in: 4800 }) : json({ error: "invalid_grant" });
  if (u.pathname === "/v1/auth/renewaccesstoken") return json({ accessToken: "tokB", expirationTime: new Date(Date.now() + 4800e3).toISOString() });
  if (u.pathname === "/v1/account/list") return json([{ id: 5, name: "APEX-0042", active: true }]);
  if (u.pathname === "/v1/cashBalance/getcashbalancesnapshot") return json({ totalCashValue: 50000 });
  throw new Error("offline");
};
const { memory } = require("../api/_store");
const { brokerFor, oauthStart, oauthFinish } = require("../api/_broker");

test("sign in on Tradovate's page → connected → token renewed → expired asks to reconnect", async () => {
  const store = memory();
  const { url } = await oauthStart(store, { env: "live", origin: "https://edge.example" });
  const q = new URL(url).searchParams;
  assert.equal(q.get("client_id"), "edge-client");
  assert.equal(q.get("redirect_uri"), "https://edge.example/api/tradovate");
  await assert.rejects(oauthFinish(store, { code: "good", state: "forged" }), /expired/);
  await assert.rejects(oauthFinish(store, { code: "bad", state: q.get("state") }), /didn't accept/);
  const { url: url2 } = await oauthStart(store, { env: "live", origin: "https://edge.example" });
  const r = await oauthFinish(store, { code: "good", state: new URL(url2).searchParams.get("state") });
  assert.equal(r.account.name, "APEX-0042");
  assert.ok(!JSON.stringify(await store.get("tradovateConn")).includes("tokA")); // sealed
  let b = await brokerFor(store);
  assert.equal(b.kind, "tradovate");
  assert.equal((await b.account()).name, "APEX-0042");

  // close to expiry → renewed and saved
  const realNow = Date.now;
  Date.now = () => realNow() + 4800e3 - 10 * 60e3; // 10 min before expiry
  b = await brokerFor(store);
  await b.account();
  assert.ok(seen.some((x) => x.url.endsWith("/auth/renewaccesstoken")));
  Date.now = () => realNow() + 2 * 4800e3 + 10 * 60e3; // well past the renewed token
  b = await brokerFor(store);
  await assert.rejects(b.account(), /Reconnect Tradovate/);
  Date.now = realNow;
});
