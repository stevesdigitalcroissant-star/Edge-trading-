// The rules. Pure functions only (no storage, no network) so they can be tested.
//
//   gradeSetup   → A+ / A / B / C from the checklist, plus hard blocks
//   guardrails   → daily limits, cool-down, open-trade limits
//   canTake      → the final yes/no (A+ and A can be taken; B and C can't)
//   evaluateTrade→ what to do with an open trade right now (break-even, take profit — the setup's own plan or the settings)
const { dayKey, nextDayStart, inWindow } = require("./_time");
const { MARKETS, BIAS_MAX_AGE_DAYS, STRATEGIES } = require("./_config");

const sign = (dir) => (dir === "short" ? -1 : 1);
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

// ---------- Exits: each strategy setup/trade carries its own (tested) target and break-even; others use the settings.
// beR 0 = the stop never moves to break-even.
function exits(x, s) {
  return { tpR: x && Number(x.tpR) > 0 ? Number(x.tpR) : s.tpAtR, beR: x && x.beR != null && Number.isFinite(Number(x.beR)) ? Number(x.beR) : s.beAtR };
}

// The checklist for the tested strategies (London breakout, natural gas zones).
function strategyChecks(setup, now) {
  const NY = "America/New_York";
  const st = STRATEGIES[setup.strategy], cfg = st && st.markets[setup.market];
  if (!cfg) return [{ id: "strategy", label: `${setup.strategy} isn't a strategy for ${setup.market}`, pass: false }];
  const windows = cfg.windows || [cfg.window];
  const inWin = windows.some((w) => inWindow(now, NY, w));
  const winTxt = windows.map((w) => w.join("–")).join(" and ") + " New York";
  const stopOk = { id: "stop", label: "Stop is a normal size (not too tight, not too wide)", pass: setup.stopOk !== false };
  if (setup.strategy === "london") {
    const hi = Number(setup.rangeHi), lo = Number(setup.rangeLo), long = setup.dir !== "short";
    const otherSide = long ? lo : hi, width = hi - lo;
    const checks = [
      { id: "range", label: "Asian range is set (18:00–02:00 New York)", pass: Number.isFinite(hi) && Number.isFinite(lo) && hi > lo, note: Number.isFinite(hi) && Number.isFinite(lo) ? `${lo} – ${hi}` : "" },
      { id: "window", label: `Breakout inside the London window (${winTxt})`, pass: inWin },
      { id: "stopside", label: "Stop at the other side of the Asian range", pass: Number.isFinite(otherSide) && width > 0 && Math.abs(setup.sl - otherSide) <= width * 0.1 },
      stopOk,
    ];
    if (cfg.minRangeAtr) checks.push({ id: "rangesize", label: `Asian range big enough (at least ${cfg.minRangeAtr}× the hourly ATR)`, pass: setup.rangeAtr == null || Number(setup.rangeAtr) >= cfg.minRangeAtr, note: setup.rangeAtr != null ? `${round(setup.rangeAtr, 1)}×` : "" });
    if (setup.market === "gold") checks.push({ id: "trend", label: "1-hour trend agrees (gold: 46% wins with it, 41% against)", pass: setup.trend == null || Number(setup.trend) === sign(setup.dir), note: setup.trend == null ? "" : Number(setup.trend) === 0 ? "no clear trend" : "" });
    return checks;
  }
  if (setup.strategy === "ngzone") {
    return [
      { id: "zone", label: "Heikin Ashi zone from an explosive move (wick → start of the body)", pass: setup.zoneTop != null && setup.zoneBot != null, note: setup.zoneTop != null ? `${setup.zoneBot} – ${setup.zoneTop}` : "" },
      { id: "age", label: `Zone at least ${cfg.minAgeDays} trading days old`, pass: Number(setup.zoneAgeDays) >= cfg.minAgeDays, note: setup.zoneAgeDays != null ? `${round(setup.zoneAgeDays, 1)} days` : "" },
      { id: "touches", label: `First or second touch of the zone (not more than ${cfg.maxTouches})`, pass: setup.touch == null || Number(setup.touch) <= cfg.maxTouches, note: setup.touch != null ? `touch ${setup.touch}` : "" },
      { id: "window", label: `Inside your natural gas windows (${winTxt})`, pass: inWin },
      stopOk,
    ];
  }
  return [];
}

// ---------- Setup grading

