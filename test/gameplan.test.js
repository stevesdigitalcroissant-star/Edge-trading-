// The 5-minute game plan: one brief when London and New York open, one recap after — sent from the heartbeat.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_HOOK_SECRET = "s3cret";
global.fetch = async () => { throw new Error("offline"); };
const { memory } = require("../api/_store");
const core = require("../api/_core");
const { zonedTime } = require("../api/_time");
const broker = { kind: "manual", label: "manual" };
const NY = (h, m = 0) => zonedTime(2026, 10, 6, h, m, "America/New_York");

test("brief at the London open (once), with the prop account and markets near a zone; recap after New York", async () => {
  const store = memory();
  await core.action(store, broker, { action: "propSave", cfg: { firm: "tradeify", plan: "select-flex", size: 50000, target: 3000, dd: 2000, consistencyPct: 40, baseRisk: 250 } }, NY(1));
  const bar = (h, m, near) => core.handleHook(store, broker, { secret: "s3cret", type: "bar", symbol: "MGC1!", price: 2400, high: 2401, low: 2399, near }, NY(h, m));
  await bar(2, 50, "4H demand 2380–2386");
  assert.equal(await store.get("gameplan"), null);
  await bar(3, 5, "4H demand 2380–2386");
  const gp = await store.get("gameplan");
  assert.equal(gp.slot, "london");
  assert.match(gp.text, /2 trades left today · risk \$250/);
  assert.match(gp.text, /\$3,000 to the target/);
  assert.match(gp.text, /Gold: 4H demand 2380–2386/);
  await bar(3, 10); assert.equal((await store.get("gameplan")).at, NY(3, 5)); // once per session
  await bar(14, 5);
  assert.equal((await store.get("gameplan")).slot, "recap");
  assert.match((await store.get("gameplan")).text, /No trades today/);
});
