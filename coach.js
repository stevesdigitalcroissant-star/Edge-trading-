// Edge Coach (browser side): shares your chart window, sends a screenshot every
// few seconds (only when the chart changed), shows + speaks the instruction.
// Lives outside the main view so it keeps running while you switch tabs.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const root = $("#coach");
  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  let stream = null, video = null, timer = null, busy = false, lastSent = 0, lastThumb = null, last = null, inTrade = false;
  let mode = "live", muted = false, spokenAt = 0, spoken = "", history = [], pip = null, errors = 0;
  try { mode = localStorage.getItem("edge.coachMode") || "live"; muted = localStorage.getItem("edge.mute") === "1"; } catch {}

  const settings = () => (window.Edge && window.Edge.state() ? window.Edge.state().settings : { coachIdleSec: 60, coachTradeSec: 20, beAtR: 2, tpAtR: 3.2 });

  function render() {
    const s = settings();
    root.innerHTML = `
      <section class="card">
        <div class="row between"><h2 style="margin:0">Coach — watches your chart with you</h2>
          <span class="pill ${stream ? "good" : ""}">${stream ? "● watching" : "off"}</span></div>
        <p class="muted">Share the window with your chart (TradingView, FX Replay, Tradovate, NinjaTrader). Edge reads it every ${s.coachIdleSec}s while you wait and every ${s.coachTradeSec}s in a trade, and tells you — out loud — the one thing to do now.</p>
        ${canShare ? "" : `<div class="blocks">Screen sharing isn't available here. Open Edge on your computer in Chrome or Edge.</div>`}
        <div class="seg" style="margin:10px 0;grid-template-columns:1fr 1fr" id="cMode">
          <button type="button" class="${mode === "live" ? "on p1" : ""}" data-m="live">Live (prop account)</button>
          <button type="button" class="${mode === "replay" ? "on z" : ""}" data-m="replay">Practice (FX Replay)</button>
        </div>
        <div class="row">
          ${stream ? `<button class="btn danger" id="cStop">Stop watching</button><button class="btn" id="cNow">Check now</button>` : `<button class="btn primary" id="cStart" ${canShare ? "" : "disabled"}>Start watching my chart</button>`}
          <button class="btn small" id="cMute">${muted ? "🔇 Voice off" : "🔊 Voice on"}</button>
          ${"documentPictureInPicture" in window ? `<button class="btn small" id="cPip">⧉ Float over my chart</button>` : ""}
        </div>
        ${stream ? `<div class="row" style="margin-top:10px"><input id="cAsk" placeholder="Ask the coach (e.g. is this A+? where's my stop?)"><button class="btn small" id="cAskBtn">Ask</button></div>` : ""}
      </section>
      <div id="cLive">${liveCard()}</div>
      <section class="card"><h2>Last instructions</h2><div class="log">${history.map((h) => `<div><time>${new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>${esc(h.text)}</div>`).join("") || `<p class="muted">Nothing yet.</p>`}</div></section>
      <section class="card"><h2>Good to know</h2><ul class="steps muted">
        <li>Share only the chart window — not your whole screen. Make the chart big, symbol and timeframe visible.</li>
        <li>Keep Edge open (use ⧉ Float to keep the coach on top of your chart). Your screenshots go to Claude to be read; nothing else on your screen is sent.</li>
        <li>Each check costs a few cents of API use. It only sends when the chart changed. Daily limit: ${s.coachDailyChecks || 600} checks (Rules).</li>
        <li>Practice mode logs trades as practice — they never count in your real stats or limits.</li>
        <li>The coach reads numbers off a picture: if a level looks wrong, tap the trade in the Journal and correct it.</li>
      </ul></section>
      <video id="cVideo" muted playsinline style="display:none"></video>`;
    bind();
    if (stream) { video = $("#cVideo"); video.srcObject = stream; video.play().catch(() => {}); }
  }

  function liveCard() {
    if (!last) return stream ? `<section class="card"><p class="muted">Reading your chart…</p></section>` : "";
    const s = settings();
    const u = last.urgency === "act_now" ? "bad" : last.urgency === "warn" ? "warn" : "good";
    const t = last.trade;
    const pct = (r) => `${Math.max(0, Math.min(100, ((r + 1) / (s.tpAtR + 1)) * 100))}%`;
    return `<section class="banner ${u === "good" ? "good" : "bad"}" style="font-size:20px">${esc(last.instruction)}
        <p class="muted" style="font-size:14px">${esc(last.reasoning || "")}</p></section>
      <section class="card">
        <div class="row between"><span class="pill">${esc(last.symbol || "?")} · ${esc(last.timeframe || "?")}</span>
          <span class="pill">${esc((last.phase || "").replace(/_/g, " "))}</span>
          <span class="pill ${last.grade === "A+" ? "good" : last.grade === "none" ? "" : "warn"}">${last.grade === "none" ? "no setup" : "grade " + esc(last.grade)}</span></div>
        ${t && t.r != null ? `<div class="ruler" style="--zero:${pct(0)};--be:${pct(s.beAtR)}"><div class="bar"></div>
          <span class="tick" style="left:${pct(-1)}">SL</span><span class="tick" style="left:${pct(0)}">Entry</span>
          <span class="tick" style="left:${pct(s.beAtR)}">BE ${s.beAtR}R</span><span class="tick" style="left:${pct(s.tpAtR)}">TP ${s.tpAtR}R</span>
          <span class="now" style="left:${pct(t.r)}"></span></div>
          <p class="num" style="font-size:22px;margin:4px 0"><b>${t.r > 0 ? "+" : ""}${t.r}R</b> <small class="muted">best ${t.maxR}R</small></p>` : ""}
        <ul class="checks">${(last.checklist || []).map((c) => `<li class="${c.status === "pass" ? "" : "no"}"><span>${esc(c.label)}${c.status === "unclear" ? " <small>(can't see — check it)</small>" : ""}${c.note ? ` <small>${esc(c.note)}</small>` : ""}</span></li>`).join("")}</ul>
        ${(last.rules || []).length ? `<p class="muted">Rule applied: ${last.rules.map(esc).join(", ")}</p>` : ""}
        <p class="muted" style="font-size:12px">Checked ${new Date(last.at).toLocaleTimeString()} · ${last.checksToday || 0} checks today</p>
      </section>`;
  }

  function bind() {
    root.querySelectorAll("#cMode [data-m]").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.m; try { localStorage.setItem("edge.coachMode", mode); } catch {}
      last = null; inTrade = false; render();
    }));
    const st = $("#cStart"); if (st) st.addEventListener("click", start);
    const sp = $("#cStop"); if (sp) sp.addEventListener("click", stop);
    const nw = $("#cNow"); if (nw) nw.addEventListener("click", () => tick(true));
    const mu = $("#cMute"); if (mu) mu.addEventListener("click", () => { muted = !muted; try { localStorage.setItem("edge.mute", muted ? "1" : "0"); } catch {} if (muted) speechSynthesis.cancel(); render(); });
    const pp = $("#cPip"); if (pp) pp.addEventListener("click", openPip);
    const ab = $("#cAskBtn"); if (ab) ab.addEventListener("click", () => { const q = $("#cAsk").value.trim(); if (q) tick(true, q); });
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2, displaySurface: "window" }, audio: false });
      stream.getVideoTracks()[0].addEventListener("ended", stop);
      // unlock speech on this click so later alerts can talk
      if (!muted) speechSynthesis.speak(new SpeechSynthesisUtterance("Coach is watching. Only A plus."));
      render();
      setTimeout(() => tick(true), 1500);
      timer = setInterval(() => tick(false), 3000);
    } catch (e) { window.Edge && window.Edge.toast("Screen sharing was cancelled."); }
  }

  function stop() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; render(); updatePip();
  }

  function frame() {
    if (!video || !video.videoWidth) return null;
    const w = Math.min(1600, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(video, 0, 0, w, h);
    const t = document.createElement("canvas"); t.width = 48; t.height = 27;
    const tx = t.getContext("2d"); tx.drawImage(video, 0, 0, 48, 27);
    const px = tx.getImageData(0, 0, 48, 27).data, thumb = new Uint8Array(48 * 27);
    for (let i = 0; i < thumb.length; i++) thumb[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
    return { url: c.toDataURL("image/jpeg", 0.8), thumb };
  }
  const change = (a, b) => { if (!a || !b) return 1; let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]) > 12 ? 1 : 0; return d / a.length; };

  async function tick(force, question = "") {
    if (!stream || busy) return;
    const s = settings(), now = Date.now(), since = (now - lastSent) / 1000;
    const every = inTrade ? s.coachTradeSec : s.coachIdleSec;
    const f = frame(); if (!f) return;
    const ch = change(f.thumb, lastThumb);
    const due = force || (since >= every && (ch > 0.004 || since >= every * 3)) || (since >= 8 && ch > 0.06);
    if (!due) return;
    busy = true; lastSent = now; lastThumb = f.thumb;
    try {
      const r = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.Edge.token()}` }, body: JSON.stringify({ action: "check", image: f.url, mode, question }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      errors = 0;
      last = { ...j, at: Date.now() };
      inTrade = !!(j.trade);
      if (!history.length || history[0].text !== j.instruction) history = [{ at: Date.now(), text: j.instruction }, ...history].slice(0, 15);
      speak(j);
      const el = $("#cLive"); if (el) el.innerHTML = liveCard();
      const hl = root.querySelector(".log"); if (hl) hl.innerHTML = history.map((h) => `<div><time>${new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>${esc(h.text)}</div>`).join("");
      updatePip();
    } catch (e) {
      if (++errors <= 2 || errors % 10 === 0) window.Edge.toast(e.message, 6000);
    } finally { busy = false; }
  }

  function speak(j) {
    const now = Date.now();
    const changed = j.instruction !== spoken;
    const repeatUrgent = j.urgency === "act_now" && now - spokenAt > 45000;
    if (j.urgency === "act_now" && (changed || repeatUrgent)) beep();
    if (muted || !(changed || repeatUrgent)) return;
    if (!changed && j.urgency === "info") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(j.instruction);
    u.rate = 1.0;
    speechSynthesis.speak(u);
    spoken = j.instruction; spokenAt = now;
  }
  function beep() {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25);
    } catch {}
  }

  // A small always-on-top window that floats over the trading platform (Chrome / Edge).
  async function openPip() {
    try {
      pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 200 });
      const st = pip.document.createElement("style");
      st.textContent = "body{margin:0;font:600 17px/1.35 -apple-system,Segoe UI,sans-serif;background:#0d1117;color:#e6edf3;padding:12px} .u-act_now{color:#f0545c} .u-warn{color:#f2a33a} .u-info{color:#2ec27e} small{color:#8b98a8;font-weight:400;display:block;margin-top:6px}";
      pip.document.head.appendChild(st);
      pip.addEventListener("pagehide", () => (pip = null));
      updatePip();
    } catch { window.Edge.toast("Couldn't open the floating window."); }
  }
  function updatePip() {
    if (!pip) return;
    const t = last && last.trade;
    pip.document.body.innerHTML = !stream ? "<div>Coach is off.</div>" : !last ? "<div>Reading your chart…</div>"
      : `<div class="u-${esc(last.urgency)}">${esc(last.instruction)}</div><small>${esc(last.symbol || "")} ${esc(last.timeframe || "")} · ${last.grade === "none" ? "no setup" : "grade " + esc(last.grade)}${t && t.r != null ? ` · ${t.r > 0 ? "+" : ""}${t.r}R` : ""}</small>`;
  }

  window.EdgeCoach = { render, show(on) { root.hidden = !on; if (on && !root.innerHTML) render(); } };
})();
