// Weekly fundamentals, filled in from free official data. Edge suggests an answer
// for each factor it can measure, with the numbers behind it; you confirm (or change)
// and save. Factors it can't measure (Fed tone, OPEC, weather, LNG, geopolitics) stay
// for you to answer.
//
//   COT (big speculators)  CFTC public reporting API — free, no key
//   US dollar, real yields, FRED (St. Louis Fed) CSV — free, no key
//   2-year (Fed expectations), 10-year, VIX
//   COT for currencies & indices  CFTC "traders in financial futures" (leveraged funds) — free, no key
//   Crude stocks, gas storage  EIA API — free key (EIA_API_KEY, eia.gov/opendata)
//
// Cached for 6 hours. Each source fails on its own without breaking the others.

const COT = { gold: "088691", crude: "067651", natgas: "023651", silver: "084691", copper: "085692" }; // CFTC disaggregated: COMEX gold, NYMEX WTI, Henry Hub, COMEX silver, COMEX copper
const TFF = { "6e": "099741", "6j": "097741", "6a": "232741", nq: "209742", ym: "124603" }; // CFTC financial futures: euro, yen, Aussie, Nasdaq-100 mini, Dow $5
const CACHE_MS = 6 * 3600e3;
const DAY = 864e5;

const pct = (a, b) => ((a - b) / b) * 100;
const sgn = (x, thr) => (x > thr ? 1 : x < -thr ? -1 : 0);
const k = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const signed = (n, f = (x) => x) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${f(Math.abs(n))}`;

// ---------- analyzers (pure — tested with sample data)

// rows: [{date, value}] oldest → newest (daily). 20 trading days ≈ 4 weeks.
function dollar(rows) {
  if (!rows || rows.length < 21) return null;
  const now = rows.at(-1), then = rows.at(-21), ch = pct(now.value, then.value);
  return { value: sgn(-ch, 0.5), text: `Dollar index ${signed(ch, (x) => x.toFixed(1))}% in 4 weeks (${now.date})`, raw: ch };
}

function realYields(rows) {
  if (!rows || rows.length < 21) return null;
  const now = rows.at(-1), then = rows.at(-21), bp = (now.value - then.value) * 100;
  return { value: sgn(-bp, 10), text: `10-year real yield ${now.value.toFixed(2)}% (${signed(bp, (x) => x.toFixed(0))} bp in 4 weeks)`, raw: bp };
}

// US 2-year yield = what the market expects from the Fed. Falling 15 bp+ in 4 weeks = cuts priced in (dovish).
function fed2y(rows) {
  if (!rows || rows.length < 21) return null;
  const now = rows.at(-1), then = rows.at(-21), bp = (now.value - then.value) * 100;
  return { value: sgn(-bp, 15), text: `US 2-year ${now.value.toFixed(2)}% (${signed(bp, (x) => x.toFixed(0))} bp in 4 weeks — ${bp <= -15 ? "more cuts priced in, dovish" : bp >= 15 ? "fewer cuts, hawkish" : "no big change"}, ${now.date})`, raw: bp };
}

function yield10(rows) {
  if (!rows || rows.length < 21) return null;
  const now = rows.at(-1), then = rows.at(-21), bp = (now.value - then.value) * 100;
  return { value: sgn(-bp, 15), text: `US 10-year ${now.value.toFixed(2)}% (${signed(bp, (x) => x.toFixed(0))} bp in 4 weeks, ${now.date})`, raw: bp };
}

// VIX: +1 = calm / risk-on (falling, or low and steady), −1 = fear (spiking or above 25)
function vix(rows) {
  if (!rows || rows.length < 21) return null;
  const now = rows.at(-1), then = rows.at(-21), ch = now.value - then.value;
  const value = now.value >= 25 || ch >= 4 ? -1 : ch <= -3 || (now.value < 16 && ch < 2) ? 1 : 0;
  return { value, text: `VIX ${now.value.toFixed(1)} (${signed(ch, (x) => x.toFixed(1))} in 4 weeks — ${value > 0 ? "calm, risk-on" : value < 0 ? "fear, risk-off" : "mixed"}, ${now.date})`, raw: ch };
}

// rows: CFTC disaggregated, newest first
function cot(rows) {
  if (!rows || rows.length < 5) return null;
  const net = (r) => Number(r.m_money_positions_long_all) - Number(r.m_money_positions_short_all);
  const n0 = net(rows[0]), n4 = net(rows[4]), oi = Number(rows[0].open_interest_all) || 1;
  const ch = n0 - n4;
  return {
    value: sgn(ch / oi, 0.03),
    text: `Big speculators net ${n0 >= 0 ? "long" : "short"} ${k(Math.abs(n0))} contracts (${signed(ch, k)} in 4 weeks, ${String(rows[0].report_date_as_yyyy_mm_dd).slice(0, 10)})`,
    raw: ch,
  };
}

// rows: CFTC traders in financial futures, newest first — leveraged funds (hedge funds, CTAs) are the speculators
function cotFin(rows) {
  if (!rows || rows.length < 5) return null;
  const net = (r) => Number(r.lev_money_positions_long) - Number(r.lev_money_positions_short);
  const n0 = net(rows[0]), n4 = net(rows[4]), oi = Number(rows[0].open_interest_all) || 1;
  if (!Number.isFinite(n0) || !Number.isFinite(n4)) return null;
  const ch = n0 - n4;
  return {
    value: sgn(ch / oi, 0.03),
    text: `Hedge funds net ${n0 >= 0 ? "long" : "short"} ${k(Math.abs(n0))} contracts (${signed(ch, k)} in 4 weeks, ${String(rows[0].report_date_as_yyyy_mm_dd).slice(0, 10)})`,
    raw: ch,
  };
}

// weekly series, oldest → newest. Same week in each of the past 5 years.
function sameWeekLastYears(rows, idx, years = 5) {
  const t = Date.parse(rows[idx].date), out = [];
  for (let y = 1; y <= years; y++) {
    const target = t - 364 * y * DAY;
    let best = -1, gap = Infinity;
    for (let i = 1; i < rows.length; i++) { const g = Math.abs(Date.parse(rows[i].date) - target); if (g < gap) { gap = g; best = i; } }
    if (best > 0 && gap <= 4 * DAY) out.push(best);
  }
  return out;
}

// US commercial crude stocks (thousand barrels), weekly
function crudeStocks(rows) {
  if (!rows || rows.length < 260) return null;
  const i = rows.length - 1, ch = rows[i].value - rows[i - 1].value;
  const past = sameWeekLastYears(rows, i).map((j) => rows[j].value - rows[j - 1].value);
  if (past.length < 3) return null;
  const avg = past.reduce((a, b) => a + b, 0) / past.length;
  const mb = (x) => `${(x / 1000).toFixed(1)}M bbl`;
  return {
    value: sgn(avg - ch, 1000), // a bigger draw / smaller build than usual is bullish
    text: `Crude stocks ${signed(ch, mb)} last week (usual for this week: ${signed(avg, mb)}, ${rows[i].date})`,
    raw: ch - avg,
  };
}

// Lower-48 working gas in storage (Bcf), weekly → two answers: level vs 5-yr average, and last week's change vs usual
function gasStorage(rows) {
  if (!rows || rows.length < 260) return null;
  const i = rows.length - 1, past = sameWeekLastYears(rows, i);
  if (past.length < 3) return null;
  const avgLevel = past.reduce((a, j) => a + rows[j].value, 0) / past.length;
  const avgCh = past.reduce((a, j) => a + rows[j].value - rows[j - 1].value, 0) / past.length;
  const level = rows[i].value, ch = level - rows[i - 1].value, diff = pct(level, avgLevel);
  return {
    storage: { value: sgn(-diff, 3), text: `Storage ${Math.round(level)} Bcf — ${signed(diff, (x) => x.toFixed(1))}% vs the 5-year average (${rows[i].date})`, raw: diff },
    eia: { value: sgn(avgCh - ch, 5), text: `Last report ${signed(ch, (x) => Math.round(x) + " Bcf")} (usual for this week: ${signed(avgCh, (x) => Math.round(x) + " Bcf")})`, raw: ch - avgCh },
  };
}

// Combine into suggested answers per market (factor ids match _config BIAS_FACTORS).
function suggest(d) {
  const pick = (x, flip = false) => (x ? { value: flip ? -x.value : x.value, text: x.text, auto: true } : null);
  const cot = d.cot || {};
  const out = {
    gold: { dxy: pick(d.dollar), yields: pick(d.yields), fed: pick(d.fed), cot: pick(cot.gold) },
    silver: { dxy: pick(d.dollar), cot: pick(cot.silver) },
    copper: { dxy: pick(d.dollar), risk: pick(d.vix), cot: pick(cot.copper) },
    crude: { eia: pick(d.crude), cot: pick(cot.crude), dxy: pick(d.dollar) },
    natgas: { storage: pick(d.gas && d.gas.storage), eia: pick(d.gas && d.gas.eia), cot: pick(cot.natgas) },
    nq: { fed: pick(d.fed), yields: pick(d.y10), risk: pick(d.vix), cot: pick(cot.nq) },
    ym: { fed: pick(d.fed), yields: pick(d.y10), risk: pick(d.vix), cot: pick(cot.ym) },
    "6e": { dxy: pick(d.dollar), fed: pick(d.fed), cot: pick(cot["6e"]) },
    "6a": { dxy: pick(d.dollar), risk: pick(d.vix), cot: pick(cot["6a"]) },
    "6j": { yields: pick(d.y10), risk: pick(d.vix, true), dxy: pick(d.dollar), cot: pick(cot["6j"]) }, // the yen is a safe haven: fear = bullish
  };
  // silver follows gold: gold's measured lines decide
  const g = Object.values(out.gold).filter(Boolean).reduce((a, x) => a + x.value, 0);
  if (Object.values(out.gold).some(Boolean)) out.silver.gold = { value: sgn(g, 1), text: `Gold's data lines add up to ${g > 0 ? "+" : ""}${g}`, auto: true };
  for (const m of Object.keys(out)) for (const f of Object.keys(out[m])) if (!out[m][f]) delete out[m][f];
  return out;
}

