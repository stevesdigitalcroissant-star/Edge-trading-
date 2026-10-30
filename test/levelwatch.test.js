// Edge's own level watch: one alert at a touch, quiet until price leaves, a BUY setup on the 5m flip, David told (signed).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const st = require("../api/_store");
const store = st.memory();
st.useStore(store);
const mcp = require("../api/mcp");
const { levelWatch } = require("../api/_levelwatch");

const T0 = Date.UTC(2026, 9, 26, 0, 0), M5 = 5 * 60e3;
// a slow climb from 90 to 97, then a quick dip to the 95 support and a strong bounce
const closes = [];
for (let i = 0; i < 1200; i++) closes.push(90 + (7 * i) / 1200 + Math.sin(i / 3) * 0.15);
closes.push(96.4, 95.8, 95.3, 95.1, 95.15, 97.6, 98, 98.2, 98.4, 98.5, 98.6);
const bars = closes.map((c, i) => { const o = i ? closes[i - 1] : c; return [T0 + i * M5, o, Math.max(o, c) + 0.05, Math.min(o, c) - 0.05, c]; });
const deps = { mcp: { ...mcp, readOne: async () => ({ trends: { daily: "up", h4: "up", h1: "mixed" }, sma15: "above", ha5: "just turned green" }) }, load: async () => bars };

test("touch once, then a BUY setup, both sent to David signed with the key's hash", async () => {
  const sent = [];
  global.fetch = async (url, o) => { sent.push({ url, body: o.body, sig: o.headers["X-Edge-Signature"] }); return { ok: true }; };
  await store.set("levels", { "6e": [95] });
  await store.set("davidKey", { hash: "abc123", at: 1 });
  await store.set("davidHook", { url: "https://example.com/hook" });
  const all = [];
  for (let i = 1200; i <= closes.length + 1; i++) { await store.set("lw:at", 0); const r = await levelWatch(store, T0 + i * M5 + 1000, deps); all.push(...r.events); }
  const kinds = all.map((e) => e.kind);
  assert.deepEqual(kinds, ["level", "setup"], JSON.stringify(all));
  assert.equal(all[0].side, "support"); assert.equal(all[1].dir, "long");
  assert.equal(sent.length, 2);
  for (const x of sent) assert.equal(x.sig, crypto.createHmac("sha256", "abc123").update(x.body).digest("hex"));
  assert.match(JSON.parse(sent[1].body).text, /BUY setup at your support 95/);
  const log = await store.lrange("log", 5);
  assert.ok(log.some((l) => l.kind === "level") && log.some((l) => l.kind === "setup"));
});

test("runs at most every 5 minutes", async () => {
  await store.set("lw:at", T0);
  assert.equal((await levelWatch(store, T0 + 60e3, deps)).skipped, true);
});
