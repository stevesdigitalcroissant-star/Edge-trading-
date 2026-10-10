// Edge strategy v2 — 4H trend · 15m zones · 5m refined entry (your rules, agreed step by step):
//   4H  : trend = last 4H candle CLOSE beyond a swing. A wick through the opposite swing without a
//         close = "possible reversal" warning (grade one step lower), the trend stays.
//   15m : demand zone = the candle right before the big move that left an imbalance (fair value gap
//         made by a big candle), on a 15m move that broke structure up. Wick to wick. Supply mirrored.
//         First touch only. Skipped if the last 15m break of structure is against the 4H trend.
//   Liq : a sweep of a nearby low (previous day, Asian session, 15m / 5m swing) on the way into the
//         zone = A+, no sweep = A.
//   5m  : inside the 15m zone, a 5m candle closes beyond the last 5m swing (5m BOS) → the 5m zone that
//         move came from (same imbalance rule) → LIMIT order at the top of the 5m demand (bottom of
//         the 5m supply), stop beyond the 15m zone. Cancelled if price reaches +2R without filling.
//   Exit: "fixed" = break-even at +2R, out at +3.2R · "zone" = out at the next opposing 15m zone (≥ 2R)
//         · trendExit "5m"/"15m" = get out with profit when structure breaks against you.
//         Out of everything at 16:40 New York. One trade per zone, max 3 a day.
// Only closed candles are used — nothing peeks ahead. Same output shape as engine.js (events + states).
(function (root) {
  const E = typeof module !== "undefined" && module.exports ? require("./engine") : root.EdgeEngine;
  const { Structure, nyMin, inWindow } = E;

  const DEFAULTS = {
    htfLen: 3, mtfLen: 2, ltfLen: 2,
    bigMult: 1.2, // the big candle's body ≥ 1.2 × the average body of the 20 candles before it
    ltfMin: 5, // entry timeframe in minutes (5 or 1) — the bars passed in must be this size
    waitMin: 240, // minutes from the zone touch to the entry break (4 hours)
    trendTF: "4h", // the trend that decides long or short: "4h" or "15m" (more trades)
    maxTouches: 2, // 1 = first touch only · 2 = a second touch is also tradeable
    entry: "zone5", // "zone5" = limit at the 5m zone · "retest" = limit at the broken 5m level · "market" = in on the 5m break close
    needZ5: false, // the 5m break must leave a gap (imbalance) — the best filter in the 6-month test
    z5Fallback: "opposite", // the entry move left no gap: "skip" or "opposite" (use the last opposite candle)
    discount: true, // buy only in the lower half of the last 4H swing range, sell only in the upper half
    target: "liquidity", // "liquidity" = nearest liquidity ≥ 2R (swing / equal highs / previous day) · "fixed" = 3.2R
    daily: "prevclose", // daily direction filter: "off" · "level" (nearest untouched daily high/low) · "prevclose" · "bias" (+ biasDir)
    exit: "fixed", trendExit: "off", block15: true, // block15 = skip when the last 15m break is against the 4H trend
    beR: 0, tpR: 3.2, beOffR: 0.05, minZoneR: 1.5, slBufAtr: 0.1, // beR 0 = no break-even (tests 2019-2026 did better without it)
    windows: [["02:00", "16:00"]], // when orders may be placed / filled (New York): London + New York
    asia: ["18:00", "02:00"], flatBy: "16:40", maxPerDay: 2, warnBars: 6,
  };
  const WINDOWS = { sessions: [["03:00", "12:00"]], killzones: [["02:00", "05:00"], ["08:30", "11:00"]] };

  // a higher timeframe built from 5m bars; reports the candle that just closed
  function TF(bucketOf, len) {
    const s = new Structure(len, 1.5), bars = [];
    let cur = null, key = null, snap = { trend: 0, upT: 0, dnT: 0 };
    this.bars = bars;
    this.feed = (b, mod) => {
      const k = bucketOf(mod);
      let closed = null, prev = snap;
      if (cur && k !== key) { bars.push(cur); closed = cur; snap = s.step(cur); }
      if (closed === null) prev = snap;
      if (!cur || k !== key) { cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }; key = k; }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; }
      return { closed, prev, snap };
    };
  }

  const body = (x) => Math.abs(x.c - x.o);
  const idxAt = (arr, t) => { let lo = 0, hi = arr.length - 1; if (hi < 0 || arr[0].t > t) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m].t <= t) lo = m; else hi = m - 1; } return lo; };

  // the candle before the big move that left a fair value gap (first one in [from, to])
  function findZone(arr, from, to, dir, mult) {
    for (let k = Math.max(from + 1, 21); k <= to - 1; k++) {
      const c1 = arr[k - 1], c2 = arr[k], c3 = arr[k + 1];
      const gap = dir === 1 ? c1.h < c3.l && c2.c > c2.o : c1.l > c3.h && c2.c < c2.o;
      if (!gap) continue;
      let avg = 0; for (let j = k - 20; j < k; j++) avg += body(arr[j]); avg /= 20;
      if (body(c2) >= mult * avg) return { top: c1.h, bot: c1.l, t: c1.t, gapA: dir === 1 ? c1.h : c3.h, gapB: dir === 1 ? c3.l : c1.l };
    }
    return null;
  }

  // fallback when the move left no gap: the last opposite candle before the move (at or before its extreme)
  function findOpposite(arr, from, to, dir) {
    let ext = from;
    for (let k = from; k <= to; k++) if (dir === 1 ? arr[k].l < arr[ext].l : arr[k].h > arr[ext].h) ext = k;
    for (let k = ext; k >= Math.max(0, from - 3); k--) if (dir === 1 ? arr[k].c < arr[k].o : arr[k].c > arr[k].o) return { top: arr[k].h, bot: arr[k].l, t: arr[k].t, fallback: true };
    return null;
  }

  function run(bars, market, opt = {}) {
    const P = { ...DEFAULTS, ...opt };
    // each rule: "required" (fails → no trade) · "grade" (fails → one grade lower) · "off"
    // defaults from the 3¾-year gold search (2023 → Sep 2026, tuned on 2023–mid 2025, checked on the rest):
    // discount, 15m-against, inducement, 4H zone and strength made results worse or never happened → off by default
    P.rules = { discount: P.discount === false ? "off" : P.discount === true && opt.discount === true ? "required" : "off", m15: P.block15 === true && opt.block15 === true ? "required" : "off", inducement: "off", zone4h: "off", strength: "off", major: "off", ...(opt.rules || {}) };
    const RQ = (k) => P.rules[k] === "required", GR = (k) => P.rules[k] === "grade";
    if (typeof P.windows === "string") P.windows = WINDOWS[P.windows] || DEFAULTS.windows;
    const H4 = new TF((m) => Math.floor((m - 1080) / 240), P.htfLen);
    const D1 = new TF((m) => Math.floor((m + 360) / 1440), 2); // the daily trend (CME days)
    let dSnap = { trend: 0 };
    const M15 = new TF((m) => Math.floor(m / 15), P.mtfLen);
    const L5 = new Structure(P.ltfLen, 1.5);
    const events = [], states = [];
    const zones = []; // 15m zones { dir, top, bot, from, valid, touched, strong, createdT }
    const zones4 = []; // 4H zones, drawn the same way { dir, top, bot, valid }
    const piv = []; // entry-timeframe swing points { t, v, dir: 1 high / -1 low }
    const dayLevels = []; // previous days' highs and lows { v, dir, taken }
    const maxWait = P.maxWait || Math.round(P.waitMin / P.ltfMin), back = Math.round(60 / P.ltfMin);
    const ltfName = `${P.ltfMin}m`;
    let dOpen = null, prevOpen = null, prevClose = null, lastClose = null;
    let h = { trend: 0, upT: 0, dnT: 0 }, m = { trend: 0, upT: 0, dnT: 0 }, l = { trend: 0, upT: 0, dnT: 0 };
    let warn = 0, warnLeft = 0; // 4H wick against the trend: -dir of the warning, candles left
    let day = null, dHi = -Infinity, dLo = Infinity, pdh = null, pdl = null, wasAsia = false, aHi = null, aLo = null, asiaHi = null, asiaLo = null;
    let tradesDay = 0, tradeDayKey = null;
    let setup = null; // { dir, zone, touchI, levels, extreme, stage: 1 waiting 5m BOS }
    let order = null; // { dir, entry, sl, tp, be, beStop, grade, swept, zone, placedI, cancelAt }
    let pos = null; // { ...order, i, beDone }
    let last = null; // the last trade, for the panel

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], mod0 = nyMin(b.t), mod = ((mod0 % 1440) + 1440) % 1440;
      const r4 = H4.feed(b, mod0), r15 = M15.feed(b, mod0), rD = D1.feed(b, mod0);
      if (rD.closed) dSnap = rD.snap;
      const trendNow = P.trendTF === "15m" ? m.trend : h.trend;
      const pl = l; l = L5.step(b);
      const atr5 = L5.atr() || 0;
      const inWin = P.windows.some((w) => inWindow(mod, w)), flat = inWindow(mod, [P.flatBy, "18:00"]);

      // liquidity levels
      const td = Math.floor((mod0 + 360) / 1440);
      if (day !== null && td !== day) {
        pdh = dHi; pdl = dLo; prevOpen = dOpen; prevClose = lastClose;
        dayLevels.push({ v: dHi, dir: 1, taken: false }, { v: dLo, dir: -1, taken: false });
        while (dayLevels.length > 20) dayLevels.shift();
        dHi = -Infinity; dLo = Infinity; dOpen = b.o;
      }
      if (dOpen == null) dOpen = b.o;
      day = td; dHi = Math.max(dHi, b.h); dLo = Math.min(dLo, b.l); lastClose = b.c;
      for (const d of dayLevels) if (!d.taken && (d.dir === 1 ? b.h > d.v : b.l < d.v)) d.taken = true;
      if (tradeDayKey !== td) { tradeDayKey = td; tradesDay = 0; }
      const inAsia = inWindow(mod, P.asia);
      if (inAsia && !wasAsia) { aHi = b.h; aLo = b.l; } else if (inAsia) { aHi = Math.max(aHi, b.h); aLo = Math.min(aLo, b.l); }
      if (!inAsia && wasAsia) { asiaHi = aHi; asiaLo = aLo; }
      wasAsia = inAsia;

      // 4H: trend on closes, wick warning
      if (r4.closed) {
        const prev = h; h = r4.snap; const c = r4.closed;
        if (h.upT !== prev.upT && h.upLvl != null) { events.push({ i, type: "bos", tf: "4H", dir: 1, lvl: h.upLvl, from: h.upFrom, to: h.upT }); warn = 0; }
        if (h.dnT !== prev.dnT && h.dnLvl != null) { events.push({ i, type: "bos", tf: "4H", dir: -1, lvl: h.dnLvl, from: h.dnFrom, to: h.dnT }); warn = 0; }
        if (h.trend === 1 && prev.swingLow != null && c.l < prev.swingLow && c.c >= prev.swingLow) { warn = -1; warnLeft = P.warnBars; events.push({ i, type: "warn", dir: -1, lvl: prev.swingLow }); }
        else if (h.trend === -1 && prev.swingHigh != null && c.h > prev.swingHigh && c.c <= prev.swingHigh) { warn = 1; warnLeft = P.warnBars; events.push({ i, type: "warn", dir: 1, lvl: prev.swingHigh }); }
        else if (warn && --warnLeft <= 0) warn = 0;
        // 4H zones: the candle before the 4H move that left an imbalance, on a 4H break of structure
        const a4 = H4.bars, j4 = a4.length - 1;
        for (const dir of [1, -1]) {
          if (!(dir === 1 ? h.upT !== prev.upT && h.upT : h.dnT !== prev.dnT && h.dnT)) continue;
          const st = idxAt(a4, dir === 1 ? h.plT : h.phT);
          const z = st >= 0 ? findZone(a4, st, j4, dir, P.bigMult) : null;
          if (z && !zones4.some((x) => x.t === z.t)) { zones4.push({ dir, top: z.top, bot: z.bot, t: z.t, valid: true }); events.push({ i, type: "zone", side: dir === 1 ? "demand" : "supply", top: z.top, bot: z.bot, tf: "4H" }); }
          while (zones4.length > 12) zones4.shift();
        }
      }
      for (const z of zones4) if (z.valid && (z.dir === 1 ? b.c < z.bot : b.c > z.top)) z.valid = false;
      // 15m: break of structure → the zone it came from
      if (r15.closed) {
        const prev = m; m = r15.snap; const arr = M15.bars, j = arr.length - 1;
        for (const dir of [1, -1]) {
          const broke = dir === 1 ? m.upT !== prev.upT && m.upT : m.dnT !== prev.dnT && m.dnT;
          if (!broke) continue;
          events.push({ i, type: "bos", tf: "15m", dir, lvl: dir === 1 ? m.upLvl : m.dnLvl, from: dir === 1 ? m.upFrom : m.dnFrom, to: dir === 1 ? m.upT : m.dnT });
          const start = idxAt(arr, dir === 1 ? m.plT : m.phT);
          const z = start >= 0 ? findZone(arr, start, j, dir, P.bigMult) : null;
          if (z && !zones.some((x) => x.t === z.t && x.dir === dir)) {
            // strong = the zone is the origin of the whole move (its extreme), not a candle in the middle of it
            let ext = dir === 1 ? Infinity : -Infinity;
            for (let q = start; q <= j; q++) ext = dir === 1 ? Math.min(ext, arr[q].l) : Math.max(ext, arr[q].h);
            const strong = dir === 1 ? z.bot <= ext : z.top >= ext;
            zones.push({ dir, top: z.top, bot: z.bot, t: z.t, from: idxAt(bars, z.t), valid: true, touched: false, createdI: i, createdT: b.t, strong });
            events.push({ i, type: "zone", side: dir === 1 ? "demand" : "supply", top: z.top, bot: z.bot, tf: "15m" });
            while (zones.filter((x) => x.dir === dir).length > 8) zones.splice(zones.findIndex((x) => x.dir === dir), 1);
          }
        }
      }
      if (l.phT && l.phT !== pl.phT) piv.push({ t: l.phT, v: l.phHigh, dir: 1 });
      if (l.plT && l.plT !== pl.plT) piv.push({ t: l.plT, v: l.plLow, dir: -1 });
      if (piv.length > 400) piv.splice(0, piv.length - 400);
      const l5Up = l.upT !== pl.upT && l.upT !== 0, l5Dn = l.dnT !== pl.dnT && l.dnT !== 0;
      if (l5Up && l.upLvl != null) events.push({ i, type: "bos", tf: ltfName, dir: 1, lvl: l.upLvl, from: l.upFrom, to: l.upT });
      if (l5Dn && l.dnLvl != null) events.push({ i, type: "bos", tf: ltfName, dir: -1, lvl: l.dnLvl, from: l.dnFrom, to: l.dnT });

      // ---- open position: stop / target / break-even / trend exit / close-out
      if (pos && i > pos.i) {
        const k = pos.dir, stopNow = pos.beDone ? pos.beStop : pos.sl;
        const hitStop = k === 1 ? b.l <= stopNow : b.h >= stopNow, hitTp = k === 1 ? b.h >= pos.tp : b.l <= pos.tp;
        const against = (P.trendExit === "5m" && (k === 1 ? l5Dn : l5Up)) || (P.trendExit === "15m" && r15.closed && (k === 1 ? m.dnT !== r15.prev.dnT && m.dnT : m.upT !== r15.prev.upT && m.upT));
        let out = null;
        if (hitStop) out = { outcome: pos.beDone ? "be" : "sl", price: stopNow };
        else if (hitTp) out = { outcome: "tp", price: pos.tp };
        else if (flat) out = { outcome: "flat", price: b.c };
        else if (against && k * (b.c - pos.entry) > 0) out = { outcome: "trend", price: b.c };
        else if (!pos.beDone && pos.be != null && (k === 1 ? b.h >= pos.be : b.l <= pos.be)) { pos.beDone = true; events.push({ i, type: "be", dir: k, stop: pos.beStop }); }
        if (out) { events.push({ i, type: "exit", dir: k, ...out }); last = { ...pos, exitI: i, ...out }; pos = null; }
      }

      // ---- pending limit order: fill / cancel
      if (order && i > order.placedI) {
        const k = order.dir;
        const touchedEntry = k === 1 ? b.l <= order.entry : b.h >= order.entry;
        const ranAway = order.cancelAt != null && (k === 1 ? b.h >= order.cancelAt : b.l <= order.cancelAt);
        if (touchedEntry) {
          pos = { ...order, i, beDone: false };
          order = null; tradesDay++;
          events.push({ i, type: "enter", dir: k, entry: pos.entry, sl: pos.sl, be: pos.be, beStop: pos.beStop, tp: pos.tp, grade: pos.grade, swept: pos.swept, missing: pos.missing, visit: 1, zoneTop: pos.zone.top, zoneBot: pos.zone.bot });
          if (k === 1 ? b.l <= pos.sl : b.h >= pos.sl) { events.push({ i, type: "exit", dir: k, outcome: "sl", price: pos.sl }); last = { ...pos, exitI: i, outcome: "sl" }; pos = null; }
        } else if (ranAway || !inWin || flat || !order.zone.valid) {
          events.push({ i, type: "cancel", dir: k, why: ranAway ? `price reached +${P.beR}R without filling you — no chasing` : !order.zone.valid ? "the 15m zone broke" : "outside your trading hours" });
          order = null;
        }
      }

      // ---- 15m zones: invalidation and first touch
      for (const z of zones) {
        if (!z.valid || i <= z.createdI) continue;
        if (z.dir === 1 ? b.c < z.bot : b.c > z.top) { z.valid = false; events.push({ i, type: "zoneDead", side: z.dir === 1 ? "demand" : "supply" }); if (setup && setup.zone === z) setup = null; continue; }
        const inZ = z.dir === 1 ? b.l <= z.top : b.h >= z.bot;
        const newVisit = inZ && !z.wasIn;
        z.wasIn = inZ;
        if (!newVisit) continue;
        z.touches = (z.touches || 0) + 1; z.touched = true;
        if (z.touches > P.maxTouches || setup || order || pos) continue;
        const dir = z.dir;
        // 1. premium / discount of the last 4H swing range
        // the current 4H dealing range: uptrend = from the swing low that started the move to the highest high since
        // (downtrend mirrored), on closed 4H candles plus the one forming now
        let rLo = null, rHi = null;
        const a4 = H4.bars, from4 = idxAt(a4, h.trend === 1 ? h.plT : h.phT);
        if (from4 >= 0) {
          rLo = Infinity; rHi = -Infinity;
          for (let q = from4; q < a4.length; q++) { rLo = Math.min(rLo, a4[q].l); rHi = Math.max(rHi, a4[q].h); }
          rLo = Math.min(rLo, b.l); rHi = Math.max(rHi, b.h);
        }
        const mid = rLo != null && rHi > rLo ? (rLo + rHi) / 2 : null;
        const inHalf = mid == null || (dir === 1 ? z.top <= mid : z.bot >= mid);
        // 7. daily direction
        let dd = 0;
        if (P.daily === "prevclose" && prevOpen != null && prevClose != null) dd = prevClose > prevOpen ? 1 : -1;
        else if (P.daily === "bias") dd = P.biasDir || 0;
        else if (P.daily === "trend") dd = dSnap.trend || 0;
        else if (P.daily === "level") {
          const open = dayLevels.filter((d) => !d.taken);
          const near = open.reduce((best, d) => (best == null || Math.abs(d.v - b.c) < Math.abs(best.v - b.c) ? d : best), null);
          dd = near ? (near.v > b.c ? 1 : -1) : 0;
        }
        const why = trendNow !== dir ? `against the ${P.trendTF === "15m" ? "15m" : "4H"} trend` : RQ("m15") && m.trend !== dir ? "15m trend against"
          : RQ("discount") && !inHalf ? (dir === 1 ? "demand is in premium (upper half of the 4H range)" : "supply is in discount (lower half of the 4H range)")
          : P.daily !== "off" && dd && dd !== dir ? "against today's direction" : tradesDay >= P.maxPerDay ? `${P.maxPerDay} trades today already` : "";
        if (why) { events.push({ i, type: "skip", dir, why, stage: "touch", top: z.top, bot: z.bot, zoneT: z.t, rLo, rHi, dd }); continue; }
        // 3. inducement: a small swing that formed beyond the zone after the zone was made — swept on the way in
        const ind = piv.filter((p) => p.dir === -dir && p.t > z.createdT && (dir === 1 ? p.v > z.top : p.v < z.bot)).pop();
        // 2. the 15m zone sits inside a 4H zone
        const in4H = zones4.some((x) => x.valid && x.dir === dir && x.bot <= z.top && x.top >= z.bot);
        setup = { dir, zone: z, touchI: i, extreme: dir === 1 ? b.l : b.h, ind, in4H, strong: z.strong, inHalf, m15ok: m.trend === dir,
          majors: dir === 1 ? [["previous day low", pdl], ["Asian low", asiaLo]] : [["previous day high", pdh], ["Asian high", asiaHi]] };
        events.push({ i, type: "touch", dir, top: z.top, bot: z.bot, zoneT: z.t, rLo, rHi, dd, inducement: ind ? ind.v : null, indT: ind ? ind.t : null, in4H, strong: z.strong });
        if (ind) events.push({ i, type: "sweep", dir, name: "inducement", lvl: ind.v, from: idxAt(bars, ind.t) });
      }

      // ---- setup: wait for the 5m break, then place the limit order at the 5m zone
      if (setup && i > setup.touchI) {
        const k = setup.dir, z = setup.zone;
        setup.extreme = k === 1 ? Math.min(setup.extreme, b.l) : Math.max(setup.extreme, b.h);
        if (trendNow !== k || i - setup.touchI > maxWait || flat) { events.push({ i, type: "skip", dir: k, why: trendNow !== k ? "trend flipped" : flat ? "session over" : `no ${ltfName} break within ${P.waitMin / 60} hours`, stage: "wait" }); setup = null; }
        else if (k === 1 ? l5Up : l5Dn) {
          const start = idxAt(bars, k === 1 ? l.plT : l.phT);
          const from5 = Math.max(start - 1, setup.touchI - back);
          const z5 = start >= 0 ? findZone(bars, from5, i, k, P.bigMult) || (P.z5Fallback === "opposite" ? findOpposite(bars, from5, i, k) : null) : null;
          // grade: A+ = inducement swept + inside a 4H zone + strong zone · one missing = A · more = B (skip)
          const major = setup.majors.find(([, v]) => v != null && (k === 1 ? setup.extreme < v && b.c > v : setup.extreme > v && b.c < v));
          const fails = { major: !major && "no big-level sweep", inducement: !setup.ind && "no inducement", zone4h: !setup.in4H && "not inside a 4H zone", strength: !setup.strong && "weak zone",
            discount: !setup.inHalf && (k === 1 ? "in premium" : "in discount"), m15: !setup.m15ok && "15m trend against" };
          const missing = Object.keys(fails).filter((r) => GR(r) && fails[r]).map((r) => fails[r]);
          const blocked = Object.keys(fails).filter((r) => RQ(r) && fails[r] && !["discount", "m15"].includes(r)).map((r) => fails[r]);
          let grade = missing.length === 0 ? "A+" : missing.length === 1 ? "A" : "B";
          if (warn === -k) grade = grade === "A+" ? "A" : "B";
          const sw = major ? [major[0], major[1]] : setup.ind ? ["inducement", setup.ind.v] : null;
          // "fvg" = limit at the edge of the fair value gap the break left (first price back into it) · "fvgmid" = its middle
          const fvg = z5 && z5.gapA != null ? { lo: Math.min(z5.gapA, z5.gapB), hi: Math.max(z5.gapA, z5.gapB) } : null;
          const entry = P.entry === "market" ? b.c : P.entry === "retest" ? (k === 1 ? l.upLvl : l.dnLvl)
            : P.entry === "fvg" ? (fvg ? (k === 1 ? fvg.hi : fvg.lo) : null) : P.entry === "fvgmid" ? (fvg ? (fvg.lo + fvg.hi) / 2 : null)
            : z5 ? (k === 1 ? z5.top : z5.bot) : null;
          const z5ok = !!z5 || !P.needZ5;
          // stop: past the 15m zone (default) · "swing" = past the low/high the break started from (tighter)
          const sl = P.slMode === "swing" ? setup.extreme - k * P.slBufAtr * atr5 : k === 1 ? z.bot - P.slBufAtr * atr5 : z.top + P.slBufAtr * atr5;
          const risk = entry != null ? k * (entry - sl) : 0;
          // the nearest opposing 15m zone limits the target
          const opp = zones.filter((x) => x.valid && x.dir === -k && (k === 1 ? x.bot > (entry ?? b.c) : x.top < (entry ?? b.c)))
            .reduce((best, x) => (best == null || (k === 1 ? x.bot < best : x.top > best) ? (k === 1 ? x.bot : x.top) : best), null);
          let tp = entry != null ? entry + k * P.tpR * risk : null;
          if (P.exit === "zone" && opp != null) tp = opp;
          // 6. take profit at the nearest liquidity at least 2R away: swing highs, equal highs, previous day high
          if (P.target === "liquidity" && entry != null && risk > 0) {
            const lv = [];
            if (k === 1 ? pdh != null : pdl != null) lv.push(k === 1 ? pdh : pdl);
            if (k === 1 ? m.phHigh != null : m.plLow != null) lv.push(k === 1 ? m.phHigh : m.plLow);
            const sw5 = piv.filter((p) => p.dir === k).slice(-60);
            for (const p of sw5) lv.push(p.v);
            for (let a = 0; a < sw5.length; a++) for (let c = a + 1; c < sw5.length; c++) if (Math.abs(sw5[a].v - sw5[c].v) <= 0.15 * atr5) lv.push(k === 1 ? Math.max(sw5[a].v, sw5[c].v) : Math.min(sw5[a].v, sw5[c].v));
            const ok = lv.filter((v) => (k * (v - entry)) / risk >= P.minZoneR).sort((x, y) => k * (x - y));
            if (ok.length) tp = ok[0];
          }
          const tpR = risk > 0 ? (k * (tp - entry)) / risk : 0;
          const roomR = opp != null && risk > 0 ? (k * (opp - entry)) / risk : null;
          const why = blocked.length ? `required: ${blocked.join(", ")}` : !z5ok || entry == null ? `no ${ltfName} imbalance zone` : !(risk > 0) ? `${ltfName} zone not above the stop` : P.entry !== "market" && k * (b.c - entry) <= 0 ? `price already beyond the ${ltfName} zone` : grade === "B" ? `grade B — ${missing.join(", ")}${warn === -k ? ", 4H wick warning" : ""}` : !inWin ? "outside your trading hours"
            : P.exit === "zone" && tpR < P.minZoneR ? `opposing zone only ${tpR.toFixed(1)}R away` : P.exit !== "zone" && roomR != null && roomR < tpR - 1e-9 ? `opposing zone too close (${roomR.toFixed(1)}R)` : "";
          if (why) events.push({ i, type: "skip", dir: k, why, stage: "order" });
          else {
            order = { dir: k, entry, sl, tp, be: P.beR > 0 ? entry + k * P.beR * risk : null, beStop: entry + k * P.beOffR * risk, cancelAt: P.beR > 0 ? entry + k * P.beR * risk : null, grade, swept: sw ? sw[0] : "", missing, zone: z, z5, placedI: i };
            events.push({ i, type: "order", dir: k, entry, sl, tp, be: order.be, grade, missing, tpR: +tpR.toFixed(2), swept: order.swept, z5top: z5 ? z5.top : null, z5bot: z5 ? z5.bot : null });
            if (P.entry === "market") { // in on the close of the break candle
              pos = { ...order, i, beDone: false }; order = null; tradesDay++;
              events.push({ i, type: "enter", dir: k, entry, sl, be: pos.be, beStop: pos.beStop, tp, grade, swept: pos.swept, missing, visit: 1, zoneTop: z.top, zoneBot: z.bot });
            }
          }
          setup = null;
        }
      }

      states.push({ trend: h.trend, warn, m15: m.trend, inSess: inWin,
        dem: zones.filter((z) => z.valid && z.dir === 1).map((z) => ({ top: z.top, bot: z.bot, from: z.from, touches: z.touched ? 1 : 0 })),
        sup: zones.filter((z) => z.valid && z.dir === -1).map((z) => ({ top: z.top, bot: z.bot, from: z.from, touches: z.touched ? 1 : 0 })),
        setup: setup ? { dir: setup.dir, top: setup.zone.top, bot: setup.zone.bot } : null,
        order: order ? { dir: order.dir, entry: order.entry, sl: order.sl, tp: order.tp, grade: order.grade } : null,
        gDir: pos ? pos.dir : 0, gE: pos ? pos.entry : null, gSL: pos ? pos.sl : null, gTP: pos ? pos.tp : null, gBE: pos ? pos.beDone : false, gGrade: pos ? pos.grade : "", gSw: pos ? pos.swept : "" });
    }
    return { events, states, params: P, version: 2 };
  }

  function panel(res, i) {
    const s = res.states[i], f = (x) => (x == null ? "—" : +x.toFixed(x >= 100 ? 2 : 3));
    const dir = s.gDir || (s.order && s.order.dir) || (s.setup && s.setup.dir) || s.trend;
    const side = dir === 1 ? "LONG" : dir === -1 ? "SHORT" : "";
    const inT = s.gDir !== 0, ord = !!s.order, set = !!s.setup;
    const steps = [
      ["4H trend (close)", dir !== 0 && s.trend === dir, (s.trend === 1 ? "UP" : s.trend === -1 ? "DOWN" : "none yet") + (s.warn ? " · wick warning" : "")],
      ["15m zone, first touch", inT || ord || set, inT || ord || set ? "price is in the zone" : "waiting"],
      ["Liquidity swept (A+)", inT ? s.gGrade === "A+" : ord ? s.order.grade === "A+" : false, inT ? (s.gSw || "no sweep — A") : ord ? (s.order.grade === "A+" ? "yes" : "no sweep — A") : "checked at the 5m break"],
      ["5m break → 5m zone", inT || ord, ord ? `limit at ${f(s.order.entry)}` : inT ? "done" : "waiting"],
      ["Limit order filled", inT, inT ? `in at ${f(s.gE)}` : "waiting"],
    ];
    const doNow = inT ? (s.gBE ? `In ${side}: stop at break-even · target ${f(s.gTP)} — hands off` : `In ${side}: stop ${f(s.gSL)} · target ${f(s.gTP)}`)
      : ord ? `${side} limit order at ${f(s.order.entry)} · stop ${f(s.order.sl)} — wait for the fill, don't chase`
      : set ? `${side}: price is in the 15m zone — wait for a 5m candle to close beyond the last 5m swing`
      : !s.inSess ? "Outside your trading hours — no new orders"
      : "Wait — price isn't at a fresh 15m zone in the 4H trend.";
    return { side, steps, doNow };
  }

  const api = { run, panel, WINDOWS, findZone };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EdgeStrategy2 = api;
})(typeof self !== "undefined" ? self : this);
