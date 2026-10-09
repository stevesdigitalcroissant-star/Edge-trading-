// The Edge S&D strategy, candle by candle — the same rules as pine/edge_supply_demand.pine,
// so Edge can find A+ setups on its own (replay practice) without TradingView.
// Input: 5-minute bars [{t (open time, ms), o, h, l, c}]. 15m and 4H bars are built from them
// (4H aligned to the CME day: 18:00, 22:00, 02:00… New York). Higher timeframes only use
// CLOSED candles, like the script (no repainting, no peeking ahead).
(function (root) {
  const DEFAULTS = {
    htfLen: 3, mtfLen: 2, ltfLen: 2, zoneCap: 1.5,
    maxWait: 96, // 5m candles from the zone touch to the entry (96 = 8 hours)
    zones: 5, // fresh 4H zones tracked each side (newest first)
    touch: "visit", // a new touch only counts after price really left the zone (wicks in and out = one visit)
    entryMode: "bos", // "bos" = 5m break of structure · "close" = first 5m close in your direction after the 15m break
    stop: "swing", // "zone" = beyond the far edge of the 4H zone · "swing" = beyond the 5m swing the entry broke from · "extreme" = beyond the lowest low / highest high since the touch
    beR: 2, tpR: 3.2, beOffR: 0.05, slBufAtr: 0.2, minStopAtr: 0.5, maxStopAtr: 6,
    session: ["03:00", "12:00"], asia: ["18:00", "02:00"], flatBy: "16:40", // out of everything by then (your close-out rule)
  };

  const SESSIONS = { gold: ["03:00", "12:00"], crude: ["08:00", "14:30"], natgas: ["08:00", "14:30"] };

  // New York local minutes since epoch (handles daylight saving), cached per hour
  const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const offCache = new Map();
  function nyMin(t) {
    const hr = Math.floor(t / 3600e3);
    let off = offCache.get(hr);
    if (off === undefined) {
      const p = Object.fromEntries(nyFmt.formatToParts(new Date(hr * 3600e3)).map((x) => [x.type, x.value]));
      off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - hr * 3600e3;
      offCache.set(hr, off);
    }
    return Math.floor((t + off) / 60e3);
  }
  const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const inWindow = (mod, [a, b]) => { const x = hm(a), y = hm(b); return x <= y ? mod >= x && mod < y : mod >= x || mod < y; };

  // ta.pivothigh/low + ta.atr + the break-of-structure state of the script's structure()
  function Structure(len, cap) {
    const H = [], L = [], O = [], C = [], T = [];
    let atr = null, trSum = 0, n = 0;
    const st = { swingHigh: null, swingLow: null, phHigh: null, phBodyBot: null, plLow: null, plBodyTop: null, phT: 0, plT: 0,
      trend: 0, demTop: null, demBot: null, supTop: null, supBot: null, upT: 0, dnT: 0, upLvl: null, dnLvl: null, upFrom: 0, dnFrom: 0 };
    this.atr = () => atr;
    this.step = (b) => {
      const prevC = C.length ? C[C.length - 1] : null;
      H.push(b.h); L.push(b.l); O.push(b.o); C.push(b.c); T.push(b.t);
      const tr = prevC == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - prevC), Math.abs(b.l - prevC));
      n++;
      if (n < 14) trSum += tr; else if (n === 14) { trSum += tr; atr = trSum / 14; } else atr = (atr * 13 + tr) / 14;
      const i = H.length - 1, c = i - len;
      if (c >= len) {
        let isH = true, isL = true;
        for (let j = c - len; j <= c + len; j++) {
          if (j === c) continue;
          if (j < c ? H[j] >= H[c] : H[j] > H[c]) isH = false;
          if (j < c ? L[j] <= L[c] : L[j] < L[c]) isL = false;
        }
        if (isH) { st.swingHigh = H[c]; st.phT = T[c]; st.phHigh = H[c]; st.phBodyBot = Math.min(O[c], C[c]); }
        if (isL) { st.swingLow = L[c]; st.plT = T[c]; st.plLow = L[c]; st.plBodyTop = Math.max(O[c], C[c]); }
      }
      if (st.swingHigh != null && b.c > st.swingHigh) {
        st.trend = 1; st.upT = b.t; st.upLvl = st.swingHigh; st.upFrom = st.phT; st.swingHigh = null;
        if (st.plLow != null && atr != null) { st.demBot = st.plLow; st.demTop = Math.max(Math.min(st.plBodyTop, st.plLow + atr * cap), st.plLow + atr * 0.25); }
      }
      if (st.swingLow != null && b.c < st.swingLow) {
        st.trend = -1; st.dnT = b.t; st.dnLvl = st.swingLow; st.dnFrom = st.plT; st.swingLow = null;
        if (st.phHigh != null && atr != null) { st.supTop = st.phHigh; st.supBot = Math.min(Math.max(st.phBodyBot, st.phHigh - atr * cap), st.phHigh - atr * 0.25); }
      }
      return { trend: st.trend, demTop: st.demTop, demBot: st.demBot, supTop: st.supTop, supBot: st.supBot, upT: st.upT, dnT: st.dnT,
        upLvl: st.upLvl, dnLvl: st.dnLvl, upFrom: st.upFrom, dnFrom: st.dnFrom, phHigh: st.phHigh, plLow: st.plLow };
    };
  }
  const EMPTY = { trend: 0, demTop: null, demBot: null, supTop: null, supBot: null, upT: 0, dnT: 0, upLvl: null, dnLvl: null, upFrom: 0, dnFrom: 0, phHigh: null, plLow: null };

  // A higher timeframe built from 5m bars; snap() = state after the last CLOSED candle
  function Higher(bucketOf, len, cap) {
    const s = new Structure(len, cap);
    let cur = null, key = null, snap = EMPTY;
    this.feed = (b, mod) => {
      const k = bucketOf(mod);
      if (cur && k !== key) { snap = s.step(cur); cur = null; }
      if (!cur) { cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }; key = k; }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; }
      return snap;
    };
  }

  function run(bars, market, opt = {}) {
    const P = { ...DEFAULTS, session: SESSIONS[market] || DEFAULTS.session, ...opt };
    const H4 = new Higher((m) => Math.floor((m - 1080) / 240), P.htfLen, P.zoneCap);
    const M15 = new Higher((m) => Math.floor(m / 15), P.mtfLen, P.zoneCap);
    const LTF = new Structure(P.ltfLen, P.zoneCap);
    const events = [], states = [];
    let h = EMPTY, m = EMPTY, l = EMPTY, ph = EMPTY, pm = EMPTY, pl = EMPTY;

    // liquidity: previous CME day high/low, Asian session high/low
    let day = null, dHi = -Infinity, dLo = Infinity, pdh = null, pdl = null;
    let wasAsia = false, aHi = null, aLo = null, asiaHi = null, asiaLo = null;
    // zones
    // zones: { side, top, bot, touches, valid, wasIn, away, from } — newest last
    const dem = [], sup = [];
    let lZone = null, sZone = null;
    // setups
    let lState = 0, lBar = 0, lLow = null, lTouch = 0, lLiq15 = null;
    let sState = 0, sBar = 0, sHigh = null, sTouch = 0, sLiq15 = null;
    // the A+ trade being followed
    let gDir = 0, gE = null, gSL = null, gRisk = null, gBE = false, gBar = 0, gSw = "", gGrade = "";

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], mod0 = nyMin(b.t), mod = ((mod0 % 1440) + 1440) % 1440;
      ph = h; pm = m; pl = l;
      h = H4.feed(b, mod0); m = M15.feed(b, mod0); l = LTF.step(b);
      const atr5 = LTF.atr();
      const inSess = inWindow(mod, P.session);

      const td = Math.floor((mod0 + 360) / 1440);
      if (day !== null && td !== day) { pdh = dHi; pdl = dLo; dHi = -Infinity; dLo = Infinity; }
      day = td; dHi = Math.max(dHi, b.h); dLo = Math.min(dLo, b.l);
      const inAsia = inWindow(mod, P.asia);
      if (inAsia && !wasAsia) { aHi = b.h; aLo = b.l; } else if (inAsia) { aHi = Math.max(aHi, b.h); aLo = Math.min(aLo, b.l); }
      if (!inAsia && wasAsia) { asiaHi = aHi; asiaLo = aLo; }
      wasAsia = inAsia;

      const newDem = h.upT !== ph.upT && h.demTop != null;
      const newSup = h.dnT !== ph.dnT && h.supTop != null;
      const mUp = m.upT !== pm.upT && m.upT !== 0, mDn = m.dnT !== pm.dnT && m.dnT !== 0;
      const lUp = l.upT !== pl.upT && l.upT !== 0, lDn = l.dnT !== pl.dnT && l.dnT !== 0;

      const add = (list, side, top, bot) => {
        list.push({ side, top, bot, touches: 0, valid: true, wasIn: false, away: true, from: i });
        while (list.length > P.zones) list.shift();
        events.push({ i, type: "zone", side, top, bot });
      };
      if (newDem) add(dem, "demand", h.demTop, h.demBot);
      if (newSup) add(sup, "supply", h.supTop, h.supBot);
      // touches: the first zone entered on this candle (newest first)
      let dHit = null, sHit = null;
      for (const z of [...dem].reverse()) {
        if (!z.valid) continue;
        if (P.touch === "visit" && b.l > z.top + (z.top - z.bot)) z.away = true;
        const inZ = b.l <= z.top && b.h >= z.bot;
        if (inZ && !z.wasIn && (P.touch !== "visit" || z.away)) { z.touches++; z.away = false; if (!dHit) dHit = z; }
        z.wasIn = inZ;
        if (b.c < z.bot) { z.valid = false; events.push({ i, type: "zoneDead", side: "demand" }); }
      }
      for (const z of [...sup].reverse()) {
        if (!z.valid) continue;
        if (P.touch === "visit" && b.h < z.bot - (z.top - z.bot)) z.away = true;
        const inZ = b.h >= z.bot && b.l <= z.top;
        if (inZ && !z.wasIn && (P.touch !== "visit" || z.away)) { z.touches++; z.away = false; if (!sHit) sHit = z; }
        z.wasIn = inZ;
        if (b.c > z.top) { z.valid = false; events.push({ i, type: "zoneDead", side: "supply" }); }
      }
      const dTouchNow = !!dHit, sTouchNow = !!sHit;
      // the nearest opposing zone limits the room to the target
      const supAbove = sup.filter((z) => z.valid && z.bot > b.c).reduce((m, z) => (m == null || z.bot < m ? z.bot : m), null);
      const demBelow = dem.filter((z) => z.valid && z.top < b.c).reduce((m, z) => (m == null || z.top > m ? z.top : m), null);

      if (h.upT !== ph.upT && h.upLvl != null) events.push({ i, type: "bos", tf: "4H", dir: 1, lvl: h.upLvl, from: h.upFrom, to: h.upT });
      if (h.dnT !== ph.dnT && h.dnLvl != null) events.push({ i, type: "bos", tf: "4H", dir: -1, lvl: h.dnLvl, from: h.dnFrom, to: h.dnT });
      if (mUp && m.upLvl != null) events.push({ i, type: "bos", tf: "15m", dir: 1, lvl: m.upLvl, from: m.upFrom, to: m.upT });
      if (mDn && m.dnLvl != null) events.push({ i, type: "bos", tf: "15m", dir: -1, lvl: m.dnLvl, from: m.dnFrom, to: m.dnT });
      if (lUp && l.upLvl != null) events.push({ i, type: "bos", tf: "5m", dir: 1, lvl: l.upLvl, from: l.upFrom, to: l.upT });
      if (lDn && l.dnLvl != null) events.push({ i, type: "bos", tf: "5m", dir: -1, lvl: l.dnLvl, from: l.dnFrom, to: l.dnT });

      const longSig = lState === 2 && (P.entryMode === "close" ? b.c > b.o : lUp), shortSig = sState === 2 && (P.entryMode === "close" ? b.c < b.o : lDn);
      const lSL = (P.stop === "zone" && lZone ? Math.min(lZone.bot, b.l) : P.stop === "swing" && l.plLow != null && l.plLow < b.c ? Math.min(l.plLow, b.l) : Math.min(lLow ?? b.l, b.l)) - P.slBufAtr * (atr5 || 0), lRisk = b.c - lSL;
      const lRoom = supAbove != null && lRisk > 0 ? (supAbove - b.c) / lRisk : null;
      const sSL = (P.stop === "zone" && sZone ? Math.max(sZone.top, b.h) : P.stop === "swing" && l.phHigh != null && l.phHigh > b.c ? Math.max(l.phHigh, b.h) : Math.max(sHigh ?? b.h, b.h)) + P.slBufAtr * (atr5 || 0), sRisk = sSL - b.c;
      const sRoom = demBelow != null && sRisk > 0 ? (b.c - demBelow) / sRisk : null;
      const stopOk = (r) => atr5 != null && r > 0 && r / atr5 >= P.minStopAtr && r / atr5 <= P.maxStopAtr;
      const lowest = Math.min(lLow ?? b.l, b.l), highest = Math.max(sHigh ?? b.h, b.h);
      const sweptL = pdl != null && lowest < pdl && b.c > pdl ? ["previous day low", pdl] : asiaLo != null && lowest < asiaLo && b.c > asiaLo ? ["Asian low", asiaLo] : lLiq15 != null && lowest < lLiq15 && b.c > lLiq15 ? ["15m swing low", lLiq15] : null;
      const sweptS = pdh != null && highest > pdh && b.c < pdh ? ["previous day high", pdh] : asiaHi != null && highest > asiaHi && b.c < asiaHi ? ["Asian high", asiaHi] : sLiq15 != null && highest > sLiq15 && b.c < sLiq15 ? ["15m swing high", sLiq15] : null;
      // A+ = liquidity taken (first or later visit) · A = first visit, no sweep · anything else is skipped
      const grade = (swept, fresh, sOk, roomOk) => !sOk ? ["", "stop size not normal"] : !roomOk ? ["", `no room to ${P.tpR}R`] : !inSess ? ["", "outside the session"]
        : swept ? ["A+", ""] : fresh ? ["A", ""] : ["", "second visit without liquidity taken"];
      const [lGrade, lWhy] = grade(!!sweptL, lTouch === 1, stopOk(lRisk), lRoom == null || lRoom >= P.tpR);
      const [sGrade, sWhy] = grade(!!sweptS, sTouch === 1, stopOk(sRisk), sRoom == null || sRoom >= P.tpR);

      // state transitions (after the signal check, like the script)
      if (lState > 0) { lLow = Math.min(lLow, b.l); if (h.trend !== 1 || !lZone.valid || i - lBar > P.maxWait || longSig) lState = 0; }
      if (lState === 1 && mUp) lState = 2;
      if (lState === 0 && h.trend === 1 && dTouchNow && !longSig) { lState = 1; lBar = i; lLow = b.l; lTouch = dHit.touches; lLiq15 = m.plLow; lZone = dHit; }
      if (sState > 0) { sHigh = Math.max(sHigh, b.h); if (h.trend !== -1 || !sZone.valid || i - sBar > P.maxWait || shortSig) sState = 0; }
      if (sState === 1 && mDn) sState = 2;
      if (sState === 0 && h.trend === -1 && sTouchNow && !shortSig) { sState = 1; sBar = i; sHigh = b.h; sTouch = sHit.touches; sLiq15 = m.phHigh; sZone = sHit; }

      const lEnter = longSig && lRisk > 0 && lGrade !== "";
      const sEnter = shortSig && sRisk > 0 && sGrade !== "" && !lEnter;
      if (longSig && sweptL) events.push({ i, type: "sweep", dir: 1, name: sweptL[0], lvl: sweptL[1], from: lBar });
      if (shortSig && sweptS) events.push({ i, type: "sweep", dir: -1, name: sweptS[0], lvl: sweptS[1], from: sBar });
      if (!lEnter && longSig && lRisk > 0) events.push({ i, type: "skip", dir: 1, why: lWhy });
      if (!sEnter && shortSig && sRisk > 0) events.push({ i, type: "skip", dir: -1, why: sWhy });

      // follow the A+ trade: stop / target / break-even
      if (gDir !== 0 && i > gBar) {
        const tp = gE + gDir * P.tpR * gRisk, stopNow = gBE ? gE + gDir * P.beOffR * gRisk : gSL;
        const hitStop = gDir === 1 ? b.l <= stopNow : b.h >= stopNow, hitTp = gDir === 1 ? b.h >= tp : b.l <= tp;
        const flat = inWindow(mod, [P.flatBy, "18:00"]);
        if (hitStop) { events.push({ i, type: "exit", outcome: gBE ? "be" : "sl", price: stopNow, dir: gDir }); gDir = 0; }
        else if (hitTp) { events.push({ i, type: "exit", outcome: "tp", price: tp, dir: gDir }); gDir = 0; }
        else if (flat) { events.push({ i, type: "exit", outcome: "flat", price: b.c, dir: gDir }); gDir = 0; }
        else if (!gBE && (gDir === 1 ? b.h >= gE + P.beR * gRisk : b.l <= gE - P.beR * gRisk)) { gBE = true; events.push({ i, type: "be", dir: gDir, stop: gE + gDir * P.beOffR * gRisk }); }
      }
      if (lEnter || sEnter) {
        gDir = lEnter ? 1 : -1; gE = b.c; gSL = lEnter ? lSL : sSL; gRisk = Math.abs(b.c - gSL); gBE = false; gBar = i; gGrade = lEnter ? lGrade : sGrade; gSw = ((lEnter ? sweptL : sweptS) || [""])[0]; const gTouch = lEnter ? lTouch : sTouch;
        events.push({ i, type: "enter", dir: gDir, entry: gE, sl: gSL, be: gE + gDir * P.beR * gRisk, beStop: gE + gDir * P.beOffR * gRisk, tp: gE + gDir * P.tpR * gRisk, swept: gSw, grade: gGrade, visit: gTouch });
      }

      const live = (list) => list.filter((z) => z.valid).map((z) => ({ top: z.top, bot: z.bot, from: z.from, touches: z.touches }));
      states.push({ trend: h.trend, dem: live(dem), sup: live(sup), lState, sState,
        lSwept: lState > 0 && !!sweptL, sSwept: sState > 0 && !!sweptS, lSwName: sweptL ? sweptL[0] : "", sSwName: sweptS ? sweptS[0] : "",
        lTouch, sTouch, inSess, gDir, gE, gSL, gRisk, gBE, gSw, gGrade });
    }
    return { events, states, params: P };
  }

  // what the panel says on candle i (same wording as the script)
  function panel(res, i) {
    const s = res.states[i], P = res.params, f = (x) => (x == null ? "—" : +x.toFixed(x >= 100 ? 2 : 3));
    // in an A+ trade every step was done (the setup itself resets on the entry candle)
    const inT = s.gDir !== 0;
    const isL = inT ? s.gDir === 1 : s.lState > 0 || (s.sState === 0 && s.trend === 1);
    const stt = isL ? s.lState : s.sState, swept = isL ? s.lSwept : s.sSwept;
    const steps = [
      ["4H trend", inT || (isL ? s.trend === 1 : s.trend === -1), s.trend === 1 ? "UP" : s.trend === -1 ? "DOWN" : "none yet"],
      ["4H zone touched", inT || stt > 0, inT ? "done" : stt > 0 ? ((isL ? s.lTouch : s.sTouch) === 1 ? "first visit" : "visit " + (isL ? s.lTouch : s.sTouch) + " — needs a sweep") : "waiting"],
      ["Liquidity taken (A+)", inT ? s.gGrade === "A+" : stt > 0 && swept, inT ? (s.gGrade === "A+" ? s.gSw : "no sweep — A setup") : stt > 0 && swept ? (isL ? s.lSwName : s.sSwName) : "waiting"],
      ["15m break of structure", inT || stt === 2, inT || stt === 2 ? "done" : "waiting"],
      ["5m candle close → ENTER", s.gDir !== 0, s.gDir !== 0 ? `entered ${f(s.gE)}` : "waiting"],
    ];
    const side = s.gDir === 1 ? "LONG" : "SHORT";
    const doNow = s.gDir !== 0
      ? (s.gBE ? `In ${side}: stop at break-even ${f(s.gE + s.gDir * P.beOffR * s.gRisk)} · target ${f(s.gE + s.gDir * P.tpR * s.gRisk)} — hands off`
        : `In ${side}: stop ${f(s.gSL)} · at ${f(s.gE + s.gDir * P.beR * s.gRisk)} move stop to break-even · target ${f(s.gE + s.gDir * P.tpR * s.gRisk)}`)
      : !s.inSess ? "Session closed — no new trades"
      : s.lState === 2 ? (s.lSwept ? "Long: wait for a 5m candle to CLOSE above the last 5m high → ENTER" : "Long: 15m confirmed, but liquidity NOT taken yet — no entry until stops are swept")
      : s.sState === 2 ? (s.sSwept ? "Short: wait for a 5m candle to CLOSE below the last 5m low → ENTER" : "Short: 15m confirmed, but liquidity NOT taken yet — no entry until stops are swept")
      : s.lState === 1 ? "Long: in the demand zone — wait for a 15m break of structure up"
      : s.sState === 1 ? "Short: in the supply zone — wait for a 15m break of structure down"
      : "Wait — price isn't at a fresh 4H zone. Nothing to do.";
    return { side: isL ? "LONG" : !isL && (s.trend === -1 || s.sState > 0 || inT) ? "SHORT" : "", steps, doNow };
  }

  const api = { run, panel, nyMin, SESSIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EdgeEngine = api;
})(typeof self !== "undefined" ? self : this);
