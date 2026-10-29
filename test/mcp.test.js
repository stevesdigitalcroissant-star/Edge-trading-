// David's read-only door: the key, the MCP handshake, the tools, and that nothing can write.
const test = require("node:test");
const assert = require("node:assert/strict");
const st = require("../api/_store");
const store = st.memory();
st.useStore(store);
const auth = require("../api/_auth");
const mcp = require("../api/mcp");

function call(body, key) {
  return new Promise((ok) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { ok({ code: this.code, j, h: this.headers }); }, end() { ok({ code: this.code }); } };
    mcp({ method: "POST", body, headers: key ? { authorization: "Bearer " + key } : {} }, res);
  });
}

test("no key, a wrong key, or a revoked key is refused", async () => {
  assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).code, 401);
  const { key } = await auth.newDavidKey(store);
  assert.match(key, /^edge_dv_/);
  assert.ok(!JSON.stringify(await store.get("davidKey")).includes(key), "only the hash is kept");
  assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, key + "x")).code, 401);
  await auth.revokeDavidKey(store);
  assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, key)).code, 401);
});

test("handshake, tool list and every tool answer, all read-only", async () => {
  const { key } = await auth.newDavidKey(store);
  const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, key);
  assert.equal(init.j.result.serverInfo.name, "edge");
  assert.equal((await call({ jsonrpc: "2.0", method: "notifications/initialized" }, key)).code, 202);
  const list = (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key)).j.result.tools.map((t) => t.name);
  assert.deepEqual(list, ["edge_today", "edge_setups", "edge_journal", "edge_coach", "edge_market", "edge_rules"]);
  for (const name of list.filter((n) => n !== "edge_market")) { // edge_market fetches prices: its own test below
    const r = (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } }, key)).j.result;
    assert.ok(!r.isError, name + ": " + r.content[0].text);
    JSON.parse(r.content[0].text);
  }
  const bad = (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "take", arguments: {} } }, key)).j;
  assert.equal(bad.error.code, -32602);
});

test("edge_market reads a market with Edge's own supply & demand rules", async () => {
  const candles = require("../api/candles");
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bars = []; let p = 2400; const t0 = Date.now() - 59 * 864e5;
  for (let t = t0; t < Date.now(); t += 5 * 60e3) { const o = p, c = p + (rnd() - 0.48) * 4, h = Math.max(o, c) + rnd() * 2, l = Math.min(o, c) - rnd() * 2; bars.push([t, o, h, l, c]); p = c; }
  const real = candles.load;
  candles.load = async (m, days, interval) => (interval === "15m" ? bars.filter((_, i) => i % 3 === 0) : bars);
  try {
    const { key } = await auth.newDavidKey(store);
    const one = (await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "edge_market", arguments: { market: "gold" } } }, key)).j.result;
    assert.ok(!one.isError, one.content[0].text);
    const r = JSON.parse(one.content[0].text);
    assert.equal(r.market, "gold");
    assert.equal(typeof r.price, "number");
    assert.ok(typeof r.status === "string" && r.status.length > 3, r.status);
    assert.equal(r.last5m.length, 36);
    const board = JSON.parse((await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "edge_market", arguments: {} } }, key)).j.result.content[0].text);
    assert.equal(board.rows.length, 9);
    assert.ok(board.rows.every((x) => !x.error), JSON.stringify(board.rows[0]));
  } finally { candles.load = real; }
});
