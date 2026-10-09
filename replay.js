// Edge replay (free practice): real past 5m candles play back; the same rules as the
// TradingView script find every A+ setup, say ENTER, manage break-even and target, and
// log the result to your practice journal. You only decide: take it or skip it.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const C4 = "#9b5de5", C15 = "#2f80ed", C5 = "#f2c94c";
  const NAMES = { gold: "Gold", crude: "Crude oil", natgas: "Natural gas" };
  const WARMUP = 288 * 8; // 8 days so the 4H structure exists

  let root = null, market = "gold", bars = null, res = null, byI = new Map(), i = 0, loading = false, err = "";
  let playing = false, speed = 4, timer = null, autoTake = false, muted = false;
  let pending = null, taken = new Map(), skipped = [], feed = [], spoken = "";
  try { market = localStorage.getItem("edge.replayMarket") || "gold"; speed = +localStorage.getItem("edge.replaySpeed") || 4; autoTake = localStorage.getItem("edge.replayAuto") === "1"; muted = localStorage.getItem("edge.mute") === "1"; } catch {}

  const settings = () => (window.Edge && window.Edge.state() && window.Edge.state().settings) || { beAtR: 2, tpAtR: 3.2, beOffsetR: 0.05 };
  const fx = (x) => (x == null ? "—" : x >= 100 ? x.toFixed(2) : x.toFixed(3));
  const when = (t) => new Date(t).toLocaleString([], { timeZone: "America/New_York", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " NY";
  const idxOf = (t) => { let lo = 0, hi = bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].t <= t) lo = m; else hi = m - 1; } return lo; };

  function say(text, loud) {
    feed = [{ at: bars ? bars[i].t : Date.now(), text }, ...feed].slice(0, 30);
    if (loud) beep();
    if (muted || text === spoken) return;
    spoken = text;
    try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/A\+/g, "A plus"))); } catch {}
  }
  function beep() {
    try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25); } catch {}
  }

  // ---------- data

  async function load() {
    loading = true; err = ""; stop(); render();
    try {
      const r = await fetch(`/api/candles?m=${market}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      bars = j.bars.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
      if (bars.length < WARMUP + 300) throw new Error("Not enough candles came back — try again later.");
      const s = settings();
      res = window.EdgeEngine.run(bars, market, { beR: s.beAtR, tpR: s.tpAtR, beOffR: s.beOffsetR });
      byI = new Map();
      for (const ev of res.events) { if (!byI.has(ev.i)) byI.set(ev.i, []); byI.get(ev.i).push(ev); }
      pending = null; taken = new Map(); skipped = []; feed = [];
      randomDay();
    } catch (e) { err = e.message; bars = null; res = null; }
    loading = false; render();
  }

  // start a little before a session opens on a random day, so you see the setup form
  function randomDay() {
    const starts = [];
    for (let k = WARMUP; k < bars.length - 300; k++) if (res.states[k].inSess && !res.states[k - 1].inSess) starts.push(k);
    i = starts.length ? starts[Math.floor(Math.random() * starts.length)] - 24 : WARMUP;
    pending = null;
    for (const t of taken.values()) t.done = true; // a new day abandons the old one (not logged)
  }

  // ---------- playback

  function step() {
    if (!res || i >= bars.length - 1) { stop(); if (res) say("End of the data. Pick another day.", false); paint(); return; }
    i++;
    for (const ev of byI.get(i) || []) onEvent(ev);
    paint();
  }
  function onEvent(ev) {
    const name = NAMES[market];
    if (ev.type === "enter") {
      const side = ev.dir === 1 ? "LONG" : "SHORT";
      if (autoTake) { taken.set(ev.i, { ev, be: false }); say(`A+ ${side} ${name} — taken at ${fx(ev.entry)}. Stop ${fx(ev.sl)}, target ${fx(ev.tp)}.`, true); return; }
      pending = ev; stop();
      say(`A+ ${side} on ${name}. Enter at ${fx(ev.entry)}, stop ${fx(ev.sl)}. Take it or skip it.`, true);
    }
    if (ev.type === "skip") feed = [{ at: bars[i].t, text: `${ev.dir === 1 ? "Long" : "Short"} trigger skipped — ${ev.why}. Not A+, no trade.` }, ...feed].slice(0, 30);
    const mine = [...taken.values()].find((x) => !x.done);
    if (ev.type === "be" && mine) { mine.be = true; say(`Plus ${settings().beAtR} R. Move your stop to break-even, ${fx(ev.stop)}.`, true); }
    if (ev.type === "exit") {
      if (mine) { mine.done = true; log(mine.ev, ev); }
      else { const sk = skipped.find((x) => !x.result); if (sk) { sk.result = ev.outcome; say(`The A+ you skipped ended at ${ev.outcome === "tp" ? "the target" : ev.outcome === "be" ? "break-even" : ev.outcome === "flat" ? "the session close-out" : "the stop"}.`, false); } }
    }
  }
  async function log(enter, exit) {
    const text = exit.outcome === "flat" ? `Close-out time — out of the trade at ${fx(exit.price)}. No holding into the session close.` : exit.outcome === "tp" ? `Target hit — +${settings().tpAtR}R. Out, done.` : exit.outcome === "be" ? "Stopped at break-even — no loss. The rule protected you." : "Stopped out, −1R. That's the plan working. No revenge.";
    say(text, true);
    try {
      const r = await fetch("/api/app", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.Edge.token()}` },
        body: JSON.stringify({ action: "practiceLog", market, dir: enter.dir === 1 ? "long" : "short", entry: enter.entry, sl: enter.sl, liquidity: enter.swept, outcome: exit.outcome, exit: exit.price, openedAt: bars[enter.i].t,
          steps: { "4H trend": true, "fresh zone": true, "liquidity taken": true, "15m break": true, "5m close": true }, note: `Edge replay ${when(bars[enter.i].t)}` }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
      if (window.Edge.refresh) window.Edge.refresh();
    } catch (e) { window.Edge.toast(`Couldn't log it: ${e.message}`, 6000); }
  }
  function play() { if (!res || pending) return; playing = true; clearInterval(timer); timer = setInterval(step, 1000 / speed); paint(); }
  function stop() { playing = false; clearInterval(timer); timer = null; }
  function nextSetup() {
    if (!res) return;
    let ev = res.events.find((e) => e.type === "enter" && e.i > i + 1);
    if (!ev) {
      // none left ahead → start over from the earliest one
      ev = res.events.find((e) => e.type === "enter" && e.i - 36 >= WARMUP);
      if (!ev) return window.Edge.toast("No A+ setup in these 60 days. Try another market.");
      for (const t of taken.values()) t.done = true;
      i = ev.i - 36;
    }
    stop(); pending = null;
    const to = Math.max(i, ev.i - 36); // 3 hours before it, so you watch it form
    // a trade you're in still plays out while we skip ahead
    for (let k = i + 1; k <= to; k++) for (const e of byI.get(k) || []) if (e.type === "be" || e.type === "exit") onEvent(e);
    i = to;
    say(`Jumped to ${when(bars[i].t)}. An A+ setup forms in the next 3 hours — watch the steps.`, false);
    paint(); play();
  }

  // ---------- chart

  function draw() {
    const cv = $("#rpChart", root); if (!cv || !res) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext("2d"); x.scale(dpr, dpr);
    const N = Math.max(40, Math.min(160, Math.floor(W / 6))), from = Math.max(0, i - N + 1), padR = 64, cw = (W - padR) / N;
    const st = res.states[i];
    let lo = Infinity, hi = -Infinity;
    for (let k = from; k <= i; k++) { lo = Math.min(lo, bars[k].l); hi = Math.max(hi, bars[k].h); }
    const span = hi - lo || 1;
    const near = (v) => v != null && v > lo - span * 0.6 && v < hi + span * 0.6;
    const live = [...taken.values()].find((t) => !t.done) || (pending ? { ev: pending } : null);
    const tr = live ? live.ev : null;
    for (const v of [st.dValid && st.dTop, st.dValid && st.dBot, st.sValid && st.sTop, st.sValid && st.sBot]) if (v && near(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (tr) for (const v of [tr.sl, tr.be, tr.tp]) { lo = Math.min(lo, v); hi = Math.max(hi, v); } // always show the whole trade
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const Y = (v) => ((hi - v) / (hi - lo)) * H, X = (k) => (k - from) * cw + cw / 2;
    const css = getComputedStyle(document.documentElement);
    x.fillStyle = "#0f1115"; x.fillRect(0, 0, W, H);
    // price grid
    x.font = "10px ui-monospace, monospace"; x.fillStyle = "#6b7280"; x.strokeStyle = "rgba(255,255,255,.05)";
    for (let g = 0; g <= 5; g++) { const v = lo + ((hi - lo) * g) / 5, y = Y(v); x.beginPath(); x.moveTo(0, y); x.lineTo(W - padR, y); x.stroke(); x.fillText(fx(v), W - padR + 6, y + 3); }
    // zones
    const zone = (top, bot, fromI, label, a) => { const x0 = Math.max(0, X(Math.max(fromI, from)) - cw / 2); x.fillStyle = `rgba(155,93,229,${a})`; x.fillRect(x0, Y(top), W - padR - x0, Y(bot) - Y(top)); x.strokeStyle = "rgba(155,93,229,.6)"; x.strokeRect(x0, Y(top), W - padR - x0, Y(bot) - Y(top)); x.fillStyle = C4; x.fillText(label, x0 + 4, Y(top) + 11); };
    if (st.dValid && near(st.dTop)) zone(st.dTop, st.dBot, st.dFrom, "4H DEMAND", 0.16);
    if (st.sValid && near(st.sBot)) zone(st.sTop, st.sBot, st.sFrom, "4H SUPPLY", 0.12);
    // latest break of structure per timeframe
    const last = {};
    for (const ev of res.events) { if (ev.i > i) break; if (ev.type === "bos") last[ev.tf] = ev; }
    for (const [tf, col, w, dash] of [["4H", C4, 2.5, []], ["15m", C15, 2, [6, 4]], ["5m", C5, 1.2, [2, 3]]]) {
      const ev = last[tf]; if (!ev || !near(ev.lvl)) continue;
      const a = Math.max(from, idxOf(ev.from)), b2 = Math.max(a + 1, idxOf(ev.to)); if (b2 < from) continue;
      x.strokeStyle = col; x.lineWidth = w; x.setLineDash(dash); x.beginPath(); x.moveTo(X(a), Y(ev.lvl)); x.lineTo(X(Math.min(b2, i)), Y(ev.lvl)); x.stroke(); x.setLineDash([]); x.lineWidth = 1;
      x.fillStyle = col; x.fillText(`${tf} BOS ${ev.dir === 1 ? "↑" : "↓"}`, X(Math.min(b2, i)) + 4, Y(ev.lvl) - 3);
    }
    // liquidity sweeps
    for (const ev of res.events) {
      if (ev.i > i) break;
      if (ev.type !== "sweep" || ev.i < from || !near(ev.lvl)) continue;
      x.strokeStyle = "rgba(255,255,255,.55)"; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(X(Math.max(ev.from, from)), Y(ev.lvl)); x.lineTo(X(ev.i), Y(ev.lvl)); x.stroke(); x.setLineDash([]);
      x.fillStyle = "#e5e7eb"; x.fillText(`$$$ ${ev.name} taken`, X(Math.max(ev.from, from)), Y(ev.lvl) + (ev.dir === 1 ? 12 : -4));
    }
    // candles
    for (let k = from; k <= i; k++) {
      const b = bars[k], up = b.c >= b.o, col = up ? "#26a69a" : "#ef5350";
      x.strokeStyle = col; x.beginPath(); x.moveTo(X(k), Y(b.h)); x.lineTo(X(k), Y(b.l)); x.stroke();
      x.fillStyle = col; const y0 = Y(Math.max(b.o, b.c)), y1 = Y(Math.min(b.o, b.c)); x.fillRect(X(k) - cw * 0.35, y0, cw * 0.7, Math.max(1, y1 - y0));
    }
    // the trade
    if (tr) {
      const a = Math.max(tr.i, from);
      for (const [v, col, label, dash] of [[tr.entry, "#9ca3af", "entry", []], [tr.sl, "#ef4444", "SL", []], [tr.be, "#f59e0b", `BE at ${settings().beAtR}R`, [5, 4]], [tr.tp, "#22c55e", `TP ${settings().tpAtR}R`, []]]) {
        x.strokeStyle = col; x.setLineDash(dash); x.lineWidth = label === "entry" ? 1 : 2; x.beginPath(); x.moveTo(X(a), Y(v)); x.lineTo(W - padR, Y(v)); x.stroke(); x.setLineDash([]); x.lineWidth = 1;
        x.fillStyle = col; x.fillRect(W - padR, Y(v) - 7, padR, 14); x.fillStyle = "#000"; x.fillText(`${label} ${fx(v)}`.slice(0, 11), W - padR + 3, Y(v) + 3);
      }
    }
    // entry / exit markers
    for (const ev of res.events) {
      if (ev.i > i) break;
      if (ev.i < from) continue;
      if (ev.type === "enter") { x.fillStyle = ev.dir === 1 ? "#22c55e" : "#ef4444"; const y = ev.dir === 1 ? Y(bars[ev.i].l) + 14 : Y(bars[ev.i].h) - 6; x.font = "bold 11px system-ui"; x.fillText(ev.dir === 1 ? "▲ ENTER A+" : "▼ ENTER A+", X(ev.i) - 24, y); x.font = "10px ui-monospace, monospace"; }
      if (ev.type === "exit") { x.fillStyle = ev.outcome === "tp" ? "#22c55e" : ev.outcome === "be" ? "#f59e0b" : "#ef4444"; x.fillText(ev.outcome === "tp" ? "🎯 TP" : ev.outcome === "be" ? "BE" : ev.outcome === "flat" ? "close-out" : "SL", X(ev.i) - 6, Y(bars[ev.i].h) - 6); }
      if (ev.type === "skip") { x.fillStyle = "#6b7280"; x.fillText("skip", X(ev.i) - 8, ev.dir === 1 ? Y(bars[ev.i].l) + 12 : Y(bars[ev.i].h) - 4); }
    }
    void css;
  }

  // ---------- page

  function panelHtml() {
    if (!res) return "";
    const p = window.EdgeEngine.panel(res, i);
    const live = [...taken.values()].find((t) => !t.done);
    return `
      ${pending ? `<section class="banner bad" style="font-size:19px">A+ ${pending.dir === 1 ? "LONG" : "SHORT"} — enter at ${fx(pending.entry)} · stop ${fx(pending.sl)} · target ${fx(pending.tp)}
          <p>Every step is done. The liquidity taken: ${esc(pending.swept)}. Calm? Then take it.</p>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="rpTake">Take it</button><button class="btn" id="rpSkip">Skip</button></div></section>`
      : `<section class="banner ${live ? (live.be ? "good" : "bad") : "good"}" style="font-size:17px">${esc(p.doNow)}</section>`}
      <section class="card">
        <div class="row between"><b>${esc(NAMES[market])} · 5m · ${esc(when(bars[i].t))}</b><span class="pill">${fx(bars[i].c)}</span></div>
        <ul class="checks">${p.steps.map(([label, ok, note], k) => `<li class="${ok ? "" : "no"}"><span>${k + 1}. ${esc(label)} <small>${esc(note)}</small></span></li>`).join("")}</ul>
      </section>`;
  }
  const feedHtml = () => feed.map((f) => `<div><time>${new Date(f.at).toLocaleTimeString([], { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}</time>${esc(f.text)}</div>`).join("") || `<p class="muted">Press play. Edge speaks when a setup forms.</p>`;

  function html() {
    const st = window.Edge && window.Edge.state() && window.Edge.state().practiceStats;
    const won = skipped.filter((s) => s.result === "tp").length;
    return `
      <section class="card">
        <h2 style="margin-top:0">Replay — Edge finds the setups</h2>
        <p class="muted">Real past candles play back. The same rules as your TradingView script spot every A+ setup and tell you when to enter, when to move the stop and when to get out. You only decide: take it or skip it. Results go to Journal → Practice.</p>
        <div class="seg" style="margin:10px 0" id="rpMkt">${Object.entries(NAMES).map(([k, l]) => `<button type="button" class="${market === k ? "on z" : ""}" data-m="${k}">${l}</button>`).join("")}</div>
        ${err ? `<div class="blocks">${esc(err)}</div>` : ""}
        ${!res ? `<button class="btn primary" id="rpLoad" ${loading ? "disabled" : ""}>${loading ? "Loading 60 days of candles…" : "Load candles"}</button>` : `
        <canvas id="rpChart" style="width:100%;height:340px;border-radius:12px;display:block;margin:8px 0"></canvas>
        <div class="row">
          ${playing ? `<button class="btn" id="rpPause">⏸ Pause</button>` : `<button class="btn primary" id="rpPlay" ${pending ? "disabled" : ""}>▶ Play</button>`}
          <button class="btn small" id="rpStep" ${pending ? "disabled" : ""}>+1 candle</button>
          <button class="btn small" id="rpNext">⏭ Next A+ setup</button>
          <button class="btn small" id="rpDay">🎲 Random day</button>
        </div>
        <div class="row" style="margin-top:8px;align-items:center">
          <span class="muted" style="font-size:13px">Speed</span>
          <div class="seg" style="grid-template-columns:repeat(4,1fr);flex:1" id="rpSpeed">${[1, 4, 10, 30].map((v) => `<button type="button" class="${speed === v ? "on z" : ""}" data-s="${v}">${v}×</button>`).join("")}</div>
        </div>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="rpAuto" ${autoTake ? "checked" : ""}> Take every A+ automatically (just watch how the rules play out)</label>
        <label class="check" style="margin-top:6px"><input type="checkbox" id="rpMute" ${muted ? "" : "checked"}> Speak out loud</label>`}
      </section>
      <div id="rpPanel">${res ? panelHtml() : ""}</div>
      ${res ? `<section class="card"><h2>What Edge said</h2><div class="log" id="rpFeed">${feedHtml()}</div></section>` : ""}
      <section class="card"><h2>Practice so far</h2>
        ${st && st.n ? `<div class="grid2">
          <div class="stat"><small>Trades</small><b>${st.n}</b><small>${st.ruleBreaks} with a rule break</small></div>
          <div class="stat"><small>Total</small><b class="${st.totalR >= 0 ? "pos" : "neg"}">${st.totalR > 0 ? "+" : ""}${st.totalR}R</b><small>win ${st.winRate ?? "—"}%</small></div>
        </div>` : `<p class="muted" style="margin:0">Nothing logged yet.</p>`}
        ${skipped.length ? `<p class="muted" style="font-size:13px">This session you skipped ${skipped.length} A+ setup${skipped.length > 1 ? "s" : ""}${won ? ` — ${won} would have hit the target` : ""}.</p>` : ""}
        <p class="muted" style="font-size:12px">Free price data (Yahoo Finance futures: GC, CL, NG), last ~60 days. The replay never shows you a candle before it closes.</p>
      </section>`;
  }

  function paint() {
    if (!root || !root.isConnected) return stop();
    const pn = $("#rpPanel", root); if (pn) pn.innerHTML = panelHtml();
    const fd = $("#rpFeed", root); if (fd) fd.innerHTML = feedHtml();
    const pp = $("#rpPlay", root) || $("#rpPause", root);
    if (pp && ((playing && pp.id === "rpPlay") || (!playing && pp.id === "rpPause"))) return render();
    bindPanel(); draw();
  }
  function bindPanel() {
    const tk = $("#rpTake", root); if (tk) tk.addEventListener("click", () => { taken.set(pending.i, { ev: pending, be: false }); say("Taken. Stop and target are set. Hands off.", false); pending = null; render(); play(); });
    const sk = $("#rpSkip", root); if (sk) sk.addEventListener("click", () => { skipped.push({ ev: pending }); say("Skipped. Edge will show you how it would have ended.", false); pending = null; render(); play(); });
  }
  function bind() {
    root.querySelectorAll("#rpMkt [data-m]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.m === market && res) return; market = b.dataset.m; try { localStorage.setItem("edge.replayMarket", market); } catch {} load(); }));
    const ld = $("#rpLoad", root); if (ld) ld.addEventListener("click", load);
    const pl = $("#rpPlay", root); if (pl) pl.addEventListener("click", () => { try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {} play(); render(); });
    const pa = $("#rpPause", root); if (pa) pa.addEventListener("click", () => { stop(); render(); });
    const sp = $("#rpStep", root); if (sp) sp.addEventListener("click", () => { stop(); step(); render(); });
    const nx = $("#rpNext", root); if (nx) nx.addEventListener("click", () => { nextSetup(); render(); });
    const dy = $("#rpDay", root); if (dy) dy.addEventListener("click", () => { stop(); randomDay(); say(`New day: ${when(bars[i].t)}.`, false); render(); });
    root.querySelectorAll("#rpSpeed [data-s]").forEach((b) => b.addEventListener("click", () => { speed = +b.dataset.s; try { localStorage.setItem("edge.replaySpeed", speed); } catch {} if (playing) play(); render(); }));
    const au = $("#rpAuto", root); if (au) au.addEventListener("change", () => { autoTake = au.checked; try { localStorage.setItem("edge.replayAuto", autoTake ? "1" : "0"); } catch {} });
    const mu = $("#rpMute", root); if (mu) mu.addEventListener("change", () => { muted = !mu.checked; try { localStorage.setItem("edge.mute", muted ? "1" : "0"); } catch {} if (muted) speechSynthesis.cancel(); });
    bindPanel();
  }
  function render() { if (!root || !root.isConnected) return; root.innerHTML = html(); bind(); draw(); }
  addEventListener("resize", () => draw());

  window.EdgeReplay = { mount(el) { root = el; render(); if (!res && !loading) load(); } };
})();
