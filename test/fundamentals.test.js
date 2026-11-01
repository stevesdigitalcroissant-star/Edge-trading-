// Free-data fundamentals: each reading turns into a suggested answer with the numbers behind it.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../api/_fundamentals");

const daily = (from, to, n = 30) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, value: from + ((to - from) * i) / (n - 1) }));
// weekly series over ~6 years with a seasonal shape; `last` overrides the latest values
function weekly(seasonal, lastLevel, lastChange) {
  const rows = [];
  const start = Date.parse("2020-10-02");
  for (let w = 0; w < 315; w++) {
    const d = new Date(start + w * 7 * 864e5);
    rows.push({ date: d.toISOString().slice(0, 10), value: seasonal(w) });
  }
  if (lastLevel != null) { rows.at(-1).value = lastLevel; rows.at(-2).value = lastLevel - lastChange; }
  return rows;
}

test("dollar and real yields", () => {
  assert.equal(F.dollar(daily(120, 118)).value, 1, "dollar down 1.7% → bullish gold");
  assert.equal(F.dollar(daily(120, 120.2)).value, 0);
  assert.match(F.dollar(daily(120, 122)).text, /\+1\.1% in 4 weeks \(2026-09-30\)/);
  assert.equal(F.realYields(daily(2.0, 1.75)).value, 1, "real yields −25 bp → bullish gold");
  assert.equal(F.realYields(daily(2.0, 2.3)).value, -1);
});

test("COT: big speculators adding longs → bullish", () => {
  const rows = [400, 380, 360, 340, 300, 290].map((l, i) => ({ m_money_positions_long_all: String(l * 1000), m_money_positions_short_all: "100000", open_interest_all: "1000000", report_date_as_yyyy_mm_dd: `2026-09-${29 - i * 7}T00:00:00.000` }));
  const c = F.cot(rows);
  assert.equal(c.value, 1);
  assert.match(c.text, /net long 300\.0k contracts \(\+100\.0k in 4 weeks, 2026-09-29\)/);
});

test("crude stocks: a bigger draw than usual is bullish", () => {
  const rows = weekly((w) => 430000 + 2000 * Math.sin((w / 52) * 2 * Math.PI), 425000, -4000);
  const c = F.crudeStocks(rows);
  assert.equal(c.value, 1);
  assert.match(c.text, /Crude stocks −4\.0M bbl last week/);
});

test("gas storage: below the 5-year average and a small injection → bullish", () => {
  const seasonal = (w) => 2800 + 800 * Math.sin((w / 52) * 2 * Math.PI);
  const rows = weekly(seasonal);
  const usualLevel = rows.at(-1).value, usualCh = rows.at(-1).value - rows.at(-2).value;
  const g = F.gasStorage(weekly(seasonal, usualLevel * 0.9, usualCh - 20));
  assert.equal(g.storage.value, 1);
  assert.equal(g.eia.value, 1);
  assert.match(g.storage.text, /−10\.\d% vs the 5-year average/);
});

test("suggestions only include what was measured", () => {
  const sug = F.suggest({ dollar: { value: 1, text: "d" }, yields: null, cot: { gold: null, crude: { value: -1, text: "c" }, natgas: null }, crude: null, gas: null });
  assert.deepEqual(Object.keys(sug.gold), ["dxy"]);
  assert.deepEqual(sug.crude, { cot: { value: -1, text: "c", auto: true }, dxy: { value: 1, text: "d", auto: true } });
  assert.deepEqual(Object.keys(sug["6e"]), ["dxy"], "a weaker dollar helps the euro");
  assert.deepEqual(sug.natgas, {});
});

test("Fed (2-year), VIX, hedge-fund COT, and the yen as a safe haven", () => {
  assert.equal(F.fed2y(daily(4.0, 3.7)).value, 1, "2-year −30 bp → dovish → bullish");
  assert.match(F.fed2y(daily(4.0, 4.3)).text, /hawkish/);
  assert.equal(F.vix(daily(14, 28)).value, -1, "fear");
  assert.equal(F.vix(daily(20, 15)).value, 1, "calming down");
  const rows = [50, 40, 30, 20, 10, 5].map((l, i) => ({ lev_money_positions_long: String(l * 1000 + 100000), lev_money_positions_short: "100000", open_interest_all: "500000", report_date_as_yyyy_mm_dd: `2026-10-${27 - i * 4}T00:00:00.000` }));
  assert.equal(F.cotFin(rows).value, 1);
  const sug = F.suggest({ vix: { value: -1, text: "fear" }, cot: {} });
  assert.equal(sug["6j"].risk.value, 1, "fear is bullish for the yen");
  assert.equal(sug.nq.risk.value, -1, "and bearish for the Nasdaq");
});

test("the bias used: yours this week, else the data's (not checked), and the alert line", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const fund = { suggestions: { gold: { dxy: { value: 1 }, fed: { value: 1 } }, nq: { risk: { value: -1 } } } };
  const saved = { gold: { dir: "short", score: -2, updated: now - 3 * 864e5 }, nq: { dir: "long", score: 3, updated: now - 9 * 864e5 } };
  assert.deepEqual(F.biasNow("gold", saved, fund, now), { market: "gold", dir: "short", score: -2, source: "you", ageDays: 3, note: "" });
  const nq = F.biasNow("nq", saved, fund, now);
  assert.equal(nq.source, "data"); assert.equal(nq.dir, "neutral"); assert.equal(nq.savedDaysAgo, 9);
  assert.equal(F.biasNow("6j", saved, fund, now).source, "none");
  assert.match(F.biasLine({ dir: "short", source: "you" }, true), /Against your weekly bias \(bearish\)/);
  assert.match(F.biasLine({ dir: "long", source: "data" }, true), /With your weekly bias \(bullish, from the data/);
});
