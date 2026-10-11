// Your prop-firm account, worked out from your own trades: how far you are from passing and from failing, the most you
// can risk right now (risk autopilot), your chance of passing in the next days (from your own results), whether your
// practice says you're ready, and when you can be paid. Works in the browser (window.EdgeProp) and in Node.
(function (root) {
  // The firms' published rules for a 50K account (Oct 2026). Firms change these — check your dashboard and edit any number.
  // null = not published / not found: Edge then ignores that rule.
  const FIRMS = {}; // filled by setFirms() from firms.json data below (kept separate so it's easy to update)

  const DAY = 864e5;
  // the futures trading day starts 18:00 New York: a trade closed at 19:00 counts for the next day (like the firms)
  const nyParts = (t) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)); const o = {}; for (const x of p) o[x.type] = x.value; return o; };
  function tradingDay(t) { const p = nyParts(t); let d = Date.UTC(+p.year, +p.month - 1, +p.day); if (+p.hour >= 18) d += DAY; return new Date(d).toISOString().slice(0, 10); }
  const usdOf = (t) => (t.usd != null ? Number(t.usd) : t.pnl != null && Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : t.resultR != null && t.riskUSD ? t.resultR * t.riskUSD : 0) - (t.feeUSD || 0);

  // the account, from where you told Edge it stood (anchor) plus every live trade closed since
  function account(trades, cfg, now = Date.now()) {
    const size = Number(cfg.size) || 50000, a = cfg.anchor || {};
    const start = a.at || cfg.startedAt || 0;
    const list = (trades || []).filter((t) => t.closedAt && t.closedAt > start && !t.practice).sort((x, y) => x.closedAt - y.closedAt);
    let bal = a.balance != null ? Number(a.balance) : size, hwm = a.hwm != null ? Number(a.hwm) : Math.max(size, bal), intraHwm = hwm;
    const days = new Map(), today = tradingDay(now);
    for (const t of list) {
      const u = usdOf(t), d = tradingDay(t.closedAt);
      bal += u; intraHwm = Math.max(intraHwm, bal);
      const e = days.get(d) || { day: d, pnl: 0, trades: 0, endBal: 0 }; e.pnl += u; e.trades++; e.endBal = bal; days.set(d, e);
    }
    for (const e of days.values()) if (e.day < today) hwm = Math.max(hwm, e.endBal); // end-of-day high-water mark (completed days only)
    const dd = Number(cfg.dd) || 0, type = cfg.ddType || "eod";
    const peak = type === "intraday" ? intraHwm : hwm;
    let floor = type === "static" ? size - dd : peak - dd;
    if (type !== "static" && cfg.ddLockAt != null) floor = Math.min(floor, Number(cfg.ddLockAt));
    const t0 = days.get(today) || { pnl: 0, trades: 0 };
    const dl = cfg.dailyLoss != null ? Number(cfg.dailyLoss) : null;
    const dayList = [...days.values()].sort((x, y) => (x.day < y.day ? -1 : 1));
    const profit = bal - size, best = dayList.reduce((m, e) => Math.max(m, e.pnl), 0);
    const daysTraded = (a.days || 0) + dayList.length;
    const pct = cfg.consistencyPct != null ? Number(cfg.consistencyPct) / 100 : null;
    const prevBest = dayList.filter((e) => e.day !== today).reduce((m, e) => Math.max(m, e.pnl), 0);
    const target = cfg.phase === "funded" ? null : Number(cfg.target) || null;
    // consistency: no single day may be more than pct of the target (or of your profit, if bigger) — what's left for today
    const consistCap = pct && target != null ? Math.max(0, pct * Math.max(target, profit) - t0.pnl) : null;
    const toTarget = target != null ? size + target - bal : null;
    const consistOk = !pct || profit <= 0 || best <= pct * profit + 0.01;
    const room = bal - floor, dailyRoom = dl != null ? dl + t0.pnl : null;
    const status = room <= 0 ? "failed" : dailyRoom != null && dailyRoom <= 0 ? "day-locked" : target != null && toTarget <= 0 && daysTraded >= (cfg.minDays || 0) && consistOk ? "passed" : target != null && toTarget <= 0 ? "almost" : "on";
    return { size, balance: bal, profit, floor, room, peak, toTarget, target, today: t0.pnl, todayTrades: t0.trades, dailyLoss: dl, dailyRoom, best, bestDay: dayList.find((e) => e.pnl === best && best > 0) || null, consistencyPct: pct ? pct * 100 : null, consistOk, consistCap, prevBest, daysTraded, minDays: cfg.minDays || 0, days: dayList, status };
  }

  // risk autopilot: the most you should risk on the next trade, and why
  function autopilot(acct, cfg, { base = 250, lastLossRisk = null, minR = 3 } = {}) {
    const why = [];
    let r = Number(base) || 250;
    if (acct.status === "failed") return { usd: 0, why: ["The drawdown is hit — the account is closed."], mode: "stop" };
    if (acct.status === "passed") return { usd: 0, why: ["You've passed — stop trading the evaluation and request your funded account."], mode: "stop" };
    if (acct.status === "day-locked") return { usd: 0, why: ["Daily loss limit reached — done until tomorrow."], mode: "stop" };
    const cut = (v, text) => { if (v < r) { r = v; why.push(text); } };
    cut(acct.room / 4, `Never more than ¼ of the $${Math.round(acct.room)} left before the drawdown — four losses in a row can't end it.`);
    if (acct.dailyRoom != null) cut(acct.dailyRoom / 2, `Half of today's $${Math.round(acct.dailyRoom)} left before the daily loss limit.`);
    if (lastLossRisk != null) cut(lastLossRisk, "No bigger than your last losing trade — never size up after a loss.");
    let mode = "normal";
    if (acct.toTarget != null && acct.toTarget > 0 && acct.toTarget <= minR * r) { r = Math.max(acct.toTarget / minR, 1); mode = "protect"; why.push(`Protect mode: $${Math.round(acct.toTarget)} to go — a ${minR}R winner at this size passes, a loss costs little.`); }
    if (acct.consistCap != null && acct.consistencyPct && acct.toTarget != null && acct.toTarget > 0) {
      if (acct.consistCap <= 10) return { usd: 0, why: [`Consistency rule (${acct.consistencyPct}%): you've made today's maximum. Stop — protect the day and pass over the next days.`], mode: "stop" };
      const capR = acct.consistCap / minR;
      if (capR < r) { r = capR; mode = "consistency"; why.push(`Consistency rule (${acct.consistencyPct}%): $${Math.round(acct.consistCap)} more today at most — sized so a ${minR}R win stays inside it.`); }
    }
    r = Math.floor(r / 5) * 5;
    if (!why.length) why.push(`Your normal $${Math.round(r)} — plenty of room.`);
    return { usd: Math.max(0, r), why, mode };
  }

  // contracts for a stop distance, never above the firm's max
  function contracts(usd, stopDist, pv, maxMicros = null) { const per = Math.abs(stopDist) * pv; let q = per > 0 ? Math.floor(usd / per + 1e-9) : 0; if (maxMicros) q = Math.min(q, maxMicros); return { qty: q, perContract: per, risk: q * per }; }

  // your chance of passing: replays the next days 2000 times with your own trade results and the autopilot's sizing
  function simulate(acct, cfg, rs, { setupsPerDay = 1, maxPerDay = 2, days = 10, runs = 2000, base = 250, fee = 2, seed = 7 } = {}) {
    const R = (rs && rs.length >= 5 ? rs : DEFAULT_R).slice();
    let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; };
    const pct = acct.consistencyPct ? acct.consistencyPct / 100 : null, size = acct.size, target = acct.target;
    let pass5 = 0, passN = 0, fail = 0; const passDays = [];
    for (let run = 0; run < runs; run++) {
      let bal = acct.balance, hwm = acct.peak, best = acct.best, daysT = acct.daysTraded, done = false;
      for (let d = 1; d <= days && !done; d++) {
        const n = Math.min(maxPerDay, pois(setupsPerDay));
        let dayPnl = 0, lastLoss = null;
        for (let k = 0; k < n; k++) {
          const floor = cfg.ddType === "static" ? size - cfg.dd : Math.min(hwm - cfg.dd, cfg.ddLockAt != null ? cfg.ddLockAt : Infinity);
          const a = { room: bal - floor, dailyRoom: cfg.dailyLoss != null ? cfg.dailyLoss + dayPnl : null, toTarget: target != null ? size + target - bal : null, consistCap: pct && target != null ? Math.max(0, pct * Math.max(target, bal - size) - dayPnl) : null, consistencyPct: pct ? pct * 100 : null, status: "on" };
          if (a.room <= 0) break;
          const risk = autopilot(a, cfg, { base, lastLossRisk: lastLoss }).usd; if (risk < 10) break;
          const r = R[Math.floor(rnd() * R.length)], p = r * risk - fee;
          bal += p; dayPnl += p; if (cfg.ddType === "intraday") hwm = Math.max(hwm, bal);
          if (p < 0) lastLoss = risk;
          if (bal <= floor) { fail++; done = true; break; }
          if (cfg.dailyLoss != null && dayPnl <= -cfg.dailyLoss) break;
        }
        if (done) break;
        if (n > 0) daysT++;
        if (cfg.ddType !== "intraday") hwm = Math.max(hwm, bal);
        best = Math.max(best, dayPnl);
        const profit = bal - size;
        if (target != null && profit >= target && daysT >= (cfg.minDays || 0) && (!pct || best <= pct * profit + 0.01)) { passN++; if (d <= 5) pass5++; passDays.push(d); done = true; }
      }
    }
    passDays.sort((a, b) => a - b);
    return { pass5: pass5 / runs, passN: passN / runs, fail: fail / runs, days, medianDays: passDays.length ? passDays[Math.floor(passDays.length / 2)] : null, usedOwn: !!(rs && rs.length >= 5), n: (rs || []).length };
  }
  // when you have fewer than 5 results: the 2019–2026 test of your playbook entry (1m gap entry, gold + crude): +0.66R a trade
  const DEFAULT_R = [-1, -1, -1, -1, -1, -1, -1, 3, 4.6, 6]; // 30% winners, +0.66R a trade on average

  // readiness: does your practice show an edge, with the rules kept?
  function readiness(practice) {
    const xs = (practice || []).filter((x) => x.R != null);
    const n = xs.length, wins = xs.filter((x) => x.R > 0.1).length, sumR = xs.reduce((a, x) => a + x.R, 0);
    const kept = xs.filter((x) => x.score && x.score.length).map((x) => x.score.filter((c) => c.ok).length / x.score.length);
    const keptPct = kept.length ? Math.round((kept.reduce((a, b) => a + b, 0) / kept.length) * 100) : null;
    const exp = n ? sumR / n : null;
    let score = 0; const why = [];
    if (n >= 30) score += 30; else why.push(`${30 - n} more practice trades for a reliable picture (${n}/30).`);
    if (exp != null && exp > 0.3) score += 35; else if (exp != null) why.push(`Average ${exp.toFixed(2)}R a trade — aim for +0.3R or better.`);
    if (keptPct != null && keptPct >= 85) score += 35; else if (keptPct != null) why.push(`Playbook kept ${keptPct}% — aim for 85%+.`);
    return { n, winRate: n ? Math.round((wins / n) * 100) : null, expectancy: exp, keptPct, score, ready: score >= 100, why };
  }

  // funded: when can you be paid, and how much is safe to take
  function payout(acct, cfg, now = Date.now()) {
    const p = cfg.payout || {};
    const winDays = acct.days.filter((d) => d.pnl >= (p.minWinningDayProfit || 0.01)).length;
    const needDays = Math.max(0, (p.minDays || 0) - acct.daysTraded), needWin = Math.max(0, (p.minWinningDays || 0) - winDays);
    const above = acct.balance - (acct.size + (p.buffer || 0));
    const safe = Math.max(0, Math.min(p.cap != null ? p.cap : Infinity, above));
    const consist = acct.consistencyPct && acct.profit > 0 ? acct.best <= (acct.consistencyPct / 100) * acct.profit + 0.01 : true;
    const eligible = needDays === 0 && needWin === 0 && safe > 0 && consist;
    let paid = null;
    if (eligible && p.processingDays != null) { let d = new Date(now), k = 0; while (k < p.processingDays) { d = new Date(d.getTime() + DAY); const w = d.getUTCDay(); if (w !== 0 && w !== 6) k++; } paid = d.toISOString().slice(0, 10); }
    return { winDays, needDays, needWin, safe, eligible, consist, paidBy: paid, split: p.split || null, buffer: p.buffer || 0 };
  }

  const api = { FIRMS, tradingDay, account, autopilot, contracts, simulate, readiness, payout, DEFAULT_R, setFirms: (f) => Object.assign(FIRMS, f) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EdgeProp = api;
})(typeof window !== "undefined" ? window : null);