// The bias to use for a market right now: the one he saved this week, else what the data says on its own
// (marked "data — not checked yet"), else none. dir: long / short / neutral.
function biasNow(market, saved, fund, now = Date.now(), maxDays = 7) {
  const b = saved && saved[market];
  const age = b ? (now - b.updated) / DAY : null;
  if (b && age <= maxDays) return { market, dir: b.dir, score: b.score, source: "you", ageDays: Math.floor(age), note: b.note || "" };
  const sug = fund && fund.suggestions && fund.suggestions[market];
  if (sug && Object.keys(sug).length) {
    const score = Object.values(sug).reduce((a, x) => a + x.value, 0);
    return { market, dir: score >= 2 ? "long" : score <= -2 ? "short" : "neutral", score, source: "data", checked: false, ...(b ? { savedDaysAgo: Math.floor(age) } : {}) };
  }
  return { market, dir: null, score: null, source: "none" };
}
async function biasAll(store, now = Date.now()) {
  const { BIAS_MARKETS } = require("./_config");
  const [saved, fund] = await Promise.all([store.get("bias").catch(() => null), store.get("fundamentals").catch(() => null)]);
  return Object.fromEntries(BIAS_MARKETS.map((m) => [m, biasNow(m, saved, fund, now)]));
}
// One line for an alert: is this trade with his weekly bias?
function biasLine(b, buy) {
  if (!b || !b.dir) return "Weekly bias: not set yet.";
  const src = b.source === "data" ? ", from the data — not checked yet" : "";
  if (b.dir === "neutral") return `Weekly bias: neutral${src} — no help either way, trade your level.`;
  return (b.dir === "long") === buy ? `✅ With your weekly bias (${biasWord(b.dir)}${src}).` : `⚠️ Against your weekly bias (${biasWord(b.dir)}${src}) — smaller size or skip.`;
}
const biasWord = (d) => (d === "long" ? "bullish" : d === "short" ? "bearish" : d === "neutral" ? "neutral" : "not set");

