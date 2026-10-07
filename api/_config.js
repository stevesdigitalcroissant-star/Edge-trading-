// Markets, default rules and the weekly fundamentals checklist.
// Everything the trader can change lives in DEFAULT_SETTINGS (saved under "settings").

const MARKETS = {
  gold: {
    name: "Gold",
    unit: "oz",
    lot: 100, // typical CFD/MT lot: 100 oz
    // TradingView tickers: OANDA:XAUUSD, FOREXCOM:XAUUSD, COMEX:GC1!, MGC1!, TVC:GOLD…
    match: /XAU|GOLD|^M?GC/i,
    instrument: () => "XAU_USD",
  },
  crude: {
    name: "Crude oil",
    unit: "barrels",
    lot: 1000,
    match: /WTI|USOIL|UKOIL|BRENT|BCO|^M?CL|OIL/i,
    instrument: (sym) => (/BCO|BRENT|UKOIL/i.test(sym) ? "BCO_USD" : "WTICO_USD"),
  },
  natgas: {
    name: "Natural gas",
    unit: "MMBtu",
    lot: 10000,
    match: /NATGAS|NGAS|XNG|^NG|^QG|^MNG/i,
    instrument: () => "NATGAS_USD",
  },
};

// Futures contracts you can trade from TradingView (Tradovate, prop firms).
// pv = dollars per 1.00 move in price, tick = smallest price step.
const FUTURES = [
  { root: "MGC", market: "gold", name: "Micro Gold", pv: 10, tick: 0.1 },
  { root: "GC", market: "gold", name: "Gold", pv: 100, tick: 0.1 },
  { root: "MCL", market: "crude", name: "Micro Crude", pv: 100, tick: 0.01 },
  { root: "CL", market: "crude", name: "Crude Oil", pv: 1000, tick: 0.01 },
  { root: "MNG", market: "natgas", name: "Micro Henry Hub", pv: 1000, tick: 0.001 },
  { root: "QG", market: "natgas", name: "E-mini Natural Gas", pv: 2500, tick: 0.005 },
  { root: "NG", market: "natgas", name: "Natural Gas", pv: 10000, tick: 0.001 },
];
// "NYMEX:MCL1!", "MCLX2026", "COMEX_MINI:MGC1!" → the contract spec (null for CFDs like XAUUSD)
function futuresSpec(symbol) {
  const s = String(symbol || "").replace(/^[A-Z_]+:/i, "").toUpperCase();
  return FUTURES.find((f) => new RegExp(`^${f.root}(\\d|[FGHJKMNQUVXZ]\\d|1!|2!)`).test(s)) || null;
}

// Which market a TradingView symbol belongs to. Natural gas is checked first
// so "NATGASUSD" never falls through to another pattern.
function marketOf(symbol) {
  const s = String(symbol || "").replace(/^[A-Z_]+:/i, "");
  for (const id of ["natgas", "gold", "crude"]) if (MARKETS[id].match.test(s)) return id;
  return null;
}

const DEFAULT_SETTINGS = {
  tz: "America/New_York",
  riskPct: 1, // % of the account risked per trade
  accountSize: 10000, // used for sizing when no broker is connected
  beAtR: 2, // move the stop to break-even when the trade reaches +2R
  beOffsetR: 0.05, // break-even + a hair, so the spread doesn't turn a BE into a small loss
  tpAtR: 3.2, // full exit
  enforceTP: true, // put the take-profit back to 3.2R if it gets moved further away (greed check)
  maxTradesPerDay: 2,
  maxDailyLossR: 2, // stop for the day after losing 2R
  cooldownMin: 60, // pause after a losing trade (revenge-trade blocker)
  maxOpen: 2,
  minAPlusShare: 90, // at least 90% of trades must be A+ (rolling last 20)
  newsBeforeMin: 30,
  newsAfterMin: 30,
  newsOpenTrade: "warn", // warn | close   (open trade not yet at break-even before big news)
  structureExit: "notify", // notify | close | off   (15m break of structure against an open trade)
  setupExpiryMin: 15, // a setup can only be taken for 15 min (3 × 5m candles) — no late entries
  maxChaseR: 0.3, // refuse the entry if price already ran 0.3R past the planned entry
  sessions: {
    gold: ["03:00", "12:00"], // London open → New York morning (New York time)
    crude: ["08:00", "14:30"], // NYMEX hours
    natgas: ["08:00", "14:30"],
  },
  lots: { gold: 100, crude: 1000, natgas: 10000 },
  flatBy: "16:40", // be out of every trade by this time (your prop firm's close-out, New York time)
  flatWarnMin: 15, // warn this many minutes before
  noNewTradesMin: 30, // no new trades this close to the close-out
  autoFlat: false, // at the close-out, close Edge-managed trades by itself (TradersPost / OANDA)
  coachIdleSec: 60, // Coach: seconds between chart checks while waiting for a setup
  coachTradeSec: 20, // …and while a trade is open
  coachDailyChecks: 600, // cost guard: max Coach checks per day
  // which alerts reach your phone (push / Telegram); the dashboard log always has all of them
  notify: { setup: true, action: true, warn: true, closed: true, news: true, locked: true, skip: false, info: true },
};

