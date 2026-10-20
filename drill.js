// The Test tab: endless made-up supply & demand setups to train your eye. Look at the chart, tap TAKE or SKIP,
// watch the trade play out, see why it won or lost — next. The setups are generated from the TAKE rule Edge uses:
// score = +1 mature zone (more than 10 1H candles old) +1 room of 2R or more to the leg high +1 narrow zone −1 instant retest (3 candles or less);
// TAKE when the score is 2 or more (A+), or 0 or more with a clean pullback — and only once the 5m shows a change of character (CHoCH).
// Also on screen: the 4H big picture (with the trend = better odds), the 5m entry (FVG / breaker / mitigation) and the volume of the break
// (shown, not counted yet: the backtest on volume is running). Outcomes follow the backtest odds: good setups win more, never always.
(function () {
  const MARKETS = [["Gold", 2400, 2.4, 1], ["NQ", 20500, 14, 2], ["YM", 42000, 38, 0], ["Silver", 30, 0.06, 3], ["Copper", 4.4, 0.012, 4],
    ["Nat gas", 2.8, 0.025, 3], ["Euro 6E", 1.085, 0.0009, 5], ["Yen 6J", 0.0068, 0.000006, 7], ["Aussie 6A", 0.665, 0.0007, 5]];
  const r = (a, b) => a + Math.random() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1)), pick = (a) => a[Math.floor(Math.random() * a.length)];
  const KEY = "edge.drill";
  let ST = { n: 0, right: 0, streak: 0, best: 0, rMine: 0, rRules: 0 };
  try { ST = { ...ST, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch {} };

  // ---------- one made-up setup ----------
  function features(wantTake) {
    for (let i = 0; i < 200; i++) {
      const ageCls = Math.random() < 0.2 ? "instant" : Math.random() < 0.45 ? "normal" : "mature";
      const age = ageCls === "instant" ? ri(2, 3) : ageCls === "normal" ? ri(5, 10) : ri(12, 26);
      const narrow = Math.random() < 0.55, w = narrow ? r(0.45, 0.72) : r(0.95, 1.6);
      const roomGood = Math.random() < 0.6, roomR = roomGood ? r(2.3, 4.5) : r(0.9, 1.7);
      const choppy = Math.random() < 0.38;
      const score = (ageCls === "mature") + roomGood + narrow - (ageCls === "instant");
      const choch = Math.random() < 0.75, trig = pick(["FVG", "Breaker", "Mitigation"]);
      const trend = Math.random() < 0.5 ? "with" : Math.random() < 0.6 ? "against" : "range";
      const volX = Math.random() < 0.45 ? r(1.6, 2.6) : Math.random() < 0.6 ? r(1.0, 1.45) : r(0.6, 0.95);
      const take = (score >= 2 || (score >= 0 && !choppy)) && choch;
      if (take === wantTake) return { ageCls, age, narrow, w, roomGood, roomR, choppy, score, take, choch, trig, trend, volX };
    }
  }
  // the 5m zoom at the zone (drawn as a long; flipped for a short): price taps the zone, then a CHoCH and the entry pattern — or no CHoCH yet
  function entry5(f) {
    const C = []; let p = 6;
    const push = (to, up = r(0.05, 0.35), dn = r(0.05, 0.35)) => { C.push({ o: p, c: to, h: Math.max(p, to) + up, l: Math.min(p, to) - dn }); p = to; };
    for (let i = 0; i < 6; i++) push(p - r(0.4, 1.1));
    const low = Math.min(...C.map((b) => b.l));
    if (!f.choch) { for (let i = 0; i < 9; i++) push(Math.max(low - 0.6, Math.min(low + 1.6, p + r(-0.9, 0.7)))); return { C, choch: false }; }
    push(p + r(0.5, 1)); push(p + r(0.4, 0.9)); const lhI = C.length; push(p + r(0.2, 0.5), 0.1); const lh = C[lhI].h;
    push(p - r(0.4, 0.8)); const hlI = C.length; push(p - r(0.2, 0.5));
    const b1 = C.length; push(lh + r(0.1, 0.4), 0.1, 0.1); push(p + r(1, 1.6), 0.15, 0.05); push(p + r(0.3, 0.7));
    let box;
    if (f.trig === "FVG") box = [C[b1 - 1].h, C[b1 + 1].l].sort((a, b) => a - b);
    else if (f.trig === "Breaker") box = [lh - 0.45, lh];
    else box = [C[hlI].l, C[hlI].l + Math.max(0.4, C[hlI].h - C[hlI].l)];
    const startI = f.trig === "FVG" ? b1 : f.trig === "Breaker" ? lhI : hlI;
    push(p - r(0.4, 0.8)); push(box[1] - r(0, 0.1), 0.1, Math.max(0.02, (box[1] - box[0]) * 0.4));
    return { C, choch: true, lh, lhI, brkI: b1 + 1, box, boxI: startI, at: C.length - 1 };
  }
  function make() {
    const f = features(Math.random() < 0.5), long = Math.random() < 0.5, mk = pick(MARKETS);
    const C = []; // candles in "units" for a LONG setup (a short is mirrored at the end); 1 unit ≈ one candle's range
    let p = f.w + r(2.5, 4);
    const push = (o, c, up = r(0.05, 0.3), dn = r(0.05, 0.3)) => { C.push({ o, c, h: Math.max(o, c) + up, l: Math.min(o, c) - dn }); return c; };
    for (let i = 0; i < 12; i++) p = push(p, p - r(-0.35, 0.75)); // price drops into the base
    const baseStart = C.length;
    for (let i = 0, n = ri(2, 3); i < n; i++) { const o = r(0.15, f.w - 0.1), c = r(0.15, f.w - 0.1); C.push({ o, c, h: Math.min(f.w, Math.max(o, c) + r(0.02, 0.15)), l: i === 0 ? 0 : Math.max(0.02, Math.min(o, c) - r(0.02, 0.15)) }); }
    const buf = 0.15, R = f.w + buf, entry = f.w, stop = -buf, target = entry + 3 * R, legExt = entry + f.roomR * R;
    // the explosive leg out of the base, up to the leg high
    const legStart = C.length, nLeg = Math.max(2, Math.min(6, Math.round((legExt - f.w) / 1.3)));
    p = C[C.length - 1].c;
    for (let i = 1; i <= nLeg; i++) { const to = f.w * 0.6 + (legExt - f.w * 0.6) * (i / nLeg) - (i === nLeg ? r(0.05, 0.2) : 0); p = push(p, to, i === nLeg ? legExt - to : r(0.02, 0.15), r(0.02, 0.12)); }
    // the walk back to the zone: as many candles as the zone's age; clean = steady, choppy = big overlapping swings
    const m = Math.max(1, f.age - nLeg), dropTo = entry - r(0, f.w * 0.35);
    for (let i = 1; i <= m; i++) {
      const glide = legExt - 0.2 - (legExt - 0.2 - entry - 0.25) * (i / m);
      let c = f.choppy ? glide + (i % 2 ? 1 : -1) * r(0.4, 0.9) : glide + r(-0.15, 0.2);
      c = Math.min(c, legExt - 0.1);
      if (i === m) { c = entry + r(0.05, 0.25); p = push(p, c, r(0.05, 0.2), c - dropTo); break; }
      const big = f.choppy ? r(0.3, 0.8) : r(0.05, 0.25);
      const cc = Math.max(entry + 0.2, c);
      p = push(p, cc, Math.max(0.02, Math.min(big, legExt - Math.max(p, cc))), Math.max(0.02, Math.min(big, Math.min(p, cc) - entry - 0.05)));
    }
    const at = C.length - 1; // you decide here: the limit at the zone's edge just filled
    // what happens next: wins reach 3R before the stop, losses hit the stop first (a short room = it stalls at the leg high first)
    const pWin = Math.max(0.12, Math.min(0.62, 0.22 + 0.07 * f.score + (f.ageCls === "mature" ? 0.07 : 0) - (f.choppy ? 0.07 : 0) - (f.ageCls === "instant" ? 0.05 : 0)
      + (f.choch ? 0.04 : -0.13) + (f.trend === "with" ? 0.06 : f.trend === "against" ? -0.05 : 0)));
    const win = Math.random() < pWin;
    p = C[at].c;
    const stallFirst = !win && !f.roomGood && Math.random() < 0.75;
    let peaked = false;
    for (let k = 0; k < 45; k++) {
      let to;
      if (win) to = p + r(-0.45, 0.85);
      else if (stallFirst && !peaked) { to = p + r(0.1, 0.8); if (to >= legExt - 0.25) { to = legExt - r(0.05, 0.2); peaked = true; } }
      else to = p - r(-0.35, 0.8);
      if (win) { to = Math.max(to, stop + 0.15); if (to >= target) { const d = r(0, 0.15); push(p, target - d, d + r(0.02, 0.1), r(0.05, 0.2)); break; } }
      else { to = Math.min(to, target - 0.4); if (to <= stop) { const d = r(0, 0.1); push(p, stop + d, r(0.05, 0.2), d + r(0.03, 0.12)); break; } }
      p = push(p, to, Math.min(r(0.05, 0.3), win ? 9 : target - 0.3 - Math.max(p, to)), Math.min(r(0.05, 0.3), win ? Math.min(p, to) - stop - 0.05 : 9));
      if (k === 44) push(p, win ? target : stop, 0.05, 0.05);
    }
    // volume: the leg out carries the break volume (volX × average); a clean pullback is quiet, a choppy one noisy
    const vol = C.map((b, i) => (i >= legStart && i < legStart + nLeg ? f.volX * r(0.85, 1.15) : i > legStart + nLeg && i <= at ? (f.choppy ? r(0.9, 1.4) : r(0.55, 0.9)) : r(0.7, 1.3)) * 1000);
    // the 4H big picture: 18 closes, trending with the trade, against it, or flat
    const t4 = []; let q = 0; const slope = f.trend === "range" ? 0 : (f.trend === "with") === long ? 1 : -1;
    for (let i = 0; i < 18; i++) { q += slope * r(0.2, 1) + r(-0.7, 0.7) + (f.trend === "range" ? -q * 0.3 : 0); t4.push(q); }
    const m5 = entry5(f);
    // to prices; a short is the same picture upside down
    const s = long ? 1 : -1, P = (u) => mk[1] + s * u * mk[2];
    const bars = C.map((b) => long ? { o: P(b.o), c: P(b.c), h: P(b.h), l: P(b.l) } : { o: P(b.o), c: P(b.c), h: P(b.l), l: P(b.h) });
    return { f, long, mk, bars, vol, t4, m5, at, baseStart, legStart, nLeg, entry: P(entry), stop: P(stop), target: P(target), legExt: P(legExt), zLo: P(long ? 0 : f.w), zHi: P(long ? f.w : 0), win, pWin, dec: mk[3] };
  }

  // ---------- the chart ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function draw(cv, X, upto, reveal) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const all = X.bars, n = all.length, padR = 74, step = (W - padR - 8) / n, bw = Math.max(2, step * 0.62);
    let lo = Math.min(X.stop, X.target, ...all.map((b) => b.l)), hi = Math.max(X.stop, X.target, ...all.map((b) => b.h));
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const volH = 50, y = (v) => 10 + (H - 24 - volH) * (1 - (v - lo) / (hi - lo)), x = (i) => 8 + step * (i + 0.5);
    const text = css("--text") || "#ddd", muted = css("--muted") || "#888", up = "#26a69a", dn = "#ef5350", gold = css("--accent") || "#d9b46c";
    // the zone, from the base to the right edge
    const zc = X.long ? "38,166,154" : "239,83,80";
    g.fillStyle = `rgba(${zc},.16)`; g.strokeStyle = `rgba(${zc},.7)`; g.lineWidth = 1;
    const zx = x(X.baseStart) - step / 2, zy = y(Math.max(X.zLo, X.zHi)), zh = Math.abs(y(X.zLo) - y(X.zHi));
    g.fillRect(zx, zy, W - padR - zx, zh); g.strokeRect(zx, zy, W - padR - zx, zh);
    g.fillStyle = `rgb(${zc})`; g.font = "600 11px system-ui, sans-serif"; g.fillText(`1H ${X.long ? "DEMAND" : "SUPPLY"}`, zx + 4, X.long ? zy + zh + 13 : zy - 5);
    // the leg high / low: the first thing in the way of the target
    const legI = X.legStart + X.nLeg;
    g.setLineDash([4, 4]); g.strokeStyle = muted; g.beginPath(); g.moveTo(x(legI - 1), y(X.legExt)); g.lineTo(W - padR, y(X.legExt)); g.stroke(); g.setLineDash([]);
    g.fillStyle = muted; g.fillText(X.long ? "leg high" : "leg low", x(legI - 1), y(X.legExt) + (X.long ? -5 : 13));
    // the position: red = stop, green = target (1:3)
    const px = x(X.at) - step / 2, pw = W - padR - px;
    g.fillStyle = "rgba(239,83,80,.14)"; g.fillRect(px, Math.min(y(X.entry), y(X.stop)), pw, Math.abs(y(X.entry) - y(X.stop)));
    g.fillStyle = "rgba(38,166,154,.14)"; g.fillRect(px, Math.min(y(X.entry), y(X.target)), pw, Math.abs(y(X.entry) - y(X.target)));
    // candles
    for (let i = 0; i <= upto && i < n; i++) {
      const b = all[i], c = b.c >= b.o ? up : dn;
      g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(x(i), y(b.h)); g.lineTo(x(i), y(b.l)); g.stroke();
      g.fillRect(x(i) - bw / 2, Math.min(y(b.o), y(b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c))));
    }
    // volume under the candles: strong (1.5× average or more) teal, weak (under average) orange
    const vmax = Math.max(...X.vol), vb = H - 6;
    g.strokeStyle = muted; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(8, vb - volH * (1000 / vmax)); g.lineTo(W - padR, vb - volH * (1000 / vmax)); g.stroke(); g.globalAlpha = 1;
    for (let i = 0; i <= upto && i < n; i++) { const v = X.vol[i], k = v / 1000; g.fillStyle = k >= 1.5 ? "rgba(38,166,154,.85)" : k < 1 ? "rgba(224,129,75,.7)" : "rgba(123,141,163,.6)"; g.fillRect(x(i) - bw / 2, vb - volH * (v / vmax), bw, volH * (v / vmax)); }
    g.fillStyle = muted; g.font = "600 10.5px system-ui, sans-serif"; g.fillText("VOLUME", 10, vb - volH + 2);
    const vi = X.legStart + Math.floor(X.nLeg / 2);
    g.fillStyle = X.f.volX >= 1.5 ? "#26a69a" : X.f.volX < 1 ? "#e0814b" : muted; g.fillText(`break ${X.f.volX.toFixed(1)}×`, Math.min(W - padR - 70, x(vi) + 6), vb - volH * (X.vol[vi] / vmax) + 10);
    // price tags on the right
    const tag = (v, label, col) => { const ty = y(v); g.fillStyle = col; g.fillRect(W - padR + 2, ty - 9, padR - 4, 18); g.fillStyle = "#fff"; g.font = "700 10.5px system-ui, sans-serif"; g.fillText(`${label} ${v.toFixed(X.dec)}`.slice(0, 13), W - padR + 5, ty + 4); g.strokeStyle = col; g.beginPath(); g.moveTo(px, ty); g.lineTo(W - padR, ty); g.stroke(); };
    tag(X.target, "TP", "#1f8f6a"); tag(X.entry, "IN", "#4b5563"); tag(X.stop, "SL", "#c0393f");
    // after you answer: what you should have counted
    if (reveal) {
      g.font = "600 11px system-ui, sans-serif";
      const a0 = x(X.legStart) - step / 2, a1 = x(X.at), ay = X.long ? y(Math.min(X.zLo, X.zHi)) + 30 : Math.max(26, y(Math.max(X.zLo, X.zHi)) - 24);
      g.strokeStyle = gold; g.fillStyle = gold; g.beginPath(); g.moveTo(a0, ay); g.lineTo(a1, ay); g.moveTo(a0, ay - 4); g.lineTo(a0, ay + 4); g.moveTo(a1, ay - 4); g.lineTo(a1, ay + 4); g.stroke();
      g.fillText(`${X.f.age} candles old`, Math.max(4, (a0 + a1) / 2 - 40), ay + (X.long ? 14 : -6));
      const rx = W - padR - 14; g.beginPath(); g.moveTo(rx, y(X.entry)); g.lineTo(rx, y(X.legExt)); g.stroke();
      g.fillText(`${X.f.roomR.toFixed(1)}R room`, rx - 62, (y(X.entry) + y(X.legExt)) / 2 + 4);
    }
    void text;
  }

  // the 4H big picture: a line of closes with the trend written on it
  function draw4(cv, X) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = X.long ? X.t4 : X.t4.map((q) => q), lo = Math.min(...v), hi = Math.max(...v), y = (q) => 26 + (H - 34) * (1 - (q - lo) / (hi - lo || 1)), x = (i) => 8 + (W - 16) * (i / (v.length - 1));
    const tr = X.f.trend, up = tr === "range" ? null : (tr === "with") === X.long, col = tr === "with" ? "#26a69a" : tr === "against" ? "#ef5350" : "#9aa3ad";
    g.strokeStyle = col; g.lineWidth = 2.2; g.lineJoin = "round"; g.beginPath(); v.forEach((q, i) => (i ? g.lineTo(x(i), y(q)) : g.moveTo(x(i), y(q)))); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(x(v.length - 1), y(v[v.length - 1]), 3.5, 0, 7); g.fill();
    g.font = "700 11.5px system-ui, sans-serif"; g.fillText(`4H ${up == null ? "↔ range" : up ? "↑ uptrend" : "↓ downtrend"}`, 8, 15);
    g.font = "600 10.5px system-ui, sans-serif"; g.fillStyle = css("--muted") || "#888"; g.fillText(tr === "with" ? "with your trade" : tr === "against" ? "against your trade" : "no clear trend", 8, H - 4);
  }
  // the 5m entry at the zone: CHoCH line, the entry pattern box, the fill
  function draw5(cv, X) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const M = X.m5, C = M.C, f = X.long ? (q) => q : (q) => -q;
    let lo = Math.min(...C.map((b) => Math.min(f(b.l), f(b.h)))), hi = Math.max(...C.map((b) => Math.max(f(b.l), f(b.h))));
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const y = (q) => 22 + (H - 30) * (1 - (f(q) - lo) / (hi - lo)), step = (W - 12) / C.length, x = (i) => 6 + step * (i + 0.5), bw = Math.max(2, step * 0.6);
    const lowest = X.long ? Math.min(...C.map((b) => b.l)) : Math.max(...C.map((b) => b.h)) * 0 + Math.min(...C.map((b) => b.l));
    const zc = X.long ? "38,166,154" : "239,83,80";
    g.fillStyle = `rgba(${zc},.13)`; const zy1 = y(lowest - 0.3), zy2 = y(lowest + 1.5); g.fillRect(0, Math.min(zy1, zy2), W, Math.abs(zy2 - zy1));
    if (M.choch) {
      g.fillStyle = "rgba(232,194,122,.28)"; g.strokeStyle = "#e8c27a"; const by1 = y(M.box[0]), by2 = y(M.box[1]); g.fillRect(x(M.boxI) - step / 2, Math.min(by1, by2), W - x(M.boxI), Math.abs(by2 - by1)); g.strokeRect(x(M.boxI) - step / 2, Math.min(by1, by2), W - x(M.boxI), Math.abs(by2 - by1));
      g.setLineDash([3, 3]); g.strokeStyle = css("--text") || "#ddd"; g.beginPath(); g.moveTo(x(M.lhI), y(M.lh)); g.lineTo(x(M.brkI) + 4, y(M.lh)); g.stroke(); g.setLineDash([]);
    }
    for (let i = 0; i < C.length; i++) { const b = C[i], upc = X.long ? b.c >= b.o : b.c <= b.o, c = upc ? "#26a69a" : "#ef5350"; g.strokeStyle = c; g.fillStyle = c;
      g.beginPath(); g.moveTo(x(i), y(b.h)); g.lineTo(x(i), y(b.l)); g.stroke(); g.fillRect(x(i) - bw / 2, Math.min(y(b.o), y(b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c)))); }
    g.font = "700 11.5px system-ui, sans-serif"; g.fillStyle = css("--text") || "#ddd"; g.fillText("5m entry", 6, 14);
    g.font = "700 10.5px system-ui, sans-serif";
    if (M.choch) { g.fillStyle = css("--text") || "#ddd"; g.fillText("CHoCH", Math.max(4, x(M.lhI) - 40), y(M.lh) + (X.long ? -5 : 12)); g.fillStyle = "#e8c27a"; const tw = g.measureText(X.f.trig).width, by = X.long ? Math.max(y(M.box[0]), y(M.box[1])) + 12 : Math.min(y(M.box[0]), y(M.box[1])) - 4; g.fillText(X.f.trig, W - tw - 6, Math.min(H - 3, Math.max(24, by))); }
    else { g.fillStyle = "#ef5350"; g.fillText("no CHoCH yet", W - 80, 14); }
  }

  // ---------- the screen ----------
  let root = null, X = null, phase = "ask", mine = null, upto = 0, timer = 0;
  const rr = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v)}R`;
  function stats() {
    const pct = ST.n ? Math.round((ST.right / ST.n) * 100) : 0;
    return `<div class="dr-stats"><div><b>${ST.right}<small>/${ST.n}</small></b><em>right calls ${ST.n ? `· ${pct}%` : ""}</em></div><div><b>🔥 ${ST.streak}</b><em>streak · best ${ST.best}</em></div><div><b class="${ST.rMine >= 0 ? "good" : "bad"}">${rr(ST.rMine)}</b><em>your calls</em></div><div><b class="${ST.rRules >= 0 ? "good" : "bad"}">${rr(ST.rRules)}</b><em>the rules</em></div></div>`;
  }
  function checks() {
    const f = X.f, side = X.long ? "buyers" : "sellers";
    const rows = [
      [f.ageCls === "mature" ? 1 : f.ageCls === "instant" ? -1 : 0, f.ageCls === "mature" ? `Mature zone · ${f.age} candles old` : f.ageCls === "instant" ? `Instant retest · only ${f.age} candles` : `Young zone · ${f.age} candles (needs 11+)`],
      [f.roomGood ? 1 : 0, f.roomGood ? `Room: ${f.roomR.toFixed(1)}R to the leg ${X.long ? "high" : "low"}` : `Only ${f.roomR.toFixed(1)}R of room (needs 2R)`],
      [f.narrow ? 1 : 0, f.narrow ? "Narrow zone · tight stop" : "Wide zone · big stop"],
      [f.choppy ? -1 : 1, f.choppy ? "Choppy, messy pullback" : `Clean pullback · ${side} waiting`],
      [f.choch ? 1 : -1, f.choch ? `5m CHoCH + ${f.trig} entry` : "No 5m CHoCH yet — no entry"],
    ];
    const bonus = [
      [f.trend === "with" ? 1 : f.trend === "against" ? -1 : 0, f.trend === "with" ? "With the 4H trend · better odds" : f.trend === "against" ? "Against the 4H trend · lower odds" : "4H in a range"],
      [f.volX >= 1.5 ? 1 : 0, `${f.volX >= 1.5 ? "Strong" : f.volX < 1 ? "Weak" : "Normal"} break volume · ${f.volX.toFixed(1)}× average <small>(still being tested)</small>`],
    ];
    const li = ([v, t]) => `<div class="${v > 0 ? "ok" : v < 0 ? "no" : "meh"}"><i>${v > 0 ? "✓" : v < 0 ? "✗" : "–"}</i><span>${t}</span></div>`;
    return `<div class="dr-checks">${rows.map(li).join("")}
      <p class="dr-score">Score ${f.score >= 0 ? "+" : ""}${f.score} ${"★".repeat(Math.max(0, f.score))}${f.score >= 2 ? " · A+" : ""}${f.choch ? "" : " · no CHoCH"} → <b class="${f.take ? "good" : "bad"}">${f.take ? "TAKE" : "SKIP"}</b></p>
      <small class="muted">Bonus</small>${bonus.map(li).join("")}</div>`;
  }
  function why() {
    const f = X.f, side = X.long ? "Buyers" : "Sellers";
    if (X.win && f.take) return `🎯 ${side} defended the zone and price ran to 3R. Textbook.`;
    if (!X.win && f.take) return `🎲 Right call, unlucky trade${f.trend === "against" ? " — it was against the 4H trend, which lowers the odds" : ""}. TAKE setups win about 4 in 10 — the +3R wins pay for these. Keep taking them.`;
    if (X.win && !f.take) return `🍀 It worked this time, but setups like this win too rarely to pay over 100 trades. Skipping was still right.`;
    const bad = !f.choch ? `no 5m CHoCH — ${X.long ? "buyers" : "sellers"} never showed up, so there was no entry` : f.choppy ? "the choppy pullback showed no real " + (X.long ? "buyers" : "sellers") + " in the zone"
      : f.ageCls === "instant" ? "instant retests rarely hold — the zone had no time to mature"
      : !f.roomGood ? `price stalled at the leg ${X.long ? "high" : "low"} (only ${f.roomR.toFixed(1)}R of room) and came back`
      : "the zone was too wide and young to trust";
    return `🛑 That's why it's a skip: ${bad}.`;
  }
  function paint() {
    if (!root) return;
    const done = phase === "done", playing = phase === "play";
    const right = mine != null && mine === X.f.take;
    root.innerHTML = `${stats()}
      <section class="card dr-card" data-tour="drill">
        <div class="dr-head"><b>${X.mk[0]}</b><span class="pill ${X.long ? "good" : "bad"}">${X.long ? "▲ BUY at demand" : "▼ SELL at supply"}</span><span class="muted">1H · 1:3</span></div>
        <div class="dr-minis"><canvas class="dr-c4" aria-label="4H big picture"></canvas><canvas class="dr-c5" aria-label="5m entry"></canvas></div>
        <canvas class="dr-cv" aria-label="Practice chart"></canvas>
        ${phase === "ask" ? `<div class="dr-look"><span>⏳ age</span><span>📏 room</span><span>↔️ width</span><span>〰️ clean</span><span>🎯 CHoCH</span></div>
          <div class="dr-btns"><button type="button" class="dr-take" data-dr="take">✅ TAKE</button><button type="button" class="dr-skip" data-dr="skip">⛔ SKIP</button></div>`
        : `<div class="dr-verdict ${right ? "good" : "bad"}">${right ? "✅ Right call" : `❌ The rules say ${X.f.take ? "TAKE" : "SKIP"}`}<small>you said ${mine ? "TAKE" : "SKIP"}${mine ? "" : " — here's what would have happened"}</small></div>
          ${playing ? `<button type="button" class="link dr-fast" data-dr="fast">▶▶ Skip to the end</button>` : ""}
          ${done ? `<div class="dr-result ${X.win ? "good" : "bad"}">${X.win ? "WIN +3R" : "LOSS −1R"}</div><p class="dr-why">${why()}</p>${checks()}
            <button type="button" class="btn primary dr-next" data-dr="next">Next setup →</button>` : ""}`}
      </section>
      ${ST.n ? `<p class="muted dr-foot">Made-up setups that follow your rules and the backtest odds. <button type="button" class="link" data-dr="reset">Reset score</button></p>` : `<p class="muted dr-foot">Look at the zone, count its age, check the room — then decide.</p>`}`;
    const cv = root.querySelector(".dr-cv");
    requestAnimationFrame(() => { draw(cv, X, phase === "ask" ? X.at : upto, done); draw4(root.querySelector(".dr-c4"), X); draw5(root.querySelector(".dr-c5"), X); });
  }
  function answer(take) {
    if (phase !== "ask") return;
    mine = take; phase = "play"; upto = X.at;
    const ok = take === X.f.take, res = X.win ? 3 : -1;
    ST.n++; if (ok) { ST.right++; ST.streak++; ST.best = Math.max(ST.best, ST.streak); } else ST.streak = 0;
    if (take) ST.rMine += res; if (X.f.take) ST.rRules += res; save();
    paint(); tick();
  }
  function tick() {
    clearTimeout(timer);
    if (phase !== "play") return;
    if (upto >= X.bars.length - 1) { phase = "done"; paint(); return; }
    upto++; const cv = root && root.querySelector(".dr-cv"); if (cv) draw(cv, X, upto, false);
    timer = setTimeout(tick, 110);
  }
  function next() { clearTimeout(timer); X = make(); phase = "ask"; mine = null; upto = X.at; paint(); }
  function onClick(e) {
    const b = e.target.closest("[data-dr]"); if (!b) return;
    const k = b.dataset.dr;
    if (k === "take") answer(true); else if (k === "skip") answer(false);
    else if (k === "fast") { clearTimeout(timer); upto = X.bars.length - 1; phase = "done"; paint(); }
    else if (k === "next") { next(); scrollTo({ top: 0, behavior: "smooth" }); }
    else if (k === "reset") { ST = { n: 0, right: 0, streak: 0, best: 0, rMine: 0, rRules: 0 }; save(); paint(); }
  }
  // the app redraws its screens often: keep this one alive and just move it into the new page
  function mount(host) {
    if (!host) return;
    if (!root) { root = document.createElement("div"); root.className = "drill"; root.addEventListener("click", onClick); addEventListener("resize", () => root.isConnected && paint()); }
    if (!X) next();
    if (root.parentNode !== host) { host.appendChild(root); paint(); }
  }
  window.EdgeDrill = { mount, make };
})();
