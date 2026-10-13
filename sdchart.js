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
        const opp = (k) => k >= 0 && (d === 1 ? B[k].c < B[k].o : B[k].c > B[k].o);
        const a = !opp(o) && opp(o - 1) ? o - 1 : o;
        let n = 0, near = null;
        for (let k = a; k >= Math.max(0, a - 2); k--) {
          if (!opp(k)) break;
          // an older opposite candle joins only inside the last one's range (a base), not a step of the drop
          if (n > 0 && (d === 1 ? Math.max(B[k].o, B[k].c) > B[a].h : Math.min(B[k].o, B[k].c) < B[a].l)) break;
          n++;
          near = d === 1 ? Math.max(near ?? -Infinity, B[k].o, B[k].c) : Math.min(near ?? Infinity, B[k].o, B[k].c);
        }
        const oldest = n > 0 ? a - n + 1 : o;
        if (n === 0) near = d === 1 ? Math.max(B[o].o, B[o].c) : Math.min(B[o].o, B[o].c);
        let far = d === 1 ? B[oldest].l : B[oldest].h;
        for (let k = oldest; k <= i; k++) far = d === 1 ? Math.min(far, B[k].l) : Math.max(far, B[k].h);
        const top = d === 1 ? near : far, bot = d === 1 ? far : near;
        if (z && z.d === d) z2 = z; else if (z2 && z2.d !== d) z2 = null;
        z = top - bot > 0 && top - bot <= 3 * atr ? { d, top, bot, t: B[oldest].t } : null;
      }
    }
    const zone = z && cnt >= 2 ? z : null;
    const overlap = zone && z2 && z2.bot <= zone.top && z2.top >= zone.bot;
    const older = z2 && cnt >= 2 && z2.d === prevDir && !overlap ? z2 : null;
    const bos = breaks.filter((x) => !x.mss).slice(-3), mss = breaks.filter((x) => x.mss).slice(-1);
    return { trend: prevDir, cnt, zone, older, breaks: [...bos, ...mss].sort((p, q) => p.t1 - q.t1) };
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
    const s = sd1h(h1.slice(0, -1)), t4 = trend4h(h4.slice(0, -1));
    const inZ = s.zone && price != null && price <= s.zone.top && price >= s.zone.bot;
    const status = !s.trend ? "Wait: no 1H trend yet"
      : s.cnt < 2 ? "Wait: 1H needs a 2nd BOS"
      : !s.zone ? "Wait: no fresh 1H zone"
      : inZ ? "IN ZONE — waiting for 5m MSS"
      : "Wait: price not in the zone yet";
    const open = nyMin != null && nyMin >= 120 && nyMin < 690;
    return { ...s, t4, inZone: !!inZ, status, ordersOpen: open, with4h: s.zone && t4 ? s.zone.d === t4 : null };
  }

  const api = { sd1h, trend4h, read };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EdgeSD = api;
})(typeof window !== "undefined" ? window : globalThis);
