const test = require("node:test");
const assert = require("node:assert");
const { replaySetup } = require("../api/_core");

const T = 1_800_000_000_000, m5 = 5 * 60e3;
const bar = (i, o, h, l, c) => [T + i * m5, o, h, l, c];
const long = { dir: "long", at: T, expires: T + 3 * 3600e3, entry: 100, sl: 98, tp: 106 };

test("a skipped long that filled and ran to the target is a missed win", () => {
  assert.deepStrictEqual(replaySetup(long, [bar(0, 103, 103, 101, 102), bar(1, 102, 102, 99.5, 100.5), bar(2, 100.5, 104, 100, 103.8), bar(3, 104, 106.5, 103, 106)]), { res: "win", R: 3 });
});
test("filled, then the stop first = a good skip", () => {
  assert.deepStrictEqual(replaySetup(long, [bar(1, 101, 101, 99.8, 100), bar(2, 100, 100.5, 97.5, 98)]), { res: "loss", R: -1 });
});
test("ran to the target without filling = never filled", () => {
  assert.strictEqual(replaySetup(long, [bar(1, 101, 103, 100.5, 102), bar(2, 102, 107, 101, 106.5)]).res, "nofill");
});
test("a short mirrors it", () => {
  const short = { dir: "short", at: T, expires: T + 3 * 3600e3, entry: 100, sl: 102, tp: 94 };
  assert.deepStrictEqual(replaySetup(short, [bar(1, 99, 100.2, 98, 98.5), bar(2, 98.5, 99, 93.5, 94)]), { res: "win", R: 3 });
});
test("not decided yet", () => {
  assert.strictEqual(replaySetup(long, [bar(1, 101, 101, 99.8, 100.2)]), null);
});
