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

test("close-out window: warn 15 min before, no new trades 30 min before, until the evening reopen", () => {
  assert.deepEqual(R.closeOut(NY(15, 0), s), { minutesLeft: 100, warn: false, due: false, noNew: false });
  assert.equal(R.closeOut(NY(16, 15), s).noNew, true);
  assert.equal(R.closeOut(NY(16, 30), s).warn, true);
  assert.equal(R.closeOut(NY(16, 45), s).due, true);
  assert.equal(R.closeOut(NY(18, 30), s).noNew, false);
  const g = R.gradeSetup({ market: "gold", dir: "long", entry: 1, sl: 0.9, trend4h: 1 }, { settings: s, bias: {}, now: NY(16, 20) });
  assert.ok(g.blocks.some((b) => b.id === "closeout"));
});

test("Close everything: sends the exit for routed trades, logs hand-placed ones with a reminder", async () => {
  sent.length = 0;
  const store = memory();
  const broker = getBroker();
  const now = NY(16, 30);
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
  await bar(16, 26); await bar(16, 31);
  assert.equal((await store.lrange("log", 20)).filter((l) => /min to the close-out/.test(l.text)).length, 1);
  await bar(16, 41);
  assert.deepEqual(sent.map((x) => x.action), ["exit"]);
  const st = await core.state(store, broker, NY(16, 42));
  assert.deepEqual(st.open.map((t) => t.market), ["crude"], "the hand-placed trade stays — Edge can't close it");
});
