// Edge practice simulator — replay real past candles like TradingView / FX Replay, place orders,
// then review each trade one point at a time on the chart, and get a summary at the end of the session.
// Uses TradingView's open-source Lightweight Charts (vendor/lightweight-charts.js, Apache 2.0).
(function () {
  const NYZ = "America/New_York";
  const MK = {
    gold: { name: "Gold", sym: "MGC", pv: 10, strategy: "london", tf: "5m", win: [120, 480], tpR: 2, beR: 1.5, dec: 2 },
    crude: { name: "Crude oil", sym: "MCL", pv: 100, strategy: "london", tf: "5m", win: [180, 480], tpR: 3, beR: 1, dec: 2 },
    silver: { name: "Silver", sym: "SIL", pv: 1000, strategy: "london", tf: "5m", win: [120, 480], tpR: 2, beR: 1, dec: 3, minRangeAtr: 1.5 },
    natgas: { name: "Natural gas", sym: "QG", pv: 2500, strategy: "ngzone", tf: "60m", wins: [[360, 540], [660, 720]], tpR: 3, beR: 2, dec: 3 },
  };
  const FLAT = 16 * 60 + 40;
  const cache = {};
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: NYZ, hour: "numeric", minute: "numeric", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric" });
  function nyInfo(t) {
    const p = Object.fromEntries(nyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const min = Number(p.hour) * 60 + Number(p.minute);
    const day = Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5;
    return { min, cme: min >= 18 * 60 ? day + 1 : day }; // the CME trading day starts at 18:00 New York
  }
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const local = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const inWins = (P, m) => (P.wins || [P.win]).some(([a, b]) => m >= a && m < b);
  const winTxt = (P) => (P.wins || [P.win]).map(([a, b]) => `${hm(a)}–${hm(b)}`).join(" and ") + " New York";

  // ---------- data
  // prices: Yahoo (free: 60 days of 5-minute, 2 years of 1-hour) or Databento (official CME, any month since 2019)
  let dbStatus = null;
  async function dbReady() {
    if (dbStatus == null) dbStatus = await fetch("/api/candles?status=1").then((r) => r.json()).then((j) => !!j.databento).catch(() => false);
    return dbStatus;
  }
  const srcPref = () => { try { return localStorage.getItem("edge.sim.src") || "free"; } catch { return "free"; } };
  async function getBars(url) {
    if (cache[url]) return cache[url];
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't load prices — try again in a minute.");
    return (cache[url] = j.bars);
  }
  // add New York time, the CME day, Heikin Ashi and ATR to raw [t,o,h,l,c] candles
  function prep(raw, tf) {
    const bars = raw.map(([t, o, h, l, c]) => { const n = nyInfo(t); return { t, o, h, l, c, min: n.min, cme: n.cme }; });
    let ho = null, hc = null;
    for (const b of bars) { const c = (b.o + b.h + b.l + b.c) / 4, o = ho == null ? (b.o + b.c) / 2 : (ho + hc) / 2; b.ha = { o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c) }; ho = o; hc = c; }
    let a = 0; bars.forEach((b, i) => { const p = bars[i - 1]; const tr = p ? Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)) : b.h - b.l; a = i ? a + (tr - a) / 14 : tr; b.atr = a; });
    const len = tf === "60m" ? 60 : 5;
    const days = [...new Set(bars.map((b) => b.cme))].filter((d) => {
      const s = bars.filter((b) => b.cme === d);
      return s.length && s[0].min >= 17 * 60 + 55 - len && s.some((b) => b.min < 18 * 60 && b.min + len >= FLAT - 10);
    });
    return { bars, days };
  }
  async function load(market, src = "free", month = null) {
    const P = MK[market];
    if (src === "db" && month) {
      const [y, m] = month.split("-").map(Number), prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
      const [a, b] = await Promise.all([getBars(`/api/candles?m=${market}&src=db&i=${P.tf}&month=${prev}`).catch(() => []), getBars(`/api/candles?m=${market}&src=db&i=${P.tf}&month=${month}`)]);
      const d = prep([...a, ...b], P.tf), first = Date.UTC(y, m - 1, 1) / 864e5, last = Date.UTC(y, m, 1) / 864e5;
      return { bars: d.bars, days: d.days.filter((x) => x >= first && x < last) };
    }
    const key = `${market}:${P.tf}`;
    if (cache[key]) return cache[key];
    const d = prep(await getBars(`/api/candles?m=${market}&i=${P.tf}`), P.tf);
    return (cache[key] = { bars: d.bars, days: d.days.slice(P.tf === "60m" ? 10 : 1, -1) });
  }
  function randomMonth() {
    const now = new Date(), from = Date.UTC(2019, 0, 1), to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    return new Date(from + Math.random() * (to - from)).toISOString().slice(0, 7);
  }

  // ---------- strategy answers (what the plan would have done) — used by the review
  function londonPlan(sess, P, style = null) {
    const box = sess.filter((b) => b.min >= 18 * 60 || b.min < 120);
    if (box.length < 6) return null; // 8 one-hour or 96 five-minute candles in a full box
    const hi = Math.max(...box.map((b) => b.h)), lo = Math.min(...box.map((b) => b.l));
    const boxStart = box[0].t, boxEnd = box[box.length - 1].t;
    // 1-hour ATR ≈ 5-minute ATR × √12
    const atrH = (box[box.length - 1].atr || 0) * ((sess[1] && sess[1].t - sess[0].t >= 3600e3) ? 1 : Math.sqrt(12));
    const tooSmall = P.minRangeAtr && atrH > 0 && (hi - lo) / atrH < P.minRangeAtr;
    let trade = null;
    for (const b of sess) {
      if (b.min >= 18 * 60 || !inWins(P, b.min)) continue;
      const up = b.h >= hi, dn = b.l <= lo;
      if (up === dn) continue; // neither, or both inside one candle (can't tell which came first): wait
      const frac = style ? style.stopFrac : 1;
      const dir = up ? 1 : -1, e = up ? Math.max(hi, b.o) : Math.min(lo, b.o), sl = frac >= 1 ? (up ? lo : hi) : e - dir * frac * (hi - lo), r = Math.abs(e - sl);
      const tpR = style ? style.tpR : P.tpR, beR = style ? style.beR : P.beR;
      trade = { dir, e, sl, tp: e + dir * tpR * r, be: beR > 0 ? e + dir * beR * r : null, t: b.t, tpR };
      break;
    }
    if (trade) trade.result = simulate(sess, trade, { ...P, tpR: trade.tpR });
    return { hi, lo, boxStart, boxEnd, trade, tooSmall, rangeAtr: atrH ? (hi - lo) / atrH : null };
  }
  // walk a trade forward with the plan's exits (break-even at beR), conservative inside a candle
  function simulate(sess, tr, P) {
    let sl = tr.sl, started = false, last = null;
    const len = sess.length > 1 ? Math.round((sess[1].t - sess[0].t) / 60e3) : 5;
    const out = (px, how, t) => ({ R: (tr.dir * (px - tr.e)) / Math.abs(tr.e - tr.sl), how, t });
    for (const b of sess) {
      if (b.t < tr.t) continue;
      if (b.t > tr.t && b.min >= FLAT && b.min < 18 * 60) return out(b.o, "16:40 close-out", b.t);
      last = b;
      const hitSL = tr.dir > 0 ? b.l <= sl : b.h >= sl, hitTP = started && (tr.dir > 0 ? b.h >= tr.tp : b.l <= tr.tp);
      if (hitSL) return { R: (tr.dir * (sl - tr.e)) / Math.abs(tr.e - tr.sl), how: sl === tr.e ? "break-even" : "stop", t: b.t };
      if (hitTP) return { R: P.tpR, how: "target", t: b.t };
      if (started && tr.be != null && (tr.dir > 0 ? b.h >= tr.be : b.l <= tr.be)) sl = tr.e;
      started = true;
      if (b.min < 18 * 60 && b.min + len > FLAT) return out(b.c, "16:40 close-out", b.t); // the candle that runs past 16:40
    }
    return last ? out(last.c, "16:40 close-out", last.t) : { R: 0, how: "open", t: null };
  }
  // natural gas zones from Heikin Ashi candles, as they stood at bar index `upto`
  function gasZones(bars, upto) {
    const zones = [], bodies = [];
    for (let i = 1; i <= upto; i++) {
      const h = bars[i - 1].ha, body = Math.abs(h.c - h.o);
      const avg = bodies.length >= 20 ? bodies.slice(-20).reduce((x, y) => x + y, 0) / 20 : null;
      bodies.push(body);
      if (avg && body >= 2 * avg) {
        const up = h.c > h.o; let j = i - 2;
        for (let q = i - 2; q >= Math.max(0, i - 4); q--) { const c = bars[q].ha; if (up ? c.c < c.o : c.c > c.o) { j = q; break; } }
        if (j >= 0) {
          const c = bars[j].ha, z = up ? { prox: c.o, dist: Math.min(c.l, h.l) } : { prox: c.o, dist: Math.max(c.h, h.h) };
          if (up ? z.prox > z.dist : z.prox < z.dist) zones.push({ dir: up ? 1 : -1, ...z, i: i - 1, t: bars[i - 1].t, tBase: bars[j].t, touches: 0, armed: false, dead: false });
        }
      }
      const b = bars[i], p = bars[i - 1];
      for (const z of zones) {
        if (z.dead || z.i >= i - 1) continue;
        const away = z.dir > 0 ? p.l > z.prox : p.h < z.prox, touched = z.dir > 0 ? b.l <= z.prox : b.h >= z.prox;
        if (i < upto) { if (touched && z.armed && away) z.touches++; if (!z.armed && away) z.armed = true; if (z.dir > 0 ? b.c < z.dist : b.c > z.dist) z.dead = true; }
      }
    }
    return zones.filter((z) => !z.dead).map((z) => ({ ...z, ageDays: (upto - z.i) / 23 }));
  }

  // ---------- review: the findings for one trade, most important first (shown one at a time)
  const ADVICE = {
    window: "Only trade inside the strategy's window — outside it the edge isn't there.",
    direction: "Take the side London breaks first. Both orders in, let price choose.",
    entry: "Put the order exactly at the box edge (or the zone edge) before the move.",
    stopTight: "The stop goes at the other side of the box / past the zone. Tighter stops get hit by normal noise.",
    stopWide: "Don't widen the stop — it only makes the loss bigger.",
    target: "Set the target at the plan's R and leave it.",
    early: "Don't close early. The plan already protects you with break-even.",
    beMissed: "Move the stop to entry the moment the trade reaches its break-even level.",
    beEarly: "Wait for the break-even level before moving the stop — too early turns winners into scratches.",
    other: "When one order fills, cancel the other one straight away.",
    small: "Skip silver when the Asian box is tiny.",
    noZone: "Only trade at old zones (5+ trading days) on their 1st or 2nd touch.",
    young: "Let zones age 5 trading days before trading them.",
    touches: "After 2 touches a zone is used up — skip it.",
    second: "One trade per market per session.",
  };
  function review(S, tr) {
    const P = S.P, f = [], R = tr.R, dirTxt = tr.dir > 0 ? "buy" : "sell", fx = (x) => x.toFixed(P.dec);
    const add = (code, title, text, ann, rule = true) => f.push({ code, title, text, ann: ann || [], rule });
    const entryMin = nyInfo(tr.tIn).min;
    if (P.strategy === "london") {
      const L = S.plan;
      if (!L) return [];
      const boxAnn = [{ type: "box", t1: L.boxStart, t2: L.boxEnd, p1: L.hi, p2: L.lo, color: "var(--c4h)", label: `Asian box ${fx(L.lo)} – ${fx(L.hi)}` }];
      const edge = tr.dir > 0 ? L.hi : L.lo, other = tr.dir > 0 ? L.lo : L.hi, box = L.hi - L.lo;
      if (L.tooSmall) add("small", "The box was too small today", `Silver's Asian box was only ${L.rangeAtr.toFixed(1)}× the hourly range. The plan skips days like this — they lost money in the test.`, boxAnn);
      if (!(entryMin >= P.win[0] && entryMin < P.win[1])) add("window", "Outside the London window", `You entered at ${hm(entryMin)} New York. ${P.name} orders are only live ${winTxt(P)}.`, [{ type: "marker", t: tr.tIn, p: tr.e, color: "var(--bad)", label: "your entry" }, ...boxAnn]);
      if (L.trade && L.trade.dir !== tr.dir) add("direction", `London broke the ${L.trade.dir > 0 ? "high" : "low"} first`, `At ${hm(nyInfo(L.trade.t).min)} New York price broke the box ${L.trade.dir > 0 ? "high" : "low"}, so the trade was a ${L.trade.dir > 0 ? "buy" : "sell"} — you took a ${dirTxt}.`, [...boxAnn, { type: "marker", t: L.trade.t, p: L.trade.e, color: "var(--good)", label: "first break" }]);
      if (Math.abs(tr.e - edge) > box * 0.15 && !f.some((x) => x.code === "direction")) add("entry", "Your entry wasn't at the box edge", `You ${dirTxt === "buy" ? "bought" : "sold"} at ${fx(tr.e)}. The plan's ${dirTxt} stop sits at the box ${tr.dir > 0 ? "high" : "low"}: ${fx(edge)}.`, [...boxAnn, { type: "hline", p: edge, color: "var(--good)", label: `${dirTxt} stop ${fx(edge)}` }, { type: "marker", t: tr.tIn, p: tr.e, color: "var(--warn)", label: "you" }]);
      const slDist = tr.dir * (tr.e - tr.sl0), planDist = tr.dir * (tr.e - other);
      if (slDist < planDist * 0.85) add("stopTight", "Your stop was inside the box", `Stop at ${fx(tr.sl0)} — inside the Asian range, where price wanders. The plan's stop is the other side: ${fx(other)}.`, [...boxAnn, { type: "hline", p: other, color: "var(--bad)", label: `plan stop ${fx(other)}` }, { type: "hline", p: tr.sl0, color: "var(--warn)", label: "your stop", dash: true }]);
      else if (slDist > planDist * 1.2) add("stopWide", "Your stop was wider than needed", `Stop at ${fx(tr.sl0)}. The plan's stop at ${fx(other)} is enough — a wider one only makes the loss bigger.`, [...boxAnn, { type: "hline", p: other, color: "var(--bad)", label: `plan stop ${fx(other)}` }]);
    } else {
      // natural gas zones as they stood when you entered
      const i = S.bars.findIndex((b) => b.t === tr.tIn);
      const zs = gasZones(S.bars, i).filter((z) => z.dir === tr.dir);
      const near = zs.map((z) => ({ z, d: Math.abs(z.prox - tr.e) })).sort((a, b) => a.d - b.d)[0];
      const atr = S.bars[i].atr, good = zs.filter((z) => z.ageDays >= 5 && z.touches < 2 && z.armed).sort((a, b) => Math.abs(a.prox - tr.e) - Math.abs(b.prox - tr.e))[0];
      const zAnn = (z, c) => ({ type: "box", t1: z.tBase, t2: tr.tIn, p1: Math.max(z.prox, z.dist), p2: Math.min(z.prox, z.dist), color: c, label: `${z.dir > 0 ? "demand" : "supply"} · ${z.ageDays.toFixed(0)} days · touch ${z.touches + 1}` });
      if (!inWins(P, entryMin)) add("window", "Outside your gas windows", `You entered at ${hm(entryMin)} New York. Gas zone trades are only taken ${winTxt(P)}.`, [{ type: "marker", t: tr.tIn, p: tr.e, color: "var(--bad)", label: "your entry" }]);
      if (!near || near.d > atr * 0.6) add("noZone", "No zone at your entry", good ? `There was no Heikin Ashi zone where you entered. The nearest old ${tr.dir > 0 ? "demand" : "supply"} zone was at ${fx(good.prox)} (${good.ageDays.toFixed(0)} days old).` : `There was no old ${tr.dir > 0 ? "demand" : "supply"} zone near your entry.`, good ? [zAnn(good, "var(--good)"), { type: "marker", t: tr.tIn, p: tr.e, color: "var(--warn)", label: "you" }] : [{ type: "marker", t: tr.tIn, p: tr.e, color: "var(--warn)", label: "you" }]);
      else if (near.z.ageDays < 5) add("young", `That zone was only ${near.z.ageDays.toFixed(1)} days old`, "Zones younger than 5 trading days lost money in the test. Let them age.", [zAnn(near.z, "var(--warn)")]);
      else if (near.z.touches >= 2) add("touches", `That was touch ${near.z.touches + 1} of the zone`, "The edge is on the 1st and 2nd touch. After that, skip it.", [zAnn(near.z, "var(--warn)")]);
      else {
        const z = near.z, planSl = z.dist - tr.dir * 0.2 * atr;
        if (Math.abs(tr.e - z.prox) > atr * 0.25) add("entry", "Your entry wasn't at the zone edge", `The limit goes at the zone edge: ${fx(z.prox)}. You got in at ${fx(tr.e)}.`, [zAnn(z, "var(--good)"), { type: "hline", p: z.prox, color: "var(--good)", label: `limit ${fx(z.prox)}` }]);
        if (tr.dir * (tr.e - tr.sl0) < tr.dir * (tr.e - planSl) * 0.85) add("stopTight", "Your stop was inside the zone", `The stop goes just past the far side of the zone: ${fx(planSl)}.`, [zAnn(z, "var(--good)"), { type: "hline", p: planSl, color: "var(--bad)", label: `plan stop ${fx(planSl)}` }]);
      }
    }
    // target, break-even, early exits — same for both strategies
    const r0 = Math.abs(tr.e - tr.sl0), tpR = tr.tp0 != null ? (tr.dir * (tr.tp0 - tr.e)) / r0 : null;
    if (tpR != null && Math.abs(tpR - P.tpR) > 0.2) add("target", `Target was ${tpR.toFixed(1)}R — the plan is ${P.tpR}R`, `For ${P.name} the target is ${P.tpR}R: ${fx(tr.e + tr.dir * P.tpR * r0)}.`, [{ type: "hline", p: tr.e + tr.dir * P.tpR * r0, color: "var(--good)", label: `plan target ${P.tpR}R` }]);
    const beLvl = tr.e + tr.dir * P.beR * r0;
    if (tr.how === "closed by you" && R < P.tpR - 0.1) {
      const after = S.bars.filter((b) => b.t > tr.tOut && b.cme === S.day);
      const hit = after.find((b) => (tr.dir > 0 ? b.h >= tr.e + tr.dir * P.tpR * r0 : b.l <= tr.e + tr.dir * P.tpR * r0));
      const stop = after.find((b) => (tr.dir > 0 ? b.l <= tr.sl0 : b.h >= tr.sl0));
      if (hit && (!stop || hit.t <= stop.t)) add("early", `You closed at ${R.toFixed(1)}R — it went on to ${P.tpR}R`, `Price reached the target at ${hm(hit.min)} New York. Holding to the plan would have paid ${P.tpR}R.`, [{ type: "hline", p: tr.e + tr.dir * P.tpR * r0, color: "var(--good)", label: "target hit later" }]);
      else add("early", `You closed early at ${R.toFixed(1)}R`, "This time it didn't reach the target, but closing early is a habit the tests punished. Let the stop and target do the work.", [], false);
    }
    if (tr.mfe >= P.beR && !tr.beAt && R < -0.5) add("beMissed", `It reached +${P.beR}R — break-even would have saved this`, `Price got to ${fx(beLvl)} (+${P.beR}R). Moving the stop to your entry there turns this loss into a scratch.`, [{ type: "hline", p: beLvl, color: "var(--warn)", label: `break-even level +${P.beR}R` }]);
    if (tr.beAt != null && tr.beAt < P.beR - 0.15 && Math.abs(R) < 0.15) add("beEarly", `You moved to break-even at +${tr.beAt.toFixed(1)}R`, `The plan waits for +${P.beR}R. Moving earlier got you stopped at entry.`, [{ type: "hline", p: beLvl, color: "var(--warn)", label: `break-even level +${P.beR}R` }]);
    if (tr.widened) add("stopWide", "You moved your stop further away", "Once you're in, the stop only moves toward profit (to entry at the break-even level). Moving it away makes the loss bigger.", [{ type: "hline", p: tr.sl0, color: "var(--bad)", label: "your first stop" }]);
    if (tr.tpMoved) add("target", "You pushed the target further", `The plan's target is ${P.tpR}R. Pushing it out is how winners turn into break-evens.`, []);
    if (tr.otherFilled) add("other", "Your other order filled too", "When one London order fills, cancel the other. Leaving it in flipped or doubled your position.", []);
    if (tr.second) add("second", "Second trade in the same session", "One trade per market per session — the tests never took a second one.", []);
    if (!f.length) {
      if (R > 0.1) add("clean", "Clean trade. Nothing to add.", "You followed the plan from entry to exit. That's exactly how it's done.", [], false);
      else add("clean", "You followed the plan — this was a normal loss", `Most London and zone trades lose (they're ${P.strategy === "london" ? "57–70" : "about 53"}%), and the winners pay for them. Nothing to fix here.`, P.strategy === "london" && S.plan ? [{ type: "box", t1: S.plan.boxStart, t2: S.plan.boxEnd, p1: S.plan.hi, p2: S.plan.lo, color: "var(--c4h)", label: "Asian box" }] : [], false);
    }
    return f;
  }

  // ---------- the simulator UI
  let S = null, chart = null, series = null, lines = [], overlay = null, timer = null;

  function open(market = "gold", day = null) {
    close();
    const el = document.createElement("div");
    el.id = "sim"; el.className = "sim";
    el.innerHTML = `<div class="sim-top">
        <button class="sim-x" data-s="close" aria-label="Close">✕</button>
        <div class="sim-mk">${Object.entries(MK).map(([k, v]) => `<button data-s="mk" data-a="${k}" class="${k === market ? "on" : ""}">${{ gold: "Gold", crude: "Crude", silver: "Silver", natgas: "Gas" }[k]}</button>`).join("")}</div>
        <button class="sim-date" data-s="pick" id="simDate" title="Pick the day to train on">📅</button>
        <button class="sim-x" data-s="fs" title="Full screen (F)">⛶</button>
        <button class="sim-pnl" data-s="acct" title="Your practice account"><small>Balance</small><b id="simBal">—</b><em id="simPnl">0.00R</em></button></div>
      <div class="sim-info" id="simInfo">Loading prices…</div>
      <div class="tv-bar" id="tvBar"></div>
      <div class="sim-chart" id="simChart"><svg class="sim-ov" id="simOv"></svg><svg class="sim-tools" id="simTools"></svg><div id="simTB"></div>${toolbarHtml()}<div class="sim-banner" id="simBanner" hidden></div></div>
      <div class="sim-ctl">
        <button class="btn small" data-s="play" id="simPlay">▶ Play</button>
        <button class="btn small" data-s="step">Next candle ›</button>
        <button class="btn small" data-s="speed" id="simSpeed">1×</button>
        <button class="btn small" data-s="skip" id="simSkip">⏩</button>
        <button class="btn small" data-s="end">End</button></div>
      <div class="sim-panel" id="simPanel"></div>`;
    document.body.appendChild(el);
    document.body.classList.add("sim-on");
    el.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    start(market, day).catch((e) => { $("#simInfo").textContent = e.message; });
  }
  function close() {
    stop();
    document.removeEventListener("keydown", onKey);
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch?.(() => {});
    if (chart) { chart.remove(); chart = null; }
    const el = $("#sim"); if (el) el.remove();
    document.body.classList.remove("sim-on");
    S = null;
  }

  // o: { day, month ("2024-03"), src ("db" | "free"), at (New York minutes to start from), seq (Next = the following day) }
  async function start(market, o = {}) {
    if (o == null) o = {};
    if (typeof o === "number") o = { day: o };
    stop();
    const useDb = (o.src || srcPref()) === "db" && (await dbReady());
    const month = useDb ? o.month || (o.day != null ? new Date(o.day * 864e5).toISOString().slice(0, 7) : randomMonth()) : null;
    $("#simInfo").textContent = useDb ? "Loading a month from Databento…" : "Loading prices…";
    const P = MK[market], data = await load(market, useDb ? "db" : "free", month);
    const dayPick = o.day;
    if (!data.days.length) throw new Error("No complete sessions in the data yet.");
    const seenKey = `edge.sim.${market}`;
    let seen = []; try { seen = JSON.parse(localStorage.getItem(seenKey) || "[]"); } catch {}
    const fresh = data.days.filter((d) => !seen.includes(d));
    const day = dayPick != null && data.days.includes(dayPick) ? dayPick : (fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : data.days[Math.floor(Math.random() * data.days.length)]);
    try { localStorage.setItem(seenKey, JSON.stringify([...seen, day].slice(-400))); } catch {}
    const all = data.bars, first = all.findIndex((b) => b.cme === day);
    const sess = all.filter((b) => b.cme === day);
    // start: London → the evening the box starts (18:00); gas → 03:00 New York with plenty of history for old zones
    let startI = P.strategy === "london" ? first : Math.max(first, all.findIndex((b) => b.cme === day && b.min >= 180 && b.min < 18 * 60));
    const at = o.at ?? startAt(market);
    if (at != null && at !== 18 * 60) { const j = all.findIndex((b, k) => k >= startI && b.cme === day && b.min >= at && b.min < 18 * 60); if (j > 0) startI = j; } // your chosen start time
    S = { market, P, day, bars: all, sess, i: startI, from: 0, view: viewPrefs(market), speed: 1, orders: [], pos: null, trades: [], plan: P.strategy === "london" ? londonPlan(sess, P) : null, reviewing: null, tools: [], draws: [], mode: null, pend: null, sel: null, tk: null, tkLines: null, src: useDb ? "db" : "free", month, days: data.days, seq: !!o.seq };
    closeTicket(); closeMenu(); if (S) modeUi();
    { const a = acct(); S.dayStart = a.balance; S.dayLock = null; }
    setTimeout(paintPnl, 0);
    buildChart();
    paintAll();
    const d = new Date(day * 864e5); // the New York trading day
    const db = $("#simDate"); if (db) db.textContent = `📅 ${d.toLocaleDateString([], { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" })}`;
    $("#simInfo").innerHTML = `<b>${P.name}</b> · ${d.toLocaleDateString([], { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${P.tf === "5m" ? "5-minute" : "1-hour Heikin Ashi"} candles · ${P.strategy === "london" ? `orders live ${winTxt(P)}` : `windows ${winTxt(P)}`}`;
    $("#simSkip").textContent = P.strategy === "london" ? `⏩ to ${hm(P.win[0])} NY` : "⏩ to 06:00 NY";
    panel();
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"; }
  let chartGen = 0, emaSeries = [];
  function buildChart() {
    if (chart) chart.remove();
    lines = []; emaSeries = [];
    const el = $("#simChart"), LW = window.LightweightCharts, V = S.view, gen = ++chartGen;
    const tz = V.clock === "ny" ? NYZ : undefined;
    const tick = (t, type) => new Date(t * 1000).toLocaleString([], type < 3 ? { timeZone: tz, day: "numeric", month: "short" } : { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: css("--panel") }, textColor: css("--muted"), fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line2") },
      timeScale: { borderColor: css("--line2"), timeVisible: true, secondsVisible: false, rightOffset: 12, tickMarkFormatter: tick },
      localization: { locale: "en-US", timeFormatter: (t) => V.clock === "ny" ? `${new Date(t * 1000).toLocaleString([], { timeZone: NYZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} NY` : `${new Date(t * 1000).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · NY ${hm(nyInfo(t * 1000).min)}` },
      crosshair: { mode: LW.CrosshairMode.Normal },
    });
    const pf = { priceFormat: { type: "price", precision: S.P.dec, minMove: S.P.dec === 2 ? 0.01 : 0.001 } }, UP = "#26a69a", DN = "#ef5350";
    series = V.type === "bars" ? chart.addBarSeries({ upColor: UP, downColor: DN, thinBars: false, ...pf })
      : V.type === "line" ? chart.addLineSeries({ color: "#2962ff", lineWidth: 2, ...pf })
      : V.type === "area" ? chart.addAreaSeries({ lineColor: "#2962ff", topColor: "rgba(41,98,255,.35)", bottomColor: "rgba(41,98,255,0)", lineWidth: 2, ...pf })
      : V.type === "hollow" ? chart.addCandlestickSeries({ upColor: "rgba(0,0,0,0)", downColor: DN, borderVisible: true, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN, ...pf })
      : chart.addCandlestickSeries({ upColor: UP, downColor: DN, wickUpColor: UP, wickDownColor: DN, borderVisible: false, ...pf });
    emaSeries = V.ema.map((p) => ({ p, s: chart.addLineSeries({ color: EMA_C[p] || "#f0b90b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) }));
    // keep every stop and target on screen
    series.applyOptions({ autoscaleInfoProvider: (orig) => {
      if (S && S.freeze) return { priceRange: S.freeze };
      const r = orig(); if (!r || !S) return r;
      const xs = []; for (const o of objects()) xs.push(o.e, o.sl, ...(o.pos && o.tp != null ? [o.tp] : []));
      if (!xs.length) return r;
      return { priceRange: { minValue: Math.min(r.priceRange.minValue, ...xs), maxValue: Math.max(r.priceRange.maxValue, ...xs) }, margins: r.margins };
    } });
    chart.subscribeClick((p) => { if (!p.point || !S || S.reviewing || S.justDragged || S.mode || Date.now() - (S.tapAt || 0) < 400) return; chartTap(p.point.x, p.point.y); });
    // while a drawing tool is picked, our own tap detection places it (sturdier than the chart's click on touch screens)
    let down = null;
    if (!el.__wired) { el.__wired = true; // once per simulator (the chart itself is rebuilt when you change the view)
    el.addEventListener("pointerdown", (e) => { down = S && S.mode && !e.target.closest("[data-k],.tv-tools,.tv-sel,.sim-banner") ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }, true);
    el.addEventListener("pointerup", (e) => {
      if (!down || !S || !S.mode) return;
      const d = down; down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || Date.now() - d.t > 800) return;
      S.tapAt = Date.now(); const r = el.getBoundingClientRect(); chartTap(e.clientX - r.left, e.clientY - r.top);
    }, true);
    new ResizeObserver(() => drawOverlay()).observe(el);
    $("#simTools").addEventListener("pointerdown", pointerDown);
    $("#simTools").addEventListener("contextmenu", onContext);
    }
    chart.subscribeCrosshairMove((p) => { if (S) S.hover = p.point && S.pend ? { x: p.point.x, y: p.point.y } : null; });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawOverlay());
    const loop = () => { if (!S || !chart || gen !== chartGen) return; drawTools(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  // ---------- what the chart shows: your timeframe, chart type, indicators and clock (the replay itself always runs on
  // the strategy's candles — 5-minute, or 1-hour for gas — and bigger timeframes are built from them as they print)
  const TFS = [[5, "5m"], [15, "15m"], [30, "30m"], [60, "1h"], [240, "4h"], [1440, "D"]];
  const TYPES = [["candles", "Candles", "🕯"], ["hollow", "Hollow candles", "◻"], ["ha", "Heikin Ashi", "🟩"], ["bars", "Bars", "┤"], ["line", "Line", "〰"], ["area", "Area", "◢"]];
  const EMAS = [9, 20, 50, 200], EMA_C = { 9: "#f0b90b", 20: "#00bcd4", 50: "#e91e63", 200: "#ffffff" };
  const baseMin = () => (S.P.tf === "60m" ? 60 : 5);
  const kTF = () => Math.max(1, S.view.tf / baseMin());
  function viewPrefs(market) {
    const P = MK[market], base = P.tf === "60m" ? 60 : 5;
    let v = {}; try { v = JSON.parse(localStorage.getItem(`edge.sim.view.${market}`) || "{}"); } catch {}
    const d = { tf: base, type: P.strategy === "ngzone" ? "ha" : "candles", ema: [], clock: "local", pdhl: false, seps: true };
    const out = { ...d, ...v };
    if (!(out.tf >= base)) out.tf = base;
    return out;
  }
  const saveView = () => { try { localStorage.setItem(`edge.sim.view.${S.market}`, JSON.stringify(S.view)); } catch {} };
  const gKey = (b) => (S.view.tf >= 1440 ? b.cme : b.cme * 1440 + Math.floor(((b.min - 1080 + 1440) % 1440) / S.view.tf)); // aligned to the 18:00 New York open, like TradingView
  function dispAdd(i) {
    const D = S.D, b = S.bars[i], key = gKey(b);
    let g = D.g[D.g.length - 1];
    if (g && g.key === key) { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; g.i1 = i; }
    else { g = { key, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, i0: i, i1: i }; D.g.push(g); }
    D.of[i] = D.g.length - 1;
    const p = D.g[D.g.length - 2], hc = (g.o + g.h + g.l + g.c) / 4, ho = p ? (p.ha.o + p.ha.c) / 2 : (g.o + g.c) / 2;
    g.ha = { o: ho, c: hc, h: Math.max(g.h, ho, hc), l: Math.min(g.l, ho, hc) };
    g.ema = {}; for (const n of S.view.ema) g.ema[n] = p ? p.ema[n] + (g.c - p.ema[n]) * 2 / (n + 1) : g.c;
    return g;
  }
  function dispBuild() { S.D = { g: [], of: [] }; for (let i = S.from; i <= S.i; i++) dispAdd(i); }
  const barOf = (g) => {
    const t = g.t / 1000, ty = S.view.type;
    if (ty === "line" || ty === "area") return { time: t, value: g.c };
    if (ty === "ha") return { time: t, open: g.ha.o, high: g.ha.h, low: g.ha.l, close: g.ha.c };
    return { time: t, open: g.o, high: g.h, low: g.l, close: g.c };
  };
  // base candle index ⇄ chart position (a 1-hour chart has one bar for twelve 5-minute candles)
  const dIdx = (i) => { const D = S.D, last = D.g.length - 1; if (i > S.i) return last + (i - S.i) / kTF(); if (i < S.from) return (i - S.from) / kTF(); return D.of[i] ?? last; };
  const bIdx = (l) => { const D = S.D, last = D.g.length - 1; if (l > last) return S.i + (l - last) * kTF(); if (l < 0) return S.from + l * kTF(); return D.g[Math.round(l)].i0; };
  const idxOf = (t) => { let lo = 0, hi = S.bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.bars[m].t <= t) lo = m; else hi = m - 1; } return lo; };
  const gTime = (t) => { const i = idxOf(t), g = S.D.g[S.D.of[i]]; return (g ? g.t : t) / 1000; };
  function paintAll() {
    dispBuild();
    series.setData(S.D.g.map(barOf));
    for (const e of emaSeries) e.s.setData(S.D.g.map((g) => ({ time: g.t / 1000, value: g.ema[e.p] })));
    const last = S.D.g.length - 1;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, last - 90), to: last + 12 });
    markers(); drawLines(); drawOverlay(); viewBar();
  }
  function setView(patch) {
    Object.assign(S.view, patch); saveView();
    S.lv = null; buildChart(); paintAll(); closeMenu();
  }
  function viewBar() {
    const el = $("#tvBar"); if (!el || !S) return;
    const V = S.view, ty = TYPES.find((x) => x[0] === V.type) || TYPES[0];
    el.innerHTML = `<button data-s="vmenu" data-a="tf" class="tf">${(TFS.find((x) => x[0] === V.tf) || [0, V.tf + "m"])[1]} ▾</button>
      <button data-s="vmenu" data-a="type" title="Chart type">${ty[2]} <span>${ty[1]}</span> ▾</button>
      <button data-s="vmenu" data-a="ind" title="Indicators">ƒx <span>Indicators</span>${V.ema.length + (V.pdhl ? 1 : 0) + (V.seps ? 1 : 0) ? ` <i>${V.ema.length + (V.pdhl ? 1 : 0) + (V.seps ? 1 : 0)}</i>` : ""}</button>
      <button data-s="vclock" title="Time on the chart">🕐 ${V.clock === "ny" ? "New York" : "Your time"}</button>`;
  }
  function viewMenu(kind, btn) {
    const V = S.view, r = btn.getBoundingClientRect(), base = baseMin();
    const check = (on) => `<i>${on ? "✓" : ""}</i>`;
    let html = "";
    if (kind === "tf") html = `<div class="tv-mh">Timeframe</div>` + TFS.filter(([m]) => m >= base).map(([m, l]) => `<button data-s="vtf" data-a="${m}">${check(V.tf === m)}${l === "D" ? "1 day" : l.replace("m", " minutes").replace("h", " hour" + (l === "1h" ? "" : "s"))}</button>`).join("")
      + `<p class="tv-mnote">The replay moves one ${base === 5 ? "5-minute" : "1-hour"} candle at a time; bigger candles build up as you go.</p>`;
    if (kind === "type") html = `<div class="tv-mh">Chart type</div>` + TYPES.map(([k, l, ic]) => `<button data-s="vtype" data-a="${k}">${check(V.type === k)}<span class="ic">${ic}</span>${l}</button>`).join("");
    if (kind === "ind") html = `<div class="tv-mh">Indicators</div>` + EMAS.map((n) => `<button data-s="vema" data-a="${n}">${check(V.ema.includes(n))}<span class="sw" style="background:${EMA_C[n]}"></span>EMA ${n}</button>`).join("")
      + `<hr><button data-s="vpdhl">${check(V.pdhl)}Previous day high / low</button><button data-s="vseps">${check(V.seps)}New-day lines (18:00 New York)</button>`;
    closeMenu();
    const m = document.createElement("div");
    m.id = "tvMenu"; m.className = "tv-menu"; m.innerHTML = html;
    $("#sim").appendChild(m);
    const mr = m.getBoundingClientRect();
    m.style.left = `${Math.max(6, Math.min(r.left, innerWidth - mr.width - 6))}px`; m.style.top = `${r.bottom + 4}px`;
    S.keepMenu = true; setTimeout(() => { if (S) S.keepMenu = false; }, 50);
  }
  function markers() {
    const m = [];
    for (const t of S.trades) {
      m.push({ time: gTime(t.tIn), position: t.dir > 0 ? "belowBar" : "aboveBar", color: t.dir > 0 ? "#26a69a" : "#ef5350", shape: t.dir > 0 ? "arrowUp" : "arrowDown", text: t.dir > 0 ? "BUY" : "SELL" });
      m.push({ time: gTime(t.tOut), position: t.dir > 0 ? "aboveBar" : "belowBar", color: t.R > 0.1 ? "#26a69a" : t.R < -0.1 ? "#ef5350" : "#9e9e9e", shape: "circle", text: `${t.R > 0 ? "+" : ""}${t.R.toFixed(1)}R` });
    }
    if (S.pos) m.push({ time: gTime(S.pos.tIn), position: S.pos.dir > 0 ? "belowBar" : "aboveBar", color: S.pos.dir > 0 ? "#26a69a" : "#ef5350", shape: S.pos.dir > 0 ? "arrowUp" : "arrowDown", text: S.pos.dir > 0 ? "BUY" : "SELL" });
    m.sort((a, b) => a.time - b.time);
    if (S.view.tf > baseMin()) m.forEach((x) => { if (x.text === "BUY" || x.text === "SELL") x.text = ""; }); // keep big candles readable
    series.setMarkers(m);
  }
  function prevDay() {
    if (S.pd && S.pd.day === S.day) return S.pd;
    const prev = S.bars.filter((b) => b.cme < S.day).reduce((m, b) => Math.max(m, b.cme), -1), bs = S.bars.filter((b) => b.cme === prev);
    S.pd = bs.length ? { day: S.day, h: Math.max(...bs.map((b) => b.h)), l: Math.min(...bs.map((b) => b.l)) } : { day: S.day };
    return S.pd.h != null ? S.pd : null;
  }
  function drawLines() {
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    // the boxes are drawn over the chart; these only put the prices on the right-hand scale (like TradingView)
    const LW = window.LightweightCharts, add = (price, color, title = "", line = false) => { if (price === "" || price == null) return; const p = Number(price); if (Number.isFinite(p)) lines.push(series.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, lineVisible: line, axisLabelVisible: true, title })); };
    if (S.reviewing) return;
    if (S.pos) { add(S.pos.e, "#787b86"); add(S.pos.sl, "#7e57c2"); if (S.pos.tp != null) add(S.pos.tp, "#2962ff"); }
    S.orders.forEach((o) => add(o.price, o.side > 0 ? "#2962ff" : "#ef5350", `${o.side > 0 ? "BUY" : "SELL"} ${o.type.toUpperCase()} ${o.qty || ""}`));
    const so = S.sel && S.sel.startsWith("tool:") && S.tools[Number(S.sel.slice(5))];
    if (so && !S.tkLines) { add(so.e, "#787b86"); add(so.sl, "#7e57c2"); add(so.tp, "#2962ff"); }
    if (S.view.pdhl) { const p = prevDay(); if (p) { add(p.h, "#9598a1", "PDH", true); add(p.l, "#9598a1", "PDL", true); } }
    if (S.tkLines) { const k = S.tkLines; add(k.e, "#787b86", "ticket", true); add(k.sl, "#7e57c2", "SL", true); add(k.tp, "#2962ff", "TP", true); }
  }


  // ---------- TradingView-style drawing: Long / Short position tools, lines, rectangles, trend lines,
  // press-and-hold menu (Create limit order…, Clone, Reverse, Remove) and an order ticket
  const TICK = { gold: 0.1, crude: 0.01, silver: 0.005, natgas: 0.005 };
  const tick = () => TICK[S.market] || (S.P.dec === 2 ? 0.01 : 0.001);
  const onTick = (p) => +(Math.round(p / tick()) * tick()).toFixed(S.P.dec);
  const fmt = (p) => Number(p).toLocaleString("en-US", { minimumFractionDigits: S.P.dec, maximumFractionDigits: S.P.dec });
  const money = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
  const riskUSD = () => { try { const v = Number(localStorage.getItem("edge.riskUSD")); if (v > 0) return v; } catch {} const st = window.Edge && window.Edge.state && window.Edge.state(); return st && st.settings ? Math.round(st.settings.accountSize * st.settings.riskPct / 100) : 100; };
  const contracts = (r, usd = riskUSD()) => (r > 0 ? Math.floor(usd / (r * S.P.pv) + 1e-9) : 0);
  const boxW = () => Math.round((S.P.tf === "60m" ? 12 : 24) * kTF()); // a position tool is about this many chart bars wide
  const PROFIT = "#2962ff", LOSS = "#7e57c2", ENTRY = "#787b86";
  // key levels to snap to: the Asian box so far (London) or the old gas zones, plus your own lines
  function levels() {
    if (!S.lv || S.lv.i !== S.i) {
      const list = [];
      if (S.P.strategy === "london") {
        const box = S.sess.filter((b) => b.t <= S.bars[S.i].t && (b.min >= 18 * 60 || b.min < 120));
        if (box.length) { S.box = { hi: Math.max(...box.map((b) => b.h)), lo: Math.min(...box.map((b) => b.l)) }; list.push(S.box.hi, S.box.lo); }
      } else for (const z of gasZones(S.bars, S.i)) if (z.ageDays >= 1) list.push(z.prox, z.dist);
      S.lv = { i: S.i, list };
    }
    const mine = [];
    for (const d of S.draws) { if (d.type === "h") mine.push(d.p); if (d.type === "r") mine.push(d.p1, d.p2); }
    return [...S.lv.list, ...mine];
  }
  function snap(price, extra = []) {
    let best = null, bd = 9;
    const y0 = series.priceToCoordinate(price);
    if (y0 == null) return onTick(price);
    for (const c of [...levels(), ...extra]) { const y = series.priceToCoordinate(c); if (y != null && Math.abs(y - y0) < bd) { bd = Math.abs(y - y0); best = c; } }
    return best != null ? best : onTick(price);
  }
  // candle index ⇄ x on the chart (works in the empty space to the right too)
  const L2X = (i) => chart.timeScale().logicalToCoordinate(dIdx(i));
  const X2L = (x) => { const l = chart.timeScale().coordinateToLogical(x); return l == null ? S.i : Math.round(bIdx(l)); };
  // keep a new box inside the visible chart (it starts where you tapped, unless that would run off the right edge)
  const fit = (t0, w = boxW()) => Math.min(t0, X2L(chart.timeScale().width() - 8) - w);
  const hourAtr = () => { const b = S.bars[S.i]; return S.P.tf === "60m" ? b.atr : b.atr * Math.sqrt(12); };
  function addTool(dir, price, t0 = S.i) {
    const e = snap(price, [S.bars[S.i].c]);
    levels();
    let sl = null;
    if (S.P.strategy === "london" && S.box) { const other = dir > 0 ? S.box.lo : S.box.hi; if (dir * (e - other) > tick()) sl = other; }
    if (sl == null) sl = onTick(e - dir * hourAtr());
    const r = Math.abs(e - sl);
    S.tools.push({ dir, e, sl, tp: onTick(e + dir * S.P.tpR * r), t0: fit(t0), w: boxW() });
    S.sel = `tool:${S.tools.length - 1}`;
    drawLines(); panel();
  }
  function planTools() {
    levels();
    if (S.P.strategy !== "london" || !S.box) return toast("The plan needs the Asian box first (from 02:00 New York).");
    const { hi, lo } = S.box, r = hi - lo;
    S.tools = [{ dir: 1, e: hi, sl: lo, tp: onTick(hi + S.P.tpR * r), t0: fit(S.i), w: boxW() }, { dir: -1, e: lo, sl: hi, tp: onTick(lo - S.P.tpR * r), t0: fit(S.i), w: boxW() }];
    S.sel = null; S.mode = null; modeUi();
    drawLines(); panel();
    toast("The plan: both positions drawn. Press and hold one → Create stop order…");
  }
  const kindOf = (t) => { const c = S.bars[S.i].c, tk = tick() * 2; return t.dir * (t.e - c) > tk ? "stop" : t.dir * (t.e - c) < -tk ? "limit" : "market"; };
  const quote = () => { const c = S.bars[S.i].c; return { bid: onTick(c - tick()), ask: onTick(c + tick()) }; };

  // everything on the chart you can tap, hold or drag
  function objects() {
    const end = (x) => Math.max(x.t0 + x.w, S.i + 3);
    const o = S.tools.map((t, i) => ({ k: `tool:${i}`, kind: "tool", t, dir: t.dir, e: t.e, sl: t.sl, tp: t.tp, i0: t.t0, i1: t.t0 + t.w }));
    S.orders.forEach((x, i) => o.push({ k: `ord:${i}`, kind: "ord", t: x, dir: x.side, e: x.price, sl: x.sl, tp: x.tp, i0: x.t0 ?? S.i, i1: end({ t0: x.t0 ?? S.i, w: x.w || boxW() }) }));
    if (S.pos) { const i0 = S.bars.findIndex((b) => b.t === S.pos.tIn); o.push({ k: "pos", kind: "pos", t: S.pos, dir: S.pos.dir, e: S.pos.e, sl: S.pos.sl, tp: S.pos.tp, i0, i1: end({ t0: i0, w: S.pos.w || boxW() }) }); }
    return o;
  }
  const objOf = (k) => (k && k.startsWith("dr:") ? { k, kind: "draw", t: S.draws[Number(k.slice(3))] } : objects().find((x) => x.k === k));
  // the price of an object's field (orders call their entry "price")
  const setF = (o, f, v) => { if (o.kind === "ord" && f === "e") o.t.price = v; else o.t[f] = v; };

  let PW = 400;
  function pill(x, y, text, bg, anchor = "middle") {
    const w = text.length * 6.3 + 14, x0 = Math.max(2, Math.min(PW - w - 2, anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x)); // stays on screen
    return `<rect x="${x0}" y="${y - 10}" width="${w}" height="20" rx="4" fill="${bg}"/><text x="${x0 + w / 2}" y="${y + 4}" text-anchor="middle" class="tl">${esc(text)}</text>`;
  }
  function drawTools() {
    const svg = $("#simTools"), tb = $("#simTB"); if (!svg || !S || !series) return;
    if (S.reviewing) { if (svg.__last) { svg.__last = ""; svg.innerHTML = ""; tb.innerHTML = ""; tb.__last = ""; } return; }
    const W = (PW = chart.timeScale().width()), Y = (p) => series.priceToCoordinate(p), H = $("#simChart").clientHeight;
    let back = "", front = "", bar = "";
    if (S.view.seps && S.view.tf < 1440 && S.D) { // a dashed line where each trading day starts (18:00 New York)
      const ts = chart.timeScale(), vr = ts.getVisibleLogicalRange(), G = S.D.g;
      if (vr) for (let gi = Math.max(1, Math.floor(vr.from)); gi <= Math.min(G.length - 1, Math.ceil(vr.to)); gi++) {
        if (S.bars[G[gi].i0].cme === S.bars[G[gi - 1].i0].cme) continue;
        const x = ts.logicalToCoordinate(gi - 0.5); if (x != null) back += `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="#9598a1" stroke-opacity=".7" stroke-dasharray="4 4"/>`;
      }
    }
    // your lines, rectangles and trend lines
    S.draws.forEach((d, n) => {
      const k = `dr:${n}`, sel = S.sel === k;
      if (d.type === "h") {
        const y = Y(d.p); if (y == null) return;
        back += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#f0b90b" stroke-width="${sel ? 2 : 1.5}"/><text x="${W - 6}" y="${y - 5}" text-anchor="end" class="tt" fill="#f0b90b">${fmt(d.p)}</text>`;
        front += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="hit" data-k="${k}" data-f="body"/>`;
        if (sel) front += `<rect x="${W / 2 - 6}" y="${y - 6}" width="12" height="12" class="h" data-k="${k}" data-f="body"/>`;
      } else {
        const x1 = L2X(d.i1), x2 = L2X(d.i2), y1 = Y(d.p1), y2 = Y(d.p2);
        if ([x1, x2, y1, y2].some((v) => v == null)) return;
        if (d.type === "r") {
          back += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="#9598a1" fill-opacity=".18" stroke="#9598a1" stroke-width="${sel ? 2 : 1}"/>`;
          front += `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" class="body" data-k="${k}" data-f="body"/>`;
        } else {
          back += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2962ff" stroke-width="${sel ? 2.5 : 2}"/>`;
          front += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="hit" data-k="${k}" data-f="body"/>`;
        }
        if (sel) front += `<circle cx="${x1}" cy="${y1}" r="6" class="h" data-k="${k}" data-f="a"/><circle cx="${x2}" cy="${y2}" r="6" class="h" data-k="${k}" data-f="b"/>`;
      }
    });
    if (S.pend) { // first corner of a rectangle / trend line, waiting for the second tap
      const x = L2X(S.pend.i), y = Y(S.pend.p), c = S.hover;
      if (x != null && y != null) {
        back += `<circle cx="${x}" cy="${y}" r="4" fill="#2962ff"/>`;
        if (c) back += S.mode === "r" ? `<rect x="${Math.min(x, c.x)}" y="${Math.min(y, c.y)}" width="${Math.abs(c.x - x)}" height="${Math.abs(c.y - y)}" fill="#9598a1" fill-opacity=".15" stroke="#9598a1" stroke-dasharray="4 3"/>` : `<line x1="${x}" y1="${y}" x2="${c.x}" y2="${c.y}" stroke="#2962ff" stroke-width="2" stroke-dasharray="4 3"/>`;
      }
    }
    // long / short positions, pending orders and the open trade
    for (const o of objects()) {
      const ye = Y(o.e), ys = Y(o.sl), yt = o.tp != null ? Y(o.tp) : null;
      let x0 = L2X(o.i0), x1 = L2X(o.i1);
      if (ye == null || ys == null || x0 == null || x1 == null) continue;
      x1 = Math.min(x1, W); if (x1 - x0 < 24) x0 = x1 - 24;
      const bw = x1 - x0, sel = S.sel === o.k, a = o.kind === "tool" ? 1 : 0.75;
      const r = Math.abs(o.e - o.sl), qty = o.t.qty || contracts(r) || 1, pct = (d) => ((d / o.e) * 100).toFixed(3);
      if (yt != null) back += `<rect x="${x0}" y="${Math.min(ye, yt)}" width="${bw}" height="${Math.abs(yt - ye)}" fill="${PROFIT}" fill-opacity="${0.22 * a}"/>`;
      back += `<rect x="${x0}" y="${Math.min(ye, ys)}" width="${bw}" height="${Math.abs(ys - ye)}" fill="${LOSS}" fill-opacity="${0.3 * a}"/>`;
      back += `<line x1="${x0}" x2="${x1}" y1="${ye}" y2="${ye}" stroke="${ENTRY}" stroke-width="1.5" ${o.kind === "ord" ? 'stroke-dasharray="5 3"' : ""}/>`;
      if (o.kind === "pos") { const yc = Y(S.bars[S.i].c); if (yc != null) back += `<line x1="${x0}" x2="${x1}" y1="${yc}" y2="${yc}" stroke="${o.dir * (S.bars[S.i].c - o.e) >= 0 ? PROFIT : LOSS}" stroke-width="1" stroke-dasharray="2 2"/>`; }
      // labels like TradingView: distance (percent) ticks, $ amount · and the risk/reward in the middle
      const mx = x0 + bw / 2, d = (p) => Math.abs(p - o.e);
      if (sel || o.kind !== "tool" || bw > 170) {
        if (yt != null) front += pill(mx, yt + (o.dir > 0 ? -14 : 14), sel ? `Target ${fmt(d(o.tp))} (${pct(d(o.tp))}%) ${Math.round(d(o.tp) / tick())} · ${money(d(o.tp) * S.P.pv * qty)}` : `${fmt(d(o.tp))} · ${money(d(o.tp) * S.P.pv * qty)}`, PROFIT);
        front += pill(mx, ys + (o.dir > 0 ? 14 : -14), sel ? `Stop ${fmt(r)} (${pct(r)}%) ${Math.round(r / tick())} · ${money(r * S.P.pv * qty)}` : `${fmt(r)} · ${money(r * S.P.pv * qty)}`, LOSS);
      }
      const mid = o.kind === "ord" ? `${o.dir > 0 ? "Buy" : "Sell"} ${o.t.type} ${o.t.qty || ""} ${S.P.sym}` : o.kind === "pos" ? `${o.dir > 0 ? "Long" : "Short"} ${o.t.qty || ""} · ${money(o.dir * (S.bars[S.i].c - o.e) * S.P.pv * (o.t.qty || 1)).replace("$-", "−$")}` : `${o.tp != null ? (d(o.tp) / r).toFixed(2) : "—"} R:R · ${qty} ${S.P.sym}`;
      front += pill(mx, ye, mid, o.kind === "pos" ? (o.dir * (S.bars[S.i].c - o.e) >= 0 ? PROFIT : LOSS) : "#50535e");
      // touch areas: the whole box (move it) — the handles on top
      front += `<rect x="${x0}" y="${Math.min(ys, yt ?? ys, ye)}" width="${bw}" height="${Math.abs((yt ?? ye) - ys) || 6}" class="body" data-k="${o.k}" data-f="${o.kind === "pos" ? "none" : "body"}"/>`;
      front += `<line x1="${x0}" x2="${x1}" y1="${ys}" y2="${ys}" class="hit" data-k="${o.k}" data-f="sl"/>`;
      if (yt != null) front += `<line x1="${x0}" x2="${x1}" y1="${yt}" y2="${yt}" class="hit" data-k="${o.k}" data-f="tp"/>`;
      if (sel) {
        front += `<rect x="${x0 - 6}" y="${ys - 6}" width="12" height="12" class="h" data-k="${o.k}" data-f="sl"/>`;
        if (yt != null) front += `<rect x="${x0 - 6}" y="${yt - 6}" width="12" height="12" class="h" data-k="${o.k}" data-f="tp"/>`;
        if (o.kind !== "pos") front += `<circle cx="${x0}" cy="${ye}" r="7" class="h" data-k="${o.k}" data-f="body"/>`;
        if (o.kind === "tool") front += `<rect x="${x1 - 6}" y="${ye - 6}" width="12" height="12" class="h" data-k="${o.k}" data-f="w"/>`;
      }
    }
    // the little toolbar over whatever is selected (like TradingView's)
    const so = S.sel && objOf(S.sel);
    if (so && so.t) {
      let y = 8, x = 8;
      if (so.kind === "draw") { const d = so.t, yy = Y(d.type === "h" ? d.p : Math.min(d.p1, d.p2)); y = yy; x = d.type === "h" ? W / 2 - 60 : L2X(Math.min(d.i1, d.i2)) ?? 8; }
      else { y = Math.min(Y(so.sl) ?? 0, so.tp != null ? Y(so.tp) ?? 0 : 1e9, Y(so.e) ?? 0); x = L2X(so.i0) ?? 8; }
      const cw = $("#simChart").clientWidth, btns = so.kind === "tool"
        ? `<button data-s="tk" data-a="${so.k}" class="go ${so.dir > 0 ? "buy" : "sell"}">${kindOf(so.t) === "market" ? (so.dir > 0 ? "Buy" : "Sell") : `${kindOf(so.t) === "limit" ? "Limit" : "Stop"} order`}…</button><button data-s="clone" data-a="${so.k}" title="Clone">⧉</button><button data-s="rev" data-a="${so.k}" title="Reverse">⇅</button>`
        : so.kind === "ord" ? `<button data-s="tk" data-a="${so.k}" class="go">Edit order…</button>`
        : so.kind === "pos" ? `<button data-s="be" ${so.t.beAt != null ? "disabled" : ""}>🛡️ Stop to entry</button><button data-s="closepos" class="go sell">Close</button>` : "";
      bar = `<div class="tv-sel" style="left:${Math.max(4, Math.min(x, cw - 230))}px;top:${Math.max(48, Math.min(y - 64, H - 90))}px">${btns}<button data-s="menu" data-a="${so.k}" title="More">⋯</button>${so.kind === "pos" ? "" : `<button data-s="del" data-a="${so.k}" title="${so.kind === "ord" ? "Cancel order" : "Remove"}">🗑</button>`}</div>`;
    }
    const html = back + front;
    if (html !== svg.__last) { svg.__last = html; svg.innerHTML = html; }
    if (bar !== tb.__last) { tb.__last = bar; tb.innerHTML = bar; }
  }

  // tap = select · drag = move · press and hold (or right-click) = menu
  function pointerDown(ev) {
    const h = ev.target.closest("[data-k]"); if (!h || !S || S.reviewing || ev.button > 0) return; // right-click → the menu (onContext)
    ev.preventDefault(); ev.stopPropagation();
    const k = h.dataset.k, f = h.dataset.f, o = objOf(k); if (!o || !o.t) return;
    if (S.mode) { S.mode = null; S.pend = null; modeUi(); }
    const box = $("#simChart").getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
    const p0 = series.coordinateToPrice(y0 - box.top), l0 = X2L(x0 - box.left);
    const st = JSON.parse(JSON.stringify(o.t));
    let moved = false, held = false;
    const t0 = o.t;
    const timer = setTimeout(() => { if (!moved) { held = true; S.sel = k; openMenu(k, x0, y0); } }, 520);
    const freeze = () => { chart.applyOptions({ handleScroll: false, handleScale: false }); const a1 = series.coordinateToPrice(0), a2 = series.coordinateToPrice(box.height - 30); if (a1 != null && a2 != null) S.freeze = { minValue: Math.min(a1, a2), maxValue: Math.max(a1, a2) }; };
    const move = (e) => {
      if (held) return;
      if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
      if (!moved) { moved = true; clearTimeout(timer); S.sel = k; closeMenu(); if (t0.lock) return; freeze(); }
      if (t0.lock) return;
      const p = series.coordinateToPrice(e.clientY - box.top); if (p == null || p0 == null) return;
      const dp = p - p0, dl = X2L(e.clientX - box.left) - l0, t = o.t;
      if (o.kind === "draw") {
        if (t.type === "h") t.p = snap(st.p + dp);
        else if (f === "a") { t.i1 = st.i1 + dl; t.p1 = snap(st.p1 + dp); }
        else if (f === "b") { t.i2 = st.i2 + dl; t.p2 = snap(st.p2 + dp); }
        else { t.i1 = st.i1 + dl; t.i2 = st.i2 + dl; t.p1 = onTick(st.p1 + dp); t.p2 = onTick(st.p2 + dp); }
        return;
      }
      const dir = o.dir, e0 = o.kind === "ord" ? st.price : st.e;
      if (f === "body") {
        if (o.kind === "pos") return;
        const ne = snap(e0 + dp, [S.bars[S.i].c]), d = ne - e0;
        setF(o, "e", ne); t.sl = onTick(st.sl + d); if (st.tp != null) t.tp = onTick(st.tp + d);
        if (o.kind === "tool") t.t0 = st.t0 + dl;
      } else if (f === "w") t.w = Math.max(4, st.w + dl);
      else if (f === "sl") {
        const nv = snap(st.sl + dp), ee = o.kind === "pos" ? t.e : e0;
        if (dir * (ee - nv) > 0 || (o.kind === "pos" && t.tp != null && dir * (nv - ee) < Math.abs(t.tp - ee))) t.sl = nv; // a trade's stop may go past entry (locking profit)
      } else if (f === "tp" && st.tp != null) {
        const ee = o.kind === "pos" ? t.e : e0, s0 = o.kind === "pos" ? t.sl0 : t.sl, r = Math.abs(ee - s0);
        const nv = snap(st.tp + dp, [1, 1.5, 2, 2.5, 3, 4, 5].map((m) => ee + dir * m * r));
        if (dir * (nv - ee) > 0) t.tp = nv;
      }
      drawLines(); if (o.kind !== "tool") panel();
    };
    const up = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      chart.applyOptions({ handleScroll: true, handleScale: true });
      S.freeze = null;
      S.justDragged = true; setTimeout(() => { if (S) S.justDragged = false; }, 250);
      if (!moved && !held) { S.sel = k; closeMenu(); }
      if (held) { S.keepMenu = true; setTimeout(() => { if (S) S.keepMenu = false; }, 150); }
      if (moved && o.kind === "pos") { // stop to entry (or past it) = break-even; further away = a rule break the review will flag
        const p = S.pos; if (!p) return;
        const r0 = Math.abs(p.e - p.sl0);
        if (p.beAt == null && p.dir * (p.sl - p.e) >= -r0 * 0.05) { p.beAt = (p.dir * (S.bars[S.i].c - p.e)) / r0; toast("Stop at break-even."); }
        if (p.dir * (p.sl0 - p.sl) > r0 * 0.05) p.widened = true;
        if (p.tp != null && p.tp0 != null && p.dir * (p.tp - p.tp0) > r0 * 0.05) p.tpMoved = true;
      }
      panel(); drawLines();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  }
  function onContext(ev) {
    const h = ev.target.closest("[data-k]"); if (!h || !S) return;
    ev.preventDefault();
    S.sel = h.dataset.k; openMenu(h.dataset.k, ev.clientX, ev.clientY);
  }

  // ---------- the press-and-hold menu
  function openMenu(k, cx, cy) {
    closeMenu();
    const o = objOf(k); if (!o || !o.t) return;
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    S.keepMenu = true; setTimeout(() => { if (S) S.keepMenu = false; }, 700); // the click that ends the long press mustn't close it
    const it = (s, label, icon = "", cls = "") => `<button data-s="${s}" data-a="${k}" class="${cls}"><i>${icon}</i>${label}</button>`, hr = "<hr>";
    let html = "";
    if (o.kind === "tool") {
      const type = kindOf(o.t), buy = o.dir > 0;
      html = (type === "market" ? "" : it("tk", `Create ${type} order…`, "⊕", "strong")) + it("tkm", `${buy ? "Buy" : "Sell"} at market…`, buy ? "▲" : "▼") + hr
        + it("clone", "Clone", "⧉") + it("rev", "Reverse", "⇅") + it("lock", o.t.lock ? "Unlock" : "Lock", o.t.lock ? "🔓" : "🔒") + hr + it("del", "Remove", "🗑", "bad");
    } else if (o.kind === "ord") html = it("tk", "Edit order…", "✎", "strong") + it("del", "Cancel order", "✕", "bad");
    else if (o.kind === "pos") html = (o.t.beAt == null ? it("be", "Move stop to entry", "🛡️") : "") + it("closepos", "Close position", "✕", "bad");
    else html = it("del", "Remove", "🗑", "bad") + it("delall", "Remove all drawings", "🧹", "bad");
    const m = document.createElement("div");
    m.id = "tvMenu"; m.className = "tv-menu"; m.innerHTML = html;
    $("#sim").appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(6, Math.min(cx, innerWidth - r.width - 6))}px`;
    m.style.top = `${Math.max(6, Math.min(cy, innerHeight - r.height - 6))}px`;
  }
  function closeMenu() { const m = $("#tvMenu"); if (m) m.remove(); }

  // ---------- order ticket (like TradingView's): Market / Limit / Stop · risk in $ ⇄ contracts · take profit and stop loss
  function openTicket(k, market = false) {
    closeMenu();
    const o = k ? objOf(k) : null, b = S.bars[S.i];
    let t;
    if (o && o.kind === "tool") t = { from: k, dir: o.dir, type: market ? "market" : kindOf(o.t), price: o.e, sl: o.sl, tp: o.tp, t0: o.t.t0, w: o.t.w };
    else if (o && o.kind === "ord") t = { edit: Number(k.split(":")[1]), dir: o.dir, type: o.t.type, price: o.t.price, sl: o.sl, tp: o.tp, qty: o.t.qty, t0: o.t.t0, w: o.t.w };
    else { const e = b.c, dir = 1, sl = onTick(e - hourAtr()); t = { dir, type: "market", price: onTick(e), sl, tp: onTick(e + S.P.tpR * (e - sl)), t0: S.i, w: boxW() }; }
    const fx = (v) => (v == null || !Number.isFinite(Number(v)) ? v : Number(v).toFixed(S.P.dec));
    t.price = fx(t.price); t.sl = fx(t.sl); t.tp = fx(t.tp);
    S.tk = { ...t, slOn: true, tpOn: t.tp != null, by: "usd", usd: riskUSD() };
    if (S.tk.qty) S.tk.by = "qty";
    else S.tk.qty = Math.max(1, contracts(Math.abs(S.tk.price - S.tk.sl)));
    stop(); renderTicket();
  }
  function closeTicket() { const el = $("#tvTicket"); if (el) el.remove(); if (S) S.tk = null; }
  function tkCalc() {
    const k = S.tk, q = quote(), e = k.type === "market" ? (k.dir > 0 ? q.ask : q.bid) : Number(k.price);
    const r = k.slOn ? Math.abs(e - Number(k.sl)) : 0;
    const qty = k.by === "usd" ? contracts(r, Number(k.usd)) : Math.max(0, Math.floor(Number(k.qty) || 0));
    const usd = qty * r * S.P.pv;
    let err = "";
    if (!Number.isFinite(e)) err = "Set a price.";
    else if (!k.slOn) err = "Practice trades need a stop loss — it's how Edge measures R.";
    else if (!Number.isFinite(Number(k.sl)) || k.dir * (e - Number(k.sl)) <= 0) err = k.dir > 0 ? "For a buy, the stop goes below the price." : "For a sell, the stop goes above the price.";
    else if (k.tpOn && (!Number.isFinite(Number(k.tp)) || k.dir * (Number(k.tp) - e) <= 0)) err = "The take profit must be on the profit side.";
    else if (k.type === "stop" && k.dir * (e - S.bars[S.i].c) <= 0) err = `A ${k.dir > 0 ? "buy" : "sell"} stop goes ${k.dir > 0 ? "above" : "below"} the price now — use Limit or Market.`;
    else if (k.type === "limit" && k.dir * (e - S.bars[S.i].c) >= 0) err = `A ${k.dir > 0 ? "buy" : "sell"} limit goes ${k.dir > 0 ? "below" : "above"} the price now — use Stop or Market.`;
    else if (!qty) err = `1 ${S.P.sym} risks ${money(r * S.P.pv)} with this stop — more than ${money(Number(k.usd) || 0)}. Tighten the stop or risk more.`;
    return { e, r, qty, usd, err, q };
  }
  function renderTicket() {
    const k = S.tk; if (!k) return;
    let el = $("#tvTicket");
    if (!el) { el = document.createElement("div"); el.id = "tvTicket"; el.className = "tv-tk-wrap"; $("#sim").appendChild(el); el.addEventListener("input", tkInput); }
    const { q } = tkCalc(), P = S.P, buy = k.dir > 0;
    const tog = (name, on) => `<button class="tv-tog ${on ? "on" : ""}" data-s="tktog" data-a="${name}" role="switch" aria-checked="${on}"><i></i></button>`;
    el.innerHTML = `<div class="tv-tk ${buy ? "buy" : "sell"}">
      <div class="tv-tk-h"><b>${P.sym}</b><span class="muted">${P.name} · 1 pt = $${P.pv} · tick ${tick()} = $${(tick() * P.pv).toFixed(2)}</span><button class="sim-x" data-s="tkclose" aria-label="Close">✕</button></div>
      <div class="tv-bs"><button data-s="tkdir" data-a="-1" class="sell ${!buy ? "on" : ""}"><small>Sell</small><b>${fmt(q.bid)}</b></button><span class="spr">${Math.round((q.ask - q.bid) / tick())}</span><button data-s="tkdir" data-a="1" class="buy ${buy ? "on" : ""}"><small>Buy</small><b>${fmt(q.ask)}</b></button></div>
      <div class="tv-tabs">${["market", "limit", "stop"].map((t) => `<button data-s="tktype" data-a="${t}" class="${k.type === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
      <label class="tv-row" ${k.type === "market" ? "hidden" : ""}><span>Price</span><input data-tk="price" inputmode="decimal" value="${k.type === "market" ? "" : esc(k.price)}"><small id="tkPx"></small></label>
      <div class="tv-row"><span>${k.by === "usd" ? "Risk $" : "Contracts"}</span><input data-tk="${k.by === "usd" ? "usd" : "qty"}" inputmode="decimal" value="${esc(k.by === "usd" ? k.usd : k.qty)}"><button class="tv-swap" data-s="tkby" title="Switch between risk in $ and contracts">⇄</button><small id="tkOther"></small></div>
      <div class="tv-info" id="tkInfo"></div>
      <div class="tv-ex"><b>Exits</b>
        <div class="tv-row">${tog("tpOn", k.tpOn)}<span>Take profit</span><input data-tk="tp" inputmode="decimal" value="${esc(k.tp ?? "")}" ${k.tpOn ? "" : "disabled"}><small id="tkTp"></small></div>
        <div class="tv-row">${tog("slOn", k.slOn)}<span>Stop loss</span><input data-tk="sl" inputmode="decimal" value="${esc(k.sl)}" ${k.slOn ? "" : "disabled"}><small id="tkSl"></small></div></div>
      <p class="tv-err" id="tkErr"></p>
      <button class="tv-go ${buy ? "buy" : "sell"}" data-s="tkgo" id="tkGo"></button></div>`;
    tkSync();
  }
  function tkInput(ev) {
    const f = ev.target.dataset.tk; if (!f || !S.tk) return;
    S.tk[f] = ev.target.value;
    tkSync();
  }
  // update the numbers without redrawing the inputs (so typing isn't interrupted)
  function tkSync() {
    const k = S.tk, el = $("#tvTicket"); if (!k || !el) return;
    const c = tkCalc(), P = S.P, set = (id, h) => { const x = $(id, el); if (x) x.innerHTML = h; };
    const tks = (p) => Math.round(Math.abs(Number(p) - c.e) / tick());
    set("#tkPx", k.type === "market" ? "" : `${k.dir > 0 ? "Ask" : "Bid"} ${Number(k.price) > (k.dir > 0 ? c.q.ask : c.q.bid) ? "+" : "−"} ${Math.round(Math.abs(Number(k.price) - (k.dir > 0 ? c.q.ask : c.q.bid)) / tick())} ticks`);
    set("#tkOther", k.by === "usd" ? `${c.qty} ${P.sym}` : `${money(c.usd)} risk`);
    set("#tkInfo", `<span>Risk <b>${money(c.usd)}</b></span><span>Per contract <b>${money(c.r * P.pv)}</b></span><span>Reward <b>${k.tpOn && Number.isFinite(Number(k.tp)) ? money(Math.abs(Number(k.tp) - c.e) * P.pv * c.qty) : "—"}</b></span><span>R:R <b>${k.tpOn && c.r ? (Math.abs(Number(k.tp) - c.e) / c.r).toFixed(2) : "—"}</b></span>`);
    set("#tkTp", k.tpOn ? `${tks(k.tp)} ticks` : "");
    set("#tkSl", k.slOn ? `${tks(k.sl)} ticks` : "");
    set("#tkErr", esc(c.err) + (c.err && !c.qty && c.r > 0 && /more than/.test(c.err) ? ` <button class="btn small" data-s="tkone">Use 1 ${P.sym} (${money(c.r * P.pv)})</button>` : ""));
    const go = $("#tkGo", el);
    go.disabled = !!c.err;
    go.innerHTML = `${k.edit != null ? "Modify" : k.dir > 0 ? "Buy" : "Sell"} ${c.qty} ${P.sym} @ ${fmt(c.e)} ${k.type.toUpperCase()}`;
    // show the ticket's levels on the chart while you type
    S.tkLines = { e: c.e, sl: k.slOn ? Number(k.sl) : null, tp: k.tpOn ? Number(k.tp) : null };
    drawLines();
  }
  function submitTicket() {
    const k = S.tk, c = tkCalc(); if (c.err) return toast(c.err);
    const lock = locked(); if (lock && k.edit == null) return toast(lock);
    const sl = Number(k.sl), tp = k.tpOn ? Number(k.tp) : null, b = S.bars[S.i];
    if (k.by === "usd") try { localStorage.setItem("edge.riskUSD", String(Number(k.usd))); } catch {}
    if (k.type === "market") {
      if (S.pos) return toast("You're already in a trade — close it first.");
      openPos(k.dir, c.e, sl, tp, b, c.qty);
    } else {
      const ord = { side: k.dir, type: k.type, price: c.e, sl, tp, qty: c.qty, t0: k.t0 ?? S.i, w: k.w || boxW() };
      if (k.edit != null) S.orders[k.edit] = ord; else S.orders.push(ord);
      toast(`${k.edit != null ? "Order modified" : `${k.dir > 0 ? "Buy" : "Sell"} ${k.type} placed`} — ${c.qty} ${S.P.sym} @ ${fmt(c.e)}. Step forward.`);
    }
    if (k.from) { S.tools.splice(Number(k.from.split(":")[1]), 1); }
    S.sel = null; S.tkLines = null;
    closeTicket(); panel(); markers(); drawLines();
  }
  function clone(k) {
    const o = objOf(k); if (!o || !o.t) return;
    if (o.kind === "draw") { const d = { ...o.t }; if (d.type === "h") d.p = onTick(d.p + hourAtr() / 2); else { d.i1 += 6; d.i2 += 6; } S.draws.push(d); S.sel = `dr:${S.draws.length - 1}`; return; }
    if (o.kind !== "tool") return;
    S.tools.push({ ...o.t, lock: false, t0: fit(o.t.t0 + o.t.w + 2, o.t.w) }); S.sel = `tool:${S.tools.length - 1}`; panel();
  }
  function reverse(k) { // flip a long into a short (stop and target swap sides)
    const o = objOf(k); if (!o || o.kind !== "tool") return;
    const t = o.t, r = t.e - t.sl, rw = t.tp - t.e;
    t.dir = -t.dir; t.sl = onTick(t.e + r); t.tp = onTick(t.e - rw);
    panel();
  }
  function remove(k) {
    if (!k) return;
    if (k.startsWith("tool:")) S.tools.splice(Number(k.slice(5)), 1);
    else if (k.startsWith("ord:")) { S.orders.splice(Number(k.slice(4)), 1); toast("Order cancelled."); }
    else if (k.startsWith("dr:")) S.draws.splice(Number(k.slice(3)), 1);
    S.sel = null; closeMenu(); panel(); drawLines();
  }
  // the floating drawing toolbar
  const ICON = {
    long: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="9" fill="${PROFIT}" opacity=".55"/><rect x="4" y="13" width="16" height="7" fill="${LOSS}" opacity=".6"/><path d="M4 13h16" stroke="currentColor" stroke-width="1.6"/></svg>`,
    short: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="7" fill="${LOSS}" opacity=".6"/><rect x="4" y="11" width="16" height="9" fill="${PROFIT}" opacity=".55"/><path d="M4 11h16" stroke="currentColor" stroke-width="1.6"/></svg>`,
    h: `<svg viewBox="0 0 24 24"><path d="M2 12h20" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
    r: `<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="4" cy="6" r="2" fill="currentColor"/><circle cx="20" cy="18" r="2" fill="currentColor"/></svg>`,
    t: `<svg viewBox="0 0 24 24"><path d="M5 19L19 5" stroke="currentColor" stroke-width="1.8"/><circle cx="5" cy="19" r="2.4" fill="currentColor"/><circle cx="19" cy="5" r="2.4" fill="currentColor"/></svg>`,
  };
  const toolbarHtml = () => `<div class="tv-tools" id="tvTools">
      <button data-s="mode" data-a="long" title="Long position (B)">${ICON.long}</button><button data-s="mode" data-a="short" title="Short position (S)">${ICON.short}</button><i></i>
      <button data-s="mode" data-a="h" title="Horizontal line (H)">${ICON.h}</button><button data-s="mode" data-a="r" title="Rectangle — mark a zone (R)">${ICON.r}</button><button data-s="mode" data-a="t" title="Trend line (T)">${ICON.t}</button><i></i>
      <button data-s="plan" id="simPlanBtn" title="Draw the London plan (P)" hidden>✨</button><button data-s="clearall" title="Remove all drawings">🗑</button></div><div class="tv-hint" id="tvHint" hidden></div>`;
  const HINT = { long: "Tap where you want to buy", short: "Tap where you want to sell", h: "Tap a price for the line", r: "Tap one corner of the zone", t: "Tap where the line starts" };
  function modeUi() {
    document.querySelectorAll('#tvTools [data-s="mode"]').forEach((b) => b.classList.toggle("on", b.dataset.a === (S && S.mode)));
    const h = $("#tvHint"); if (!h) return;
    h.hidden = !(S && S.mode); if (S && S.mode) h.textContent = S.pend ? (S.mode === "r" ? "Now tap the opposite corner" : "Now tap where it ends") : HINT[S.mode];
    const c = $("#simChart"); if (c) c.classList.toggle("arming", !!(S && S.mode));
  }
  function setMode(m) { S.mode = S.mode === m ? null : m; S.pend = null; S.sel = null; closeMenu(); modeUi(); }
  // a tap on the chart: draw with the chosen tool, otherwise deselect
  function chartTap(x, y) {
    const price = series.coordinateToPrice(y); if (price == null) return;
    const idx = X2L(x), m = S.mode;
    if (!m) { if (S.sel) { S.sel = null; closeMenu(); } return; }
    if (m === "long" || m === "short") { addTool(m === "long" ? 1 : -1, price, Math.min(idx, S.i + 5)); S.mode = null; }
    else if (m === "h") { S.draws.push({ type: "h", p: snap(price) }); S.sel = `dr:${S.draws.length - 1}`; S.mode = null; }
    else if (!S.pend) S.pend = { i: idx, p: snap(price) };
    else { S.draws.push({ type: m, i1: S.pend.i, p1: S.pend.p, i2: idx, p2: snap(price) }); S.sel = `dr:${S.draws.length - 1}`; S.pend = null; S.mode = null; }
    modeUi();
  }

  // annotations drawn over the chart (boxes, levels, markers) during a review
  function drawOverlay() {
    const svg = $("#simOv"); if (!svg || !S || !chart) return;
    const items = S.reviewing ? S.reviewing.items[S.reviewing.k].ann : [];
    const X = (t) => L2X(idxOf(t)), Y = (p) => series.priceToCoordinate(p);
    const w = svg.clientWidth;
    const html = items.map((a) => {
      if (a.type === "box") {
        const x1 = X(a.t1) ?? 0, x2 = X(a.t2) ?? w - 60, y1 = Y(a.p1), y2 = Y(a.p2);
        if (y1 == null || y2 == null) return "";
        return `<rect class="ann" x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.max(4, Math.abs(x2 - x1))}" height="${Math.max(3, Math.abs(y2 - y1))}" rx="3" fill="${a.color}" fill-opacity=".18" stroke="${a.color}" stroke-width="1.5"/><text x="${Math.min(x1, x2) + 4}" y="${Math.min(y1, y2) - 5}" fill="${a.color}" class="annt">${esc(a.label)}</text>`;
      }
      if (a.type === "hline") { const y = Y(a.p); if (y == null) return ""; return `<line class="ann" x1="0" x2="${w - 60}" y1="${y}" y2="${y}" stroke="${a.color}" stroke-width="2" ${a.dash ? 'stroke-dasharray="5 4"' : ""}/><text x="8" y="${y - 5}" fill="${a.color}" class="annt">${esc(a.label)}</text>`; }
      if (a.type === "marker") { const x = X(a.t), y = Y(a.p); if (x == null || y == null) return ""; return `<circle class="ann pulse" cx="${x}" cy="${y}" r="9" fill="none" stroke="${a.color}" stroke-width="2.5"/><text x="${x + 12}" y="${y + 4}" fill="${a.color}" class="annt">${esc(a.label)}</text>`; }
      return "";
    }).join("");
    if (html !== svg.__last) { svg.__last = html; svg.innerHTML = html; } // redraw only when something moved
  }

  // ---------- replay engine
  function step() {
    if (!S || S.reviewing) return false;
    const nx = S.i + 1, b = S.bars[nx];
    if (!b || b.cme !== S.day || (b.min >= FLAT && b.min < 18 * 60)) { endSession(); return false; }
    S.i = nx;
    const g = dispAdd(nx); series.update(barOf(g));
    for (const e of emaSeries) e.s.update({ time: g.t / 1000, value: g.ema[e.p] });
    const prev = S.bars[nx - 1];
    if (S.orders.length && inWins(S.P, prev.min) && !inWins(S.P, b.min) && prev.min < 18 * 60) { S.orders = []; toast("Window closed — your orders were cancelled, as the plan says."); }
    fills(b);
    if (S.pos) manage(b);
    paintPnl(); checkRules();
    panel(); markers(); drawLines();
    return true;
  }
  function fills(b) {
    if (S.orders.length && locked()) { S.orders = []; toast("Orders cancelled — " + locked()); }
    for (const o of [...S.orders]) {
      let px = null;
      if (o.type === "stop") px = o.side > 0 ? (b.h >= o.price ? Math.max(o.price, b.o) : null) : (b.l <= o.price ? Math.min(o.price, b.o) : null);
      if (o.type === "limit") px = o.side > 0 ? (b.l <= o.price ? Math.min(o.price, b.o) : null) : (b.h >= o.price ? Math.max(o.price, b.o) : null);
      if (px == null) continue;
      S.orders = S.orders.filter((x) => x !== o);
      if (S.pos) {
        if (S.pos.dir !== o.side) { S.pos.otherFilled = true; exit(px, b, "your other order closed it"); toast("Your other order filled and closed the trade — cancel the other order when one fills!"); }
        else toast("A second order in the same direction was ignored.");
        continue;
      }
      openPos(o.side, px, o.sl, o.tp, b, o.qty);
      // stop hit inside the fill candle (conservative, like the tests)
      if (o.side > 0 ? b.l <= o.sl : b.h >= o.sl) exit(o.sl, b, "stop");
    }
  }
  function openPos(dir, e, sl, tp, b, qty = null) {
    S.pos = { dir, e, sl, sl0: sl, tp, tp0: tp, tIn: b.t, mfe: 0, beAt: null, second: S.trades.length > 0, qty: qty || Math.max(1, contracts(Math.abs(e - sl))) };
    S.sel = "pos";
    toast(`${dir > 0 ? "Bought" : "Sold"} ${S.pos.qty} ${S.P.sym} at ${fmt(e)}`);
  }
  function manage(b) {
    const p = S.pos, r0 = Math.abs(p.e - p.sl0);
    if (b.t === p.tIn) return;
    const hitSL = p.dir > 0 ? b.l <= p.sl : b.h >= p.sl, hitTP = p.tp != null && (p.dir > 0 ? b.h >= p.tp : b.l <= p.tp);
    if (hitSL) return exit(p.dir > 0 ? Math.min(p.sl, b.o) : Math.max(p.sl, b.o), b, Math.abs(p.sl - p.e) < r0 * 0.05 ? "break-even" : "stop");
    if (hitTP) return exit(p.tp, b, "target");
    p.mfe = Math.max(p.mfe, (p.dir * ((p.dir > 0 ? b.h : b.l) - p.e)) / r0);
    if (p.mfe >= S.P.beR && !p.beAt && !p.beHinted) { p.beHinted = true; toast(`+${S.P.beR}R — the plan says: move your stop to entry now.`); }
  }
  function exit(px, b, how) {
    const p = S.pos, r0 = Math.abs(p.e - p.sl0);
    const gross = p.dir * (px - p.e) * S.P.pv * (p.qty || 1), fee = acct().fee * (p.qty || 1);
    const tr = { ...p, x: px, tOut: b.t, how, R: (p.dir * (px - p.e)) / r0, usd: gross - fee, fee };
    book(tr);
    S.pos = null; S.trades.push(tr); if (S.sel === "pos") S.sel = null;
    tr.findings = review(S, tr);
    tr.rulesOk = !tr.findings.some((x) => x.rule);
    save(tr);
    stop();
    const ban = $("#simBanner");
    ban.hidden = false;
    ban.innerHTML = `<b>${tr.R > 0.1 ? "🎯" : tr.R < -0.1 ? "✋" : "🛡️"} Trade closed ${tr.R > 0 ? "+" : ""}${tr.R.toFixed(2)}R · ${tr.usd < 0 ? "−" : "+"}${money(Math.abs(tr.usd))}</b><span class="muted">${esc(how)}</span>
      <div class="row"><button class="btn small primary" data-s="review" data-a="${S.trades.length - 1}">🔍 Review this trade</button><button class="btn small" data-s="dismiss">Keep going ›</button></div>`;
    paintPnl();
    if (!S.ruleExit) checkRules();
  }
  function save(tr) {
    const P = S.P, out = tr.how === "target" || Math.abs(tr.R - P.tpR) < 0.1 ? "tp" : Math.abs(tr.R) < 0.1 ? "be" : tr.how === "stop" && tr.R <= -0.9 ? "sl" : "flat";
    const api = window.Edge && window.Edge.api;
    if (!api) return;
    const r0 = Math.abs(tr.e - tr.sl0), box = S.plan ? S.plan.hi - S.plan.lo : null;
    const style = { stopFrac: box ? +(r0 / box).toFixed(3) : null, tpR: tr.tp0 != null ? +((tr.dir * (tr.tp0 - tr.e)) / r0).toFixed(2) : null, beAt: tr.beAt != null ? +tr.beAt.toFixed(2) : null };
    api({ action: "backtestLog", strategy: P.strategy, market: S.market, dir: tr.dir > 0 ? "long" : "short", outcome: out, r: tr.R.toFixed(2), date: new Date(tr.tIn).toISOString().slice(0, 10), rulesOk: tr.rulesOk, style, note: `simulator · ${tr.findings.map((f) => f.title).join(" · ")}`.slice(0, 480) }).catch(() => {});
  }
  // ---------- your practice account: a balance that every win adds to and every loss takes from (kept on this device)
  const ACCT = "edge.sim.account";
  function acct() {
    let a = null; try { a = JSON.parse(localStorage.getItem(ACCT) || "null"); } catch {}
    if (!a || !(a.start > 0)) { const st = window.Edge && window.Edge.state && window.Edge.state(); const s0 = (st && st.settings && st.settings.accountSize) || 50000; a = { start: s0, balance: s0, fee: 0, peak: s0, log: [] }; }
    return a;
  }
  const saveAcct = (a) => { try { localStorage.setItem(ACCT, JSON.stringify(a)); } catch {} };
  function book(tr) {
    const a = acct();
    a.balance = +(a.balance + tr.usd).toFixed(2); a.peak = Math.max(a.peak || a.start, a.balance);
    a.log = [{ t: Date.now(), day: S.day, m: S.market, dir: tr.dir, qty: tr.qty || 1, usd: +tr.usd.toFixed(2), R: +tr.R.toFixed(2), bal: a.balance }, ...(a.log || [])].slice(0, 200);
    saveAcct(a);
  }
  const signed = (x) => `${x < -0.004 ? "−" : "+"}${money(Math.abs(x))}`;
  function paintPnl() {
    if (!S) return;
    const a = acct(), tot = S.trades.reduce((x, t) => x + t.R, 0), usd = S.trades.reduce((x, t) => x + t.usd, 0);
    const open = S.pos ? S.pos.dir * (S.bars[S.i].c - S.pos.e) * S.P.pv * (S.pos.qty || 1) : 0, bal = a.balance + open;
    const b = $("#simBal"), el = $("#simPnl"); if (!b || !el) return;
    b.textContent = money(bal); b.className = bal > a.start + 0.5 ? "good" : bal < a.start - 0.5 ? "bad" : "";
    el.textContent = S.trades.length || S.pos ? `${signed(usd + open)} today · ${tot > 0 ? "+" : ""}${tot.toFixed(2)}R` : "today: —";
    el.className = usd + open > 0.5 ? "good" : usd + open < -0.5 ? "bad" : "";
  }
  function openAcct() {
    stop();
    const a = acct(), pl = a.balance - a.start, dd = (a.peak || a.start) - a.balance, wins = (a.log || []).filter((x) => x.usd > 0).length;
    let el = $("#simAcct"); if (!el) { el = document.createElement("div"); el.id = "simAcct"; el.className = "tv-tk-wrap"; $("#sim").appendChild(el); el.addEventListener("click", (e) => { if (e.target === el) el.remove(); }); }
    el.innerHTML = `<div class="tv-tk">
      <div class="tv-tk-h"><b>Practice account</b><span class="muted">saved on this device</span><button class="sim-x" data-s="acctclose" aria-label="Close">✕</button></div>
      <div class="acct-big ${pl > 0.5 ? "good" : pl < -0.5 ? "bad" : ""}"><small>Balance</small><b>${money(a.balance)}</b><span>${signed(pl)} since you started (${((pl / a.start) * 100).toFixed(1)}%)</span></div>
      <div class="tv-info"><span>Trades <b>${(a.log || []).length}</b></span><span>Won <b>${(a.log || []).length ? Math.round((wins / a.log.length) * 100) + "%" : "—"}</b></span><span>Best <b>${money(a.peak || a.start)}</b></span><span>Down from best <b>${dd > 0.5 ? "−" + money(dd) : "$0"}</b></span></div>
      <label class="tv-row"><span>Start with $</span><input id="acctStart" inputmode="decimal" value="${a.start}"><small></small><small></small></label>
      <label class="tv-row"><span>Fees / contract</span><input id="acctFee" inputmode="decimal" value="${a.fee || 0}"><small>round trip</small><small></small></label>
      ${a.status === "failed" ? `<p class="tv-err">⛔ Failed: ${esc(a.failWhy || "max drawdown")}. Start over to try again.</p>` : a.status === "passed" ? `<p class="good" style="margin:0">🏆 Passed — profit target reached.</p>` : ""}
      ${rulesHtml(a)}
      <div class="row"><button class="btn small" data-s="acctsave">Save</button><button class="btn small danger" data-s="acctreset">Start over at $${Number(a.start).toLocaleString("en-US")}</button></div>
      ${(a.log || []).length ? `<div class="acct-log">${a.log.slice(0, 30).map((x) => `<div><span>${x.dir > 0 ? "▲" : "▼"} ${MK[x.m] ? MK[x.m].sym : x.m} ×${x.qty} <small class="muted">${new Date(x.day * 864e5).toLocaleDateString([], { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" })}</small></span><b class="${x.usd > 0 ? "good" : x.usd < 0 ? "bad" : ""}">${signed(x.usd)}</b><small class="muted">${money(x.bal)}</small></div>`).join("")}</div>` : `<p class="muted" style="margin:0">Your trades will show here, each one adding to or taking from the balance.</p>`}</div>`;
  }
  // ---------- prop-firm rules: daily loss limit, max drawdown (trailing or static), profit target, Edge's own day rules
  // "Typical" numbers are common evaluation sizes — change them to your firm's exact rules.
  const PRESETS = { "50k": { start: 50000, target: 3000, maxDD: 2000, daily: 1000 }, "100k": { start: 100000, target: 6000, maxDD: 3000, daily: 2000 }, "150k": { start: 150000, target: 9000, maxDD: 4500, daily: 3000 } };
  const rulesOf = (a) => ({ on: false, target: 0, maxDD: 0, ddType: "eod", daily: 0, stopR: 2, maxTrades: 0, ...(a.rules || {}) });
  function ruleState() {
    const a = acct(), r = rulesOf(a);
    const open = S && S.pos ? S.pos.dir * (S.bars[S.i].c - S.pos.e) * S.P.pv * (S.pos.qty || 1) : 0, eq = a.balance + open;
    const hwm = Math.max(a.hwm || a.start, r.ddType === "intraday" ? eq : 0);
    const floor = r.maxDD > 0 ? (r.ddType === "static" ? a.start - r.maxDD : Math.min(hwm - r.maxDD, a.start)) : -Infinity;
    const today = S ? eq - (S.dayStart ?? a.balance) : 0, dayR = S ? S.trades.reduce((x, t) => x + t.R, 0) : 0;
    return { a, r, eq, hwm, floor, today, dayR };
  }
  // why you can't open a new trade right now ("" = you can)
  function locked() {
    if (!S) return "";
    const { a, r } = ruleState();
    if (!r.on) return "";
    if (a.status === "failed") return "This account failed — open Balance → Start over.";
    if (S.dayLock) return S.dayLock;
    if (r.maxTrades > 0 && S.trades.length + (S.pos ? 1 : 0) >= r.maxTrades) return `That's ${r.maxTrades} trade${r.maxTrades > 1 ? "s" : ""} today — your limit. Done for the day.`;
    return "";
  }
  function flatten(why, px = null) { // close everything now, like the firm would (at the exact limit price when it's inside this candle)
    S.orders = []; S.tools = []; S.ruleExit = true;
    if (S.pos) { const b = S.bars[S.i]; exit(px != null ? px : b.c, b, why); }
    S.ruleExit = false; panel(); drawLines(); markers();
  }
  function ruleBanner(icon, title, text, cls = "") {
    stop();
    const ban = $("#simBanner"); ban.hidden = false;
    ban.innerHTML = `<b class="${cls}">${icon} ${esc(title)}</b><span class="muted">${esc(text)}</span><div class="row">${S.trades.length ? `<button class="btn small primary" data-s="review" data-a="${S.trades.length - 1}">🔍 Review the last trade</button>` : ""}<button class="btn small" data-s="end">End the session</button><button class="btn small" data-s="dismiss">OK</button></div>`;
  }
  function checkRules() {
    if (!S || S.ended) return;
    const st = ruleState(), { a, r } = st;
    if (!r.on) return;
    if (r.ddType === "intraday" && st.hwm > (a.hwm || a.start)) { a.hwm = st.hwm; saveAcct(a); }
    if (a.status === "failed") return;
    // the worst moment inside this candle, and the price where each limit is hit
    let worstEq = st.eq, liq = () => null;
    if (S.pos) {
      const p = S.pos, b = S.bars[S.i], q = (p.qty || 1) * S.P.pv, worst = p.dir > 0 ? b.l : b.h;
      worstEq = a.balance + p.dir * (worst - p.e) * q;
      liq = (eqAt) => { const px = p.e + (p.dir * (eqAt - a.balance)) / q; return p.dir > 0 ? Math.min(Math.max(px, b.l), b.h) : Math.max(Math.min(px, b.h), b.l); };
      st.eq = Math.min(st.eq, worstEq);
    }
    if (r.maxDD > 0 && st.eq <= st.floor + 0.01) {
      a.status = "failed"; a.failWhy = `Max drawdown: equity ${money(st.eq)} reached the ${money(st.floor)} floor`; saveAcct(a);
      flatten("max drawdown — account failed", liq(st.floor));
      return ruleBanner("⛔", "Account failed — max drawdown hit", `Your equity touched ${money(st.floor)}. In a real evaluation this account is over. Look at what led here, then Start over from Balance.`, "bad");
    }
    const todayWorst = st.today - (ruleState().eq - st.eq);
    if (!S.dayLock && r.daily > 0 && todayWorst <= -r.daily + 0.01) {
      S.dayLock = `Daily loss limit (${money(r.daily)}) hit — done for today.`;
      flatten("daily loss limit", liq((S.dayStart ?? a.balance) - r.daily));
      st.today = acct().balance - (S.dayStart ?? a.balance);
      return ruleBanner("🛑", "Daily loss limit hit — done for today", `You're down ${money(-st.today)} today. The firm closes you out here. Tomorrow is a new day.`, "bad");
    }
    if (!S.dayLock && r.stopR > 0 && !S.pos && st.dayR <= -r.stopR + 0.01) {
      S.dayLock = `Edge rule: stop after −${r.stopR}R in a day. Done for today.`; S.orders = []; S.tools = [];
      panel(); drawLines();
      return ruleBanner("🧘", `−${r.stopR}R today — Edge says stop`, "This is the rule that keeps a bad day from becoming a blown account. Close the chart and come back tomorrow.");
    }
    if (r.target > 0 && a.status !== "passed" && a.balance >= a.start + r.target && !S.pos) {
      a.status = "passed"; saveAcct(a);
      return ruleBanner("🏆", "Profit target reached — you passed!", `Balance ${money(a.balance)} (+${money(a.balance - a.start)}). Keep practising the same way — the next goal is staying consistent.`, "good");
    }
  }
  function endOfDay() { const a = acct(), r = rulesOf(a); if (r.on && r.ddType === "eod" && a.status !== "failed") { a.hwm = Math.max(a.hwm || a.start, a.balance); saveAcct(a); } }
  function ruleBar() {
    if (!S) return "";
    const st = ruleState(), { a, r } = st;
    if (!r.on) return "";
    if (a.status === "failed") return `<div class="rule-bar bad"><b>⛔ Account failed</b><button class="btn small" data-s="acct">Start over</button></div>`;
    const m = (label, left, tot) => { const p = tot > 0 ? Math.max(0, Math.min(1, left / tot)) : 1; return `<div class="rule-m ${p < 0.25 ? "bad" : p < 0.5 ? "warn" : ""}"><small>${label}</small><b>${money(Math.max(0, left))}</b><i style="width:${Math.round(p * 100)}%"></i></div>`; };
    return `<div class="rule-bar">${r.daily > 0 ? m("Daily loss left", r.daily + st.today, r.daily) : ""}${r.maxDD > 0 ? m("Drawdown left", st.eq - st.floor, r.maxDD) : ""}${r.target > 0 ? `<div class="rule-m good"><small>${a.status === "passed" ? "Target" : "To target"}</small><b>${a.status === "passed" ? "passed 🏆" : money(Math.max(0, a.start + r.target - a.balance))}</b><i style="width:${Math.round(Math.max(0, Math.min(1, (a.balance - a.start) / r.target)) * 100)}%"></i></div>` : ""}</div>${S.dayLock ? `<p class="sim-hint bad">🔒 ${esc(S.dayLock)}</p>` : ""}`;
  }
  function rulesHtml(a) {
    const r = rulesOf(a), num = (id, v, label, hint = "") => `<label class="tv-row"><span>${label}</span><input id="${id}" inputmode="decimal" value="${v || 0}"><small>${hint}</small><small></small></label>`;
    return `<div class="acct-rules"><div class="tv-row pk-seq"><button class="tv-tog ${r.on ? "on" : ""}" data-s="rulestog" role="switch" aria-checked="${r.on}"><i></i></button><span style="min-width:0"><b>Prop-firm rules</b> — practise like an evaluation</span></div>
      ${r.on ? `<div class="pk-row" style="grid-template-columns:repeat(3,1fr)">${Object.keys(PRESETS).map((k) => `<button data-s="rulepre" data-a="${k}">Typical ${k.toUpperCase()}</button>`).join("")}</div>
      ${num("rTarget", r.target, "Profit target $")}${num("rDD", r.maxDD, "Max drawdown $")}
      <div class="tv-tabs">${[["eod", "Trails end of day"], ["intraday", "Trails live"], ["static", "Static"]].map(([k, l]) => `<button data-s="ruledd" data-a="${k}" class="${r.ddType === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${num("rDaily", r.daily, "Daily loss limit $", "0 = none")}${num("rStopR", r.stopR, "Stop the day at −R", "Edge rule: 2")}${num("rMax", r.maxTrades, "Max trades a day", "0 = no limit")}
      <p class="muted pk-note">Use your firm's exact numbers. Trailing drawdown stops rising once it reaches your starting balance.</p>` : ""}</div>`;
  }
  function acctSave(reset) {
    const a = acct(), s = Number($("#acctStart").value), f = Number($("#acctFee").value);
    if (!(s >= 100)) return toast("Start with at least $100.");
    const fresh = reset || s !== a.start;
    if (fresh) { a.start = s; a.balance = s; a.peak = s; a.hwm = s; a.log = []; a.status = null; a.failWhy = null; if (S) { S.dayStart = s; S.dayLock = null; } }
    a.fee = f >= 0 ? f : 0;
    if (a.rules && a.rules.on && $("#rTarget")) { const v = (id) => Math.max(0, Number($(id).value) || 0); Object.assign(a.rules, { target: v("#rTarget"), maxDD: v("#rDD"), daily: v("#rDaily"), stopR: v("#rStopR"), maxTrades: Math.round(v("#rMax")) }); }
    saveAcct(a); paintPnl(); openAcct();
    toast(fresh ? `Fresh start: ${money(s)}.` : "Saved.");
  }

  function play() {
    if (timer) return stop();
    $("#simPlay").textContent = "⏸ Pause";
    timer = setInterval(() => { if (!step()) stop(); }, 700 / S.speed);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } const b = $("#simPlay"); if (b) b.textContent = "▶ Play"; }
  function toast(t) { if (window.Edge && window.Edge.toast) window.Edge.toast(t, 3500); }

  // ---------- order panel
  function panel() {
    const el = $("#simPanel"); if (!el || !S) return;
    const P = S.P, b = S.bars[S.i], dec = P.dec;
    const pb = $("#simPlanBtn"); if (pb) pb.hidden = !(P.strategy === "london" && b.min >= 120 && b.min < P.win[1]);
    const ny = hm(b.min), live = P.strategy === "london" ? inWins(P, b.min) && b.min < 18 * 60 : inWins(P, b.min);
    const clock = ruleBar() + `<div class="sim-clock"><span>${local(b.t)} your time · <b>NY ${ny}</b></span><span class="${live ? "good" : "muted"}">${live ? "● window open" : P.strategy === "london" && (b.min >= 18 * 60 || b.min < 120) ? "Asian box forming" : "window closed"}</span></div>`;
    if (S.pos) {
      const p = S.pos, r = (p.dir * (b.c - p.e)) / Math.abs(p.e - p.sl0);
      el.innerHTML = `${clock}<div class="sim-pos ${r >= 0 ? "up" : "down"}"><div><small>${p.dir > 0 ? "LONG" : "SHORT"} from ${p.e.toFixed(dec)}</small><b>${r > 0 ? "+" : ""}${r.toFixed(2)}R</b></div>
        <div class="levels" style="grid-template-columns:repeat(3,1fr);margin:8px 0"><div><small>Stop</small><b>${p.sl.toFixed(dec)}</b></div><div><small>Target</small><b>${p.tp != null ? p.tp.toFixed(dec) : "—"}</b></div><div><small>BE at +${P.beR}R</small><b>${(p.e + p.dir * P.beR * Math.abs(p.e - p.sl0)).toFixed(dec)}</b></div></div>
        <div class="row"><small class="muted" style="flex:1">${p.qty} ${P.sym} · ${(r * Math.abs(p.e - p.sl0) * P.pv * p.qty) < 0 ? "−" : "+"}${money(Math.abs(r * Math.abs(p.e - p.sl0) * P.pv * p.qty))}</small><button class="btn small" data-s="be" ${p.beAt != null ? "disabled" : ""}>🛡️ Stop to entry</button><button class="btn small danger" data-s="closepos">Close now</button></div></div>
        ${S.orders.length ? `<div class="sim-orders">${orderRows()}</div>` : ""}`;
      return;
    }
    const toolsHtml = S.tools.map((t, i) => { const r = Math.abs(t.e - t.sl), type = kindOf(t), n = contracts(r); return `<div class="sim-toolrow ${t.dir > 0 ? "long" : "short"}"><span><b>${t.dir > 0 ? "▲ Long" : "▼ Short"}</b> ${fmt(t.e)} <small class="muted">SL ${fmt(t.sl)} · TP ${fmt(t.tp)} · ${(Math.abs(t.tp - t.e) / r).toFixed(1)}R · ${n ? `${n} ${P.sym} for ${money(riskUSD())}` : `1 ${P.sym} risks ${money(r * P.pv)}`}</small></span><button class="btn small primary" data-s="tk" data-a="tool:${i}">${type === "market" ? (t.dir > 0 ? "Buy…" : "Sell…") : `${type === "limit" ? "Limit" : "Stop"} order…`}</button></div>`; }).join("");
    const hint = S.tools.length || S.orders.length ? "" : `<p class="sim-hint" style="margin:4px 0 8px">Pick <b>Long</b> or <b>Short</b> on the chart's toolbar and tap where you want in${P.strategy === "london" ? " — or <b>✨</b> to draw the plan once the box is set" : ""}. Drag to adjust (it snaps to the ${P.strategy === "london" ? "box edges" : "zone edges"}, your lines and whole R). <b>Press and hold</b> a position → <b>Create order…</b></p>`;
    el.innerHTML = `${clock}${hint}${toolsHtml}${S.orders.length ? `<div class="sim-orders">${orderRows()}</div>` : ""}<button class="btn small" data-s="tk" style="margin-top:8px">＋ New order (type prices)</button>`;
  }
  const orderRows = () => S.orders.map((o, i) => `<div class="row between"><span>${o.side > 0 ? "▲ BUY" : "▼ SELL"} ${o.type.toUpperCase()} ${o.qty || ""} <b>${fmt(o.price)}</b> <small class="muted">SL ${fmt(o.sl)} · TP ${o.tp != null ? fmt(o.tp) : "—"}</small></span><span class="row"><button class="btn small" data-s="tk" data-a="ord:${i}">Edit</button><button class="btn small" data-s="del" data-a="ord:${i}">Cancel</button></span></div>`).join("");

  // ---------- pick the day you train on: any day since 2019 (Databento) or the last 60 days, and when the replay starts
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const STARTS = { london: [[18 * 60, "Asian 18:00"], [120, "London 02:00"], [480, "New York 08:00"]], ngzone: [[180, "03:00"], [360, "Window 06:00"], [660, "Window 11:00"]] };
  function startAt(market) { try { const v = localStorage.getItem(`edge.sim.at.${market}`); if (v != null) return Number(v); } catch {} return null; }
  const lastMonth = (y) => { const n = new Date(Date.now() - 864e5); return y < n.getUTCFullYear() ? 12 : n.getUTCMonth() + 1; };
  const pkMonthStr = () => `${PK.year}-${String(PK.month).padStart(2, "0")}`;
  let PK = null;
  async function openPicker() {
    stop();
    const ok = await dbReady(), d = new Date(S.day * 864e5);
    PK = { market: S.market, src: ok ? S.src : "free", db: ok, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, at: startAt(S.market) ?? STARTS[S.P.strategy][0][0], seq: S.seq || true, days: null };
    pkLoad();
  }
  function closePicker() { const el = $("#simPick"); if (el) el.remove(); PK = null; }
  async function pkLoad() {
    PK.days = null; PK.err = ""; pkRender();
    const want = PK.src === "db" ? pkMonthStr() : "free";
    try {
      const data = await load(PK.market, PK.src, PK.src === "db" ? want : null);
      if (!PK || (PK.src === "db" ? pkMonthStr() : "free") !== want) return; // you picked something else meanwhile
      PK.days = data.days;
    } catch (e) { if (PK) { PK.err = e.message; PK.days = []; } }
    if (PK) pkRender();
  }
  function pkRender() {
    let el = $("#simPick");
    if (!el) { el = document.createElement("div"); el.id = "simPick"; el.className = "tv-tk-wrap"; $("#sim").appendChild(el); el.addEventListener("click", (e) => { if (e.target === el) closePicker(); }); }
    const P = MK[PK.market], now = new Date(), seen = (() => { try { return JSON.parse(localStorage.getItem(`edge.sim.${PK.market}`) || "[]"); } catch { return []; } })();
    const years = []; for (let y = 2019; y <= now.getUTCFullYear(); y++) years.push(y);
    const days = PK.days == null ? `<p class="muted">Loading the days${PK.src === "db" ? ` of ${MON[PK.month - 1]} ${PK.year}` : ""}…</p>`
      : !PK.days.length ? `<p class="muted">${esc(PK.err || "No full trading days here.")}</p>`
      : `<div class="pk-days">${PK.days.map((d) => { const t = new Date(d * 864e5); return `<button data-s="pkday" data-a="${d}" class="${seen.includes(d) ? "seen" : ""} ${S && d === S.day ? "on" : ""}"><small>${t.toLocaleDateString([], { timeZone: "UTC", weekday: "short" })}</small><b>${t.getUTCDate()}</b>${PK.src === "free" ? `<small>${MON[t.getUTCMonth()]}</small>` : ""}</button>`; }).join("")}</div>`;
    el.innerHTML = `<div class="tv-tk pk">
      <div class="tv-tk-h"><b>Pick your day</b><span class="muted">${P.name}</span><button class="sim-x" data-s="pkclose" aria-label="Close">✕</button></div>
      <div class="tv-tabs" style="grid-template-columns:1fr 1fr"><button data-s="pksrc" data-a="db" class="${PK.src === "db" ? "on" : ""}" ${PK.db ? "" : "disabled"}>Any day since 2019</button><button data-s="pksrc" data-a="free" class="${PK.src === "free" ? "on" : ""}">Last 60 days</button></div>
      ${PK.db ? "" : `<p class="muted pk-note">Connect Databento to train on any day since 2019.</p>`}
      ${PK.src === "db" ? `<div class="pk-row">${years.map((y) => `<button data-s="pkyear" data-a="${y}" class="${y === PK.year ? "on" : ""}">${y}</button>`).join("")}</div>
      <div class="pk-months">${MON.map((m, i) => `<button data-s="pkmonth" data-a="${i + 1}" class="${i + 1 === PK.month ? "on" : ""}" ${i + 1 > lastMonth(PK.year) ? "disabled" : ""}>${m}</button>`).join("")}</div>` : ""}
      <div class="pk-h"><b>Day</b><small class="muted">✓ = already practised</small></div>
      ${days}
      <div class="pk-h"><b>Start the replay at</b><small class="muted">New York time</small></div>
      <div class="tv-tabs">${STARTS[P.strategy].map(([m, l]) => `<button data-s="pkat" data-a="${m}" class="${m === PK.at ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="tv-row pk-seq">${`<button class="tv-tog ${PK.seq ? "on" : ""}" data-s="pkseq" role="switch" aria-checked="${PK.seq}"><i></i></button>`}<span style="min-width:0">Go day by day — <b>Next session</b> opens the following day</span></div>
      <button class="tv-go buy" data-s="pkrand" ${PK.days && PK.days.length ? "" : "disabled"}>🎲 Surprise me${PK.src === "db" ? ` — any day in ${MON[PK.month - 1]} ${PK.year}` : ""}</button></div>`;
  }
  // Next session: the following trading day when you go day by day, otherwise a random fresh one
  async function nextSession() {
    if (!S.seq) return start(S.market, { src: S.src });
    const nx = S.days.find((d) => d > S.day);
    if (nx != null) return start(S.market, { day: nx, src: S.src, month: S.month, seq: true });
    if (S.src === "db") { const [y, m] = S.month.split("-").map(Number), n = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); const nd = await load(S.market, "db", n).catch(() => ({ days: [] })); if (nd.days.length) return start(S.market, { day: nd.days[0], src: "db", month: n, seq: true }); }
    toast("That was the last day available — here's a random one.");
    return start(S.market, { src: S.src });
  }

  // ---------- review, one point at a time
  function startReview(n) {
    const tr = S.trades[n];
    stop(); $("#simBanner").hidden = true;
    S.reviewing = { n, k: 0, items: tr.findings };
    showReview();
    // keep the drawings glued to the candles while the chart rescales or you zoom
    const loop = () => { if (!S || !S.reviewing) return; drawOverlay(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  function showReview() {
    const R = S.reviewing, it = R.items[R.k], el = $("#simPanel");
    el.innerHTML = `<div class="sim-review ${it.rule ? "bad" : "good"}"><small class="muted">Review · point ${R.k + 1} of ${R.items.length}</small>
      <b>${esc(it.title)}</b><p>${esc(it.text)}</p>
      <div class="row between"><button class="btn small" data-s="rprev" ${R.k ? "" : "disabled"}>‹ Back</button><button class="btn small primary" data-s="rnext">${R.k < R.items.length - 1 ? "Next point ›" : "Done — keep going"}</button></div></div>`;
    // bring the annotations into view
    const ts = it.ann.map((a) => a.t1 || a.t).filter(Boolean);
    if (ts.length) { const idx = S.bars.findIndex((b) => b.t === Math.min(...ts)); if (idx >= 0) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, dIdx(idx) - 20), to: dIdx(S.i) + 10 }); }
    drawLines(); drawOverlay();
  }
  function endReview() { S.reviewing = null; drawOverlay(); if (S.ended) return endSession(); panel(); drawLines(); }

  // ---------- end of the session: what went well, common mistakes, what to do
  function endSession() {
    stop();
    if (!S.ended) { S.ended = true; S.orders = []; if (S.pos) { const b = S.bars[S.i]; exit(b.c, b, "16:40 close-out"); } $("#simBanner").hidden = true; drawLines(); endOfDay(); }
    const P = S.P, tot = S.trades.reduce((x, t) => x + t.R, 0), counts = {};
    for (const t of S.trades) for (const f of t.findings) if (f.rule) counts[f.code] = (counts[f.code] || 0) + 1;
    const common = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    let missed = "";
    if (P.strategy === "london" && S.plan && S.plan.trade && !S.plan.tooSmall && !S.trades.some((t) => t.dir === S.plan.trade.dir)) {
      const r = S.plan.trade.result;
      missed = `<div class="insight ${r.R > 0 ? "bad" : "info"}"><span>👀</span><div><b>You missed today's ${S.plan.trade.dir > 0 ? "buy" : "sell"}</b><p>London broke the box ${S.plan.trade.dir > 0 ? "high" : "low"} at ${hm(nyInfo(S.plan.trade.t).min)} New York. The plan trade ended at ${r.R > 0 ? "+" : ""}${r.R.toFixed(1)}R (${r.how}).</p></div></div>`;
    }
    const body = !S.trades.length
      ? `<p>No trades this session.</p>${missed || `<div class="insight good"><span>🧘</span><div><b>Nothing to take today — and you didn't force it.</b><p>That's the job some days.</p></div></div>`}`
      : `<div class="levels" style="grid-template-columns:repeat(3,1fr)"><div><small>Trades</small><b>${S.trades.length}</b></div><div><small>Result</small><b class="${tot > 0 ? "good" : tot < 0 ? "bad" : ""}">${tot > 0 ? "+" : ""}${tot.toFixed(2)}R</b><small>${signed(S.trades.reduce((x, t) => x + t.usd, 0))} · balance ${money(acct().balance)}</small></div><div><small>Rules kept</small><b>${S.trades.filter((t) => t.rulesOk).length}/${S.trades.length}</b></div></div>
        ${common.length ? `<h3 style="margin:12px 0 6px">What to work on</h3>${common.slice(0, 3).map(([c, n]) => `<div class="insight bad"><span>🎯</span><div><b>${esc(S.trades.flatMap((t) => t.findings).find((f) => f.code === c).title)}${n > 1 ? ` (${n}×)` : ""}</b><p>${esc(ADVICE[c] || "")}</p></div></div>`).join("")}`
          : `<div class="insight good"><span>✅</span><div><b>Clean session — nothing to add.</b><p>Every trade followed the plan. Keep doing exactly this.</p></div></div>`}${missed}`;
    const list = S.trades.map((t, n) => `<div class="row between sim-tline"><span>${t.dir > 0 ? "▲ Buy" : "▼ Sell"} ${local(t.tIn)} · <b class="${t.R > 0.1 ? "good" : t.R < -0.1 ? "bad" : ""}">${t.R > 0 ? "+" : ""}${t.R.toFixed(2)}R</b> ${t.rulesOk ? "✅" : "⚠️"}</span><button class="btn small" data-s="review" data-a="${n}">🔍 Review</button></div>`).join("");
    $("#simPanel").innerHTML = `<div class="sim-review good"><small class="muted">Session over · 16:40 New York</small><b>${P.name} — your session</b>${body}${list ? `<h3 style="margin:12px 0 6px">Your trades</h3>${list}` : ""}
      <div class="row" style="margin-top:10px"><button class="btn primary" data-s="next">Next session ›</button><button class="btn" data-s="close">Done</button></div></div>`;
  }

  // ---------- clicks
  function onClick(ev) {
    if (!ev.target.closest("#tvMenu") && !(S && S.keepMenu)) closeMenu();
    if (ev.target.id === "tvTicket") { if (S) S.tkLines = null; closeTicket(); return drawLines(); } // tap outside the ticket
    const b = ev.target.closest("[data-s]"); if (!b || !S && b.dataset.s !== "close") return;
    const a = b.dataset.a;
    switch (b.dataset.s) {
      case "close": return close();
      case "pick": return openPicker();
      case "acct": return openAcct();
      case "vmenu": return viewMenu(a, b);
      case "vtf": return setView({ tf: Number(a) });
      case "vtype": return setView({ type: a });
      case "vema": { const n = Number(a), e = S.view.ema.includes(n) ? S.view.ema.filter((x) => x !== n) : [...S.view.ema, n].sort((x, y) => x - y); setView({ ema: e }); return viewMenu("ind", $('#tvBar [data-a="ind"]')); }
      case "vpdhl": setView({ pdhl: !S.view.pdhl }); return viewMenu("ind", $('#tvBar [data-a="ind"]'));
      case "vseps": setView({ seps: !S.view.seps }); return viewMenu("ind", $('#tvBar [data-a="ind"]'));
      case "vclock": return setView({ clock: S.view.clock === "ny" ? "local" : "ny" });
      case "acctclose": { const el = $("#simAcct"); if (el) el.remove(); return; }
      case "acctsave": return acctSave(false);
      case "acctreset": return acctSave(true);
      case "rulestog": { const a = acct(); a.rules = { ...rulesOf(a), on: !rulesOf(a).on }; saveAcct(a); openAcct(); paintPnl(); return panel(); }
      case "ruledd": { const a = acct(); a.rules = { ...rulesOf(a), ddType: b.dataset.a }; saveAcct(a); return openAcct(); }
      case "rulepre": { const a = acct(), p = PRESETS[b.dataset.a]; a.rules = { ...rulesOf(a), on: true, target: p.target, maxDD: p.maxDD, daily: p.daily }; saveAcct(a); openAcct(); $("#acctStart").value = p.start; return acctSave(a.start !== p.start); }
      case "pkclose": return closePicker();
      case "pksrc": PK.src = a; try { localStorage.setItem("edge.sim.src", a); } catch {} return pkLoad();
      case "pkyear": PK.year = Number(a); PK.month = Math.min(PK.month, lastMonth(PK.year)); return pkLoad();
      case "pkmonth": PK.month = Number(a); return pkLoad();
      case "pkat": PK.at = Number(a); try { localStorage.setItem(`edge.sim.at.${PK.market}`, a); } catch {} return pkRender();
      case "pkseq": PK.seq = !PK.seq; return pkRender();
      case "pkday": case "pkrand": { const day = b.dataset.s === "pkday" ? Number(a) : PK.days[Math.floor(Math.random() * PK.days.length)]; if (day == null) return; const { market, src: s, at, seq } = PK, month = s === "db" ? pkMonthStr() : null; closePicker(); return start(market, { day, src: s, month, at, seq: b.dataset.s === "pkday" && seq }).catch((e) => toast(e.message)); }
      case "fs": return fullScreen();
      case "mk": return document.querySelectorAll(".sim-mk button").forEach((x) => x.classList.toggle("on", x === b)), start(a, S && S.seq ? { day: S.day, src: S.src, seq: true } : {}).catch((e) => toast(e.message));
      case "play": return play();
      case "step": stop(); return void step();
      case "speed": S.speed = S.speed >= 8 ? 1 : S.speed * 2; b.textContent = `${S.speed}×`; if (timer) { stop(); play(); } return;
      case "skip": { stop(); const target = S.P.strategy === "london" ? S.P.win[0] : 360; let n = 0; while (n++ < 600 && !(S.bars[S.i].min >= target && S.bars[S.i].min < 18 * 60) && step()); return; }
      case "end": return endSession();
      case "next": return nextSession().catch((e) => toast(e.message));
      case "mode": return setMode(a);
      case "plan": return planTools();
      case "clearall": case "delall": S.draws = []; S.tools = []; S.sel = null; closeMenu(); drawLines(); return panel();
      case "menu": { const r = b.getBoundingClientRect(); return openMenu(a, r.left, r.bottom + 4); }
      case "tk": return openTicket(a || null);
      case "tkm": return openTicket(a, true);
      case "clone": closeMenu(); return clone(a);
      case "rev": closeMenu(); return reverse(a);
      case "lock": { closeMenu(); const o = objOf(a); if (o && o.t) { o.t.lock = !o.t.lock; toast(o.t.lock ? "Locked — it won't move when you touch it." : "Unlocked."); } return; }
      case "del": return remove(a);
      case "tkclose": S.tkLines = null; closeTicket(); return drawLines();
      case "tkdir": { const d = Number(a), k = S.tk; if (d === k.dir) return; const ee = Number(k.price), r = Math.abs(ee - Number(k.sl)), rw = k.tp != null ? Math.abs(Number(k.tp) - ee) : r * S.P.tpR; k.dir = d; k.sl = onTick(ee - d * r); k.tp = onTick(ee + d * rw); if (k.type !== "market") k.type = kindOf({ dir: d, e: ee }) === "stop" ? "stop" : "limit"; return renderTicket(); }
      case "tktype": S.tk.type = a; if (a !== "market" && !Number.isFinite(Number(S.tk.price))) S.tk.price = S.bars[S.i].c; return renderTicket();
      case "tkby": { const c = tkCalc(); S.tk.by = S.tk.by === "usd" ? "qty" : "usd"; if (S.tk.by === "qty") S.tk.qty = c.qty || 1; else S.tk.usd = Math.round(c.usd) || riskUSD(); return renderTicket(); }
      case "tktog": S.tk[a] = !S.tk[a]; if (a === "tpOn" && S.tk.tpOn && !Number.isFinite(Number(S.tk.tp))) { const c = tkCalc(); S.tk.tp = onTick(c.e + S.tk.dir * S.P.tpR * c.r); } return renderTicket();
      case "tkgo": return submitTicket();
      case "tkone": S.tk.by = "qty"; S.tk.qty = 1; return renderTicket();
      case "be": closeMenu(); if (S.pos) { S.pos.beAt = (S.pos.dir * (S.bars[S.i].c - S.pos.e)) / Math.abs(S.pos.e - S.pos.sl0); S.pos.sl = S.pos.e; panel(); drawLines(); } return;
      case "closepos": closeMenu(); if (S.pos) { const bar = S.bars[S.i]; exit(bar.c, bar, "closed by you"); panel(); } return;
      case "review": return startReview(Number(a));
      case "dismiss": $("#simBanner").hidden = true; return;
      case "rnext": if (S.reviewing.k < S.reviewing.items.length - 1) { S.reviewing.k++; return showReview(); } return endReview();
      case "rprev": S.reviewing.k = Math.max(0, S.reviewing.k - 1); return showReview();
    }
  }

  // laptop / iPad keyboard: Space play/pause · → next candle · B/S long/short · H/R/T line, zone, trend · P plan
  // Enter order ticket · Delete remove · F full screen · Esc close / cancel
  function onKey(e) {
    if (!S || e.target.closest("input,textarea,select")) { if (S && e.key === "Enter" && S.tk) { e.preventDefault(); submitTicket(); } return; }
    const k = e.key.toLowerCase(), go = (fn) => { e.preventDefault(); fn(); };
    if (k === "escape") return go(() => { if ($("#tvMenu")) return closeMenu(); if (S.tk) { S.tkLines = null; closeTicket(); return drawLines(); } if (S.mode) return setMode(S.mode); if (S.reviewing) return endReview(); S.sel = null; });
    if (S.tk) { if (k === "enter") go(submitTicket); return; }
    if (k === " ") return go(play);
    if (k === "arrowright") return go(() => { stop(); step(); });
    if (k === "b") return go(() => setMode("long"));
    if (k === "s") return go(() => setMode("short"));
    if (["h", "r", "t"].includes(k)) return go(() => setMode(k));
    if (k === "p") return go(planTools);
    if ((k === "delete" || k === "backspace") && S.sel) return go(() => remove(S.sel));
    if (k === "enter" && !S.reviewing) return go(() => openTicket(S.sel && S.sel !== "pos" ? S.sel : S.tools.length ? "tool:0" : null));
    if (k === "f") return go(fullScreen);
  }
  function fullScreen() {
    const el = $("#sim"), d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) return (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) Promise.resolve(fn.call(el)).catch(() => toast("Full screen isn't allowed here — on iPad, add Edge to the Home Screen for a full-screen app."));
    else toast("On iPhone/iPad: Share → Add to Home Screen gives Edge a full-screen app.");
  }


  // ---------- Style lab: your stop size, target and break-even vs the tested plan, on real history
  function labRun(data, P, style) {
    if (!data.byDay) { data.byDay = new Map(); for (const b of data.bars) { if (!data.byDay.has(b.cme)) data.byDay.set(b.cme, []); data.byDay.get(b.cme).push(b); } }
    const out = [];
    for (const d of data.days) {
      const L = londonPlan(data.byDay.get(d) || [], P, style);
      if (!L || !L.trade || L.tooSmall || L.trade.result.how === "open") continue;
      out.push({ t: L.trade.t, R: L.trade.result.R - 0.03 }); // ~costs
    }
    return out;
  }
  function labStats(tr) {
    let eq = 0, pk = 0, dd = 0, run = 0, ls = 0;
    for (const t of tr) { eq += t.R; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); run = t.R < -0.2 ? run + 1 : 0; ls = Math.max(ls, run); }
    const n = tr.length;
    return { n, win: n ? Math.round((tr.filter((t) => t.R > 0.2).length / n) * 100) : 0, R: eq, avg: n ? eq / n : 0, dd, ls };
  }
  let L = null, labChart = null;
  function learned(market) {
    const st = window.Edge && window.Edge.state && window.Edge.state();
    const xs = ((st && st.practice) || []).filter((t) => t.market === market && t.style && t.style.stopFrac > 0);
    const med = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
    return { n: xs.length, stopFrac: med(xs.map((t) => t.style.stopFrac)), tpR: med(xs.map((t) => t.style.tpR)) };
  }
  async function openLab(market = "gold") {
    close(); closeLab();
    const el = document.createElement("div");
    el.id = "lab"; el.className = "sim lab";
    el.innerHTML = `<div class="sim-top"><button class="sim-x" data-l2="close" aria-label="Close">✕</button>
        <div class="sim-mk">${["gold", "crude", "silver"].map((k) => `<button data-l2="mk" data-a="${k}" class="${k === market ? "on" : ""}">${MK[k].name.split(" ")[0]}</button>`).join("")}</div>
        <button class="sim-x" data-l2="fs" title="Full screen">⛶</button></div>
      <div class="lab-body" id="labBody"><p class="muted" style="padding:16px">Loading prices…</p></div>`;
    document.body.appendChild(el);
    document.body.classList.add("sim-on");
    el.addEventListener("click", labClick);
    el.addEventListener("input", (e) => { if (e.target.dataset.lr) { L.style[e.target.dataset.lr] = Number(e.target.value); labCompute(); } });
    await labLoad(market, "60m");
  }
  function closeLab() { if (labChart) { labChart.remove(); labChart = null; } const el = $("#lab"); if (el) el.remove(); if (!$("#sim")) document.body.classList.remove("sim-on"); L = null; }
  async function labLoad(market, src) {
    await dbReady();
    const P = MK[market], lr = learned(market);
    const app = window.Edge && window.Edge.state && window.Edge.state();
    const saved = ((app && app.settings && app.settings.style) || {})[market];
    L = { market, P, src, data: null, style: saved ? { stopFrac: saved.stopFrac, tpR: saved.tpR, beR: saved.beR } : { stopFrac: lr.stopFrac ? Math.max(0.2, Math.min(1, Math.round(lr.stopFrac * 20) / 20)) : 1, tpR: lr.tpR ? Math.max(1, Math.min(6, Math.round(lr.tpR * 2) / 2)) : P.tpR, beR: P.beR }, learned: lr, saved };
    const body = $("#labBody");
    try {
      if (src === "db") {
        const now = new Date(), months = [];
        for (let k = 24; k >= 1; k--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
        const raw = [];
        for (let k = 0; k < months.length; k++) { body.innerHTML = `<p class="muted" style="padding:16px">Loading Databento month ${k + 1} of ${months.length}… (first time only — then it's saved)</p>`; raw.push(...(await getBars(`/api/candles?m=${market}&src=db&i=5m&month=${months[k]}`))); }
        L.data = prep(raw, "5m");
      } else {
        const tf = src === "5m" ? "5m" : "60m";
        L.data = prep(await getBars(`/api/candles?m=${market}&i=${tf}`), tf);
        L.data.days = L.data.days.slice(1, -1);
      }
    } catch (e) { body.innerHTML = `<p class="err" style="padding:16px">${esc(e.message)}</p>`; return; }
    L.plan = labStats(labRun(L.data, P, null));
    L.planTrades = labRun(L.data, P, null);
    labRender();
  }
  function labRender() {
    const P = L.P, s = L.style, lr = L.learned;
    const db = dbStatus;
    $("#labBody").innerHTML = `<div class="lab-grid"><div class="lab-left">
      <h2 class="lab-h">🧪 Style lab · ${P.name}</h2>
      <p class="muted lab-p">Set your stop and target. Edge replays every London breakout in the data with your numbers and with the tested plan, side by side.</p>
      ${lr.n ? `<div class="insight info"><span>🧠</span><div><b>From your ${lr.n} simulator trades</b><p>You usually put the stop at <b>${Math.round(lr.stopFrac * 100)}%</b> of the Asian box${lr.tpR ? ` and the target at <b>${lr.tpR.toFixed(1)}R</b>` : ""}. The sliders start there.</p></div></div>` : `<div class="insight info"><span>🧠</span><div><b>Edge learns your style from the simulator</b><p>Trade a few sessions there — your usual stop and target will show up here.</p></div></div>`}
      <div class="chips three lab-src">${[["60m", "2 years · 1-hour"], ["5m", "60 days · 5-min"], ...(db ? [["db", "Databento · 2 yrs 5-min"]] : [])].map(([k, l]) => `<button data-l2="src" data-a="${k}" class="${L.src === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="lab-sl"><span>Stop size <b id="lvStop">${Math.round(s.stopFrac * 100)}% of the box</b></span><input type="range" min="0.2" max="1" step="0.05" value="${s.stopFrac}" data-lr="stopFrac"></label>
      <label class="lab-sl"><span>Target <b id="lvTp">${s.tpR}R</b></span><input type="range" min="1" max="6" step="0.5" value="${s.tpR}" data-lr="tpR"></label>
      <div class="lab-sl"><span>Break-even</span><div class="chips">${[0, 1, 1.5, 2].map((v) => `<button data-l2="be" data-a="${v}" class="${s.beR === v ? "on" : ""}">${v ? `+${v}R` : "Off"}</button>`).join("")}</div></div>
      <p class="muted lab-p" style="font-size:12.5px">💡 A smaller stop doesn't lower your risk in dollars — Edge gives you more contracts for the same risk. It changes how often you're stopped out. What matters is the total in R.</p>
    </div><div class="lab-right">
      <div class="lab-cmp" id="labCmp"></div>
      <div class="lab-legend"><span><i style="background:#8a94a6"></i>Tested plan</span><span><i style="background:#d9b46c"></i>Your style</span></div>
      <div class="lab-chart" id="labChart"></div>
      <div id="labVerdict"></div>
    </div></div>`;
    labCompute();
  }
  function labCompute() {
    const P = L.P, s = L.style;
    const mine = labRun(L.data, P, s), m = labStats(mine), p = L.plan;
    const lv = $("#lvStop"); if (lv) lv.textContent = `${Math.round(s.stopFrac * 100)}% of the box`;
    const lt = $("#lvTp"); if (lt) lt.textContent = `${s.tpR}R`;
    const row = (lbl, a, b, f, better) => `<div class="lab-row"><span>${lbl}</span><b>${f(a)}</b><b class="${better(b, a) ? "good" : better(a, b) ? "bad" : ""}">${f(b)}</b></div>`;
    const R = (x) => `${x > 0 ? "+" : ""}${x.toFixed(1)}R`;
    $("#labCmp").innerHTML = `<div class="lab-row head"><span></span><b>Tested plan</b><b>Your style</b></div>
      ${row("Trades", p.n, m.n, (x) => x, () => false)}
      ${row("Won", p.win, m.win, (x) => x + "%", (a, b) => a > b + 2)}
      ${row("Total", p.R, m.R, R, (a, b) => a > b + 0.5)}
      ${row("Per trade", p.avg, m.avg, (x) => `${x > 0 ? "+" : ""}${x.toFixed(2)}R`, (a, b) => a > b + 0.01)}
      ${row("Worst dip", p.dd, m.dd, R, (a, b) => a > b + 0.5)}
      ${row("Losses in a row", p.ls, m.ls, (x) => x, (a, b) => a < b)}`;
    const diff = m.R - p.R, same = Math.abs(s.stopFrac - 1) < 0.01 && s.tpR === P.tpR && s.beR === P.beR;
    const note = L.src === "60m" && s.stopFrac < 0.9 ? " Hourly candles are harsh on tight stops (a stop touched anywhere in the hour counts) — check it on 5-minute data or Databento too." : L.src === "5m" ? " 60 days is a small sample — treat it as a hint." : "";
    $("#labVerdict").innerHTML = `<div class="insight ${same ? "info" : diff > 0 ? "good" : "bad"}"><span>${same ? "📏" : diff > 0 ? "📈" : "📉"}</span><div><b>${same ? "This is the tested plan" : diff > 0 ? `Your style made ${R(diff)} more` : `Your style made ${R(-diff).replace("+", "")} less`}</b><p>${same ? "Move the sliders to try your own stop and target." : `Over ${m.n} trades.${note}`}</p></div></div>
      <div class="row" style="margin-top:8px">${same ? "" : `<button class="btn ${diff > 0 ? "primary" : ""}" data-l2="use">Use my style for live alerts</button>`}${L.saved ? `<button class="btn" data-l2="reset">Back to the tested plan</button>` : ""}</div>`;
    labDraw(mine);
  }
  function labDraw(mine) {
    const el = $("#labChart"), LW = window.LightweightCharts;
    if (!el || !LW) return;
    if (labChart) { labChart.remove(); labChart = null; }
    labChart = LW.createChart(el, { autoSize: true, localization: { locale: "en-US", timeFormatter: (t) => new Date(t * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" }) }, layout: { background: { type: "solid", color: css("--panel2") }, textColor: css("--muted") }, grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, handleScroll: false, handleScale: false });
    const curve = (tr) => { let eq = 0; const seen = new Set(); return tr.map((t) => ({ time: Math.floor(t.t / 1000), value: +(eq += t.R).toFixed(2) })).filter((x) => !seen.has(x.time) && seen.add(x.time)); };
    labChart.addLineSeries({ color: "#8a94a6", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "plan" }).setData(curve(L.planTrades));
    labChart.addLineSeries({ color: "#d9b46c", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "you" }).setData(curve(mine));
    labChart.timeScale().fitContent();
  }
  async function labClick(ev) {
    const b = ev.target.closest("[data-l2]"); if (!b) return;
    const a = b.dataset.a;
    switch (b.dataset.l2) {
      case "close": return closeLab();
      case "fs": { const el = $("#lab"), fn = el.requestFullscreen || el.webkitRequestFullscreen; if (document.fullscreenElement) return document.exitFullscreen(); if (fn) Promise.resolve(fn.call(el)).catch(() => {}); return; }
      case "mk": document.querySelectorAll("#lab .sim-mk button").forEach((x) => x.classList.toggle("on", x === b)); return labLoad(a, L.src);
      case "src": return labLoad(L.market, a);
      case "be": L.style.beR = Number(a); return labRender();
      case "use": case "reset": {
        const api = window.Edge && window.Edge.api; if (!api) return;
        const st = b.dataset.l2 === "use" ? { ...L.style, tested: `${labStats(labRun(L.data, L.P, L.style)).R.toFixed(1)}R vs plan ${L.plan.R.toFixed(1)}R (${L.src})` } : null;
        try { await api({ action: "settings", patch: { style: { [L.market]: st } } }); toast(st ? `${L.P.name}: live London orders now use your style.` : `${L.P.name}: back to the tested plan.`); if (window.Edge.refresh) window.Edge.refresh(); L.saved = st; labRender(); }
        catch (e) { toast(e.message); }
      }
    }
  }

  window.EdgeSim = { open, close, openLab, _prep: prep, _labRun: labRun, _state: () => S, _review: review, _londonPlan: londonPlan, _gasZones: gasZones, MK };
})();
