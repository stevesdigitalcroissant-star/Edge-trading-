const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../api/_databento");
const { memory } = require("../api/_store");

const CSV = `ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol
2024-03-04T10:00:00.000000000Z,33,1,123,2100.1,2101.0,2099.5,2100.8,50,GC.c.0
2024-03-04T10:01:00.000000000Z,33,1,123,2100.8,2102.4,2100.2,2102.0,40,GC.c.0
2024-03-04T10:04:00.000000000Z,33,1,123,2102.0,2102.1,2098.0,2098.5,70,GC.c.0
2024-03-04T10:05:00.000000000Z,33,1,123,2098.5,2099.0,2097.0,2097.5,30,GC.c.0`;

test("Databento CSV → 5-minute candles", () => {
  const one = db.parseCsv(CSV);
  assert.equal(one.length, 4);
  assert.equal(one[0][0], Date.parse("2024-03-04T10:00:00Z"));
  const five = db.rollUp(one, 5);
  assert.deepEqual(five[0], [Date.parse("2024-03-04T10:00:00Z"), 2100.1, 2102.4, 2098, 2098.5]);
  assert.equal(five.length, 2);
  // nanosecond timestamps (without pretty_ts) work too
  const ns = db.parseCsv("ts_event,open,high,low,close\n1709546400000000000,1,2,0.5,1.5");
  assert.equal(ns[0][0], Date.parse("2024-03-04T10:00:00Z"));
});

test("a month is fetched once with your key, then served from storage", async () => {
  process.env.DATABENTO_API_KEY = "db-test";
  const store = memory();
  let calls = 0, seen = null;
  const fake = async (url, opt) => { calls++; seen = { url, auth: opt.headers.Authorization }; return { ok: true, status: 200, text: async () => CSV }; };
  const a = await db.month(store, "gold", "2024-03", "5m", fake);
  const b = await db.month(store, "gold", "2024-03", "5m", fake);
  assert.equal(calls, 1);
  assert.equal(a.length, 2);
  assert.deepEqual(a, b);
  assert.match(seen.url, /dataset=GLBX\.MDP3/);
  assert.match(seen.url, /symbols=GC\.v\.0/);
  assert.match(seen.url, /schema=ohlcv-1m/);
  assert.equal(seen.auth, "Basic " + Buffer.from("db-test:").toString("base64"));
  const bad = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ detail: "Invalid API key" }) });
  await assert.rejects(db.month(memory(), "gold", "2024-04", "5m", bad), /Databento 401: Invalid API key/);
  delete process.env.DATABENTO_API_KEY;
});
