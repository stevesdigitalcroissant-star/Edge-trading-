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
    bigMult: 1.5, // the big candle's body ≥ 1.5 × the average body of the 20 candles before it
    maxWait: 96, // 5m candles from the zone touch to the 5m break (8 hours)
    exit: "fixed", trendExit: "off", block15: true, // block15 = skip when the last 15m break is against the 4H trend
    beR: 2, tpR: 3.2, beOffR: 0.05, minZoneR: 2, slBufAtr: 0.1,
    windows: [["03:00", "12:00"]], // when orders may be placed / filled (New York)
    asia: ["18:00", "02:00"], flatBy: "16:40", maxPerDay: 3, warnBars: 6,
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

  function run(bars, market, opt = {}) {
    const P = { ...DEFAULTS, ...opt };
    if (typeof P.windows === "string") P.windows = WINDOWS[P.windows] || DEFAULTS.windows;
    const H4 = new TF((m) => Math.floor((m - 1080) / 240), P.htfLen);
    const M15 = new TF((m) => Math.floor(m / 15), P.mtfLen);
    const L5 = new Structure(P.ltfLen, 1.5);
    const events = [], states = [];
    const zones = []; // 15m zones { dir, top, bot, from, valid, touched }
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
      const r4 = H4.feed(b, mod0), r15 = M15.feed(b, mod0);
      const pl = l; l = L5.step(b);
      const atr5 = L5.atr() || 0;
      const inWin = P.windows.some((w) => inWindow(mod, w)), flat = inWindow(mod, [P.flatBy, "18:00"]);

      // liquidity levels
      const td = Math.floor((mod0 + 360) / 1440);
      if (day !== null && td !== day) { pdh = dHi; pdl = dLo; dHi = -Infinity; dLo = Infinity; }
      day = td; dHi = Math.max(dHi, b.h); dLo = Math.min(dLo, b.l);
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
      }
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
            zones.push({ dir, top: z.top, bot: z.bot, t: z.t, from: idxAt(bars, z.t), valid: true, touched: false, createdI: i });
            events.push({ i, type: "zone", side: dir === 1 ? "demand" : "supply", top: z.top, bot: z.bot, tf: "15m" });
            while (zones.filter((x) => x.dir === dir).length > 8) zones.splice(zones.findIndex((x) => x.dir === dir), 1);
          }
        }
      }
      const l5Up = l.upT !== pl.upT && l.upT !== 0, l5Dn = l.dnT !== pl.dnT && l.dnT !== 0;
      if (l5Up && l.upLvl != null) events.push({ i, type: "bos", tf: "5m", dir: 1, lvl: l.upLvl, from: l.upFrom, to: l.upT });
      if (l5Dn && l.dnLvl != null) events.push({ i, type: "bos", tf: "5m", dir: -1, lvl: l.dnLvl, from: l.dnFrom, to: l.dnT });

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
        else if (!pos.beDone && (k === 1 ? b.h >= pos.be : b.l <= pos.be)) { pos.beDone = true; events.push({ i, type: "be", dir: k, stop: pos.beStop }); }
        if (out) { events.push({ i, type: "exit", dir: k, ...out }); last = { ...pos, exitI: i, ...out }; pos = null; }
      }

      // ---- pending limit order: fill / cancel
      if (order && i > order.placedI) {
        const k = order.dir;
        const touchedEntry = k === 1 ? b.l <= order.entry : b.h >= order.entry;
        const ranAway = k === 1 ? b.h >= order.cancelAt : b.l <= order.cancelAt;
        if (touchedEntry) {
          pos = { ...order, i, beDone: false };
          order = null; tradesDay++;
          events.push({ i, type: "enter", dir: k, entry: pos.entry, sl: pos.sl, be: pos.be, beStop: pos.beStop, tp: pos.tp, grade: pos.grade, swept: pos.swept, visit: 1, zoneTop: pos.zone.top, zoneBot: pos.zone.bot });
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
        if (!inZ || z.touched) continue;
        z.touched = true; // first touch only
        if (setup || order || pos) continue;
        const dir = z.dir;
        const why = h.trend !== dir ? "against the 4H trend" : P.block15 && m.trend !== dir ? "15m trend against" : tradesDay >= P.maxPerDay ? `${P.maxPerDay} trades today already` : "";
        if (why) { events.push({ i, type: "skip", dir, why, stage: "touch" }); continue; }
        setup = { dir, zone: z, touchI: i, extreme: dir === 1 ? b.l : b.h,
          levels: dir === 1 ? [["previous day low", pdl], ["Asian low", asiaLo], ["15m swing low", m.plLow], ["5m swing low", l.plLow]]
            : [["previous day high", pdh], ["Asian high", asiaHi], ["15m swing high", m.phHigh], ["5m swing high", l.phHigh]] };
        events.push({ i, type: "touch", dir, top: z.top, bot: z.bot });
      }

      // ---- setup: wait for the 5m break, then place the limit order at the 5m zone
      if (setup && i > setup.touchI) {
        const k = setup.dir, z = setup.zone;
        setup.extreme = k === 1 ? Math.min(setup.extreme, b.l) : Math.max(setup.extreme, b.h);
        if (h.trend !== k || i - setup.touchI > P.maxWait || flat) { events.push({ i, type: "skip", dir: k, why: h.trend !== k ? "4H trend flipped" : flat ? "session over" : "no 5m break within 8 hours", stage: "wait" }); setup = null; }
        else if (k === 1 ? l5Up : l5Dn) {
          const start = idxAt(bars, k === 1 ? l.plT : l.phT);
          const z5 = start >= 0 ? findZone(bars, Math.max(start - 1, setup.touchI - 12), i, k, P.bigMult) : null;
          const sw = setup.levels.find(([, v]) => v != null && (k === 1 ? setup.extreme < v && b.c > v : setup.extreme > v && b.c < v));
          let grade = sw ? "A+" : "A";
          if (warn === -k) grade = grade === "A+" ? "A" : "B";
          const entry = z5 ? (k === 1 ? z5.top : z5.bot) : null;
          const sl = k === 1 ? z.bot - P.slBufAtr * atr5 : z.top + P.slBufAtr * atr5;
          const risk = entry != null ? k * (entry - sl) : 0;
          // the nearest opposing 15m zone limits the target
          const opp = zones.filter((x) => x.valid && x.dir === -k && (k === 1 ? x.bot > (entry ?? b.c) : x.top < (entry ?? b.c)))
            .reduce((best, x) => (best == null || (k === 1 ? x.bot < best : x.top > best) ? (k === 1 ? x.bot : x.top) : best), null);
          let tp = entry != null ? entry + k * P.tpR * risk : null;
          if (P.exit === "zone" && opp != null) tp = opp;
          const tpR = risk > 0 ? (k * (tp - entry)) / risk : 0;
          const roomR = opp != null && risk > 0 ? (k * (opp - entry)) / risk : null;
          const why = !z5 ? "no 5m imbalance zone" : !(risk > 0) ? "5m zone not above the stop" : k * (b.c - entry) <= 0 ? "price already beyond the 5m zone" : grade === "B" ? "4H wick warning — grade B" : !inWin ? "outside your trading hours"
            : P.exit === "zone" && tpR < P.minZoneR ? `opposing zone only ${tpR.toFixed(1)}R away` : P.exit !== "zone" && roomR != null && roomR < P.tpR ? `opposing zone too close (${roomR.toFixed(1)}R)` : "";
          if (sw) events.push({ i, type: "sweep", dir: k, name: sw[0], lvl: sw[1], from: setup.touchI });
          if (why) events.push({ i, type: "skip", dir: k, why, stage: "order" });
          else {
            order = { dir: k, entry, sl, tp, be: entry + k * P.beR * risk, beStop: entry + k * P.beOffR * risk, cancelAt: entry + k * P.beR * risk, grade, swept: sw ? sw[0] : "", zone: z, z5, placedI: i };
            events.push({ i, type: "order", dir: k, entry, sl, tp, be: order.be, grade, swept: order.swept, z5top: z5.top, z5bot: z5.bot });
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
