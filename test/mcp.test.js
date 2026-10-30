// David's door into Edge: the key, the MCP handshake, the tools — he reads, writes only journal / notes / levels, never trades.
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

const tool = async (key, name, args = {}) => { const r = (await call({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, key)).j.result; return { err: r.isError ? r.content[0].text : null, out: r.isError ? null : JSON.parse(r.content[0].text) }; };

test("handshake, tool list; David reads, and writes only the journal, his notes and the levels", async () => {
  const { key } = await auth.newDavidKey(store);
  const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, key);
  assert.equal(init.j.result.serverInfo.name, "edge");
  assert.match(init.j.result.instructions, /support & resistance/);
  assert.equal((await call({ jsonrpc: "2.0", method: "notifications/initialized" }, key)).code, 202);
  const list = (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key)).j.result.tools.map((t) => t.name);
  assert.deepEqual(list, ["edge_today", "edge_market", "edge_scan", "edge_levels", "edge_levels_set", "edge_journal", "edge_journal_write", "edge_style", "edge_style_write", "edge_rules"]);
  assert.ok(!list.some((n) => /order|trade_|close|place|stop_move/.test(n)), "no trading tools");
  for (const name of ["edge_today", "edge_journal", "edge_rules", "edge_levels", "edge_style"]) { const r = await tool(key, name); assert.ok(!r.err, name + ": " + r.err); }
  assert.match(JSON.stringify((await tool(key, "edge_rules")).out.strategy), /Heikin Ashi/);
  // levels
  assert.deepEqual((await tool(key, "edge_levels_set", { market: "gold", levels: [2380, "2405.5", "x"] })).out.saved.levels, [2405.5, 2380]);
  assert.deepEqual((await tool(key, "edge_levels")).out.levels.gold, [2405.5, 2380]);
  // a trade David watched, then more notes on it
  assert.ok((await tool(key, "edge_journal_write", { market: "gold", dir: "long" })).err, "needs entry and stop");
  const w = (await tool(key, "edge_journal_write", { market: "gold", dir: "long", entry: 2400, stop: 2395, target: 2415, exit: 2410, emotion: "calm", followedRules: true, notes: "Waited for the 5m HA flip at support", tags: ["waited for the HA flip"] })).out.written;
  assert.equal(w.resultR, 2);
  const u = (await tool(key, "edge_journal_write", { id: w.id, notes: "Took profit early" })).out.updated;
  assert.match(u.note, /HA flip[\s\S]*profit early/);
  assert.equal((await tool(key, "edge_journal")).out.trades.find((t) => t.id === w.id).resultR, 2);
  // what David learns about him
  await tool(key, "edge_style_write", { kind: "strength", note: "Waits for the Heikin Ashi flip before entering." });
  assert.equal((await tool(key, "edge_style")).out.notes[0].kind, "strength");
  const bad = (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "take", arguments: {} } }, key)).j;
  assert.equal(bad.error.code, -32602);
});

test("edge_market / edge_scan read a market his way: trends, 80 SMA, Heikin Ashi, distance to his levels", async () => {
  const candles = require("../api/candles");
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bars = []; let p = 2400; const t0 = Date.now() - 59 * 864e5;
  for (let t = t0; t < Date.now(); t += 5 * 60e3) { const o = p, c = p + (rnd() - 0.48) * 4, h = Math.max(o, c) + rnd() * 2, l = Math.min(o, c) - rnd() * 2; bars.push([t, o, h, l, c]); p = c; }
  const daily = []; for (let i = 0; i < 300; i++) { const o = 2000 + i * 1.5, c = o + 1; daily.push([Date.now() - (300 - i) * 864e5, o, c + 2, o - 2, c]); }
  const real = candles.load;
  candles.load = async (m, days, interval) => (interval === "1d" ? daily : bars);
  try {
    const { key } = await auth.newDavidKey(store);
    const price = bars[bars.length - 1][4];
    await tool(key, "edge_levels_set", { market: "gold", levels: [price - 3, price + 5] });
    const r = (await tool(key, "edge_market", { market: "gold" })).out;
    assert.equal(r.market, "gold");
    assert.equal(r.trend.daily, "up");
    assert.ok(["up", "down", "mixed"].includes(r.trend.h4) && ["up", "down", "mixed"].includes(r.trend.h1));
    assert.ok(/green|red/.test(r.m5.heikinAshi) && ["above", "below"].includes(r.m15.sma80));
    assert.ok(Math.abs(r.levels.nearestSupport - (price - 3)) < 1e-9 && r.levels.distanceToSupportATR15 > 0);
    assert.equal(r.last2h15m.length, 8);
    const scan = (await tool(key, "edge_scan")).out;
    assert.equal(scan.rows.length, 9);
    assert.equal(scan.rows[0].market, "gold", "the market with levels saved comes first");
    assert.ok(scan.rows.every((x) => !x.error));
  } finally { candles.load = real; }
});
