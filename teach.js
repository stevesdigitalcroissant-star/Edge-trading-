// "Teach Edge": real past charts, one after another — you mark YOUR zone on the 1H (or 4H), say why, then watch that
// day's 5m play from 03:00 New York and place YOUR trade (entry, stop, target) or pass. Every example is saved to your
// Edge so the scanner can be rebuilt around how you draw. Charts come from your private Databento archive (?teach=1).
(function () {
  const GOAL = 30, WHY = ["Base before a big move", "Fresh / untouched", "Old zone", "With the 4H trend", "At a big level", "Clean pullback", "Liquidity taken"];
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ny = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const tok = () => { try { return localStorage.getItem("edge.token") || ""; } catch { return ""; } };
  const QKEY = "edge.teachQueue"; // examples not sent yet (offline) — sent the next time
  let pool = [], X = null, S = null, ov = null, card = null, saved = null, done = 0, err = "", timer = null;

  async function api(q, opt = {}) { const r = await fetch(`/api/candles?teach=1${q}`, { ...opt, headers: { Authorization: `Bearer ${tok()}`, ...(opt.body ? { "Content-Type": "application/json" } : {}) } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; }
  async function refreshCount() { try { saved = (await api("&label=1")).count; } catch { saved = null; } paintCard(); }
  async function flushQueue() { let q = []; try { q = JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch {} const left = [];
    for (const label of q) { try { await api("&label=1", { method: "POST", body: JSON.stringify({ label }) }); } catch { left.push(label); } }
    try { localStorage.setItem(QKEY, JSON.stringify(left)); } catch {} }
  async function saveLabel(label) { try { await api("&label=1", { method: "POST", body: JSON.stringify({ label }) }); if (saved != null) saved++; } catch { try { const q = JSON.parse(localStorage.getItem(QKEY) || "[]"); q.push(label); localStorage.setItem(QKEY, JSON.stringify(q)); } catch {} } }

  async function nextChart() {
    if (pool.length < 3) { try { const j = await api(""); pool = pool.concat((j.items || []).sort(() => Math.random() - 0.5)); err = ""; } catch (e) { err = e.message; } }
    X = pool.shift() || null;
    S = X && { step: "zone", tf: "1h", zoom: false, taps: [], why: new Set(), k: X.at, playing: false, speed: 1, place: [], trade: null, res: null, noZone: false };
    paint();
  }

  // ---------- one candle chart on a canvas; remembers its price ↔ pixel map so taps become prices
  function chart(cv, bars, o) {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const n = o.slots || bars.length, padR = 58, lv = [...(o.levels || [])].filter((v) => v != null);
    const vis = bars.slice(Math.max(0, bars.length - (n - (o.ahead || 0)))); // leave room on the right for what comes next
    let lo = Math.min(...vis.map((b) => b[2]), ...lv), hi = Math.max(...vis.map((b) => b[1]), ...lv); const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const y = (v) => 8 + (H - 16) * (1 - (v - lo) / (hi - lo)), step = (W - padR - 6) / n, x = (i) => 4 + step * (i + 0.5), bw = Math.max(1, step * 0.66);
    cv._map = { p: (py) => lo + (1 - (py - 8) / (H - 16)) * (hi - lo), y, dec: o.dec };
    g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1; g.font = "600 10.5px system-ui, sans-serif"; g.fillStyle = css("--faint") || "#5c636d"; g.textAlign = "left";
    for (let q = 0; q <= 4; q++) { const v = lo + ((hi - lo) * q) / 4, yy = y(v); g.beginPath(); g.moveTo(0, yy); g.lineTo(W - padR, yy); g.stroke(); g.fillText(v.toFixed(o.dec), W - padR + 4, yy + 3); }
    const band = (a, b, col, lab) => { if (a == null || b == null) return; const t = y(Math.max(a, b)), u = y(Math.min(a, b)); g.fillStyle = col; g.fillRect(0, t, W - padR, Math.max(2, u - t)); if (lab) { g.fillStyle = css("--text") || "#fff"; g.font = "800 11px system-ui, sans-serif"; g.fillText(lab, 6, t - 4 < 12 ? u + 13 : t - 4); } };
    (o.bands || []).forEach((z) => band(z.a, z.b, z.col, z.lab));
    vis.forEach((b, i) => { const up = b[3] >= b[0], c = up ? "#26a69a" : "#ef5350"; g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(x(i), y(b[1])); g.lineTo(x(i), y(b[2])); g.stroke(); const t = y(Math.max(b[0], b[3])); g.fillRect(x(i) - bw / 2, t, bw, Math.max(1, y(Math.min(b[0], b[3])) - t)); });
    (o.lines || []).forEach((l) => { if (l.v == null) return; const yy = y(l.v); g.strokeStyle = l.col; g.lineWidth = 2; g.setLineDash(l.dash ? [6, 5] : []); g.beginPath(); g.moveTo(l.from != null ? x(l.from - (bars.length - vis.length)) : 0, yy); g.lineTo(W - padR, yy); g.stroke(); g.setLineDash([]);
      g.fillStyle = l.col; g.fillRect(W - padR + 1, yy - 9, padR - 2, 18); g.fillStyle = "#0b0f15"; g.font = "800 10px system-ui, sans-serif"; g.fillText(l.lab, W - padR + 4, yy + 4); });
    (o.marks || []).forEach((m) => { const i = m.i - (bars.length - vis.length); if (i < 0) return; g.fillStyle = m.col; g.beginPath(); g.arc(x(i), y(m.v), 6, 0, 7); g.fill(); });
    if (o.now) { g.strokeStyle = "rgba(217,180,108,.6)"; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x(vis.length - 1) + step / 2, 0); g.lineTo(x(vis.length - 1) + step / 2, H); g.stroke(); g.setLineDash([]); }
  }

  // ---------- what the trade did after you placed it (limit / stop entry at your price, then stop or target, else 16:00)
  function play(tr, from) {
    const M = X.m; let fill = null;
    for (let k = from + 1; k < M.length; k++) { const [, h, l] = M[k];
      if (fill == null) { if (l <= tr.e && h >= tr.e) fill = k; else continue; if (tr.dir > 0 ? l <= tr.sl : h >= tr.sl) return { k, how: "stop", x: tr.sl, fill }; continue; }
      if (tr.dir > 0 ? l <= tr.sl : h >= tr.sl) return { k, how: "stop", x: tr.sl, fill }; if (tr.dir > 0 ? h >= tr.tp : l <= tr.tp) return { k, how: "target", x: tr.tp, fill }; }
    return fill == null ? { k: M.length - 1, how: "never filled", x: null, fill } : { k: M.length - 1, how: "16:00 close", x: M[M.length - 1][3], fill };
  }
  const zoneOf = () => (S.taps.length === 2 ? { lo: Math.min(...S.taps), hi: Math.max(...S.taps) } : null);
  const zoneDir = (z) => (z.hi < X.h[X.h.length - 1][3] ? 1 : z.lo > X.h[X.h.length - 1][3] ? -1 : 0);
  const fx = (v) => (v == null ? "–" : v.toFixed(X.dec));

  function finish() {
    const z = zoneOf(), tr = S.trade, r = S.res;
    const R = tr && r && r.x != null ? (tr.dir * (r.x - tr.e)) / Math.abs(tr.e - tr.sl) : null;
    S.step = "done"; S.k = X.m.length - 1; S.R = R; done++;
    saveLabel({ mk: X.mk, day: X.day, v: 1, tfDrawn: S.tf, noZone: S.noZone, zone: z && { ...z, dir: zoneDir(z), why: [...S.why] },
      trade: tr && { ...tr, placedMin: X.m[tr.k][4], fillMin: r && r.fill != null ? X.m[r.fill][4] : null }, outcome: r && { how: r.how, R: R == null ? null : +R.toFixed(2), exitMin: X.m[r.k][4] }, noTrade: !tr, at: Date.now() });
    paint();
  }

  // ---------- screens
  function paint() {
    if (!ov) return; stopPlay();
    if (!X) { ov.innerHTML = `<div class="tc-top"><b>Teach Edge</b><button class="btn small" data-t="close">Close</button></div><div class="tc-msg">${err ? `<p>${esc(err)}</p>` : "<p>Loading a chart…</p>"}${err ? '<button class="btn small" data-t="retry">Try again</button>' : ""}</div>`; return; }
    const z = zoneOf(), dirW = z ? (zoneDir(z) > 0 ? "demand" : zoneDir(z) < 0 ? "supply" : "zone") : "";
    const top = `<div class="tc-top"><span><b>${esc(X.name)}</b> <small>· example ${done + (S.step === "done" ? 0 : 1)} of ${GOAL}${saved != null ? ` · ${saved} saved` : ""}</small></span><button class="btn small" data-t="close">Done for now</button></div>`;
    let body = "";
    if (S.step === "zone") body = `<p class="tc-ask">${S.taps.length < 2 ? `<b>Mark your zone.</b> Tap its ${S.taps.length ? "other edge" : "top or bottom"} on the chart — where would you look for a trade today?` : `<b>Your ${dirW} zone:</b> ${fx(z.lo)} – ${fx(z.hi)}. Why this one? (tap all that fit)`}</p>
      <div class="tc-tf"><button class="${S.tf === "1h" ? "on" : ""}" data-t="tf1">1H · 15 days</button><button class="${S.tf === "4h" ? "on" : ""}" data-t="tf4">4H · 3 months</button><button class="${S.zoom ? "on" : ""}" data-t="zoom">${S.zoom ? "Zoom in" : "Zoom out"}</button></div>
      <canvas class="tc-cv" data-t="cv"></canvas>
      ${z ? `<div class="tc-why">${WHY.map((w) => `<button class="${S.why.has(w) ? "on" : ""}" data-w="${esc(w)}">${esc(w)}</button>`).join("")}</div>` : ""}
      <div class="tc-act"><button class="btn small" data-t="nozone">No zone I'd trade today</button>${S.taps.length ? '<button class="btn small" data-t="clear">Redraw</button>' : ""}<button class="btn small primary" data-t="watch" ${z ? "" : "disabled"}>Watch the day ▶</button></div>`;
    else if (S.step === "watch" || S.step === "place") { const pl = S.place, need = ["ENTRY", "STOP", "TARGET"][pl.length];
      body = `<p class="tc-ask">${S.step === "watch" ? `<b>${ny(X.m[S.k][4])} New York.</b> Play the 5m. When you'd take a trade, pause and tap <b>Trade here</b>.` : pl.length < 3 ? `Tap your <b>${need}</b> on the chart.${pl.length === 2 ? ' Or <button class="tc-link" data-t="r3">use 1:3</button>' : ""}` : `<b>${pl[1] < pl[0] ? "BUY" : "SELL"}</b> · entry ${fx(pl[0])} · stop ${fx(pl[1])} · target ${fx(pl[2])} · 1:${(Math.abs(pl[2] - pl[0]) / Math.abs(pl[0] - pl[1])).toFixed(1)}`}</p>
        <canvas class="tc-cv" data-t="cv"></canvas>
        <div class="tc-act">${S.step === "watch" ? `<button class="btn small" data-t="step">+1 candle</button><button class="btn small" data-t="playp">${S.playing ? "⏸ Pause" : "▶ Play"}</button><button class="btn small" data-t="speed">${S.speed}×</button><button class="btn small" data-t="pass">No trade today</button><button class="btn small primary" data-t="trade">📍 Trade here</button>`
          : `<button class="btn small" data-t="unplace">Back</button>${pl.length ? '<button class="btn small" data-t="undo">Undo tap</button>' : ""}<button class="btn small primary" data-t="confirm" ${pl.length === 3 && (pl[0] - pl[1]) * (pl[2] - pl[0]) > 0 ? "" : "disabled"}>Place it ✓</button>`}</div>`; }
    else { const R = S.R, tr = S.trade, r = S.res;
      body = `<p class="tc-ask">${tr ? (r.how === "never filled" ? "<b>Your order never filled.</b>" : `<b>${r.how === "target" ? "🎯 Target hit" : r.how === "stop" ? "🛑 Stopped" : "Closed at 16:00"}: ${R >= 0 ? "+" : "−"}${Math.abs(R).toFixed(1)}R</b> (${R >= 0 ? "+" : "−"}$${Math.abs(Math.round(R * 150))} at $150 risk).`) : "<b>No trade.</b> Here's how the day played out."} <small>${esc(X.day)} · saved ✓</small></p>
        <canvas class="tc-cv" data-t="cv"></canvas>
        <div class="tc-act"><button class="btn small primary" data-t="next">${done >= GOAL ? "That's 30 — keep going?" : "Next chart ▶"}</button></div>`; }
    ov.innerHTML = top + body;
    const cv = ov.querySelector("canvas"); if (cv) draw(cv);
    if (S.playing && S.step === "watch") startPlay();
  }
  function draw(cv) {
    const z = zoneOf(), zc = z && zoneDir(z) < 0 ? "rgba(239,83,80,.22)" : "rgba(38,166,154,.22)";
    if (S.step === "zone") { const bars = S.tf === "4h" ? X.h4 : X.h, slots = S.zoom ? bars.length : S.tf === "4h" ? 180 : 120;
      chart(cv, bars, { dec: X.dec, slots, bands: z ? [{ a: z.lo, b: z.hi, col: zc, lab: "your zone" }] : [], lines: S.taps.length === 1 ? [{ v: S.taps[0], col: "#d9b46c", lab: fx(S.taps[0]), dash: 1 }] : [], now: 1 }); return; }
    const end = S.step === "done" ? X.m.length : S.k + 1, bars = X.m.slice(0, end), pl = S.place, tr = S.trade, lines = [];
    const show = tr ? [tr.e, tr.sl, tr.tp] : pl; const labs = ["entry", "stop", "target"], cols = ["#6aa8ff", "#ef5350", "#26a69a"];
    show.forEach((v, i) => lines.push({ v, col: cols[i], lab: `${labs[i]}`, from: tr ? tr.k : S.k }));
    const marks = []; if (S.res && S.step === "done") { if (S.res.fill != null) marks.push({ i: S.res.fill, v: tr.e, col: "#6aa8ff" }); if (S.res.x != null) marks.push({ i: S.res.k, v: S.res.x, col: S.res.how === "target" ? "#26a69a" : S.res.how === "stop" ? "#ef5350" : "#d9b46c" }); }
    const live = S.step !== "done"; // while you watch: the last ~2 hours, bigger candles; at the end: the whole day
    chart(cv, bars, { dec: X.dec, slots: live ? 84 : X.m.length, ahead: live ? 18 : 0, bands: z ? [{ a: z.lo, b: z.hi, col: zc, lab: "your zone" }] : [], lines, marks, now: S.step !== "done", levels: z ? [z.lo, z.hi] : [] });
  }
  function stopPlay() { if (timer) { clearInterval(timer); timer = null; } }
  function startPlay() { stopPlay(); timer = setInterval(() => { if (!S || S.step !== "watch" || S.k >= X.m.length - 1) { S.playing = false; stopPlay(); if (S && S.step === "watch" && S.k >= X.m.length - 1) { S.res = null; finish(); } else paint(); return; } S.k++; const cv = ov.querySelector("canvas"); if (cv) draw(cv); const t = ov.querySelector(".tc-ask b"); if (t) t.textContent = `${ny(X.m[S.k][4])} New York.`; }, 260 / S.speed); }

  function onTap(e) {
    const cv = e.target.closest("canvas"); if (!cv || !cv._map) return; const rect = cv.getBoundingClientRect(), p = cv._map.p(e.clientY - rect.top);
    if (S.step === "zone") { if (S.taps.length >= 2) S.taps = []; S.taps.push(p); S.noZone = false; paint(); }
    else if (S.step === "place" && S.place.length < 3) { S.place.push(p); paint(); }
  }
  function onClick(e) {
    const w = e.target.closest("[data-w]"); if (w) { const k = w.dataset.w; S.why.has(k) ? S.why.delete(k) : S.why.add(k); w.classList.toggle("on"); return; }
    const t = e.target.closest("[data-t]"); if (!t) return; const a = t.dataset.t;
    if (a === "cv") return onTap(e);
    if (a === "close") return close();
    if (a === "retry") return nextChart();
    if (!S) return;
    if (a === "tf1" || a === "tf4") { S.tf = a === "tf1" ? "1h" : "4h"; return paint(); }
    if (a === "zoom") { S.zoom = !S.zoom; return paint(); }
    if (a === "clear") { S.taps = []; S.why.clear(); return paint(); }
    if (a === "nozone") { S.noZone = true; S.taps = []; S.step = "watch"; return paint(); }
    if (a === "watch") { S.step = "watch"; return paint(); }
    if (a === "step") { if (S.k < X.m.length - 1) S.k++; return paint(); }
    if (a === "playp") { S.playing = !S.playing; paint(); if (S.playing) startPlay(); return; }
    if (a === "speed") { S.speed = S.speed === 1 ? 3 : S.speed === 3 ? 8 : 1; paint(); if (S.playing) startPlay(); return; }
    if (a === "pass") { S.trade = null; S.res = null; return finish(); }
    if (a === "trade") { S.playing = false; S.step = "place"; S.place = []; return paint(); }
    if (a === "unplace") { S.step = "watch"; S.place = []; return paint(); }
    if (a === "undo") { S.place.pop(); return paint(); }
    if (a === "r3") { const [en, sl] = S.place; S.place[2] = en + 3 * (en - sl); return paint(); }
    if (a === "confirm") { const [en, sl, tp] = S.place, dir = sl < en ? 1 : -1; S.trade = { dir, e: en, sl, tp, k: S.k }; S.res = play(S.trade, S.k); return finish(); }
    if (a === "next") return nextChart();
  }
  function open() { if (!ov) { ov = document.createElement("div"); ov.className = "teach-ov"; ov.addEventListener("click", onClick); addEventListener("resize", () => ov.isConnected && paint()); }
    document.body.appendChild(ov); document.body.classList.add("teach-on"); flushQueue(); if (!X) nextChart(); else paint(); }
  function close() { stopPlay(); if (ov) ov.remove(); document.body.classList.remove("teach-on"); refreshCount(); }

  // ---------- the card on the Test tab
  function paintCard() { if (!card) return; card.innerHTML = `<section class="card teach-card"><div class="card-head"><h2>✏️ Teach Edge your way</h2></div>
    <p class="muted" style="margin:0 0 10px">Real past charts, one after another. Mark <b>your</b> zone, then play the day and place <b>your</b> trade — or pass. After 20–30, Edge learns how you draw and rebuilds the scanner around it.</p>
    <div class="tc-cardrow"><span>${saved == null ? "" : `<b>${saved}</b> examples saved`}</span><button class="btn small primary" data-t="open">Start marking ▶</button></div></section>`; }
  function mount(host) { if (!host) return; if (!card) { card = document.createElement("div"); card.addEventListener("click", (e) => { if (e.target.closest('[data-t="open"]')) open(); }); refreshCount(); }
    if (card.parentNode !== host) host.appendChild(card); paintCard(); }
  window.EdgeTeach = { mount, open, play: (x, tr, from) => { const keep = X; X = x; try { return play(tr, from); } finally { X = keep; } } };
})();
