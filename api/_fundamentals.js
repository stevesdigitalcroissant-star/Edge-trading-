// Weekly fundamentals, filled in from free official data. Edge suggests an answer
// for each factor it can measure, with the numbers behind it; you confirm (or change)
// and save. Factors it can't measure (Fed tone, OPEC, weather, LNG, geopolitics) stay
// for you to answer.
//
//   COT (big speculators)  CFTC public reporting API — free, no key
//   US dollar, real yields FRED (St. Louis Fed) CSV — free, no key
//   Crude stocks, gas storage  EIA API — free key (EIA_API_KEY, eia.gov/opendata)
//
// Cached for 6 hours. Each source fails on its own without breaking the others.

const COT = { gold: "088691", crude: "067651", natgas: "023651", silver: "084691" }; // CFTC contract codes: COMEX gold, NYMEX WTI, NYMEX Henry Hub, COMEX silver
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
  const pick = (x) => (x ? { value: x.value, text: x.text, auto: true } : null);
  const out = {
    gold: { dxy: pick(d.dollar), yields: pick(d.yields), cot: pick(d.cot && d.cot.gold) },
    crude: { eia: pick(d.crude), cot: pick(d.cot && d.cot.crude), dxy: pick(d.dollar) },
    natgas: { storage: pick(d.gas && d.gas.storage), eia: pick(d.gas && d.gas.eia), cot: pick(d.cot && d.cot.natgas) },
    silver: { dxy: pick(d.dollar), cot: pick(d.cot && d.cot.silver) },
  };
  for (const m of Object.keys(out)) for (const f of Object.keys(out[m])) if (!out[m][f]) delete out[m][f];
  return out;
}

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

async function cftc(code) {
  const q = new URLSearchParams({ cftc_contract_market_code: code, $order: "report_date_as_yyyy_mm_dd DESC", $limit: "6" });
  return get(`https://publicreporting.cftc.gov/resource/72hh-3qpy.json?${q}`);
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
  const [dx, ry, cg, cc, cn, crude, gas, cs] = await Promise.all([
    safe("Dollar (FRED)", fred("DTWEXBGS")), safe("Real yields (FRED)", fred("DFII10")),
    safe("COT gold", cftc(COT.gold)), safe("COT crude", cftc(COT.crude)), safe("COT gas", cftc(COT.natgas)),
    safe("EIA crude", eia("PET.WCESTUS1.W")), safe("EIA gas storage", eia("NG.NW2_EPG0_SWO_R48_BCF.W")),
    safe("COT silver", cftc(COT.silver)),
  ]);
  const data = { dollar: dollar(dx), yields: realYields(ry), cot: { gold: cot(cg), crude: cot(cc), natgas: cot(cn), silver: cot(cs) }, crude: crudeStocks(crude), gas: gasStorage(gas) };
  const doc = { at: now, suggestions: suggest(data), errors: [...new Set(errors)] };
  await store.set("fundamentals", doc);
  return doc;
}

module.exports = { load, suggest, dollar, realYields, cot, crudeStocks, gasStorage, COT };
