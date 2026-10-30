const test = require("node:test");
const assert = require("node:assert/strict");
const { memory, useStore } = require("../api/_store");
const candles = require("../api/candles");

const call = async (method, path, { key, body } = {}) => {
  let code = 200, out = null; const res = { setHeader() {}, status(c) { code = c; return res; }, json(j) { out = j; return res; } };
  await candles({ method, url: path, headers: { host: "x", ...(key ? { "x-edge-data": key } : {}) }, body }, res);
  return { code, out };
};

test("Teach Edge: charts go up with the data key, your marked-up examples are saved and read back", async () => {
  useStore(memory()); process.env.EDGE_DATA_TOKEN = "k-123";
  assert.equal((await call("PUT", "/api/candles?teach=1", { key: "nope", body: { i: 0, n: 1, items: [] } })).code, 401);
  assert.equal((await call("PUT", "/api/candles?teach=1", { key: "k-123", body: { i: 0, n: 1, items: [{ mk: "gold", day: "2024-03-04" }] } })).code, 200);
  const g = await call("GET", "/api/candles?teach=1", { key: "k-123" });
  assert.equal(g.out.items[0].mk, "gold");
  assert.equal((await call("GET", "/api/candles?drill=1", { key: "k-123" })).code, 404); // the Test-tab setups are kept apart
  assert.equal((await call("POST", "/api/candles?teach=1&label=1", { body: { label: { mk: "gold" } } })).code, 401); // not signed in
  assert.equal((await call("POST", "/api/candles?teach=1&label=1", { key: "k-123", body: { label: { mk: "gold" } } })).code, 400);
  const s = await call("POST", "/api/candles?teach=1&label=1", { key: "k-123", body: { label: { mk: "gold", day: "2024-03-04", zone: { lo: 1, hi: 2, dir: 1 } } } });
  assert.equal(s.code, 200);
  const all = await call("GET", "/api/candles?teach=1&labels=1", { key: "k-123" });
  assert.equal(all.out.count, 1); assert.equal(all.out.labels[0].zone.hi, 2);
  assert.equal((await call("GET", "/api/candles?teach=1&label=1", { key: "k-123" })).out.labels, undefined); // the app only asks for the count
});

test("Teach Edge: your trade plays out — limit fill, then target / stop / 16:00", () => {
  global.window = {}; require("../teach.js"); const { play } = global.window.EdgeTeach;
  const m = (rows) => ({ m: rows.map((r, i) => [...r, 180 + i * 5]) });
  const tr = { dir: 1, e: 10, sl: 9, tp: 13 };
  assert.deepEqual(play(m([[11, 11, 11, 11], [11, 11.5, 9.8, 10.2], [10.2, 13.2, 10.1, 13]]), tr, 0), { k: 2, how: "target", x: 13, fill: 1 });
  assert.equal(play(m([[11, 11, 11, 11], [11, 11, 8.5, 9]]), tr, 0).how, "stop"); // filled and stopped in one candle: the stop counts
  assert.equal(play(m([[11, 11, 11, 11], [11, 12, 10.5, 11]]), tr, 0).how, "never filled");
  assert.equal(play(m([[11, 11, 11, 11], [11, 11, 9.9, 10.5], [10.5, 11, 10.2, 10.8]]), tr, 0).how, "16:00 close");
});
