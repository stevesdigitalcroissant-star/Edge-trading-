// Edge chart reader (free): shares your TradingView window, reads the script's
// "EDGE code" line off the screen with OCR (Tesseract, runs in your browser),
// turns the ENTER signal into a setup in one click, and guides you live while
// you're in the trade — on screen, out loud, in a floating window, and on your phone.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const OCR_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  let root = null, stream = null, video = null, worker = null, timer = null, busy = false;
  let region = null, misses = 0, status = "", raw = "", prev = null, read = null;
  let signal = null, seenSignals = new Set(), guideRes = null, lastPriceSent = 0, sentPrice = null;
  let muted = false, spoken = "", spokenAt = 0, pip = null, history = [];
  try { muted = localStorage.getItem("edge.mute") === "1"; seenSignals = new Set(JSON.parse(localStorage.getItem("edge.seenSignals") || "[]")); } catch {}

  const api = async (body) => {
    const r = await fetch("/api/app", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.Edge.token()}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  };

  // ---------- reading the EDGE line

  // "EDGE MGC1! LONG E 4207.8 SL 4195.2 PX 4210.1" / "EDGE MGC1! WAIT PX 4210.1"
  function parse(text) {
    let t = ` ${String(text || "").toUpperCase().replace(/[|,]/g, " ").replace(/\s+/g, " ")} `;
    t = t.replace(/\b[E3F]D[G6]E\b/g, "EDGE").replace(/\bL[O0]NG\b/g, "LONG").replace(/\b[S5]H[O0]RT\b/g, "SHORT").replace(/\bWA[I1L]T\b/g, "WAIT")
      .replace(/ [S5][L1I] /g, " SL ").replace(/ P[X×K] /g, " PX ");
    const m = t.match(/EDGE (\S+) (LONG|SHORT|WAIT)(?: (A\+|A4|A|AT))?(?: E ?([\d.]+) SL ?([\d.]+))? PX ?([\d.]+)/);
    if (!m) return null;
    const n = (x) => (x != null && /^\d+(\.\d+)?$/.test(x) ? Number(x) : null);
    // grade: "A+" (liquidity taken) or "A" (first visit, no sweep); older script versions had no grade = A+
    const out = { symbol: m[1].replace(/[^A-Z0-9!]/g, ""), dir: m[2] === "WAIT" ? null : m[2].toLowerCase(), grade: m[3] === "A" ? "A" : "A+", entry: n(m[4]), sl: n(m[5]), px: n(m[6]) };
    if (out.px == null) return null;
    if (out.dir) {
      if (out.entry == null || out.sl == null) return null;
      const k = out.dir === "long" ? 1 : -1;
      if (k * (out.entry - out.sl) <= 0 || Math.abs(out.entry / out.px - 1) > 0.04) return null;
    }
    return out;
  }

  function loadOcr() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = OCR_SRC; s.onload = ok; s.onerror = () => fail(new Error("Couldn't load the text reader — check your internet."));
      document.head.appendChild(s);
    });
  }

  function grab(maxW) {
    const w = Math.min(maxW, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(video, 0, 0, w, h);
    return c;
  }

  // light text on a dark chart reads badly → grey, invert when dark, stretch contrast
  function prep(src, sx, sy, sw, sh, scale) {
    const c = document.createElement("canvas"); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    const dark = sum / (d.length / 4) < 128;
    for (let i = 0; i < d.length; i += 4) {
      let v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (dark) v = 255 - v;
      v = v < 140 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  const wordsOf = (data) => data.words && data.words.length ? data.words
    : (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => l.words || [])));

  // find the EDGE line anywhere on the shared window (slow — only when we lost it)
  async function locate() {
    const c = grab(2000);
    const { data } = await worker.recognize(prep(c, 0, 0, c.width, c.height, 1));
    const words = wordsOf(data);
    const anchor = words.find((w) => /^[E3F]D[G6]E$/i.test((w.text || "").trim()));
    if (!anchor) return false;
    const a = anchor.bbox, mid = (a.y0 + a.y1) / 2, hgt = a.y1 - a.y0;
    const line = words.filter((w) => { const m = (w.bbox.y0 + w.bbox.y1) / 2; return Math.abs(m - mid) < hgt * 0.7 && w.bbox.x0 >= a.x0 - 5; });
    const x0 = Math.min(...line.map((w) => w.bbox.x0)), x1 = Math.max(...line.map((w) => w.bbox.x1));
    const y0 = Math.min(...line.map((w) => w.bbox.y0)), y1 = Math.max(...line.map((w) => w.bbox.y1));
    const padX = hgt * 1.5, padY = hgt * 0.6;
    region = { x: Math.max(0, x0 - padX) / c.width, y: Math.max(0, y0 - padY) / c.height, w: Math.min(c.width, x1 + padX * 3) / c.width, h: Math.min(c.height, y1 + padY) / c.height };
    region.w -= region.x; region.h -= region.y;
    return true;
  }

  async function readLine() {
    const c = grab(4000);
    const sx = region.x * c.width, sy = region.y * c.height, sw = region.w * c.width, sh = region.h * c.height;
    const scale = Math.max(1, Math.min(4, 70 / sh));
    const img = prep(c, sx, sy, sw, sh, scale);
    const { data } = await worker.recognize(img);
    return (data.text || "").replace(/\n+/g, " ").trim();
  }

  // ---------- the loop

  async function tick() {
    if (!stream || busy || !video || !video.videoWidth) return;
    busy = true;
    try {
      if (!region || misses >= 3) {
        status = "Looking for the EDGE line on your chart…"; paint();
        misses = 0;
        if (!(await locate())) { region = null; status = "Can't see the EDGE line. Share the TradingView window with the Edge S&D panel showing (top-right of the chart)."; return; }
      }
      raw = await readLine();
      const p = parse(raw);
      if (!p) { misses++; status = "Reading… (couldn't read the line cleanly — make the chart window bigger if this stays)"; return; }
      misses = 0;
      // act only on two matching reads in a row: one misread digit must never move anything
      const same = prev && prev.symbol === p.symbol && prev.dir === p.dir && prev.entry === p.entry && prev.sl === p.sl && Math.abs(prev.px / p.px - 1) < 0.003;
      prev = p;
      if (!same) { status = "Reading…"; return; }
      read = { ...p, at: Date.now() };
      status = "";
      await onRead(read);
    } catch (e) {
      status = e.message;
    } finally { busy = false; paint(); }
  }

  async function onRead(p) {
    // a new ENTER signal on the chart
    if (p.dir) {
      const key = `${p.symbol}|${p.dir}|${p.grade}|${p.entry}|${p.sl}`;
      if (!seenSignals.has(key)) {
        seenSignals.add(key);
        try { localStorage.setItem("edge.seenSignals", JSON.stringify([...seenSignals].slice(-50))); } catch {}
        signal = { ...p, key, at: Date.now() };
        say(p.grade === "A+" ? `A plus ${p.dir} signal. Entry ${p.entry}, stop ${p.sl}. Check it in Edge before you click.` : `A ${p.dir} signal, no liquidity sweep. Entry ${p.entry}, stop ${p.sl}. Check it in Edge before you click.`, "act_now", true);
      }
    }
    // the live price → Edge's trade manager (break-even, target, phone alerts)
    const now = Date.now();
    if (now - lastPriceSent >= 4000 || sentPrice !== p.px) {
      lastPriceSent = now; sentPrice = p.px;
      try {
        const before = guideRes ? guideRes.trades.length : 0;
        guideRes = await api({ action: "chartPrice", symbol: p.symbol, price: p.px });
        const t = guideRes.trades[0];
        if (t) say(t.text, t.urgency);
        else if (before && guideRes.closed) say("Trade closed. Write one line in the journal about how you followed the plan.", "info", true);
      } catch (e) { status = e.message; }
    }
  }

  // ---------- voice + floating window

  function say(text, urgency = "info", force = false) {
    const now = Date.now();
    const changed = text !== spoken;
    const repeat = urgency === "act_now" && now - spokenAt > 45000;
    if (!(changed || repeat || force)) return;
    if (changed) history = [{ at: now, text }, ...history].slice(0, 15);
    if (urgency === "act_now") beep();
    spoken = text; spokenAt = now;
    if (muted || (!changed && !repeat && !force)) return;
    try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
  }
  function beep() {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25);
    } catch {}
  }
  async function openPip() {
    try {
      pip = await window.documentPictureInPicture.requestWindow({ width: 400, height: 210 });
      const st = pip.document.createElement("style");
      st.textContent = "body{margin:0;font:600 17px/1.35 -apple-system,Segoe UI,sans-serif;background:#0d1117;color:#e6edf3;padding:12px} .act_now{color:#f0545c} .warn{color:#f2a33a} .info{color:#2ec27e} small{color:#8b98a8;font-weight:400;display:block;margin-top:6px}";
      pip.document.head.appendChild(st);
      pip.addEventListener("pagehide", () => (pip = null));
      paintPip();
    } catch { window.Edge.toast("Couldn't open the floating window."); }
  }
  function paintPip() {
    if (!pip) return;
    const t = guideRes && guideRes.trades[0];
    pip.document.body.innerHTML = !stream ? "<div>Chart reader is off.</div>"
      : t ? `<div class="${esc(t.urgency)}">${esc(t.text)}</div><small>${t.r > 0 ? "+" : ""}${t.r}R · BE at ${esc(t.beTrigger)} · TP ${esc(t.tp)}</small>`
      : signal && Date.now() - signal.at < 15 * 60e3 ? `<div class="act_now">${esc(signal.grade)} ${esc(signal.dir.toUpperCase())} signal — entry ${esc(signal.entry)}, SL ${esc(signal.sl)}</div><small>Open Edge → Take it, if you're calm.</small>`
      : `<div class="info">No trade. Waiting for an A+ signal.</div><small>${read ? `${esc(read.symbol)} · ${esc(read.px)}` : "Reading…"}</small>`;
  }

  // ---------- screen

  async function start() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2, displaySurface: "window" }, audio: false });
      stream.getVideoTracks()[0].addEventListener("ended", stop);
      if (!muted) try { speechSynthesis.speak(new SpeechSynthesisUtterance("Chart reader on. Only A plus.")); } catch {}
      status = "Loading the text reader (first time takes a few seconds)…"; render();
      await loadOcr();
      if (!worker) {
        worker = await window.Tesseract.createWorker("eng");
        await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!:-+ ", preserve_interword_spaces: "1" });
      }
      status = "Looking for the EDGE line on your chart…"; paint();
      timer = setInterval(tick, 2500);
      tick();
    } catch (e) { stop(); window.Edge.toast(e.message && !/Permission|NotAllowed/i.test(e.name + e.message) ? e.message : "Screen sharing was cancelled."); }
  }
  function stop() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; region = null; prev = null; status = ""; render(); paintPip();
  }

  async function takeSignal() {
    if (!signal) return;
    try {
      const r = await api({ action: "chartSetup", symbol: signal.symbol, dir: signal.dir, grade: signal.grade, entry: signal.entry, sl: signal.sl });
      if (r.takeable === false) window.Edge.toast(`Edge says skip: ${(r.why || [])[0] || "a rule blocks it"}`, 7000);
      window.Edge.go("setups");
    } catch (e) { window.Edge.toast(e.message, 7000); }
  }

  // ---------- page

  function liveHtml() {
    const s = (window.Edge && window.Edge.state() && window.Edge.state().settings) || { beAtR: 2, tpAtR: 3.2 };
    const t = guideRes && guideRes.trades[0];
    const tpR = (t && t.tpR) || s.tpAtR, beR = t && t.beR != null ? t.beR : s.beAtR;
    const pct = (r) => `${Math.max(0, Math.min(100, ((r + 1) / (tpR + 1)) * 100))}%`;
    const sig = signal && Date.now() - signal.at < 15 * 60e3 && !t;
    return `
      ${t ? `<section class="banner ${t.urgency === "info" ? "good" : "bad"}" style="font-size:20px">${esc(t.text)}</section>
        <section class="card">
          <div class="row between"><span class="pill">${esc(read ? read.symbol : "")} · ${esc(t.dir.toUpperCase())} from ${esc(t.entry)}</span><span class="pill">price ${esc(read ? read.px : "?")}</span></div>
          <div class="ruler" style="--zero:${pct(0)};--be:${pct(beR > 0 ? beR : 0)}"><div class="bar"></div>
            <span class="tick" style="left:${pct(-1)}">SL</span><span class="tick" style="left:${pct(0)}">Entry</span>
            ${beR > 0 ? `<span class="tick" style="left:${pct(beR)}">BE ${beR}R</span>` : ""}<span class="tick" style="left:${pct(tpR)}">TP ${tpR}R</span>
            <span class="now" style="left:${pct(t.r ?? 0)}"></span></div>
          <p class="num" style="font-size:22px;margin:4px 0"><b>${t.r > 0 ? "+" : ""}${t.r}R</b> <small class="muted">best ${t.maxR}R</small></p>
          <ul class="steps muted"><li>Stop now: <b>${esc(t.stop)}</b></li><li>At <b>${esc(t.beTrigger)}</b> → move stop to <b>${esc(t.beStop)}</b> (break-even)</li><li>Full exit at <b>${esc(t.tp)}</b></li></ul>
        </section>`
      : sig ? `<section class="banner bad" style="font-size:20px">${esc(signal.grade)} ${esc(signal.dir.toUpperCase())} signal on ${esc(signal.symbol)} — entry ${esc(signal.entry)} · SL ${esc(signal.sl)}</section>
        <section class="card"><p class="muted">Every step is done on the chart: 4H trend, fresh zone, liquidity taken, 15m break, 5m close. Edge still checks your limits, the news and your mood before you take it.</p>
          <div class="row"><button class="btn primary" id="rTake">Take it in Edge →</button><button class="btn" id="rDismiss">Not this one</button></div></section>`
      : stream ? `<section class="card"><p>${read ? `<b>No trade.</b> Waiting for an A+ signal on ${esc(read.symbol)} · price ${esc(read.px)}` : "Reading your chart…"}</p></section>` : ""}
      ${stream ? `<section class="card"><p class="muted" style="font-size:12px;margin:0">${status ? esc(status) + "<br>" : ""}Last read: <code>${esc(raw || "—")}</code></p></section>` : ""}`;
  }

  function html() {
    return `
      <section class="card">
        <div class="row between"><h2 style="margin:0">Chart reader — free</h2>
          <span class="pill ${stream ? "good" : ""}">${stream ? "● reading" : "off"}</span></div>
        <p class="muted">Edge reads the <b>EDGE</b> line from the Edge S&D panel on your TradingView chart. When the script says <b>ENTER</b>, you take it here in one click. Once you're in, it watches the price and tells you — on screen, out loud and on your phone — when to move your stop to break-even and when to get out.</p>
        ${canShare ? "" : `<div class="blocks">Screen reading works on a computer, in Chrome or Edge.</div>`}
        <div class="row">
          ${stream ? `<button class="btn danger" id="rStop">Stop reading</button>` : `<button class="btn primary" id="rStart" ${canShare ? "" : "disabled"}>Start reading my chart</button>`}
          <button class="btn small" id="rMute">${muted ? "🔇 Voice off" : "🔊 Voice on"}</button>
          ${"documentPictureInPicture" in window ? `<button class="btn small" id="rPip">⧉ Float over my chart</button>` : ""}
        </div>
      </section>
      <div id="rLive">${liveHtml()}</div>
      <section class="card"><h2>Last instructions</h2><div class="log" id="rLog">${logHtml()}</div></section>
      <section class="card"><h2>Good to know</h2><ul class="steps muted">
        <li>Share the <b>TradingView window</b> (not the whole screen), with the Edge S&D panel visible in the top-right corner.</li>
        <li>It's free: the reading happens in this browser. Nothing is sent anywhere except the price and the signal, to your Edge.</li>
        <li>Edge only acts when it reads the same thing twice in a row, and ignores prices far from your trade — a misread can't close anything.</li>
        <li>After you click buy/sell in TradingView, tap <b>Take it</b> here with your real fill price, so the stop and target match your trade.</li>
      </ul></section>
      <video id="rVideo" muted playsinline style="display:none"></video>`;
  }
  const logHtml = () => history.map((h) => `<div><time>${new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>${esc(h.text)}</div>`).join("") || `<p class="muted">Nothing yet.</p>`;

  function paint() {
    if (!root) return;
    const live = $("#rLive", root); if (live) { live.innerHTML = liveHtml(); bindLive(); }
    const lg = $("#rLog", root); if (lg) lg.innerHTML = logHtml();
    paintPip();
  }
  function bindLive() {
    const tk = $("#rTake", root); if (tk) tk.addEventListener("click", takeSignal);
    const ds = $("#rDismiss", root); if (ds) ds.addEventListener("click", () => { signal = null; paint(); });
  }
  function bind() {
    const st = $("#rStart", root); if (st) st.addEventListener("click", start);
    const sp = $("#rStop", root); if (sp) sp.addEventListener("click", stop);
    const mu = $("#rMute", root); if (mu) mu.addEventListener("click", () => { muted = !muted; try { localStorage.setItem("edge.mute", muted ? "1" : "0"); } catch {} if (muted) speechSynthesis.cancel(); render(); });
    const pp = $("#rPip", root); if (pp) pp.addEventListener("click", openPip);
    bindLive();
  }
  function render() {
    if (!root || !root.isConnected) return;
    // keep the shared screen alive across re-renders
    root.innerHTML = html();
    if (stream) { const nv = $("#rVideo", root); nv.srcObject = stream; nv.play().catch(() => {}); video = nv; }
    bind();
  }

  window.EdgeReader = { mount(el) { root = el; render(); }, active: () => !!stream, parse };
})();
