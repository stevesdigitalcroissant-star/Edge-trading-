// Edge practice simulator — replay real past candles like TradingView / FX Replay, place orders,
// then review each trade one point at a time on the chart, and get a summary at the end of the session.
// Uses TradingView's open-source Lightweight Charts (vendor/lightweight-charts.js, Apache 2.0).
(function () {
  const NYZ = "America/New_York";
  const MK = {
    gold: { name: "Gold", sym: "MGC", strategy: "london", tf: "5m", win: [120, 480], tpR: 2, beR: 1.5, dec: 2 },
    crude: { name: "Crude oil", sym: "MCL", strategy: "london", tf: "5m", win: [180, 480], tpR: 3, beR: 1, dec: 2 },
    silver: { name: "Silver", sym: "SIL", strategy: "london", tf: "5m", win: [120, 480], tpR: 2, beR: 1, dec: 3, minRangeAtr: 1.5 },
    natgas: { name: "Natural gas", sym: "QG", strategy: "ngzone", tf: "60m", wins: [[360, 540], [660, 720]], tpR: 3, beR: 2, dec: 3 },
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
      const d = prep([...a, ...b], P.tf), first = Date.UTC(y, m - 1, 1) / 864e5;
      return { bars: d.bars, days: d.days.filter((x) => x >= first) };
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
        <button class="sim-x" data-s="src" id="simSrc" title="Where the prices come from">60d</button>
        <button class="sim-x" data-s="fs" title="Full screen (F)">⛶</button>
        <div class="sim-pnl"><small>Session</small><b id="simPnl">0.00R</b></div></div>
      <div class="sim-info" id="simInfo">Loading prices…</div>
      <div class="sim-chart" id="simChart"><svg class="sim-ov" id="simOv"></svg><div class="sim-banner" id="simBanner" hidden></div></div>
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
    dbReady().then((ok) => { const b = $("#simSrc"); if (b) { b.textContent = ok && srcPref() === "db" ? "2019+" : "60d"; b.hidden = !ok; } });
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

  async function start(market, dayPick = null) {
    stop();
    const useDb = srcPref() === "db" && (await dbReady());
    $("#simInfo").textContent = useDb ? "Loading a month from Databento…" : "Loading prices…";
    const P = MK[market], data = await load(market, useDb ? "db" : "free", useDb ? randomMonth() : null);
    if (!data.days.length) throw new Error("No complete sessions in the data yet.");
    const seenKey = `edge.sim.${market}`;
    let seen = []; try { seen = JSON.parse(localStorage.getItem(seenKey) || "[]"); } catch {}
    const fresh = data.days.filter((d) => !seen.includes(d));
    const day = dayPick != null && data.days.includes(dayPick) ? dayPick : (fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : data.days[Math.floor(Math.random() * data.days.length)]);
    try { localStorage.setItem(seenKey, JSON.stringify([...seen, day].slice(-400))); } catch {}
    const all = data.bars, first = all.findIndex((b) => b.cme === day);
    const sess = all.filter((b) => b.cme === day);
    // start: London → the evening the box starts (18:00); gas → 03:00 New York with plenty of history for old zones
    const startI = P.strategy === "london" ? first : Math.max(first, all.findIndex((b) => b.cme === day && b.min >= 180 && b.min < 18 * 60));
    const hist = P.strategy === "london" ? 160 : 24 * 12;
    S = { market, P, day, bars: all, sess, i: startI, from: Math.max(0, startI - hist), speed: 1, orders: [], pos: null, trades: [], ha: P.strategy === "ngzone", plan: P.strategy === "london" ? londonPlan(sess, P) : null, ticket: { side: 1, type: P.strategy === "london" ? "stop" : "limit", entry: "", sl: "", tp: "", field: "entry" }, reviewing: null };
    buildChart();
    paintAll();
    const d = new Date(day * 864e5); // the New York trading day
    $("#simInfo").innerHTML = `<b>${P.name}</b> · ${d.toLocaleDateString([], { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${P.tf === "5m" ? "5-minute" : "1-hour Heikin Ashi"} candles · ${P.strategy === "london" ? `orders live ${winTxt(P)}` : `windows ${winTxt(P)}`}`;
    $("#simSkip").textContent = P.strategy === "london" ? `⏩ to ${hm(P.win[0])} NY` : "⏩ to 06:00 NY";
    panel();
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"; }
  function buildChart() {
    if (chart) chart.remove();
    const el = $("#simChart"), LW = window.LightweightCharts;
    chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: css("--panel") }, textColor: css("--muted"), fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line2") },
      timeScale: { borderColor: css("--line2"), timeVisible: true, secondsVisible: false, rightOffset: 12, tickMarkFormatter: (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      localization: { timeFormatter: (t) => `${new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · NY ${hm(nyInfo(t * 1000).min)}` },
      crosshair: { mode: LW.CrosshairMode.Normal },
    });
    series = chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", wickUpColor: "#26a69a", wickDownColor: "#ef5350", borderVisible: false, priceFormat: { type: "price", precision: S.P.dec, minMove: S.P.dec === 2 ? 0.01 : 0.001 } });
    chart.subscribeClick((p) => { if (!p.point || !S || S.reviewing) return; const price = series.coordinateToPrice(p.point.y); if (price == null) return; S.ticket[S.ticket.field] = price.toFixed(S.P.dec); if (S.ticket.field === "entry") S.ticket.field = "sl"; else if (S.ticket.field === "sl") S.ticket.field = "tp"; panel(); drawLines(); });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawOverlay());
    new ResizeObserver(() => drawOverlay()).observe(el);
  }
  const candle = (b) => (S.ha ? { time: b.t / 1000, open: b.ha.o, high: b.ha.h, low: b.ha.l, close: b.ha.c } : { time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c });
  function paintAll() {
    series.setData(S.bars.slice(S.from, S.i + 1).map(candle));
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, S.i - S.from - 90), to: S.i - S.from + 12 });
    markers(); drawLines(); drawOverlay();
  }
  function markers() {
    const m = [];
    for (const t of S.trades) {
      m.push({ time: t.tIn / 1000, position: t.dir > 0 ? "belowBar" : "aboveBar", color: t.dir > 0 ? "#26a69a" : "#ef5350", shape: t.dir > 0 ? "arrowUp" : "arrowDown", text: t.dir > 0 ? "BUY" : "SELL" });
      m.push({ time: t.tOut / 1000, position: t.dir > 0 ? "aboveBar" : "belowBar", color: t.R > 0.1 ? "#26a69a" : t.R < -0.1 ? "#ef5350" : "#9e9e9e", shape: "circle", text: `${t.R > 0 ? "+" : ""}${t.R.toFixed(1)}R` });
    }
    if (S.pos) m.push({ time: S.pos.tIn / 1000, position: S.pos.dir > 0 ? "belowBar" : "aboveBar", color: S.pos.dir > 0 ? "#26a69a" : "#ef5350", shape: S.pos.dir > 0 ? "arrowUp" : "arrowDown", text: S.pos.dir > 0 ? "BUY" : "SELL" });
    series.setMarkers(m.sort((a, b) => a.time - b.time));
  }
  function drawLines() {
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    const LW = window.LightweightCharts, add = (price, color, title, style = LW.LineStyle.Solid) => { if (price === "" || price == null) return; const p = Number(price); if (Number.isFinite(p)) lines.push(series.createPriceLine({ price: p, color, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title })); };
    if (S.pos) { add(S.pos.e, "#9aa4b2", "entry", LW.LineStyle.Dotted); add(S.pos.sl, "#ef5350", "SL"); if (S.pos.tp != null) add(S.pos.tp, "#26a69a", "TP"); }
    for (const o of S.orders) { add(o.price, o.side > 0 ? "#26a69a" : "#ef5350", `${o.side > 0 ? "BUY" : "SELL"} ${o.type.toUpperCase()}`, LW.LineStyle.Dashed); }
    if (!S.pos && !S.reviewing) { const k = S.ticket; add(k.entry, "#d9b46c", "entry?", LW.LineStyle.SparseDotted); add(k.sl, "#ef5350", "SL?", LW.LineStyle.SparseDotted); add(k.tp, "#26a69a", "TP?", LW.LineStyle.SparseDotted); }
  }

  // annotations drawn over the chart (boxes, levels, markers) during a review
  function drawOverlay() {
    const svg = $("#simOv"); if (!svg || !S || !chart) return;
    const items = S.reviewing ? S.reviewing.items[S.reviewing.k].ann : [];
    const ts = chart.timeScale(), X = (t) => ts.timeToCoordinate(t / 1000), Y = (p) => series.priceToCoordinate(p);
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
    series.update(candle(b));
    const prev = S.bars[nx - 1];
    if (S.orders.length && inWins(S.P, prev.min) && !inWins(S.P, b.min) && prev.min < 18 * 60) { S.orders = []; toast("Window closed — your orders were cancelled, as the plan says."); }
    fills(b);
    if (S.pos) manage(b);
    panel(); markers(); drawLines();
    return true;
  }
  function fills(b) {
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
      openPos(o.side, px, o.sl, o.tp, b);
      // stop hit inside the fill candle (conservative, like the tests)
      if (o.side > 0 ? b.l <= o.sl : b.h >= o.sl) exit(o.sl, b, "stop");
    }
  }
  function openPos(dir, e, sl, tp, b) {
    S.pos = { dir, e, sl, sl0: sl, tp, tp0: tp, tIn: b.t, mfe: 0, beAt: null, second: S.trades.length > 0 };
    toast(`${dir > 0 ? "Bought" : "Sold"} at ${e.toFixed(S.P.dec)}`);
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
    const tr = { ...p, x: px, tOut: b.t, how, R: (p.dir * (px - p.e)) / r0 };
    S.pos = null; S.trades.push(tr);
    tr.findings = review(S, tr);
    tr.rulesOk = !tr.findings.some((x) => x.rule);
    save(tr);
    stop();
    const ban = $("#simBanner");
    ban.hidden = false;
    ban.innerHTML = `<b>${tr.R > 0.1 ? "🎯" : tr.R < -0.1 ? "✋" : "🛡️"} Trade closed ${tr.R > 0 ? "+" : ""}${tr.R.toFixed(2)}R</b><span class="muted">${esc(how)}</span>
      <div class="row"><button class="btn small primary" data-s="review" data-a="${S.trades.length - 1}">🔍 Review this trade</button><button class="btn small" data-s="dismiss">Keep going ›</button></div>`;
    paintPnl();
  }
  function save(tr) {
    const P = S.P, out = tr.how === "target" || Math.abs(tr.R - P.tpR) < 0.1 ? "tp" : Math.abs(tr.R) < 0.1 ? "be" : tr.how === "stop" && tr.R <= -0.9 ? "sl" : "flat";
    const api = window.Edge && window.Edge.api;
    if (!api) return;
    const r0 = Math.abs(tr.e - tr.sl0), box = S.plan ? S.plan.hi - S.plan.lo : null;
    const style = { stopFrac: box ? +(r0 / box).toFixed(3) : null, tpR: tr.tp0 != null ? +((tr.dir * (tr.tp0 - tr.e)) / r0).toFixed(2) : null, beAt: tr.beAt != null ? +tr.beAt.toFixed(2) : null };
    api({ action: "backtestLog", strategy: P.strategy, market: S.market, dir: tr.dir > 0 ? "long" : "short", outcome: out, r: tr.R.toFixed(2), date: new Date(tr.tIn).toISOString().slice(0, 10), rulesOk: tr.rulesOk, style, note: `simulator · ${tr.findings.map((f) => f.title).join(" · ")}`.slice(0, 480) }).catch(() => {});
  }
  function paintPnl() { const tot = S.trades.reduce((x, t) => x + t.R, 0); const el = $("#simPnl"); el.textContent = `${tot > 0 ? "+" : ""}${tot.toFixed(2)}R`; el.className = tot > 0.01 ? "good" : tot < -0.01 ? "bad" : ""; }

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
    const P = S.P, b = S.bars[S.i], k = S.ticket, dec = P.dec;
    const ny = hm(b.min), live = P.strategy === "london" ? inWins(P, b.min) && b.min < 18 * 60 : inWins(P, b.min);
    const clock = `<div class="sim-clock"><span>${local(b.t)} your time · <b>NY ${ny}</b></span><span class="${live ? "good" : "muted"}">${live ? "● window open" : P.strategy === "london" && (b.min >= 18 * 60 || b.min < 120) ? "Asian box forming" : "window closed"}</span></div>`;
    if (S.pos) {
      const p = S.pos, r = (p.dir * (b.c - p.e)) / Math.abs(p.e - p.sl0);
      el.innerHTML = `${clock}<div class="sim-pos ${r >= 0 ? "up" : "down"}"><div><small>${p.dir > 0 ? "LONG" : "SHORT"} from ${p.e.toFixed(dec)}</small><b>${r > 0 ? "+" : ""}${r.toFixed(2)}R</b></div>
        <div class="levels" style="grid-template-columns:repeat(3,1fr);margin:8px 0"><div><small>Stop</small><b>${p.sl.toFixed(dec)}</b></div><div><small>Target</small><b>${p.tp != null ? p.tp.toFixed(dec) : "—"}</b></div><div><small>BE at +${P.beR}R</small><b>${(p.e + p.dir * P.beR * Math.abs(p.e - p.sl0)).toFixed(dec)}</b></div></div>
        <div class="row"><button class="btn small" data-s="be" ${p.beAt != null ? "disabled" : ""}>🛡️ Stop to entry</button><button class="btn small danger" data-s="closepos">Close now</button></div></div>
        ${S.orders.length ? `<div class="sim-orders">${orderRows()}</div>` : ""}`;
      return;
    }
    const e = Number(k.entry), sl = Number(k.sl), tp = Number(k.tp), risk = Math.abs(e - sl), rr = risk > 0 && k.tp !== "" ? Math.abs(tp - e) / risk : null;
    const f = (name, label) => `<label class="sim-f ${k.field === name ? "on" : ""}" data-s="field" data-a="${name}"><small>${label}</small><input data-sf="${name}" inputmode="decimal" value="${esc(k[name])}" placeholder="tap chart"></label>`;
    el.innerHTML = `${clock}<div class="sim-ticket">
      <div class="chips two">${["1", "-1"].map((v) => `<button data-s="side" data-a="${v}" class="${String(k.side) === v ? "on" : ""}">${v === "1" ? "▲ Buy" : "▼ Sell"}</button>`).join("")}</div>
      <div class="chips three">${["market", "stop", "limit"].map((t) => `<button data-s="type" data-a="${t}" class="${k.type === t ? "on" : ""}">${t === "market" ? "Market" : t === "stop" ? "Stop" : "Limit"}</button>`).join("")}</div>
      <div class="sim-fields">${k.type === "market" ? "" : f("entry", "Price")}${f("sl", "Stop loss")}${f("tp", "Take profit")}</div>
      <p class="muted sim-hint">${k.type === "market" ? "" : "Tap a box, then tap the chart to set it. "}${rr != null && Number.isFinite(rr) ? `Target = <b>${rr.toFixed(1)}R</b> (plan ${P.tpR}R)` : ""}</p>
      <button class="btn primary" data-s="place" style="width:100%">${k.type === "market" ? (k.side > 0 ? "Buy now" : "Sell now") : `Place ${k.side > 0 ? "buy" : "sell"} ${k.type}`}</button>
      ${S.orders.length ? `<div class="sim-orders">${orderRows()}</div>` : ""}</div>`;
    el.querySelectorAll("[data-sf]").forEach((inp) => inp.addEventListener("input", () => { S.ticket[inp.dataset.sf] = inp.value; drawLines(); }));
  }
  const orderRows = () => S.orders.map((o, i) => `<div class="row between"><span>${o.side > 0 ? "▲ BUY" : "▼ SELL"} ${o.type.toUpperCase()} <b>${o.price.toFixed(S.P.dec)}</b> <small class="muted">SL ${o.sl.toFixed(S.P.dec)} · TP ${o.tp != null ? o.tp.toFixed(S.P.dec) : "—"}</small></span><button class="btn small" data-s="cancel" data-a="${i}">Cancel</button></div>`).join("");
  function place() {
    const k = S.ticket, b = S.bars[S.i], side = Number(k.side);
    const sl = Number(k.sl), tp = k.tp === "" ? null : Number(k.tp);
    const e = k.type === "market" ? b.c : Number(k.entry);
    if (!Number.isFinite(e) || !Number.isFinite(sl) || k.sl === "") return toast("Set a price and a stop loss first (tap the box, then the chart).");
    if (side * (e - sl) <= 0) return toast(side > 0 ? "For a buy, the stop goes below the price." : "For a sell, the stop goes above the price.");
    if (tp != null && side * (tp - e) <= 0) return toast("The target must be on the profit side.");
    if (k.type === "market") { if (S.pos) return toast("You're already in a trade."); openPos(side, e, sl, tp, b); }
    else {
      if (k.type === "stop" && side * (e - b.c) <= 0) return toast(`A ${side > 0 ? "buy" : "sell"} stop goes ${side > 0 ? "above" : "below"} the current price — use a limit or market order.`);
      if (k.type === "limit" && side * (e - b.c) >= 0) return toast(`A ${side > 0 ? "buy" : "sell"} limit goes ${side > 0 ? "below" : "above"} the current price.`);
      S.orders.push({ side, type: k.type, price: e, sl, tp });
      toast("Order placed. Now step forward.");
    }
    S.ticket = { ...S.ticket, entry: "", sl: "", tp: "", field: "entry", side: -side };
    panel(); markers(); drawLines();
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
    if (ts.length) { const idx = S.bars.findIndex((b) => b.t === Math.min(...ts)); if (idx >= 0) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, idx - S.from - 20), to: S.i - S.from + 10 }); }
    drawLines(); drawOverlay();
  }
  function endReview() { S.reviewing = null; drawOverlay(); if (S.ended) return endSession(); panel(); drawLines(); }

  // ---------- end of the session: what went well, common mistakes, what to do
  function endSession() {
    stop();
    if (!S.ended) { S.ended = true; S.orders = []; if (S.pos) { const b = S.bars[S.i]; exit(b.c, b, "16:40 close-out"); } $("#simBanner").hidden = true; drawLines(); }
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
      : `<div class="levels" style="grid-template-columns:repeat(3,1fr)"><div><small>Trades</small><b>${S.trades.length}</b></div><div><small>Result</small><b class="${tot > 0 ? "good" : tot < 0 ? "bad" : ""}">${tot > 0 ? "+" : ""}${tot.toFixed(2)}R</b></div><div><small>Rules kept</small><b>${S.trades.filter((t) => t.rulesOk).length}/${S.trades.length}</b></div></div>
        ${common.length ? `<h3 style="margin:12px 0 6px">What to work on</h3>${common.slice(0, 3).map(([c, n]) => `<div class="insight bad"><span>🎯</span><div><b>${esc(S.trades.flatMap((t) => t.findings).find((f) => f.code === c).title)}${n > 1 ? ` (${n}×)` : ""}</b><p>${esc(ADVICE[c] || "")}</p></div></div>`).join("")}`
          : `<div class="insight good"><span>✅</span><div><b>Clean session — nothing to add.</b><p>Every trade followed the plan. Keep doing exactly this.</p></div></div>`}${missed}`;
    const list = S.trades.map((t, n) => `<div class="row between sim-tline"><span>${t.dir > 0 ? "▲ Buy" : "▼ Sell"} ${local(t.tIn)} · <b class="${t.R > 0.1 ? "good" : t.R < -0.1 ? "bad" : ""}">${t.R > 0 ? "+" : ""}${t.R.toFixed(2)}R</b> ${t.rulesOk ? "✅" : "⚠️"}</span><button class="btn small" data-s="review" data-a="${n}">🔍 Review</button></div>`).join("");
    $("#simPanel").innerHTML = `<div class="sim-review good"><small class="muted">Session over · 16:40 New York</small><b>${P.name} — your session</b>${body}${list ? `<h3 style="margin:12px 0 6px">Your trades</h3>${list}` : ""}
      <div class="row" style="margin-top:10px"><button class="btn primary" data-s="next">Next session ›</button><button class="btn" data-s="close">Done</button></div></div>`;
  }

  // ---------- clicks
  function onClick(ev) {
    const b = ev.target.closest("[data-s]"); if (!b || !S && b.dataset.s !== "close") return;
    const a = b.dataset.a;
    switch (b.dataset.s) {
      case "close": return close();
      case "src": { const nx = srcPref() === "db" ? "free" : "db"; try { localStorage.setItem("edge.sim.src", nx); } catch {} b.textContent = nx === "db" ? "2019+" : "60d"; toast(nx === "db" ? "Any day since 2019 (Databento) — next session." : "Last 60 days (free) — next session."); return start(S.market).catch((e) => toast(e.message)); }
      case "fs": return fullScreen();
      case "mk": return document.querySelectorAll(".sim-mk button").forEach((x) => x.classList.toggle("on", x === b)), start(a).catch((e) => toast(e.message));
      case "play": return play();
      case "step": stop(); return void step();
      case "speed": S.speed = S.speed >= 8 ? 1 : S.speed * 2; b.textContent = `${S.speed}×`; if (timer) { stop(); play(); } return;
      case "skip": { stop(); const target = S.P.strategy === "london" ? S.P.win[0] : 360; let n = 0; while (n++ < 600 && !(S.bars[S.i].min >= target && S.bars[S.i].min < 18 * 60) && step()); return; }
      case "end": return endSession();
      case "next": return start(S.market).catch((e) => toast(e.message));
      case "side": S.ticket.side = Number(a); return panel();
      case "type": S.ticket.type = a; return panel();
      case "field": S.ticket.field = a; return panel();
      case "place": return place();
      case "cancel": S.orders.splice(Number(a), 1); panel(); return drawLines();
      case "be": if (S.pos) { S.pos.beAt = (S.pos.dir * (S.bars[S.i].c - S.pos.e)) / Math.abs(S.pos.e - S.pos.sl0); S.pos.sl = S.pos.e; panel(); drawLines(); } return;
      case "closepos": if (S.pos) { const bar = S.bars[S.i]; exit(bar.c, bar, "closed by you"); panel(); } return;
      case "review": return startReview(Number(a));
      case "dismiss": $("#simBanner").hidden = true; return;
      case "rnext": if (S.reviewing.k < S.reviewing.items.length - 1) { S.reviewing.k++; return showReview(); } return endReview();
      case "rprev": S.reviewing.k = Math.max(0, S.reviewing.k - 1); return showReview();
    }
  }

  // laptop / iPad keyboard: Space play/pause · → next candle · B buy · S sell · 1/2/3 price/stop/target · Enter place · F full screen · Esc close the review
  function onKey(e) {
    if (!S || e.target.closest("input,textarea,select")) return;
    const k = e.key.toLowerCase(), go = (fn) => { e.preventDefault(); fn(); };
    if (k === " ") return go(play);
    if (k === "arrowright") return go(() => { stop(); step(); });
    if (k === "b") return go(() => { S.ticket.side = 1; panel(); });
    if (k === "s") return go(() => { S.ticket.side = -1; panel(); });
    if (["1", "2", "3"].includes(k)) return go(() => { S.ticket.field = ["entry", "sl", "tp"][Number(k) - 1]; panel(); });
    if (k === "enter" && !S.reviewing) return go(place);
    if (k === "f") return go(fullScreen);
    if (k === "escape" && S.reviewing) return go(endReview);
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

  window.EdgeSim = { open, close, openLab, _labRun: labRun, _state: () => S, _review: review, _londonPlan: londonPlan, _gasZones: gasZones, MK };
})();