// Weekly fundamentals: each factor is answered +1 (bullish), -1 (bearish) or 0 (neutral/unclear).
// Score ≥ +2 → bullish bias, ≤ -2 → bearish, otherwise neutral.
const BIAS_FACTORS = {
  gold: [
    { id: "dxy", label: "US dollar (DXY)", hint: "Dollar falling → bullish gold. Rising → bearish." },
    { id: "yields", label: "US real yields / 10-year yield", hint: "Falling yields → bullish. Rising → bearish." },
    { id: "fed", label: "Fed tone & rate expectations", hint: "Cuts / dovish → bullish. Hikes / hawkish → bearish." },
    { id: "cot", label: "COT: managed money (big speculators)", hint: "Net longs growing → bullish. Shrinking → bearish." },
    { id: "risk", label: "Fear / geopolitics / central-bank buying", hint: "More fear or buying → bullish. Calm, risk-on → bearish." },
  ],
  crude: [
    { id: "eia", label: "EIA inventories vs forecast (Wed)", hint: "Bigger draw than expected → bullish. Surprise build → bearish." },
    { id: "opec", label: "OPEC+ supply", hint: "Cuts / compliance → bullish. Adding barrels → bearish." },
    { id: "demand", label: "Demand (China, US data, refinery runs)", hint: "Strong → bullish. Weak / recession fears → bearish." },
    { id: "geo", label: "Supply risk / geopolitics", hint: "Disruption risk rising → bullish. Easing → bearish." },
    { id: "cot", label: "COT: managed money", hint: "Net longs growing → bullish. Shrinking → bearish." },
    { id: "dxy", label: "US dollar (DXY)", hint: "Dollar falling → mildly bullish. Rising → mildly bearish." },
  ],
  natgas: [
    { id: "weather", label: "Weather forecasts (6–15 day)", hint: "Colder winter / hotter summer than normal → bullish. Mild → bearish." },
    { id: "storage", label: "Storage vs 5-year average", hint: "Below average → bullish. Above → bearish." },
    { id: "eia", label: "EIA storage report vs forecast (Thu)", hint: "Smaller injection / bigger draw than expected → bullish." },
    { id: "lng", label: "LNG export feedgas", hint: "High / rising → bullish. Outages at export plants → bearish." },
    { id: "production", label: "US production", hint: "Falling → bullish. Record highs → bearish." },
    { id: "cot", label: "COT: managed money", hint: "Net longs growing → bullish. Shrinking → bearish." },
  ],
};

const BIAS_MAX_AGE_DAYS = 7;

function biasFromFactors(answers) {
  const score = Object.values(answers || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  return { score, dir: score >= 2 ? "long" : score <= -2 ? "short" : "neutral" };
}

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.sessions = { ...DEFAULT_SETTINGS.sessions, ...((saved && saved.sessions) || {}) };
  s.lots = { ...DEFAULT_SETTINGS.lots, ...((saved && saved.lots) || {}) };
  s.notify = { ...DEFAULT_SETTINGS.notify, ...((saved && saved.notify) || {}) };
  return s;
}

module.exports = { MARKETS, FUTURES, futuresSpec, marketOf, DEFAULT_SETTINGS, BIAS_FACTORS, BIAS_MAX_AGE_DAYS, biasFromFactors, mergeSettings };
