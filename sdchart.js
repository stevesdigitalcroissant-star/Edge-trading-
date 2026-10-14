// The supply & demand picture for the home chart — the same rules as pine/edge_sd_scanner.pine:
// 1H breaks of structure (BOS = same way as the last one, MSS = the first one the other way), the 1H trend
// (the last two breaks the same way), the 1H zone of the latest break (the last 1–3 opposite candles at the
// origin of the move, tight on the base, at most 3× ATR tall, dead on a close through it), the zone before it
// when it points the same way and doesn't overlap, and the 4H trend (the direction of the last 4H close
// past a 4H swing). Candles in: [{ t (ms), o, h, l, c }], oldest first; only closed candles are used.
(function (root) {
  const LEN = 2;
  const pivot = (B, j, hi) => {
    if (j < LEN || j + LEN >= B.length) return false;
    for (let k = 1; k <= LEN; k++) {
      if (hi ? !(B[j].h > B[j - k].h && B[j].h > B[j + k].h) : !(B[j].l < B[j - k].l && B[j].l < B[j + k].l)) return false;
    }
    return true;
  };

  function sd1h(B) {
    let lastH = null, lastHi = -1, brokeH = true, lastL = null, lastLi = -1, brokeL = true, prevDir = 0, cnt = 0, atr = null;
    let z = null, z2 = null;
    const breaks = [];
    for (let i = 0; i < B.length; i++) {
      const b = B[i], tr = i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l;
      atr = atr == null ? tr : (atr * 13 + tr) / 14;
      const j = i - LEN;
      if (j >= LEN && pivot(B, j, true)) { lastH = B[j].h; lastHi = j; brokeH = false; }
      if (j >= LEN && pivot(B, j, false)) { lastL = B[j].l; lastLi = j; brokeL = false; }
      if (z && (z.d === 1 ? b.c < z.bot : b.c > z.top)) z = null;
      if (z2 && (z2.d === 1 ? b.c < z2.bot : b.c > z2.top)) z2 = null;
      for (const d of [1, -1]) {
        const hit = d === 1 ? !brokeH && lastH != null && b.c > lastH : !brokeL && lastL != null && b.c < lastL;
        if (!hit) continue;
        const sw = d === 1 ? lastHi : lastLi;
        if (d === 1) brokeH = true; else brokeL = true;
        breaks.push({ lvl: d === 1 ? lastH : lastL, t0: B[sw].t, t1: b.t, d, mss: prevDir !== 0 && d !== prevDir });
        cnt = d === prevDir ? cnt + 1 : 1; prevDir = d;
        // the origin: the extreme between the broken swing and this candle
        const span = Math.min(i - sw, 400);
        let o = i;
        for (let k = i; k >= i - span; k--) if (d === 1 ? B[k].l < B[o].l : B[k].h > B[o].h) o = k;
        breaks[breaks.length - 1].o = { t: B[o].t, p: d === 1 ? B[o].l : B[o].h }; // where the impulse started
        const opp = (k) => k >= 0 && (d === 1 ? B[k].c < B[k].o : B[k].c > B[k].o);
        const a = !opp(o) && opp(o - 1) ? o - 1 : o;
        let n = 0, near = null, wick = null; // the zone runs wick to wick: wick = the wick edge (drawn light), near = the body edge (arms alerts)
        for (let k = a; k >= Math.max(0, a - 2); k--) {
          if (!opp(k)) break;
          // an older opposite candle joins only inside the last one's range (a base), not a step of the drop
          if (n > 0 && (d === 1 ? Math.max(B[k].o, B[k].c) > B[a].h : Math.min(B[k].o, B[k].c) < B[a].l)) break;
          n++;
          near = d === 1 ? Math.max(near ?? -Infinity, B[k].o, B[k].c) : Math.min(near ?? Infinity, B[k].o, B[k].c);
          wick = d === 1 ? Math.max(wick ?? -Infinity, B[k].h) : Math.min(wick ?? Infinity, B[k].l);
        }
        const oldest = n > 0 ? a - n + 1 : o;
        if (n === 0) { near = d === 1 ? Math.max(B[o].o, B[o].c) : Math.min(B[o].o, B[o].c); wick = d === 1 ? B[o].h : B[o].l; }
        let far = d === 1 ? B[oldest].l : B[oldest].h;
        for (let k = oldest; k <= i; k++) far = d === 1 ? Math.min(far, B[k].l) : Math.max(far, B[k].h);
        const top = d === 1 ? near : far, bot = d === 1 ? far : near;
        if (z && z.d === d) z2 = z; else if (z2 && z2.d !== d) z2 = null;
        z = top - bot > 0 && top - bot <= 3 * atr ? { d, top, bot, wick, t: B[oldest].t } : null;
      }
    }
    const zone = z && cnt >= 2 ? z : null;
    const overlap = zone && z2 && z2.bot <= zone.top && z2.top >= zone.bot;
    const older = z2 && cnt >= 2 && z2.d === prevDir && !overlap ? z2 : null;
    const bos = breaks.filter((x) => !x.mss).slice(-3), mss = breaks.filter((x) => x.mss).slice(-1);
    return { trend: prevDir, cnt, zone, older, breaks: [...bos, ...mss].sort((p, q) => p.t1 - q.t1), allBreaks: breaks };
  }

  // Swing structure (how Steve reads it): an impulse makes a new extreme, price retraces, a close past that extreme
  // is a BOS and the retracement's extreme becomes the protected level; that repeats until a close past the
  // protected level — the MSS — flips the trend. Small wiggles inside an impulse don't count.
  function swing(B) {
    const out = []; if (B.length < 25) return { trend: 0, breaks: out };
    let dir = 0, peak = null, prot = null, retr = false, pivotI = 0;
    // start: the first close outside the first 20 candles' range sets the direction
    let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    for (let i = 0; i < 20; i++) { if (B[i].h > hi) { hi = B[i].h; hiI = i; } if (B[i].l < lo) { lo = B[i].l; loI = i; } }
    for (let i = 20; i < B.length; i++) {
      const b = B[i];
      if (!dir) {
        if (b.c > hi) { dir = 1; peak = { i, p: b.h }; prot = { i: loI, p: lo }; }
        else if (b.c < lo) { dir = -1; peak = { i, p: b.l }; prot = { i: hiI, p: hi }; }
        continue;
      }
      const up = dir === 1;
      // MSS: a close past the protected level
      if (up ? b.c < prot.p : b.c > prot.p) {
        out.push({ d: -dir, lvl: prot.p, t0: B[prot.i].t, t1: b.t, mss: true, o: { t: B[peak.i].t, p: peak.p } });
        // the new protected level is the extreme of the move that just failed
        const np = { i: peak.i, p: peak.p };
        let ex = i; for (let k = peak.i; k <= i; k++) if (up ? B[k].l < B[ex].l : B[k].h > B[ex].h) ex = k;
        dir = -dir; prot = np; peak = { i: ex, p: up ? B[ex].l : B[ex].h }; retr = false;
        continue;
      }
      // the impulse extends while price keeps making new extremes; a candle that fails to (a retracement) arms the BOS
      if (up ? b.h > peak.p : b.l < peak.p) {
        if (retr && (up ? b.c > peak.p : b.c < peak.p)) {
          // BOS: close past the peak after a retracement; the retracement's extreme becomes protected
          let ex = peak.i; for (let k = peak.i; k <= i; k++) if (up ? B[k].l < B[ex].l : B[k].h > B[ex].h) ex = k;
          out.push({ d: dir, lvl: peak.p, t0: B[peak.i].t, t1: b.t, mss: false, o: { t: B[ex].t, p: up ? B[ex].l : B[ex].h } });
          prot = { i: ex, p: up ? B[ex].l : B[ex].h }; retr = false;
        }
        if (!retr) peak = { i, p: up ? b.h : b.l };
      } else if (up ? b.l < B[peak.i].l : b.h > B[peak.i].h) retr = true; // price came back below the peak candle's low
    }
    return { trend: dir, breaks: out };
  }

  // Liquidity taken: a candle wicks past an earlier swing high / low (where stops rest) and closes back inside.
  // Swings = 3-candle pivots not yet run; each swing can be swept once. d = the side of the stops that were taken
  // (+1 = buy stops above a high, −1 = sell stops below a low).
  function sweeps(B, len = 3, maxAge = 120) {
    const pools = [], out = [];
    for (let i = 0; i < B.length; i++) {
      const j = i - len;
      if (j >= len) {
        let H = true, L = true;
        for (let k = 1; k <= len; k++) { if (!(B[j].h > B[j - k].h && B[j].h >= B[j + k].h)) H = false; if (!(B[j].l < B[j - k].l && B[j].l <= B[j + k].l)) L = false; }
        if (H) pools.push({ d: 1, p: B[j].h, i: j });
        if (L) pools.push({ d: -1, p: B[j].l, i: j });
      }
      const b = B[i];
      for (let q = pools.length - 1; q >= 0; q--) {
        const P = pools[q];
        if (i - P.i > maxAge) { pools.splice(q, 1); continue; }
        if (P.i >= i - len) continue;
        if (P.d === 1 ? b.h > P.p : b.l < P.p) {
          pools.splice(q, 1);
          if (P.d === 1 ? b.c < P.p : b.c > P.p) out.push({ d: P.d, lvl: P.p, t0: B[P.i].t, t1: b.t }); // wick through, close back = taken
        }
      }
    }
    return out;
  }

  // Liquidity at the MAJOR swings only (the zigzag of the swing structure): the first candle that wicks past one of
  // those highs / lows and is back inside within `back` candles takes its liquidity. Staying past it is a break.
  function majorSweeps(B, sw, back = 3) {
    const byT = new Map(B.map((b, i) => [b.t, i])), pts = [];
    for (const x of sw.breaks) {
      pts.push({ t: x.t0, p: x.lvl, hi: x.mss ? x.d < 0 : x.d > 0 }); // the level that broke: a high for a break up
      if (x.o) pts.push({ t: x.o.t, p: x.o.p, hi: x.mss ? x.d > 0 : x.d < 0 }); // the impulse start / failed extreme
    }
    const out = [], seen = new Set();
    for (const P of pts) {
      const key = `${P.t}:${P.p}`; if (seen.has(key)) continue; seen.add(key);
      const i0 = byT.get(P.t); if (i0 == null) continue;
      for (let i = i0 + 2; i < B.length; i++) {
        const b = B[i];
        if (P.hi ? b.h <= P.p : b.l >= P.p) continue;
        // taken if price is back inside (a close) on this candle or within the next `back` candles
        for (let k = i; k <= Math.min(B.length - 1, i + back); k++) if (P.hi ? B[k].c < P.p : B[k].c > P.p) { out.push({ d: P.hi ? 1 : -1, lvl: P.p, t0: P.t, t1: b.t, back: k - i }); break; }
        break;
      }
    }
    return out.sort((a, b) => a.t1 - b.t1);
  }

  function trend4h(B) {
    let h = null, l = null, dir = 0;
    for (let i = 0; i < B.length; i++) {
      const j = i - LEN;
      if (j >= LEN && pivot(B, j, true)) h = B[j].h;
      if (j >= LEN && pivot(B, j, false)) l = B[j].l;
      if (h != null && B[i].c > h) { dir = 1; h = null; }
      if (l != null && B[i].c < l) { dir = -1; l = null; }
    }
    return dir;
  }

  // everything the home chart shows; h1 / h4 include the candle still forming (it is dropped here)
  function read(h1, h4, price, nyMin) {
    const s = sd1h(h1.slice(0, -1)), t4 = trend4h(h4.slice(0, -1)), s4 = sd1h(h4.slice(0, -1)); // the 4H zones follow the same rules on 4H candles
    const inZ = s.zone && price != null && price <= s.zone.top && price >= s.zone.bot;
    const status = !s.trend ? "Wait: no 1H trend yet"
      : s.cnt < 2 ? "Wait: 1H needs a 2nd BOS"
      : !s.zone ? "Wait: no fresh 1H zone"
      : inZ ? "IN ZONE — waiting for 5m MSS"
      : "Wait: price not in the zone yet";
    const open = nyMin != null && nyMin >= 120 && nyMin < 690;
    const in4 = s4.zone && price != null && price <= s4.zone.top && price >= s4.zone.bot;
    return { ...s, t4, zone4: s4.zone, older4: s4.older, inZone4: !!in4, inZone: !!inZ, status, ordersOpen: open, with4h: s.zone && t4 ? s.zone.d === t4 : null };
  }

  const api = { sd1h, swing, sweeps, majorSweeps, trend4h, read };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EdgeSD = api;
})(typeof window !== "undefined" ? window : globalThis);
