// Session close-out + Close everything.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
process.env.TRADERSPOST_WEBHOOK_URL = "https://webhooks.traderspost.io/trading/webhook/test/abc";
const sent = [];
global.fetch = async (url, opts) => {
  if (String(url).startsWith("https://webhooks.traderspost.io")) { sent.push(JSON.parse(opts.body)); return new Response("{}", { status: 200 }); }
  throw new Error("offline");
};
const { memory } = require("../api/_store");
const { getBroker } = require("../api/_broker");
const core = require("../api/_core");
const R = require("../api/_rules");
const { mergeSettings } = require("../api/_config");
const { zonedTime } = require("../api/_time");
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");
const s = mergeSettings({});

test("close-out window: out by 15:55 (the firm closes at 16:10) — warn 15 min before, no new trades 30 min before", () => {
  assert.deepEqual(R.closeOut(NY(15, 0), s), { flatAt: "15:55", minutesLeft: 55, warn: false, due: false, noNew: false });
  assert.equal(R.closeOut(NY(15, 30), s).noNew, true);
  assert.equal(R.closeOut(NY(15, 45), s).warn, true);
  assert.equal(R.closeOut(NY(16, 0), s).due, true);
  // half day (day after Thanksgiving): out by 12:45 — the firm doesn't auto-close on half days
  const half = (h, m) => zonedTime(2026, 11, 27, h, m, "America/New_York");
  assert.equal(R.closeOut(half(12, 50), s).due, true);
  assert.equal(R.closeOut(half(12, 50), s).flatAt, "12:45");
  // an old saved 16:40 close-out is replaced by the safe one
  assert.equal(mergeSettings({ flatBy: "16:40" }).flatBy, "15:55");
  assert.equal(R.closeOut(NY(18, 30), s).noNew, false);
  const g = R.gradeSetup({ market: "gold", dir: "long", entry: 1, sl: 0.9, trend4h: 1 }, { settings: s, bias: {}, now: NY(16, 20) });
  assert.ok(g.blocks.some((b) => b.id === "closeout"));
});

test("Close everything: sends the exit for routed trades, logs hand-placed ones with a reminder", async () => {
  sent.length = 0;
  const store = memory();
  const broker = getBroker();
  const now = NY(15, 30);
  await core.action(store, broker, { action: "manualOpen", market: "crude", dir: "long", entry: 70, sl: 69.6 }, now);
  await store.hset("trades", "tp:1", { id: "tp:1", source: "traderspost", market: "gold", symbol: "MGC1!", ticker: "MGC1!", dir: "long", entry: 2650, initialSL: 2642, currentSL: 2642, tp: 2675.6, openedAt: now, lastPrice: 2658 });
  await store.set("price:crude", { price: 70.2, time: now });
  const r = await core.action(store, broker, { action: "closeAll" }, now);
  assert.equal(r.closed, 2);
  assert.equal(r.manual, 1);
  assert.deepEqual(sent.map((x) => [x.ticker, x.action]), [["MGC1!", "exit"]]);
  const st = await core.state(store, broker, now);
  assert.equal(st.open.length, 0);
  assert.equal(st.journal.find((t) => t.market === "crude").resultR, 0.5);
  assert.ok(st.log.some((l) => /close them in TradingView|close it in TradingView/.test(l.text)));
});

test("close-out: one warning, then auto-close (when switched on) only what Edge can close", async () => {
  sent.length = 0;
  const store = memory();
  const broker = getBroker();
  await core.action(store, broker, { action: "settings", patch: { autoFlat: true } }, NY(9));
  await store.hset("trades", "tp:2", { id: "tp:2", source: "traderspost", market: "gold", symbol: "MGC1!", ticker: "MGC1!", dir: "long", entry: 2650, initialSL: 2642, currentSL: 2642, tp: 2675.6, openedAt: NY(9) });
  await core.action(store, broker, { action: "manualOpen", market: "crude", dir: "short", entry: 70, sl: 70.4 }, NY(9));
  const bar = (h, m) => core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2655, high: 2656, low: 2654 }, NY(h, m));
  await bar(15, 26); await bar(15, 41);
  assert.equal((await store.lrange("log", 20)).filter((l) => /min to the close-out/.test(l.text)).length, 1);
  await bar(15, 56);
  assert.deepEqual(sent.map((x) => x.action), ["exit"]);
  const st = await core.state(store, broker, NY(15, 57));
  assert.deepEqual(st.open.map((t) => t.market), ["crude"], "the hand-placed trade stays — Edge can't close it");
});

test("news: 10 min before a big release Edge cancels the waiting limits and gets you flat (firm rule: 2 min before → 2 min after)", async () => {
  const store = memory();
  const broker = { kind: "manual", label: "manual" };
  const T = NY(8, 30), now = T - 9 * 60e3;
  await store.set("news", { fetched: now, ok: true, events: [{ title: "CPI m/m", country: "USD", impact: "High", time: T, forecast: "", previous: "" }] });
  await store.hset("orders", "o1", { id: "o1", market: "nq", dir: "long", entry: 1, sl: 0.9, tp: 1.3, placedAt: now - 3600e3, trade: { id: "t1", market: "nq", dir: "long", entry: 1, initialSL: 0.9, tp: 1.3 } });
  await core.tick(store, broker, now);
  assert.equal(Object.keys((await store.hgetall("orders")) || {}).length, 0);
  const log = (await store.lrange("log", 10)).map((l) => l.text).join(" | ");
  assert.match(log, /CPI m\/m at 08:30/);
  assert.match(log, /cancel your .* limit/);
  // once per release
  await core.tick(store, broker, now + 60e3);
  assert.equal((await store.lrange("log", 20)).filter((l) => /CPI m\/m at 08:30/.test(l.text)).length, 1);
});
