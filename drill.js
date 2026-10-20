// The Test tab: train your eye on supply & demand setups, the way the real market serves them. Three drills:
//   TAKE or SKIP — a setup at its entry; decide, watch it play out, see why it won or lost.
//   Spot the zone — the move just left its base; tap where the 1H zone is.
//   Trade a week — Monday to Friday, 0–3 setups a day, 2 trades a day max; your week in R and dollars, streaks and all.
// Sources: real past setups from your own private Databento archive (signed in only; uploaded by the edge-data repo,
// never public), made-up ones (endless, generated from the rule and odds below), or a mix of both (the default).
// The rule (the same one the TradingView scanner uses):
//   score = +1 mature zone (more than 10 1H candles old) +1 room of 2R or more to the leg high/low +1 narrow zone (≤ ¾ of a 1H candle)
//           −1 instant retest (3 candles or less)
//   A — TAKE: a very clean pullback (A+), or a clean pullback with a score of 0 or more — once the 5m shows its CHoCH.
//   B — optional: a choppy pullback, but with the 4H trend and a score of 1 or more. Doable, not the best: take it or not.
//   SKIP — everything else.
// Your own data, 2019 → Sep 2026 (2,071 setups): A +0.21R a trade (40% wins) — +0.24R with the 4H trend, +0.15R against it;
// B +0.12R; SKIP +0.02R (no edge, only risk). Weeks: 52% green, 42% red, worst −5.3R, longest losing streak 10.
// The made-up outcomes follow those odds (wins, losses, and trades closed at 11:00 New York), so they're never predictable.
// Focus: every miss is remembered by its kind and comes back now and then (about 1 setup in 3) until you get it right.
(function () {
  const MARKETS = [["Gold", 2400, 2.4, 1], ["NQ", 20500, 14, 2], ["YM", 42000, 38, 0], ["Silver", 30, 0.06, 3], ["Copper", 4.4, 0.012, 4],
    ["Nat gas", 2.8, 0.025, 3], ["Euro 6E", 1.085, 0.0009, 5], ["Yen 6J", 0.0068, 0.000006, 7], ["Aussie 6A", 0.665, 0.0007, 5]];
  const r = (a, b) => a + Math.random() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1)), pick = (a) => a[Math.floor(Math.random() * a.length)];
  const chance = (p) => Math.random() < p;
  const KEY = "edge.drill";
  const FRESH = { n: 0, right: 0, streak: 0, best: 0, rMine: 0, rRules: 0, miss: {}, zn: 0, zr: 0, mode: "take", src: "mix", weeks: [] };
  let ST = { ...FRESH };
  try { ST = { ...ST, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
  if (ST.src === "made" && !ST.srcPicked) ST.src = "mix"; // the mix is the new default
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch {} };
  const riskUSD = () => { try { const v = Number(localStorage.getItem("edge.riskUSD")); return v > 0 ? v : 150; } catch { return 150; } };

  // the verdict: A (take), B (optional), SKIP
  const gradeOf = (f) => (!f.choch ? "SKIP" : f.chop === "aplus" || (f.chop === "clean" && f.score >= 0) ? "A" : f.chop === "choppy" && f.trend === "with" && f.score >= 1 ? "B" : "SKIP");
  const rightCall = (f, saidTake) => f.grade === "B" || saidTake === (f.grade === "A");

  // ---------- your weak spots: what you get wrong comes back now and then ----------
  const FOCUS = {
    choch: ["setups with no 5m CHoCH", (f) => !f.choch],
    choppy: ["choppy pullbacks", (f) => f.chop === "choppy" && f.grade === "SKIP" && f.choch],
    instant: ["instant retests", (f) => f.ageCls === "instant"],
    lowscore: ["low-score zones", (f) => f.score < 0 && f.chop === "clean"],
    aplus: ["very clean A+ pullbacks", (f) => f.chop === "aplus" && f.score <= 0 && f.choch],
    score0: ["clean setups with a score of 0", (f) => f.chop === "clean" && f.score === 0 && f.choch],
    good: ["good setups you skipped", (f) => f.grade === "A" && f.score >= 1],
  };
  function missKey(f, saidTake) {
    if (saidTake) return !f.choch ? "choch" : f.chop === "choppy" ? "choppy" : f.ageCls === "instant" ? "instant" : "lowscore";
    return f.chop === "aplus" ? "aplus" : f.score === 0 ? "score0" : "good";
  }
  function focusNow() {
    const top = Object.entries(ST.miss || {}).filter(([k, n]) => n >= 3 && FOCUS[k]).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  }

  // ---------- one made-up setup ----------
  function features(want) {
    for (let i = 0; i < 800; i++) {
      const ageCls = chance(0.18) ? "instant" : chance(0.45) ? "normal" : "mature";
      const age = ageCls === "instant" ? ri(2, 3) : ageCls === "normal" ? ri(5, 10) : ri(12, 28);
      const narrow = chance(0.55), w = narrow ? r(0.4, 0.72) : r(0.9, 1.7);
      const roomGood = chance(0.62), roomR = roomGood ? r(2.1, 5) : r(0.8, 1.8);
      const chop = chance(0.3) ? "aplus" : chance(0.62) ? "clean" : "choppy"; // the market is choppy about a quarter of the time
      const score = (ageCls === "mature") + roomGood + narrow - (ageCls === "instant");
      const choch = chance(0.82), trig = pick(["FVG", "FVG", "Breaker", "Mitigation"]);
      const trend = chance(0.7) ? "with" : chance(0.9) ? "against" : "range";
      const volX = chance(0.4) ? r(1.5, 2.8) : chance(0.6) ? r(1.0, 1.45) : r(0.55, 0.95);
      const f = { ageCls, age, narrow, w, roomGood, roomR, chop, choppy: chop === "choppy", score, choch, trig, trend, volX };
      f.grade = gradeOf(f); f.take = f.grade === "A";
      if (!want || want(f)) return f;
    }
    return features();
  }
  // the 5m zoom at the zone (drawn as a long; flipped for a short): price taps the zone, then a CHoCH and the entry pattern —
  // in one of several ways (a plain CHoCH, a sweep of the low first, a double bottom, a slow grind) — or no CHoCH yet
  function entry5(f) {
    const C = []; let p = r(5, 7);
    const push = (to, up = r(0.05, 0.35), dn = r(0.05, 0.35)) => { C.push({ o: p, c: to, h: Math.max(p, to) + up, l: Math.min(p, to) - dn }); p = to; };
    for (let i = 0, n = ri(4, 8); i < n; i++) push(p - r(0.3, 1.1));
    const kind = pick(["plain", "sweep", "double", "grind"]);
    let low = Math.min(...C.map((b) => b.l));
    const zone = [low - 0.4, low + r(1.2, 1.8)];
    if (!f.choch) { for (let i = 0, n = ri(7, 12); i < n; i++) push(Math.max(low - 0.7, Math.min(low + 1.5, p + r(-0.9, 0.75)))); return { C, choch: false, zone, at: C.length - 1, kind }; }
    if (kind === "double") { push(p + r(0.5, 0.9)); push(p + r(0.2, 0.5)); push(p - r(0.4, 0.8)); push(low + r(0, 0.15), 0.1, r(0.02, 0.12)); }
    if (kind === "sweep") { push(p + r(0.4, 0.8)); push(p - r(0.5, 0.9), 0.1, r(0.4, 0.7)); low = Math.min(low, C[C.length - 1].l); }
    const slow = kind === "grind" ? 1.6 : 1;
    push(p + r(0.4, 0.9) / slow); if (slow > 1) push(p + r(0.2, 0.5));
    push(p + r(0.3, 0.8) / slow); const lhI = C.length; push(p + r(0.2, 0.5) / slow, 0.1); const lh = C[lhI].h;
    push(p - r(0.4, 0.8)); const hlI = C.length; push(p - r(0.2, 0.5)); if (chance(0.4)) push(p + r(-0.2, 0.2));
    const b1 = C.length; push(lh + r(0.1, 0.4), 0.1, 0.1); push(p + r(0.9, 1.7), 0.15, 0.05); push(p + r(0.2, 0.8));
    let box;
    if (f.trig === "FVG") box = [C[b1 - 1].h, C[b1 + 1].l].sort((a, b) => a - b);
    else if (f.trig === "Breaker") box = [lh - r(0.3, 0.55), lh];
    else box = [C[hlI].l, C[hlI].l + Math.max(0.35, C[hlI].h - C[hlI].l)];
    if (box[1] - box[0] < 0.15) box[1] = box[0] + 0.2;
    const startI = f.trig === "FVG" ? b1 : f.trig === "Breaker" ? lhI : hlI;
    for (let i = 0, n = ri(1, 3); i < n; i++) push(p - r(0.2, 0.6));
    push(box[1] - r(0, 0.1), 0.1, Math.max(0.02, (box[1] - box[0]) * r(0.2, 0.6)));
    return { C, choch: true, lh, lhI, brkI: b1 + 1, box, boxI: startI, at: C.length - 1, zone, kind };
  }
  // the outcome, by the odds of your own data (A ≈ +0.25R a trade, B ≈ +0.12R, SKIP ≈ 0); about 1 trade in 6 is closed at 11:00
  function outcome(f) {
    if (chance(0.17)) return { how: "time", R: +r(-0.7, 1.3).toFixed(1) };
    let q = f.grade === "A" ? 0.31 + 0.025 * (f.score - 1) + (f.ageCls === "mature" ? 0.02 : 0) : f.grade === "B" ? 0.28 : 0.245 - (f.choch ? 0 : 0.03);
    q += f.trend === "with" ? 0.02 : f.trend === "against" ? -0.025 : 0;
    return chance(Math.max(0.12, Math.min(0.5, q))) ? { how: "tp", R: 3 } : { how: "sl", R: -1 };
  }
  function make(want) {
    const f = features(want), long = chance(0.5), mk = pick(MARKETS);
    const C = []; // candles in "units" for a LONG setup (a short is mirrored at the end); 1 unit ≈ one candle's range
    const push = (o, c, up = r(0.05, 0.3), dn = r(0.05, 0.3)) => { C.push({ o, c, h: Math.max(o, c) + up, l: Math.min(o, c) - dn }); return c; };
    // the way in: a drop into the base (reversal) or a rally into it (continuation), then some noise
    const into = chance(0.6) ? "drop" : "rally";
    let p = into === "drop" ? f.w + r(2.5, 4.5) : r(-3.5, -2);
    for (let i = 0, n = ri(10, 16); i < n; i++) { const tgt = into === "drop" ? f.w * 0.6 : f.w * 0.4, k = (i + 1) / n; p = push(p, p + (tgt - p) * r(0.15, 0.35) * (0.6 + k) + r(-0.45, 0.45)); }
    // the base: 1–4 hesitation candles, sometimes a wick that grabs the lows (that wick is the zone's bottom)
    const baseStart = C.length, nb = ri(1, 4), sweep = chance(0.3);
    for (let i = 0; i < nb; i++) { const o = r(0.12, f.w - 0.08), c = r(0.12, f.w - 0.08); C.push({ o, c, h: Math.min(f.w, Math.max(o, c) + r(0.02, 0.15)), l: i === (sweep ? nb - 1 : 0) ? 0 : Math.max(0.03, Math.min(o, c) - r(0.02, 0.15)) }); }
    const buf = 0.15, R = f.w + buf, entry = f.w, stop = -buf, target = entry + 3 * R, legExt = entry + f.roomR * R;
    // the leg out: one or two big candles, or a few steps with a pause
    const legStart = C.length, burst = chance(0.4), nLeg = burst ? ri(1, 2) : Math.max(2, Math.min(6, Math.round((legExt - f.w) / r(0.9, 1.5))));
    p = C[C.length - 1].c;
    for (let i = 1; i <= nLeg; i++) {
      const to = f.w * 0.6 + (legExt - f.w * 0.6) * (i / nLeg) - (i === nLeg ? r(0.05, 0.2) : 0);
      if (!burst && i === Math.ceil(nLeg / 2) && chance(0.4)) p = push(p, p - r(0.05, 0.3), r(0.02, 0.1), r(0.02, 0.1)); // a pause on the way up
      p = push(p, Math.max(p + 0.1, to), i === nLeg ? Math.max(0.02, legExt - Math.max(p, to)) : r(0.02, 0.15), r(0.02, 0.12));
    }
    const bos = C.length - 1;
    // the walk back to the zone: as many candles as its age; steady, staircase, slow drift, or choppy swings
    const m = Math.max(1, f.age - (bos - legStart + 1)), dropTo = entry - r(0, f.w * 0.35);
    const shape = f.chop === "choppy" ? "chop" : f.chop === "aplus" ? pick(["steady", "drift"]) : pick(["steady", "stairs", "drift"]);
    const amp = r(0.35, 0.95);
    for (let i = 1; i <= m; i++) {
      const k = i / m, kk = shape === "stairs" ? Math.floor(k * 3 + 0.5) / 3 * 0.85 + k * 0.15 : shape === "drift" ? Math.pow(k, 1.6) : k;
      const glide = legExt - 0.25 - (legExt - 0.25 - entry - 0.3) * kk;
      let c = shape === "chop" ? glide + (i % 2 ? 1 : -1) * amp * r(0.6, 1.2) : f.chop === "aplus" ? glide + r(-0.05, 0.08) : glide + r(-0.2, 0.25);
      c = Math.min(c, legExt - 0.1);
      if (i === m) { c = entry + r(0.05, 0.25); p = push(p, c, r(0.05, 0.2), c - dropTo); break; }
      const big = shape === "chop" ? amp * r(0.4, 0.9) : f.chop === "aplus" ? r(0.02, 0.1) : r(0.05, 0.3);
      const cc = Math.max(entry + 0.2, c);
      p = push(p, cc, Math.max(0.02, Math.min(big, legExt - Math.max(p, cc))), Math.max(0.02, Math.min(big, Math.min(p, cc) - entry - 0.05)));
    }
    const at = C.length - 1; // you decide here: the limit at the zone's edge just filled
    // what happens next — never the same way twice: a clean run, a scary dip first, a stall at the leg, a near-miss,
    // a slow bleed, an instant fail, or nothing much until 11:00
    const out = outcome(f), win = out.R > 0;
    p = C[at].c;
    const path = out.how === "tp" ? pick(["run", "dip", "stall"]) : out.how === "sl" ? (!f.roomGood && chance(0.6) ? "stalled" : pick(["fail", "bleed", "near"])) : "time";
    const goal = out.how === "tp" ? target : out.how === "sl" ? stop : entry + out.R * R;
    let phase = 0;
    for (let k = 0; k < 60; k++) {
      let to;
      if (path === "dip" && phase === 0) { to = p - r(0.15, 0.5); if (to <= stop + 0.12) { to = stop + r(0.03, 0.12); phase = 1; } }
      else if (path === "stall" && phase === 0) { to = p + r(0.05, 0.7); if (to >= legExt - 0.15) { to = legExt - r(0.05, 0.15); phase = 1; } }
      else if (path === "stall" && phase === 1 && k % 3 !== 0) to = p + r(-0.35, 0.3);
      else if ((path === "near" || path === "stalled") && phase === 0) { const top = path === "near" ? entry + r(2.2, 2.8) * R : legExt - r(0.05, 0.2); to = p + r(0.15, 0.8); if (to >= top) { to = top; phase = 1; } }
      else if (path === "bleed") to = p - r(-0.25, 0.4);
      else if (path === "time") { to = p + r(-0.6, 0.6) + (goal - p) * 0.08; }
      else to = win ? p + r(-0.3, 0.9) : p - r(-0.2, 0.9);
      if (out.how === "tp") { to = Math.max(to, stop + 0.04); if (to >= target) { const d = r(0, 0.15); push(p, target - d, d + r(0.02, 0.1), r(0.05, 0.2)); break; } }
      else if (out.how === "sl") { to = Math.min(to, target - 0.3); if (to <= stop) { const d = r(0, 0.1); push(p, stop + d, r(0.05, 0.2), d + r(0.03, 0.12)); break; } }
      else { to = Math.max(stop + 0.15, Math.min(target - 0.25, to)); if (k >= 14) { push(p, goal, r(0.03, 0.15), r(0.03, 0.15)); break; } }
      p = push(p, to, Math.min(r(0.05, 0.3), out.how === "tp" ? 9 : target - 0.2 - Math.max(p, to)), Math.min(r(0.05, 0.3), out.how === "sl" ? 9 : Math.min(p, to) - stop - 0.03));
      if (k === 59) push(p, out.how === "tp" ? target : out.how === "sl" ? stop : goal, 0.05, 0.05);
    }
    // volume: the leg out carries the break volume (volX × average); a clean pullback is quiet, a choppy one noisy
    const vol = C.map((b, i) => (i >= legStart && i <= bos ? f.volX * r(0.8, 1.2) : i > bos && i <= at ? (f.chop === "choppy" ? r(0.85, 1.45) : r(0.5, 0.95)) : r(0.65, 1.35)) * 1000);
    // the 4H big picture: 18 closes, trending with the trade, against it, or flat
    const t4 = []; let q = 0; const slope = f.trend === "range" ? 0 : (f.trend === "with") === long ? 1 : -1;
    for (let i = 0; i < 18; i++) { q += slope * r(0.15, 1) + r(-0.8, 0.8) + (f.trend === "range" ? -q * 0.3 : 0); t4.push(q); }
    const m5 = entry5(f); m5.flip = !long;
    // to prices; a short is the same picture upside down
    const s = long ? 1 : -1, P = (u) => mk[1] + s * u * mk[2];
    const bars = C.map((b) => long ? { o: P(b.o), c: P(b.c), h: P(b.h), l: P(b.l) } : { o: P(b.o), c: P(b.c), h: P(b.l), l: P(b.h) });
    return { real: false, f, long, name: mk[0], bars, vol, t4, m5, at, baseStart, legStart, nLeg: bos - legStart + 1, bos, entry: P(entry), stop: P(stop), target: P(target), legExt: P(legExt), zLo: P(long ? 0 : f.w), zHi: P(long ? f.w : 0), win, res: out.R, how: out.how, dec: mk[3] };
  }

  // ---------- a real past setup (from your private archive) ----------
  function fromReal(it) {
    const long = it.dir > 0, ageCls = it.age <= 3 ? "instant" : it.age > 10 ? "mature" : "normal";
    const chop = it.aplus ? "aplus" : it.ci <= 55 ? "clean" : "choppy";
    const trig = /^(BB|breaker)$/.test(it.kind) ? "Breaker" : /^(MB|mitigation)$/.test(it.kind) ? "Mitigation" : "FVG";
    const f = { ageCls, age: it.age, narrow: it.zH <= 0.75, roomGood: it.room >= 2, roomR: it.room, chop, choppy: chop === "choppy", score: it.score, choch: true, trig,
      trend: "range", volX: it.vol };
    // the 4H trend as you see it: where the last 18 closed 4H candles went, against their range
    if (it.c4 && it.c4.length > 2) { const c = it.c4, rng = Math.max(...c) - Math.min(...c), mv = c[c.length - 1] - c[0], d = rng > 0 && Math.abs(mv) > 0.3 * rng ? Math.sign(mv) : 0; f.trend = d === 0 ? "range" : d === it.dir ? "with" : "against"; }
    f.grade = gradeOf(f); f.take = f.grade === "A";
    const bars = it.h.map(([o, h, l, c]) => ({ o, h, l, c }));
    // the hour's volume against the average of the 20 before it (1000 = average)
    const hv = it.hv || [], vol = hv.map((v, i) => { const prev = hv.slice(Math.max(0, i - 20), i).filter((x) => x != null); const avg = prev.length >= 5 ? prev.reduce((a, b) => a + b, 0) / prev.length : null; return v != null && avg ? (v / avg) * 1000 : null; });
    const r5 = Math.abs(it.e - it.sl), box = [it.e, it.e - it.dir * r5 * 0.35].sort((a, b) => a - b);
    const m5 = { C: it.m.map(([o, h, l, c]) => ({ o, h, l, c })), choch: true, lh: it.mssLvl, lhI: Math.max(0, it.mss - 10), brkI: it.mss, box, boxI: it.mss, at: it.mAt, zone: it.zone.slice().sort((a, b) => a - b), flip: false };
    const legStart = Math.min(it.bos, it.z0 + 1), nLeg = Math.max(1, it.bos - legStart + 1);
    return { real: true, f, long, name: it.name, day: it.day, ny: it.ny, bars, vol: vol.some((v) => v != null) ? vol : null, t4: it.c4 && it.c4.length > 2 ? it.c4 : [0, 0], m5, at: it.at, baseStart: it.z0, legStart, nLeg, bos: it.bos,
      entry: it.e, stop: it.sl, target: it.tp, legExt: it.ext, zLo: Math.min(...it.zone), zHi: Math.max(...it.zone), win: it.R > 0, res: it.R, how: it.how, dec: it.dec };
  }
  let pool = [], poolErr = "", loading = false;
  async function loadPool() {
    if (loading) return; loading = true;
    try {
      let tok = ""; try { tok = localStorage.getItem("edge.token") || ""; } catch {}
      const res = await fetch("/api/candles?drill=1", { headers: { Authorization: `Bearer ${tok}` } }), j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
      pool = pool.concat((j.items || []).sort(() => Math.random() - 0.5)); poolErr = "";
    } catch (e) { poolErr = e.message; }
    loading = false;
  }
  async function nextReal(want) {
    if (pool.length < 5) await loadPool();
    if (!pool.length) return null;
    let i = want ? pool.findIndex((it) => want(fromReal(it).f)) : 0;
    if (i < 0) i = 0;
    return fromReal(pool.splice(i, 1)[0]);
  }
  // one setup from the chosen source (the mix = about 6 in 10 real when they're there)
  async function nextSetup(want) {
    const real = ST.src === "real" || (ST.src === "mix" && chance(0.6) && !poolErr);
    if (real) { const X = await nextReal(want); if (X) return X; if (ST.src === "real") return null; }
    return make(want);
  }

  // ---------- the charts ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  // the 1H chart. o: { upto, reveal, zone, pos, fit (scale to the shown candles only), tap }
  function draw(cv, X, o) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const upto = o.upto, shown = o.fit ? X.bars.slice(0, upto + 1) : X.bars, n = o.fit ? upto + 4 : X.bars.length, padR = o.pos ? 74 : 12, step = (W - padR - 8) / n, bw = Math.max(2, step * 0.62);
    let lo = Math.min(...shown.map((b) => b.l), ...(o.pos ? [X.stop, X.target] : [])), hi = Math.max(...shown.map((b) => b.h), ...(o.pos ? [X.stop, X.target] : []));
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const volH = X.vol ? 50 : 0, y = (v) => 10 + (H - 24 - volH) * (1 - (v - lo) / (hi - lo)), x = (i) => 8 + step * (i + 0.5);
    cv._map = { lo, hi, H, volH, step }; // to turn a tap back into a price and a candle
    const muted = css("--muted") || "#888", up = "#26a69a", dn = "#ef5350", gold = css("--accent") || "#d9b46c";
    const zc = X.long ? "38,166,154" : "239,83,80";
    if (o.zone) { // the zone, from the base to the right edge
      g.fillStyle = `rgba(${zc},.16)`; g.strokeStyle = `rgba(${zc},.7)`; g.lineWidth = 1;
      const zx = x(X.baseStart) - step / 2, zy = y(X.zHi), zh = Math.abs(y(X.zLo) - y(X.zHi));
      g.fillRect(zx, zy, W - padR - zx, zh); g.strokeRect(zx, zy, W - padR - zx, zh);
      g.fillStyle = `rgb(${zc})`; g.font = "600 11px system-ui, sans-serif"; g.fillText(`1H ${X.long ? "DEMAND" : "SUPPLY"}`, zx + 4, X.long ? zy + zh + 13 : zy - 5);
    }
    if (o.pos) {
      // the leg high / low: the first thing in the way of the target
      const legI = X.legStart + X.nLeg;
      g.setLineDash([4, 4]); g.strokeStyle = muted; g.beginPath(); g.moveTo(x(legI - 1), y(X.legExt)); g.lineTo(W - padR, y(X.legExt)); g.stroke(); g.setLineDash([]);
      g.fillStyle = muted; g.font = "600 11px system-ui, sans-serif"; g.fillText(X.long ? "leg high" : "leg low", x(legI - 1), y(X.legExt) + (X.long ? -5 : 13));
      // the position: red = stop, green = target (1:3)
      const px = x(X.at) - step / 2, pw = W - padR - px;
      g.fillStyle = "rgba(239,83,80,.14)"; g.fillRect(px, Math.min(y(X.entry), y(X.stop)), pw, Math.abs(y(X.entry) - y(X.stop)));
      g.fillStyle = "rgba(38,166,154,.14)"; g.fillRect(px, Math.min(y(X.entry), y(X.target)), pw, Math.abs(y(X.entry) - y(X.target)));
    }
    for (let i = 0; i <= upto && i < X.bars.length; i++) {
      const b = X.bars[i], c = b.c >= b.o ? up : dn;
      g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(x(i), y(b.h)); g.lineTo(x(i), y(b.l)); g.stroke();
      g.fillRect(x(i) - bw / 2, Math.min(y(b.o), y(b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c))));
    }
    // volume under the candles: strong (1.5× average or more) teal, weak (under average) orange
    if (X.vol) {
      const vs = X.vol.slice(0, upto + 1).filter((v) => v != null), vmax = Math.max(1500, ...vs), vb = H - 6;
      g.strokeStyle = muted; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(8, vb - volH * (1000 / vmax)); g.lineTo(W - padR, vb - volH * (1000 / vmax)); g.stroke(); g.globalAlpha = 1;
      for (let i = 0; i <= upto && i < X.bars.length; i++) { const v = X.vol[i]; if (v == null) continue; const k = v / 1000; g.fillStyle = k >= 1.5 ? "rgba(38,166,154,.85)" : k < 1 ? "rgba(224,129,75,.7)" : "rgba(123,141,163,.6)"; g.fillRect(x(i) - bw / 2, vb - volH * (v / vmax), bw, volH * (v / vmax)); }
      g.fillStyle = muted; g.font = "600 10.5px system-ui, sans-serif"; g.fillText("VOLUME", 10, vb - volH + 2);
      if (X.f.volX != null && o.pos) { const vi = Math.min(upto, X.legStart + Math.floor(X.nLeg / 2)), v = X.vol[vi] || 1000;
        g.fillStyle = X.f.volX >= 1.5 ? "#26a69a" : X.f.volX < 1 ? "#e0814b" : muted; g.fillText(`break ${X.f.volX.toFixed(1)}×`, Math.min(W - padR - 70, x(vi) + 6), vb - volH * (v / vmax) + 10); }
    }
    if (o.pos) {
      const px = x(X.at) - step / 2;
      const tag = (v, label, col) => { const ty = y(v); g.fillStyle = col; g.fillRect(W - padR + 2, ty - 9, padR - 4, 18); g.fillStyle = "#fff"; g.font = "700 10.5px system-ui, sans-serif"; g.fillText(`${label} ${v.toFixed(X.dec)}`.slice(0, 13), W - padR + 5, ty + 4); g.strokeStyle = col; g.beginPath(); g.moveTo(px, ty); g.lineTo(W - padR, ty); g.stroke(); };
      tag(X.target, "TP", "#1f8f6a"); tag(X.entry, "IN", "#4b5563"); tag(X.stop, "SL", "#c0393f");
    }
    // after you answer: what you should have counted
    if (o.reveal) {
      g.font = "600 11px system-ui, sans-serif";
      const a0 = x(X.legStart) - step / 2, a1 = x(X.at), ay = X.long ? y(X.zLo) + 30 : Math.max(26, y(X.zHi) - 24);
      g.strokeStyle = gold; g.fillStyle = gold; g.beginPath(); g.moveTo(a0, ay); g.lineTo(a1, ay); g.moveTo(a0, ay - 4); g.lineTo(a0, ay + 4); g.moveTo(a1, ay - 4); g.lineTo(a1, ay + 4); g.stroke();
      g.fillText(`${X.f.age} candles old`, Math.max(4, (a0 + a1) / 2 - 40), ay + (X.long ? 14 : -6));
      const rx = W - padR - 14; g.beginPath(); g.moveTo(rx, y(X.entry)); g.lineTo(rx, y(X.legExt)); g.stroke();
      g.fillText(`${X.f.roomR.toFixed(1)}R room`, rx - 62, (y(X.entry) + y(X.legExt)) / 2 + 4);
    }
    if (o.tap) { // where you tapped (spot the zone)
      g.strokeStyle = "#fff"; g.fillStyle = o.tap.ok ? "#26a69a" : o.tap.close ? "#e8c27a" : "#ef5350"; g.lineWidth = 2;
      g.beginPath(); g.arc(o.tap.px, o.tap.py, 8, 0, 7); g.fill(); g.stroke(); g.lineWidth = 1;
    }
  }
  // the 4H big picture: a line of closes with the trend written on it
  function draw4(cv, X) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = X.t4, lo = Math.min(...v), hi = Math.max(...v), y = (q) => 26 + (H - 34) * (1 - (q - lo) / (hi - lo || 1)), x = (i) => 8 + (W - 16) * (i / (v.length - 1));
    const tr = X.f.trend, up = tr === "range" ? null : (tr === "with") === X.long, col = tr === "with" ? "#26a69a" : tr === "against" ? "#ef5350" : "#9aa3ad";
    g.strokeStyle = col; g.lineWidth = 2.2; g.lineJoin = "round"; g.beginPath(); v.forEach((q, i) => (i ? g.lineTo(x(i), y(q)) : g.moveTo(x(i), y(q)))); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(x(v.length - 1), y(v[v.length - 1]), 3.5, 0, 7); g.fill();
    g.font = "700 11.5px system-ui, sans-serif"; g.fillText(`4H ${up == null ? "↔ range" : up ? "↑ uptrend" : "↓ downtrend"}`, 8, 15);
    g.font = "600 10.5px system-ui, sans-serif"; g.fillStyle = css("--muted") || "#888"; g.fillText(tr === "with" ? "with your trade" : tr === "against" ? "against your trade" : "no clear trend", 8, H - 4);
  }
  // the 5m entry at the zone: CHoCH line, the entry pattern box, the fill (and after you answer, the trade itself)
  function draw5(cv, X, upto) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const M = X.m5, C = M.C.slice(0, upto + 1), f = M.flip ? (q) => -q : (q) => q;
    let lo = Math.min(...C.map((b) => Math.min(f(b.l), f(b.h)))), hi = Math.max(...C.map((b) => Math.max(f(b.l), f(b.h))));
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const y = (q) => 22 + (H - 30) * (1 - (f(q) - lo) / (hi - lo)), step = (W - 12) / Math.max(C.length, M.at + 6), x = (i) => 6 + step * (i + 0.5), bw = Math.max(2, step * 0.6);
    const zc = X.long ? "38,166,154" : "239,83,80";
    g.fillStyle = `rgba(${zc},.13)`; const zy1 = y(M.zone[0]), zy2 = y(M.zone[1]); g.fillRect(0, Math.min(zy1, zy2), W, Math.abs(zy2 - zy1));
    if (M.choch) {
      g.fillStyle = "rgba(232,194,122,.28)"; g.strokeStyle = "#e8c27a"; const by1 = y(M.box[0]), by2 = y(M.box[1]); g.fillRect(x(M.boxI) - step / 2, Math.min(by1, by2), W - x(M.boxI), Math.abs(by2 - by1)); g.strokeRect(x(M.boxI) - step / 2, Math.min(by1, by2), W - x(M.boxI), Math.abs(by2 - by1));
      g.setLineDash([3, 3]); g.strokeStyle = css("--text") || "#ddd"; g.beginPath(); g.moveTo(x(M.lhI), y(M.lh)); g.lineTo(x(M.brkI) + 4, y(M.lh)); g.stroke(); g.setLineDash([]);
    }
    for (let i = 0; i < C.length; i++) { const b = C[i], upc = M.flip ? b.c <= b.o : b.c >= b.o, c = upc ? "#26a69a" : "#ef5350"; g.strokeStyle = c; g.fillStyle = c;
      g.beginPath(); g.moveTo(x(i), y(b.h)); g.lineTo(x(i), y(b.l)); g.stroke(); g.fillRect(x(i) - bw / 2, Math.min(y(b.o), y(b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c)))); }
    if (upto > M.at) { g.strokeStyle = "rgba(255,255,255,.35)"; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x(M.at) + step / 2, 18); g.lineTo(x(M.at) + step / 2, H); g.stroke(); g.setLineDash([]); }
    g.font = "700 11.5px system-ui, sans-serif"; g.fillStyle = css("--text") || "#ddd"; g.fillText("5m entry", 6, 14);
    g.font = "700 10.5px system-ui, sans-serif";
    if (M.choch) { g.fillStyle = css("--text") || "#ddd"; g.fillText("CHoCH", Math.max(4, x(M.lhI) - 40), y(M.lh) + (X.long ? -5 : 12)); g.fillStyle = "#e8c27a"; const tw = g.measureText(X.f.trig).width, by = X.long ? Math.max(y(M.box[0]), y(M.box[1])) + 12 : Math.min(y(M.box[0]), y(M.box[1])) - 4; g.fillText(X.f.trig, W - tw - 6, Math.min(H - 3, Math.max(24, by))); }
    else { g.fillStyle = "#ef5350"; g.fillText("no CHoCH yet", W - 80, 14); }
  }

  // ---------- the screen ----------
  let root = null, X = null, phase = "ask", mine = null, upto = 0, timer = 0, focus = null, tap = null, busy = false;
  let WK = null; // the week you're trading: { days: [n setups each], d, i, taken: [taken today], log: [{day, mine, rules, res, name, grade}] }
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const rr = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 10) / 10)}R`;
  const usd = (v) => `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const gradeWord = (g) => (g === "A" ? "TAKE" : g === "B" ? "B · optional" : "SKIP");
  function stats() {
    if (ST.mode === "zone") { const pct = ST.zn ? Math.round((ST.zr / ST.zn) * 100) : 0; return `<div class="dr-stats two"><div><b>${ST.zr}<small>/${ST.zn}</small></b><em>zones spotted ${ST.zn ? `· ${pct}%` : ""}</em></div><div><b>🔥 ${ST.streak}</b><em>streak · best ${ST.best}</em></div></div>`; }
    if (ST.mode === "week") { const w = ST.weeks || [], g = w.filter((x) => x.R > 0).length, sum = w.reduce((a, x) => a + x.R, 0); return `<div class="dr-stats two"><div><b>${w.length}</b><em>weeks traded · ${g} green</em></div><div><b class="${sum >= 0 ? "good" : "bad"}">${rr(sum)}</b><em>all your weeks</em></div></div>`; }
    const pct = ST.n ? Math.round((ST.right / ST.n) * 100) : 0;
    return `<div class="dr-stats"><div><b>${ST.right}<small>/${ST.n}</small></b><em>right calls ${ST.n ? `· ${pct}%` : ""}</em></div><div><b>🔥 ${ST.streak}</b><em>streak · best ${ST.best}</em></div><div><b class="${ST.rMine >= 0 ? "good" : "bad"}">${rr(ST.rMine)}</b><em>your calls</em></div><div><b class="${ST.rRules >= 0 ? "good" : "bad"}">${rr(ST.rRules)}</b><em>the rules</em></div></div>`;
  }
  function checks() {
    const f = X.f, side = X.long ? "buyers" : "sellers";
    const rows = [
      [f.ageCls === "mature" ? 1 : f.ageCls === "instant" ? -1 : 0, f.ageCls === "mature" ? `Mature zone · ${f.age} candles old` : f.ageCls === "instant" ? `Instant retest · only ${f.age} candles` : `Young zone · ${f.age} candles (needs 11+)`],
      [f.roomGood ? 1 : 0, f.roomGood ? `Room: ${f.roomR.toFixed(1)}R to the leg ${X.long ? "high" : "low"}` : `Only ${f.roomR.toFixed(1)}R of room (needs 2R)`],
      [f.narrow ? 1 : 0, f.narrow ? "Narrow zone · tight stop" : "Wide zone · big stop"],
      [f.chop === "choppy" ? -1 : 1, f.chop === "aplus" ? `Very clean pullback · A+` : f.chop === "clean" ? `Clean pullback · ${side} waiting` : "Choppy pullback"],
      [f.choch ? 1 : -1, f.choch ? `5m CHoCH + ${f.trig} entry` : "No 5m CHoCH yet — no entry"],
      [f.trend === "with" ? 1 : f.trend === "against" ? -1 : 0, f.trend === "with" ? "With the 4H trend · +0.24R a trade in your data" : f.trend === "against" ? "Against the 4H trend · +0.15R a trade (lower)" : "4H in a range"],
    ];
    const bonus = f.volX != null ? [[f.volX >= 1.5 ? 1 : 0, `${f.volX >= 1.5 ? "Strong" : f.volX < 1 ? "Weak" : "Normal"} break volume · ${f.volX.toFixed(1)}× average <small>(still being tested)</small>`]] : [];
    const li = ([v, t]) => `<div class="${v > 0 ? "ok" : v < 0 ? "no" : "meh"}"><i>${v > 0 ? "✓" : v < 0 ? "✗" : "–"}</i><span>${t}</span></div>`;
    const how = !f.choch ? "no CHoCH" : f.chop === "aplus" ? "very clean pullback = A+" : f.chop === "clean" ? (f.score >= 0 ? "clean + score 0 or more" : "score under 0") : f.grade === "B" ? "choppy, but with the 4H trend and a good score" : "choppy pullback";
    return `<div class="dr-checks">${rows.map(li).join("")}
      <p class="dr-score">Score ${f.score >= 0 ? "+" : ""}${f.score} ${"★".repeat(Math.max(0, f.score))} · ${how} → <b class="${f.grade === "A" ? "good" : f.grade === "B" ? "warn" : "bad"}">${gradeWord(f.grade)}</b></p>
      ${bonus.length ? `<small class="muted">Bonus</small>${bonus.map(li).join("")}` : ""}</div>`;
  }
  function why() {
    const f = X.f, side = X.long ? "Buyers" : "Sellers";
    if (X.how === "time") return `⏰ Nothing decided by 11:00 New York — closed at ${rr(X.res)}. That happens on about 1 trade in 6.`;
    if (f.grade === "B") return X.win ? `🎯 A B setup that paid. Choppy, but with the 4H trend and a good zone — +0.12R a trade in your data: doable, not the best. Taking it or leaving it were both fine.`
      : `🎲 A B setup that didn't work. Choppy markets make these coin-flips (+0.12R a trade in your data). Fine to take with a smaller risk, fine to skip.`;
    if (X.win && f.take) return `🎯 ${side} defended the zone and price ran to ${rr(X.res)}.${f.trend === "with" ? " With the 4H trend — your best kind." : ""}`;
    if (!X.win && f.take) return `🎲 Right call, losing trade${f.trend === "against" ? " — against the 4H trend, which lowers the odds" : ""}. TAKE setups win about 4 in 10; the +3R winners pay for these. Losing 5 or even 10 in a row happens — keep taking them.`;
    if (X.win && !f.take) return `🍀 It worked this time — but setups like this break even over time in your data (+0.02R a trade): all the risk, no edge.`;
    const bad = !f.choch ? `no 5m CHoCH — ${X.long ? "buyers" : "sellers"} never showed up, so there was no entry` : f.chop === "choppy" ? `choppy and ${f.trend === "with" ? "a weak zone" : "against the 4H trend"} — no real ${X.long ? "buyers" : "sellers"} in control`
      : f.ageCls === "instant" ? "instant retests rarely hold — the zone had no time to mature"
      : !f.roomGood ? `price stalled at the leg ${X.long ? "high" : "low"} (only ${f.roomR.toFixed(1)}R of room) and came back`
      : "the zone was too wide and young to trust";
    return `🛑 That's why it's a skip: ${bad}.`;
  }
  function zoneWhy() {
    if (!tap) return "";
    return tap.ok ? "✅ Spot on — that's the base before the explosive move." : tap.close ? "🟡 Close. The zone is the base candles right before the explosive move — the last candles before price took off." : `❌ Not there. Look for where price paused (the base) right before the big ${X.long ? "up" : "down"} move — that's the zone.`;
  }
  function weekSummary() {
    const L = WK.log, mineR = L.filter((x) => x.mine).reduce((a, x) => a + x.res, 0), rulesR = L.filter((x) => x.grade === "A").reduce((a, x) => a + x.res, 0);
    const took = L.filter((x) => x.mine), wins = took.filter((x) => x.res > 0).length, risk = riskUSD();
    const mood = mineR > 2 ? "🟢 A green week." : mineR >= -0.05 ? "⚪ About flat." : mineR > -3 ? "🔴 A red week — normal. 42% of real weeks are red." : "🔴 A rough week. Your rule's worst real week was −5.3R; it still made money over the year.";
    return `<section class="card dr-card dr-week"><div class="dr-head"><b>Your week</b><span class="muted">${took.length} trade${took.length === 1 ? "" : "s"} · ${wins} win${wins === 1 ? "" : "s"}</span></div>
      <div class="dr-result ${mineR >= 0 ? "good" : "bad"}">${rr(mineR)}</div><p class="dr-why"><b>${usd(mineR * risk)}</b> at $${risk} a trade · the rules: ${rr(rulesR)}</p>
      <p class="dr-why">${mood}</p>
      <div class="dr-days">${DAYS.map((d, i) => { const t = L.filter((x) => x.day === i); return `<div><b>${d.slice(0, 3)}</b>${t.length ? t.map((x) => `<span class="${x.mine ? (x.res > 0 ? "good" : x.res < 0 ? "bad" : "") : "muted"}">${x.mine ? rr(x.res) : "skip"}</span>`).join("") : `<span class="muted">—</span>`}</div>`; }).join("")}</div>
      <p class="muted dr-real">Real weeks with your rule (2019 → 2026): 52% green, 42% red, 6% no trade · worst −5.3R · best +10R · longest losing streak 10. The edge shows over months, not days.</p>
      <button type="button" class="btn primary dr-next" data-dr="week-new">Trade another week →</button></section>`;
  }
  function paint() {
    if (!root) return;
    const tabs = `<div class="dr-modes"><div class="seg three"><button type="button" data-dr="m-take" class="${ST.mode === "take" ? "on" : ""}">TAKE or SKIP</button><button type="button" data-dr="m-week" class="${ST.mode === "week" ? "on" : ""}">Trade a week</button><button type="button" data-dr="m-zone" class="${ST.mode === "zone" ? "on" : ""}">Spot the zone</button></div>
      <div class="seg three"><button type="button" data-dr="s-real" class="${ST.src === "real" ? "on" : ""}">Real</button><button type="button" data-dr="s-mix" class="${ST.src === "mix" ? "on" : ""}">Mixed</button><button type="button" data-dr="s-made" class="${ST.src === "made" ? "on" : ""}">Made-up</button></div></div>`;
    if (ST.mode === "week" && WK && WK.done) { root.innerHTML = `${tabs}${stats()}${weekSummary()}`; return; }
    if (ST.mode === "week" && WK && !X) { // a day with no setup
      root.innerHTML = `${tabs}${stats()}<section class="card dr-card dr-quiet"><div class="dr-head"><b>${DAYS[WK.d]}</b><span class="muted">day ${WK.d + 1} of 5</span></div><div class="dr-emoji">😴</div><p class="dr-why"><b>No setup today.</b><br>Nothing met your rules in your hours. Patience is part of the edge — no trade is a good day too.</p><button type="button" class="btn primary dr-next" data-dr="week-next">${WK.d < 4 ? `On to ${DAYS[WK.d + 1]} →` : "See your week →"}</button></section>`;
      return;
    }
    if (!X) { root.innerHTML = `${tabs}${stats()}<section class="card dr-card"><p class="muted">${busy ? "Loading…" : esc(poolErr || "Loading…")}</p></section>`; return; }
    const wkHead = ST.mode === "week" ? `<div class="dr-day">📅 <b>${DAYS[WK.d]}</b> · setup ${WK.i + 1} of ${WK.days[WK.d]} · ${WK.taken} of 2 trades taken today · week so far ${rr(WK.log.filter((x) => x.mine).reduce((a, x) => a + x.res, 0))}</div>` : "";
    const head = `${wkHead}<div class="dr-head"><b>${X.name}</b><span class="pill ${X.long ? "good" : "bad"}">${X.long ? "▲ BUY at demand" : "▼ SELL at supply"}</span><span class="muted">${X.real ? `${X.day} · ${X.ny} NY` : "1H · 1:3"}</span></div>
      ${focus && ST.mode !== "zone" ? `<div class="dr-focus">🎯 Practising: ${FOCUS[focus][0]}</div>` : ""}${X.real ? `<div class="dr-realtag">📜 Real past setup</div>` : ""}`;
    const foot = `<p class="muted dr-foot">${X.real ? "A real setup from your own data, scored with your rule." : "A made-up setup that follows your rule and your data's odds."} ${ST.n || ST.zn || (ST.weeks || []).length ? `<button type="button" class="link" data-dr="reset">Reset score</button>` : ""}</p>`;
    if (ST.mode === "zone") {
      const done = phase === "done";
      root.innerHTML = `${tabs}${stats()}<section class="card dr-card" data-tour="drill">${head}
        <canvas class="dr-cv dr-tap" aria-label="Tap where the zone is"></canvas>
        ${done ? `<p class="dr-why">${zoneWhy()}</p><button type="button" class="btn primary dr-next" data-dr="next">Next chart →</button>` : `<p class="dr-ask">👆 Price just left its base. <b>Tap where the 1H ${X.long ? "demand" : "supply"} zone is.</b></p>`}
      </section>${foot}`;
      const cv = root.querySelector(".dr-cv");
      requestAnimationFrame(() => draw(cv, X, { upto: Math.min(X.bars.length - 1, X.bos + 2), zone: done, pos: false, fit: true, tap }));
      return;
    }
    const done = phase === "done", playing = phase === "play", right = mine != null && rightCall(X.f, mine);
    const capped = ST.mode === "week" && WK.taken >= 2;
    const nextBtn = ST.mode === "week" ? `<button type="button" class="btn primary dr-next" data-dr="week-next">${WK.i + 1 < WK.days[WK.d] ? "Next setup today →" : WK.d < 4 ? `On to ${DAYS[WK.d + 1]} →` : "See your week →"}</button>` : `<button type="button" class="btn primary dr-next" data-dr="next">Next setup →</button>`;
    root.innerHTML = `${tabs}${stats()}
      <section class="card dr-card" data-tour="drill">${head}
        <div class="dr-minis"><canvas class="dr-c4" aria-label="4H big picture"></canvas><canvas class="dr-c5" aria-label="5m entry"></canvas></div>
        <canvas class="dr-cv" aria-label="Practice chart"></canvas>
        ${phase === "ask" ? `<div class="dr-look"><span>🔭 4H</span><span>⏳ age</span><span>📏 room</span><span>↔️ width</span><span>〰️ clean</span><span>🎯 CHoCH</span></div>
          ${capped ? `<p class="dr-ask">✋ 2 trades today already — your limit. This one's a skip whatever it is.</p>` : ""}
          <div class="dr-btns"><button type="button" class="dr-take" data-dr="take" ${capped ? "disabled" : ""}>✅ TAKE</button><button type="button" class="dr-skip" data-dr="skip">⛔ SKIP</button></div>`
        : `<div class="dr-verdict ${right ? "good" : "bad"}">${right ? (X.f.grade === "B" ? "🟡 Fine either way — a B setup" : "✅ Right call") : `❌ The rules say ${gradeWord(X.f.grade)}`}<small>you said ${mine ? "TAKE" : "SKIP"}${mine ? "" : " — here's what would have happened"}</small></div>
          ${playing ? `<button type="button" class="link dr-fast" data-dr="fast">▶▶ Skip to the end</button>` : ""}
          ${done ? `<div class="dr-result ${X.res > 0 ? "good" : X.res < 0 ? "bad" : ""}">${X.how === "time" ? "CLOSED" : X.win ? "WIN" : "LOSS"} ${rr(X.res)}</div><p class="dr-why">${why()}</p>${checks()}${nextBtn}` : ""}`}
      </section>${foot}`;
    const cv = root.querySelector(".dr-cv");
    requestAnimationFrame(() => { draw(cv, X, { upto: phase === "ask" ? X.at : upto, reveal: done, zone: true, pos: true }); draw4(root.querySelector(".dr-c4"), X); draw5(root.querySelector(".dr-c5"), X, done ? X.m5.C.length - 1 : X.m5.at); });
  }
  function answer(take) {
    if (phase !== "ask") return;
    if (take && ST.mode === "week" && WK.taken >= 2) return;
    mine = take; phase = "play"; upto = X.at;
    const ok = rightCall(X.f, take), res = X.res;
    ST.n++; if (ok) { ST.right++; ST.streak++; ST.best = Math.max(ST.best, ST.streak); } else ST.streak = 0;
    ST.miss = ST.miss || {};
    if (!ok) { const k = missKey(X.f, take); ST.miss[k] = (ST.miss[k] || 0) + 1; }
    else if (focus && FOCUS[focus][1](X.f)) ST.miss[focus] = Math.max(0, (ST.miss[focus] || 0) - 1); // getting your weak spot right wears it down
    if (take) ST.rMine += res; if (X.f.grade === "A") ST.rRules += res;
    if (ST.mode === "week") { if (take) WK.taken++; WK.log.push({ day: WK.d, mine: take, grade: X.f.grade, res, name: X.name }); }
    save(); paint(); tick();
  }
  function tick() {
    clearTimeout(timer);
    if (phase !== "play") return;
    if (upto >= X.bars.length - 1) { phase = "done"; paint(); return; }
    upto++; const cv = root && root.querySelector(".dr-cv"); if (cv) draw(cv, X, { upto, zone: true, pos: true });
    timer = setTimeout(tick, ST.mode === "week" ? 70 : X.real ? 160 : 110);
  }
  function onTap(e) {
    if (ST.mode !== "zone" || phase === "done" || !X) return;
    const cv = e.target.closest(".dr-cv"); if (!cv || !cv._map) return;
    const rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top, M = cv._map;
    const price = M.lo + (1 - (py - 10) / (M.H - 24 - M.volH)) * (M.hi - M.lo), i = (px - 8) / M.step - 0.5;
    const zh = X.zHi - X.zLo, inP = price >= X.zLo - zh * 0.25 && price <= X.zHi + zh * 0.25, nearP = price >= X.zLo - zh * 1.5 && price <= X.zHi + zh * 1.5;
    const inT = i >= X.baseStart - 3; // anywhere from the base on, to the right
    tap = { px, py, ok: inP && inT, close: !(inP && inT) && nearP && inT };
    ST.zn++; if (tap.ok) { ST.zr++; ST.streak++; ST.best = Math.max(ST.best, ST.streak); } else ST.streak = 0; save();
    phase = "done"; paint();
  }
  async function load(want) {
    busy = true; X = null; paint();
    X = await nextSetup(want); busy = false;
    if (!X) { X = make(want); if (poolErr) setTimeout(() => alertMsg(poolErr), 0); }
  }
  async function next() {
    clearTimeout(timer); phase = "ask"; mine = null; tap = null;
    focus = ST.mode === "take" ? focusNow() : null;
    const want = ST.mode === "zone" ? (f) => f.age >= 8 : focus && chance(0.35) ? FOCUS[focus][1] : null; // spot the zone: a zone with a clear move away from it
    await load(want);
    if (focus && !FOCUS[focus][1](X.f)) focus = null; // not one of your weak spots this time
    upto = X.at; paint();
  }
  // a week: 0–3 setups a day (about 5 a week, like your scanner), 2 trades a day max
  function newWeek() { const days = DAYS.map(() => { const u = Math.random(); return u < 0.22 ? 0 : u < 0.62 ? 1 : u < 0.9 ? 2 : 3; }); WK = { days, d: 0, i: 0, taken: 0, log: [], done: false }; }
  async function weekStep(first) {
    clearTimeout(timer); phase = "ask"; mine = null; focus = null;
    if (!first) { WK.i++; if (WK.i >= WK.days[WK.d]) { WK.d++; WK.i = 0; WK.taken = 0; } } // a day with no setup is shown, then left on the next tap
    if (WK.d >= 5) { WK.done = true; ST.weeks = [...(ST.weeks || []), { R: +WK.log.filter((x) => x.mine).reduce((a, x) => a + x.res, 0).toFixed(2), at: Date.now() }].slice(-52); save(); X = null; paint(); return; }
    if (WK.days[WK.d] === 0) { X = null; paint(); return; }
    await load(null); upto = X.at; paint();
  }
  function alertMsg(m) { const t = document.getElementById("toast"); if (!t) return; t.textContent = `Real charts: ${m} Showing made-up setups.`; t.hidden = false; setTimeout(() => (t.hidden = true), 6000); }
  function onClick(e) {
    const b = e.target.closest("[data-dr]"); if (!b) return onTap(e);
    const k = b.dataset.dr;
    if (k === "take") answer(true); else if (k === "skip") answer(false);
    else if (k === "fast") { clearTimeout(timer); upto = X.bars.length - 1; phase = "done"; paint(); }
    else if (k === "next") { next(); scrollTo({ top: 0, behavior: "smooth" }); }
    else if (k === "week-next") { weekStep(false); scrollTo({ top: 0, behavior: "smooth" }); }
    else if (k === "week-new") { newWeek(); weekStep(true); }
    else if (k === "reset") { ST = { ...FRESH, mode: ST.mode, src: ST.src, srcPicked: ST.srcPicked }; save(); paint(); }
    else if (k === "m-take" || k === "m-zone" || k === "m-week") { ST.mode = k.slice(2); ST.streak = 0; save(); if (ST.mode === "week") { newWeek(); weekStep(true); } else next(); }
    else if (k === "s-made" || k === "s-real" || k === "s-mix") { ST.src = k.slice(2); ST.srcPicked = true; save(); if (ST.mode === "week") paint(); else next(); }
  }
  // the app redraws its screens often: keep this one alive and just move it into the new page
  function mount(host) {
    if (!host) return;
    if (!root) { root = document.createElement("div"); root.className = "drill"; root.addEventListener("click", onClick); addEventListener("resize", () => root.isConnected && paint()); }
    if (!X && !busy && !WK) { if (ST.mode === "week") { newWeek(); weekStep(true); } else next(); }
    if (root.parentNode !== host) { host.appendChild(root); paint(); }
  }
  window.EdgeDrill = { mount, make, fromReal, gradeOf };
})();