// ---------- fetchers

async function get(url, as = "json") {
  const r = await fetch(url, { headers: { "User-Agent": "edge-copilot/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`);
  return as === "json" ? r.json() : r.text();
}

async function fred(id) {
  const csv = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, "text");
  return csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).map(([date, v]) => ({ date, value: Number(v) })).filter((r) => r.date && Number.isFinite(r.value));
}

async function cftc(code, dataset = "72hh-3qpy") { // 72hh-3qpy = disaggregated (commodities), gpe5-46if = financial futures
  const q = new URLSearchParams({ cftc_contract_market_code: code, $order: "report_date_as_yyyy_mm_dd DESC", $limit: "6" });
  return get(`https://publicreporting.cftc.gov/resource/${dataset}.json?${q}`);
}

async function eia(series) {
  const key = process.env.EIA_API_KEY;
  if (!key) throw new Error("add a free EIA_API_KEY (eia.gov/opendata) for inventories and storage");
  const start = new Date(Date.now() - 6.5 * 365 * DAY).toISOString().slice(0, 10);
  const j = await get(`https://api.eia.gov/v2/seriesid/${series}?api_key=${encodeURIComponent(key)}&start=${start}`);
  return ((j.response && j.response.data) || []).map((r) => ({ date: String(r.period).slice(0, 10), value: Number(r.value) }))
    .filter((r) => Number.isFinite(r.value)).sort((a, b) => a.date.localeCompare(b.date));
}

async function load(store, { force = false, now = Date.now() } = {}) {
  const cached = await store.get("fundamentals");
  if (!force && cached && now - cached.at < CACHE_MS) return cached;
  const errors = [];
  const safe = (name, p) => p.catch((e) => { errors.push(`${name}: ${e.message}`); return null; });
  const [dx, ry, f2, y10, vx, crude, gas] = await Promise.all([
    safe("Dollar (FRED)", fred("DTWEXBGS")), safe("Real yields (FRED)", fred("DFII10")), safe("2-year yield (FRED)", fred("DGS2")),
    safe("10-year yield (FRED)", fred("DGS10")), safe("VIX (FRED)", fred("VIXCLS")),
    safe("EIA crude", eia("PET.WCESTUS1.W")), safe("EIA gas storage", eia("NG.NW2_EPG0_SWO_R48_BCF.W")),
  ]);
  const cotRows = {};
  await Promise.all([
    ...Object.entries(COT).map(async ([m, c]) => { cotRows[m] = cot(await safe(`COT ${m}`, cftc(c))); }),
    ...Object.entries(TFF).map(async ([m, c]) => { cotRows[m] = cotFin(await safe(`COT ${m}`, cftc(c, "gpe5-46if"))); }),
  ]);
  const data = { dollar: dollar(dx), yields: realYields(ry), fed: fed2y(f2), y10: yield10(y10), vix: vix(vx), cot: cotRows, crude: crudeStocks(crude), gas: gasStorage(gas) };
  const doc = { at: now, suggestions: suggest(data), errors: [...new Set(errors)] };
  await store.set("fundamentals", doc);
  return doc;
}

module.exports = { load, suggest, biasNow, biasAll, biasLine, biasWord, dollar, realYields, fed2y, yield10, vix, cot, cotFin, crudeStocks, gasStorage, COT, TFF };