function gradeSetup(setup, ctx) {
  const { settings: s, bias, news, now } = ctx;
  if (setup.strategy) return gradeStrategy(setup, ctx);
  const dir = setup.dir;
  const b = bias && bias[setup.market];
  const biasAge = b ? (now - b.updated) / 864e5 : Infinity;
  const biasDir = b && biasAge <= BIAS_MAX_AGE_DAYS ? b.dir : null;

  const checks = [
    { id: "trend", label: "4H trend points your way (break of structure)", pass: Number(setup.trend4h) === sign(dir) },
    // a second visit to the zone is fine once liquidity was taken on it
    { id: "zone", label: "4H supply/demand zone: first visit, or a later visit with liquidity taken", pass: setup.zoneFresh !== false || setup.sweep === true },
    {
      id: "liquidity", label: "Liquidity taken first (stops swept, then reclaimed)", pass: setup.sweep !== false,
      note: setup.sweepName ? `${setup.sweepName}${setup.sweepLvl != null ? " " + setup.sweepLvl : ""}` : setup.sweep === false ? "no sweep yet — price may come back for it" : "",
    },
    { id: "bos15", label: "15m broke structure your way on a closed candle", pass: setup.bos15 !== false },
    { id: "close5", label: "5m entry candle closed — no anticipating", pass: setup.close5 !== false },
    {
      id: "room", label: `Room to ${s.tpAtR}R before the opposing 4H zone`,
      pass: setup.roomR == null || Number(setup.roomR) >= s.tpAtR,
      note: setup.roomR == null ? "no opposing zone in the way" : `${round(setup.roomR, 1)}R of room`,
    },
    { id: "stop", label: "Stop is a normal size (not too tight, not too wide)", pass: setup.stopOk !== false },
    {
      id: "bias", label: "Weekly fundamentals don't fight the trade",
      pass: biasDir != null && (biasDir === "neutral" || biasDir === dir),
      note: !b ? "set your weekly bias" : biasDir == null ? "bias is over a week old — update it" : `bias: ${biasDir}`,
    },
    {
      id: "session", label: "Inside your trading hours",
      pass: inWindow(now, s.tz, s.sessions[setup.market] || ["00:00", "24:00"]),
      note: (s.sessions[setup.market] || []).join("–"),
    },
  ];
  const fails = checks.filter((c) => !c.pass).length;
  const grade = fails === 0 ? "A+" : fails === 1 ? "A" : fails === 2 ? "B" : "C";
  return { grade, checks, blocks: hardBlocks(setup, ctx) };
}

// A tested strategy: every check must pass (only gold's trend check can miss → A). Your weekly bias is shown, not graded
// — the tests didn't use it.
function gradeStrategy(setup, ctx) {
  const { bias, now } = ctx;
  const checks = strategyChecks(setup, now);
  const soft = checks.filter((c) => !c.pass && c.id === "trend").length;
  const hard = checks.filter((c) => !c.pass && c.id !== "trend").length;
  const grade = hard ? (hard === 1 ? "B" : "C") : soft ? "A" : "A+";
  const b = bias && bias[setup.market];
  const biasAge = b ? (now - b.updated) / 864e5 : Infinity;
  const biasDir = b && biasAge <= BIAS_MAX_AGE_DAYS ? b.dir : null;
  const info = biasDir == null ? "no recent weekly bias" : biasDir === "neutral" || biasDir === setup.dir ? `weekly bias ${biasDir}` : `⚠️ against your weekly bias (${biasDir})`;
  return { grade, checks, blocks: hardBlocks(setup, ctx), info };
}

function hardBlocks(setup, ctx) {
  const { settings: s, news, now } = ctx;
  const blocks = [];
  const ev = news;
  if (ev) blocks.push({ id: "news", text: `${ev.title} at ${new Date(ev.time).toISOString().slice(11, 16)} UTC — no new trades ${s.newsBeforeMin} min before / ${s.newsAfterMin} min after` });
  if (setup.expires && now > setup.expires) blocks.push({ id: "expired", text: "Setup expired — the entry candle is gone. Wait for the next one." });
  if (setup.status && setup.status !== "open") blocks.push({ id: "done", text: `Already ${setup.status}` });
  const ce = closeOut(now, s);
  if (ce.noNew) blocks.push({ id: "closeout", text: `Too close to the session close-out (${s.flatBy}) — no new trades now.` });
  return blocks;
}

