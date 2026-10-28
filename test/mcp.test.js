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
  assert.deepEqual(list, ["edge_today", "edge_setups", "edge_journal", "edge_coach", "edge_rules"]);
  for (const name of list) {
    const r = (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } }, key)).j.result;
    assert.ok(!r.isError, name + ": " + r.content[0].text);
    JSON.parse(r.content[0].text);
  }
  const bad = (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "take", arguments: {} } }, key)).j;
  assert.equal(bad.error.code, -32602);
});
