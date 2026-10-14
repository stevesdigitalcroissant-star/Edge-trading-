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
        // the impulse that broke the protected level started at the last major swing before it —
        // e.g. the last lower high in an uptrend that fails — not at the old move's extreme
        // (a swing with SW candles each side, so small pauses inside the impulse don't count)
        const SW = 6;
        let st = peak.i;
        for (let k = i - 1; k > peak.i; k--) {
          let ok = true; for (let m = 1; m <= SW && ok; m++) ok = k - m >= 0 && (up ? B[k].h >= B[k - m].h : B[k].l <= B[k - m].l) && (k + m > i || (up ? B[k].h >= B[k + m].h : B[k].l <= B[k + m].l));
          if (ok) { st = k; break; }
        }
        out.push({ d: -dir, lvl: prot.p, t0: B[prot.i].t, t1: b.t, mss: true, o: { t: B[st].t, p: up ? B[st].h : B[st].l } });
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

  // Liquidity as fuel: stops rest beyond the MAJOR highs (buy-side, BSL) and lows (sell-side, SSL). Major = a
  // swing with `len` candles each side; equal highs / lows (within `tolATR` × ATR) pool together and count touches.
  // A pool is taken when price trades past it: "swept" if price is back inside within `back` candles (fuel for a
  // reversal), "run" if it keeps going. Untaken pools rest as targets. Bias: the side taken last by a sweep —
  // sell-side swept → buys, buy-side swept → sells.
  function liquidity(B, { len = 5, tolATR = 0.3, back = 3, keep = 3 } = {}) {
    const pools = [], taken = []; let atr = null;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], tr = i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l;
      atr = atr == null ? tr : (atr * 13 + tr) / 14;
      const j = i - len;
      if (j >= len) for (const d of [1, -1]) {
        let ok = true; for (let k = 1; k <= len && ok; k++) ok = d === 1 ? B[j].h > B[j - k].h && B[j].h >= B[j + k].h : B[j].l < B[j - k].l && B[j].l <= B[j + k].l;
        if (!ok) continue;
        const p = d === 1 ? B[j].h : B[j].l, near = pools.find((q) => q.d === d && Math.abs(q.p - p) <= tolATR * atr);
        if (near) { near.touches++; near.p = d === 1 ? Math.max(near.p, p) : Math.min(near.p, p); near.tl = B[j].t; near.il = j; }
        else pools.push({ d, p, touches: 1, t0: B[j].t, tl: B[j].t, il: j });
      }
      for (let q = pools.length - 1; q >= 0; q--) {
        const P = pools[q]; if (P.il > i - len) continue;
        if (P.d === 1 ? b.h <= P.p : b.l >= P.p) continue;
        let back_ = -1; for (let k = i; k <= Math.min(B.length - 1, i + back); k++) if (P.d === 1 ? B[k].c < P.p : B[k].c > P.p) { back_ = k; break; }
        if (back_ < 0 && i + back >= B.length) continue; // too early to tell
        taken.push({ d: P.d, lvl: P.p, t0: P.t0, t1: b.t, touches: P.touches, how: back_ >= 0 ? "swept" : "run" });
        pools.splice(q, 1);
      }
    }
    const px = B.length ? B[B.length - 1].c : 0;
    const resting = [...pools.filter((q) => q.d === 1 && q.p > px).sort((a, b) => a.p - b.p).slice(0, keep), ...pools.filter((q) => q.d === -1 && q.p < px).sort((a, b) => b.p - a.p).slice(0, keep)]
      .map((q) => ({ d: q.d, lvl: q.p, t0: q.t0, touches: q.touches }));
    const lastSweep = [...taken].reverse().find((x) => x.how === "swept");
    return { taken, resting, bias: lastSweep ? -lastSweep.d : 0, lastSweep: lastSweep || null };
  }

  // Supply & demand zones (how Steve draws them): the base an impulse leaves from — the last 1–3 opposite candles
  // (older ones only if they sit inside the last one's range), wick to wick: far edge = the extreme, body edge (arms
  // alerts) and wick edge (drawn light). Two kinds:
  //  · "BOS" / "MSS": the base of every impulse that broke structure (from the swing structure);
  //  · "fuel": every other base inside a trend that created a move — a displacement out of it that takes out the
  //    recent high (demand) / low (supply). Trends are fuelled by several of these until fatigue.
  // A base taller than `refineATR` × ATR is refined on the lower timeframe (`lower` bars) to the 1–3 opposite candles
  // at the extreme; without lower bars, bases taller than `maxATR` × ATR are skipped. Then followed after the leg:
  // fresh → tested (with how deep the deepest touch went, 0–100 % of the zone, and how many touches) → broken
  // (a close through the far edge).
  function swingZones(B, sw, { maxATR = 3, refineATR = 1.5, lower = null, fuel = true } = {}) {
    const n = B.length, idx = new Map(B.map((b, i) => [b.t, i])), atr = []; let a = null;
    B.forEach((b, i) => { const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l; a = a == null ? tr : (a * 13 + tr) / 14; atr.push(a); });
    const tf = n > 1 ? Math.min(...B.slice(1, 50).map((b, i) => b.t - B[i].t)) : 0;
    const isOpp = (X, k, d) => k >= 0 && k < X.length && (d === 1 ? X[k].c < X[k].o : X[k].c > X[k].o);
    // the base candles at index o (the leg's extreme) of bars X
    const baseAt = (X, o, d) => {
      const s0 = !isOpp(X, o, d) && isOpp(X, o - 1, d) ? o - 1 : o, cs = [];
      for (let k = s0; k >= Math.max(0, s0 - 2); k--) {
        if (!isOpp(X, k, d)) break;
        if (cs.length && (d === 1 ? Math.max(X[k].o, X[k].c) > X[s0].h : Math.min(X[k].o, X[k].c) < X[s0].l)) break;
        cs.push(k);
      }
      if (!cs.length) cs.push(o);
      const far = d === 1 ? Math.min(...cs.map((k) => X[k].l), X[o].l) : Math.max(...cs.map((k) => X[k].h), X[o].h);
      const body = d === 1 ? Math.max(...cs.map((k) => Math.max(X[k].o, X[k].c))) : Math.min(...cs.map((k) => Math.min(X[k].o, X[k].c)));
      const wick = d === 1 ? Math.max(...cs.map((k) => X[k].h)) : Math.min(...cs.map((k) => X[k].l));
      return { t: X[Math.min(...cs)].t, far, body, wick, n: cs.length };
    };
    // refine a tall base on the lower timeframe: the lower candles inside it, the one at the extreme, its base
    const refine = (z, o, d) => {
      const t0 = z.t, t1 = B[o].t + tf, L = lower.filter((x) => x.t >= t0 && x.t < t1);
      if (L.length < 2) return null;
      let e = 0; for (let k = 1; k < L.length; k++) if (d === 1 ? L[k].l < L[e].l : L[k].h > L[e].h) e = k;
      const r = baseAt(L, e, d); r.refined = true; return r;
    };
    const make = (o, d, from, tBreak, start) => {
      let z = baseAt(B, o, d);
      const h = Math.abs(z.wick - z.far);
      if (h > refineATR * atr[o] && lower) z = refine(z, o, d) || z;
      if (Math.abs(z.wick - z.far) > maxATR * atr[o] || Math.abs(z.body - z.far) <= 0) return null;
      const r = { d, from, t: z.t, tBreak, far: z.far, body: z.body, wick: z.wick, top: d === 1 ? z.wick : z.far, bot: d === 1 ? z.far : z.wick, i: o, refined: !!z.refined, status: "fresh", tEnd: null, touches: 0, depth: 0 };
      // follow it after the leg: each return into the zone is a touch; depth = deepest touch (0 = wick edge, 1 = far)
      // liquidity taken INTO the zone: minor swing highs (supply) / lows (demand) formed after the leg, run by the
      // move that came back to the zone — buy stops above for a sell, sell stops below for a buy (the fuel)
      let inside = false; const minor = []; r.liq = [];
      for (let k = start + 1; k < n; k++) {
        const j = k - 3;
        if (j > start + 3) { let ok = true; for (let m = 1; m <= 3 && ok; m++) ok = d === 1 ? B[j].l < B[j - m].l && B[j].l <= B[j + m].l : B[j].h > B[j - m].h && B[j].h >= B[j + m].h; if (ok) minor.push({ p: d === 1 ? B[j].l : B[j].h, t: B[j].t, i: j }); }
        for (let q = minor.length - 1; q >= 0; q--) if (minor[q].i < k - 3 && (d === 1 ? B[k].l < minor[q].p : B[k].h > minor[q].p)) {
          // counts when that run reaches the zone within 6 candles
          let to = -1; for (let m = k; m <= Math.min(n - 1, k + 6); m++) if (d === 1 ? B[m].l <= r.wick : B[m].h >= r.wick) { to = m; break; }
          // only the pools in front of the zone, taken on the way to its first touch
          if (to >= 0 && !r.touches && (d === 1 ? minor[q].p > r.wick : minor[q].p < r.wick)) r.liq.push({ lvl: minor[q].p, t0: minor[q].t, t1: B[k].t });
          minor.splice(q, 1);
        }
        if (d === 1 ? B[k].c < r.far : B[k].c > r.far) { r.status = "broken"; r.tEnd = B[k].t; break; }
        const hit = d === 1 ? B[k].l <= r.wick : B[k].h >= r.wick;
        if (hit) {
          if (!inside) { r.touches++; if (!r.tTest) r.tTest = B[k].t; }
          const dp = (d === 1 ? r.wick - B[k].l : B[k].h - r.wick) / Math.abs(r.wick - r.far);
          r.depth = Math.max(r.depth, Math.min(1, dp));
          if (d === 1 ? B[k].l <= r.body : B[k].h >= r.body) r.status = "tested";
        }
        inside = hit;
      }
      r.liq = r.liq.slice(-2);
      return r;
    };
    const out = [];
    for (const x of sw.breaks) {
      if (!x.o) continue;
      const o = idx.get(x.o.t), bi = idx.get(x.t1); if (o == null || bi == null) continue;
      const z = make(o, x.d, x.mss ? "MSS" : "BOS", x.t1, bi); if (z) out.push(z);
    }
    if (fuel) {
      // the trend at each bar from the swing structure
      const tr = new Array(n).fill(0); let bi = 0, dir = 0;
      const bs = [...sw.breaks].sort((p, q) => p.t1 - q.t1);
      for (let i = 0; i < n; i++) { while (bi < bs.length && bs[bi].t1 <= B[i].t) dir = bs[bi++].d; tr[i] = dir; }
      for (let e = 10; e < n - 3; e++) {
        const d = tr[e]; if (!d) continue;
        // the base sits at a turn: the extreme of the 3 candles each side
        let turn = true; for (let k = e - 3; k <= e + 3 && turn; k++) if (k !== e) turn = d === 1 ? B[e].l <= B[k].l : B[e].h >= B[k].h;
        if (!turn) continue;
        const z = baseAt(B, e, d);
        // displacement: within 3 candles a close beyond the base by ≥ 1 ATR and past the last 10 candles' high / low
        let prior = d === 1 ? -Infinity : Infinity; for (let k = e - 10; k < e; k++) prior = d === 1 ? Math.max(prior, B[k].h) : Math.min(prior, B[k].l);
        let leg = -1;
        for (let k = e + 1; k <= Math.min(n - 1, e + 3); k++) {
          if (d === 1 ? B[k].c < z.far : B[k].c > z.far) break;
          if ((d === 1 ? B[k].c - z.wick : z.wick - B[k].c) >= atr[e] && (d === 1 ? B[k].c > prior : B[k].c < prior)) { leg = k; break; }
        }
        if (leg < 0) continue;
        // not a duplicate of a zone already there (same side, overlapping, made within 3 candles)
        const dup = out.some((q) => q.d === d && Math.abs(q.i - e) <= 6 && q.bot <= Math.max(z.far, z.wick) && q.top >= Math.min(z.far, z.wick));
        if (dup) continue;
        const r = make(e, d, "fuel", B[leg].t, leg); if (r) out.push(r);
      }
    }
    return out.sort((p, q) => p.t - q.t);
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
    // how much of the 1H zone price has filled since the break that made it (drawn zone: wick edge → far edge);
    // price usually fills ~30% of a fresh zone before it turns — a 5m MSS before that may go deeper first
    let fill = null;
    if (s.zone) {
      const z = s.zone, near = z.d > 0 ? Math.max(z.top, z.wick ?? z.top) : Math.min(z.bot, z.wick ?? z.bot), far = z.d > 0 ? z.bot : z.top;
      const br = (s.allBreaks || []).filter((b) => b.d === z.d && b.t1 > z.t).pop(), from = br ? br.t1 : z.t;
      const after = h1.filter((b) => b.t > from);
      if (after.length && near !== far) {
        const ext = z.d > 0 ? Math.min(...after.map((b) => b.l)) : Math.max(...after.map((b) => b.h));
        fill = Math.max(0, (z.d > 0 ? near - ext : ext - near) / Math.abs(near - far));
      }
      z.l30 = near - z.d * 0.3 * Math.abs(near - far);
    }
    const status = !s.trend ? "Wait: no 1H trend yet"
      : s.cnt < 2 ? "Wait: 1H needs a 2nd BOS"
      : !s.zone ? "Wait: no fresh 1H zone"
      : inZ ? `IN ZONE · ${fill > 1 ? "wicked past the far edge" : `filled ${Math.round((fill || 0) * 100)}%${fill != null && fill < 0.3 ? " (under 30%)" : ""}`} — waiting for 5m MSS`
      : "Wait: price not in the zone yet";
    const open = nyMin != null && nyMin >= 180 && nyMin < 840;
    const in4 = s4.zone && price != null && price <= s4.zone.top && price >= s4.zone.bot;
    return { ...s, t4, zone4: s4.zone, older4: s4.older, inZone4: !!in4, inZone: !!inZ, fill, status, ordersOpen: open, with4h: s.zone && t4 ? s.zone.d === t4 : null };
  }

  const api = { sd1h, swing, sweeps, majorSweeps, liquidity, swingZones, trend4h, read };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EdgeSD = api;
})(typeof window !== "undefined" ? window : globalThis);