// ---------- Session close-out (prop firms want you flat before the daily close)
// Futures pause 17:00–18:00 New York time; after the close-out nothing new until the evening reopen.
function closeOut(now, s) {
  const { hm, minutesOfDay } = require("./_time");
  const m = minutesOfDay(now, s.tz), flat = hm(s.flatBy || "16:40"), reopen = hm("18:00");
  return {
    minutesLeft: flat - m,
    warn: m >= flat - (s.flatWarnMin ?? 15) && m < flat,
    due: m >= flat && m < reopen,
    noNew: m >= flat - (s.noNewTradesMin ?? 30) && m < reopen,
  };
}

// ---------- Guardrails (greed & impatience)

function guardrails({ settings: s, journal, open, now, cooldownUntil }) {
  const today = dayKey(now, s.tz);
  const closedToday = journal.filter((t) => t.closedAt && dayKey(t.closedAt, s.tz) === today);
  // natural gas zone trades come on top of the daily count (they're rare and come after the London trades)
  const openedToday = [...journal, ...open].filter((t) => t.openedAt && dayKey(t.openedAt, s.tz) === today && !t.extra);
  const rToday = round(closedToday.reduce((a, t) => a + (t.resultR || 0), 0));
  const reasons = [], codes = [];
  let until = 0;
  const tomorrow = nextDayStart(now, s.tz);
  const add = (code, text) => { codes.push(code); reasons.push(text); };

  if (openedToday.length >= s.maxTradesPerDay) { add("count", `You've taken your ${s.maxTradesPerDay} trades today. Done until tomorrow.`); until = Math.max(until, tomorrow); }
  if (rToday <= -s.maxDailyLossR) { add("loss", `Daily loss limit hit (${rToday}R). Platform closed until tomorrow — protect the account.`); until = Math.max(until, tomorrow); }

  const lastLoss = journal.filter((t) => t.closedAt && t.resultR < -0.1).sort((a, b) => b.closedAt - a.closedAt)[0];
  if (lastLoss && now < lastLoss.closedAt + s.cooldownMin * 60e3) {
    const u = lastLoss.closedAt + s.cooldownMin * 60e3;
    add("lossCool", `Cool-down after a loss — no revenge trades until ${new Date(u).toISOString().slice(11, 16)} UTC.`);
    until = Math.max(until, u);
  }
  if (cooldownUntil && now < cooldownUntil) { add("mood", "You said you weren't calm. Walk away — the next setup will come."); until = Math.max(until, cooldownUntil); }
  if (open.length >= s.maxOpen) add("open", `Already ${open.length} open trade(s) — manage those first.`);

  return { ok: reasons.length === 0, reasons, codes, until: until || null, tradesToday: openedToday.length, rToday };
}

// A+ share over the last 20 taken trades (manual / unplanned trades count as not A+).
function aPlusShare(journalAndOpen, window = 20) {
  const taken = [...journalAndOpen].sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).slice(0, window);
  const nonA = taken.filter((t) => t.grade !== "A+").length;
  return { taken: taken.length, nonA, share: taken.length ? Math.round(((taken.length - nonA) / taken.length) * 100) : 100 };
}

function canTake({ graded, setup, guard, history, settings: s, open }) {
  const why = [];
  for (const b of graded.blocks) why.push(b.text);
  // a tested strategy's order was planned before the move (the London stop orders, the zone limit):
  // the cool-down after a loss doesn't apply to it, and natural gas zone trades don't use up the daily count.
  const plan = setup.strategy ? (STRATEGIES[setup.strategy] || {}) : null;
  (guard.reasons || []).forEach((r, i) => {
    const code = (guard.codes || [])[i];
    if (plan && code === "lossCool") return;
    if (plan && plan.extra && code === "count") return;
    why.push(r);
  });
  if (open.some((t) => t.market === setup.market)) why.push(`You already have a ${MARKETS[setup.market].name} trade open.`);
  const twin = { gold: "silver", silver: "gold" }[setup.market];
  if (twin && open.some((t) => t.market === twin)) why.push(`Gold and silver move together — you already have a ${MARKETS[twin].name} trade open. One at a time.`);
  if (graded.grade === "B" || graded.grade === "C") why.push(`Grade ${graded.grade} — not your setup. Skip it.`);
  return { ok: why.length === 0, why };
}

// Position size in instrument units (oz / barrels / MMBtu) for a USD-quoted CFD.
function sizeUnits(riskMoneyUSD, entry, sl) {
  const d = Math.abs(entry - sl);
  return d > 0 ? riskMoneyUSD / d : 0;
}

// Futures: whole contracts only, never more risk than allowed. 0 contracts = the stop is too wide for this account.
function sizeContracts(riskMoneyUSD, entry, sl, spec) {
  const dist = Math.abs(entry - sl);
  const perContract = dist * spec.pv;
  return { contracts: perContract > 0 ? Math.floor(riskMoneyUSD / perContract + 1e-9) : 0, riskPerContract: round(perContract), ticks: Math.round(dist / spec.tick) };
}

// What to put in the order ticket for a setup (manual / TradingView mode).
// riskOverride: the dollars you typed on the setup card (else account size × risk %).
function orderSize(setup, s, entry = setup.entry, riskOverride = null) {
  const { futuresSpec } = require("./_config");
  const riskUSD = Number(riskOverride) > 0 ? Number(riskOverride) : s.accountSize * s.riskPct / 100;
  const spec = futuresSpec(setup.symbol || setup.tv);
  if (spec) {
    const c = sizeContracts(riskUSD, entry, setup.sl, spec);
    return { kind: "futures", contract: spec.root, name: spec.name, qty: c.contracts, unit: "contracts", riskUSD: round(riskUSD), riskPerContract: c.riskPerContract, totalRisk: round(c.contracts * c.riskPerContract), stopTicks: c.ticks };
  }
  const units = sizeUnits(riskUSD, entry, setup.sl);
  return { kind: "cfd", qty: units, unit: null, riskUSD: round(riskUSD), totalRisk: round(riskUSD) };
}

// ---------- Open trade management

function plan(t, s) {
  const k = sign(t.dir);
  const risk = Math.abs(t.entry - (t.initialSL ?? t.sl));
  const { tpR, beR } = exits(t, s);
  return {
    risk, tpR, beR,
    beTrigger: beR > 0 ? t.entry + k * beR * risk : null,
    beStop: t.entry + k * s.beOffsetR * risk,
    tp: t.entry + k * tpR * risk,
  };
}

const rAt = (t, price) => {
  const risk = Math.abs(t.entry - t.initialSL);
  return risk > 0 ? (sign(t.dir) * (price - t.entry)) / risk : 0;
};

// mark: { price, high?, low? } — price is where the trade would close now.
// Returns the R now, best R so far, and the actions to take.
function evaluateTrade(t, mark, s) {
  const k = sign(t.dir);
  const p = plan(t, s);
  const best = t.dir === "short" ? Math.min(mark.price, mark.low ?? mark.price) : Math.max(mark.price, mark.high ?? mark.price);
  const r = round(rAt(t, mark.price));
  const maxR = round(Math.max(t.maxR || 0, rAt(t, best)));
  const eps = p.risk * 0.02;
  const actions = [];

  if (!(p.risk > 0)) return { r: 0, maxR: 0, plan: p, actions: [{ type: "warn", code: "nostop", text: "No stop loss on this trade! Put one in now." }] };

  const slSet = t.currentSL != null;
  const beDone = t.beMoved || (slSet && k * (t.currentSL - t.entry) >= -eps);

  if (!slSet) actions.push({ type: "warn", code: "nostop", text: "Your stop loss is gone! A trade without a stop is a gamble." });
  else if (k * (t.initialSL - t.currentSL) > eps) actions.push({ type: "warn", code: "widened", text: "You moved your stop further away. That's the rule you're here to stop breaking.", ruleBreak: true });

  if (!beDone && p.beR > 0 && maxR >= p.beR) actions.push({ type: "moveSL", price: p.beStop, text: `+${p.beR}R reached → stop to break-even. This trade can't lose now.` });

  if (t.tp == null) actions.push({ type: "setTP", price: p.tp, text: `Take-profit set at ${p.tpR}R — your plan.` });
  else if (s.enforceTP && k * (t.tp - p.tp) > eps) actions.push({ type: "setTP", price: p.tp, text: `Take-profit moved back to ${p.tpR}R. Waiting for more is how profits got given back.`, ruleBreak: true });

  return { r, maxR, plan: p, beDone, actions };
}

// How a closed trade ended, for the journal.
function exitReason(t, exit, s) {
  const r = rAt(t, exit);
  if (Math.abs(r - exits(t, s).tpR) <= 0.15) return "target";
  if (t.beMoved && Math.abs(r - s.beOffsetR) <= 0.15) return "break-even";
  if (Math.abs(r + 1) <= 0.15) return "stop";
  return r > 0 ? "closed early (profit)" : "closed early (loss)";
}

module.exports = { exits, strategyChecks, closeOut, gradeSetup, guardrails, canTake, aPlusShare, sizeUnits, sizeContracts, orderSize, plan, rAt, evaluateTrade, exitReason, sign, round };
