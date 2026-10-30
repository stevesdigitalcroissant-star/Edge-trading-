// "Teach Edge": real past charts, one after another — you draw YOUR zones on the 1H (or 4H) by dragging, say why, then
// watch the day play from the 18:00 New York open (5m / 15m / 1H) and drag YOUR trade into place (entry, stop, target)
// or pass. Nothing is cut at the session end: the trade runs on (2 more days of candles) until its stop or target. Every example is saved to your
// Edge so the scanner can be rebuilt around how you draw. Charts come from your private Databento archive (?teach=1).
(function () {
  const CH = ["#2ef2a6", "#5cc8ff", "#c77dff", "#ffb020", "#ff7ab6", "#7cf06b", "#ff8a4c"];
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
    S = X && { step: "zone", tf: "1h", zoom: 1, vz: 1, why: new Set(), k: X.at, playing: false, speed: 1, pos: null, trade: null, res: null, noZone: false, zones: [], wtf: "5m", t0: Date.now(), log: [] };
    paint();
  }

  // ---------- one candle chart on a canvas; remembers its price ↔ pixel map so taps become prices
  function chart(cv, bars, o) {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const n = o.slots || bars.length, padR = 58, lv = [...(o.levels || [])].filter((v) => v != null);
    const vis = bars.slice(Math.max(0, bars.length - (n - (o.ahead || 0)))); // leave room on the right for what comes next
    let lo = Math.min(...vis.map((b) => b[2]), ...lv), hi = Math.max(...vis.map((b) => b[1]), ...lv);
    { const span = hi - lo; for (const v of o.soft || []) if (v != null && v > lo - span && v < hi + span) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } // zones count only when near const pad = (hi - lo) * (0.06 + 0.35 * ((o.vz || 1) - 1)) || 1; lo -= pad; hi += pad;
    const y = (v) => 8 + (H - 16) * (1 - (v - lo) / (hi - lo)), step = (W - padR - 6) / n, x = (i) => 4 + step * (i + 0.5), bw = Math.max(1, step * 0.66);
    cv._map = { p: (py) => lo + (1 - (py - 8) / (H - 16)) * (hi - lo), y, dec: o.dec, W, padR };
    g.strokeStyle = "rgba(160,170,255,.08)"; g.lineWidth = 1; g.font = "600 10.5px system-ui, sans-serif"; g.fillStyle = "#8f97c4"; g.textAlign = "left";
    for (let q = 0; q <= 4; q++) { const v = lo + ((hi - lo) * q) / 4, yy = y(v); g.beginPath(); g.moveTo(0, yy); g.lineTo(W - padR, yy); g.stroke(); g.fillText(v.toFixed(o.dec), W - padR + 4, yy + 3); }
    const band = (a, b, col, lab, edge) => { if (a == null || b == null) return; const t = y(Math.max(a, b)), u = y(Math.min(a, b)); g.fillStyle = col; g.fillRect(0, t, W - padR, Math.max(2, u - t));
      if (edge) { g.save(); g.shadowColor = edge; g.shadowBlur = 10; g.strokeStyle = edge; g.lineWidth = 1.5; g.strokeRect(0.5, t, W - padR - 1, Math.max(2, u - t)); g.restore(); } if (lab) { g.fillStyle = edge || "#fff"; g.font = "800 11px system-ui, sans-serif"; g.fillText(lab, 6, t - 4 < 12 ? u + 13 : t - 4); } };
    (o.bands || []).forEach((z) => band(z.a, z.b, z.col, z.lab, z.edge));
    vis.forEach((b, i) => { const up = b[3] >= b[0], c = up ? "#2ef2a6" : "#ff4d7d"; g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(x(i), y(b[1])); g.lineTo(x(i), y(b[2])); g.stroke(); const t = y(Math.max(b[0], b[3])); g.fillRect(x(i) - bw / 2, t, bw, Math.max(1, y(Math.min(b[0], b[3])) - t)); });
    (o.lines || []).forEach((l) => { if (l.v == null) return; const yy = y(l.v); g.strokeStyle = l.col; g.lineWidth = 2; g.setLineDash(l.dash ? [6, 5] : []); g.beginPath(); g.moveTo(l.from != null ? x(l.from - (bars.length - vis.length)) : 0, yy); g.lineTo(W - padR, yy); g.stroke(); g.setLineDash([]);
      g.fillStyle = l.col; g.fillRect(W - padR + 1, yy - 9, padR - 2, 18); g.fillStyle = "#0b0f15"; g.font = "800 10px system-ui, sans-serif"; g.fillText(l.lab, W - padR + 4, yy + 4);
      if (l.grip) { g.fillStyle = l.col; g.beginPath(); g.arc(W - padR - 14, yy, 6, 0, 7); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke(); } });
    (o.bands || []).forEach((z) => { if (!z.grip) return; [z.a, z.b].forEach((v) => { const yy = y(v); g.fillStyle = z.edge; g.fillRect((W - padR) / 2 - 14, yy - 3, 28, 6); }); }); // zone edge grips
    (o.marks || []).forEach((m) => { const i = m.i - (bars.length - vis.length); if (i < 0) return; g.save(); g.shadowColor = m.col; g.shadowBlur = 14; g.fillStyle = m.col; g.beginPath(); g.arc(x(i), y(m.v), 7, 0, 7); g.fill(); g.restore(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(x(i), y(m.v), 7, 0, 7); g.stroke(); });
    if (o.now) { g.strokeStyle = "rgba(255,196,77,.75)"; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x(vis.length - 1) + step / 2, 0); g.lineTo(x(vis.length - 1) + step / 2, H); g.stroke(); g.setLineDash([]); }
  }

  // ---------- what the trade did after you placed it (limit / stop entry at your price, then stop or target — it runs on
  // past the session to the end of the data, 2 days later; if neither is hit by then it's marked "still open")
  function play(tr, from) {
    const M = X.m; let fill = null;
    for (let k = from + 1; k < M.length; k++) { const [, h, l] = M[k];
      if (fill == null) { if (l <= tr.e && h >= tr.e) fill = k; else continue; if (tr.dir > 0 ? l <= tr.sl : h >= tr.sl) return { k, how: "stop", x: tr.sl, fill }; continue; }
      if (tr.dir > 0 ? l <= tr.sl : h >= tr.sl) return { k, how: "stop", x: tr.sl, fill }; if (tr.dir > 0 ? h >= tr.tp : l <= tr.tp) return { k, how: "target", x: tr.tp, fill }; }
    return fill == null ? { k: M.length - 1, how: "never filled", x: null, fill } : { k: M.length - 1, how: "still open", x: M[M.length - 1][3], fill };
  }
  // the futures day starts 18:00 New York: bucket a 5m candle into its 15m / 1H candle
  const bucket = (min, tf) => Math.floor(((min - 1080 + 1440) % 1440) / (tf === "1h" ? 60 : tf === "15m" ? 15 : 5));
  function view(m5, tf) {
    if (tf === "5m") return { bars: m5.map((b) => b.slice(0, 4)), map: m5.map((_, i) => i) };
    const bars = [], map = []; let key = null;
    for (const b of m5) { const k = bucket(b[4], tf); if (k !== key) { bars.push([b[0], b[1], b[2], b[3]]); key = k; } else { const g = bars[bars.length - 1]; g[1] = Math.max(g[1], b[1]); g[2] = Math.min(g[2], b[2]); g[3] = b[3]; } map.push(bars.length - 1); }
    if (tf === "1h") { const pre = X.h.slice(-30); return { bars: [...pre, ...bars], map: map.map((i) => i + pre.length) }; }
    return { bars, map };
  }
  const allZones = () => S.zones; // as many as you see (a big zone and a tighter one inside, or two zones…)
  const ZC = ["#2ef2a6", "#5cc8ff", "#ffb020", "#c77dff"];
  const bandsOf = (grip) => S.zones.map((z, i) => { const sup = zoneDir(z) < 0; return { a: z.lo, b: z.hi, col: sup ? "rgba(255,77,125,.17)" : "rgba(46,242,166,.15)", edge: i ? ZC[i % 4] : sup ? "#ff4d7d" : "#2ef2a6", lab: S.zones.length > 1 ? `zone ${i + 1}` : "your zone", grip }; });
  const zoneDir = (z) => (z.hi < X.h[X.h.length - 1][3] ? 1 : z.lo > X.h[X.h.length - 1][3] ? -1 : 0);
  const fx = (v) => (v == null ? "–" : v.toFixed(X.dec));

  function finish() {
    const Z = S.zones, z = Z[0] || null, tr = S.trade, r = S.res;
    const R = tr && r && r.x != null ? (tr.dir * (r.x - tr.e)) / Math.abs(tr.e - tr.sl) : null;
    S.step = "done"; S.k = X.m.length - 1; S.R = R; done++;
    S.id = `${X.mk}|${X.day}|${Date.now()}`; S.label = { id: S.id, mk: X.mk, day: X.day, v: 2, secs: Math.round((Date.now() - S.t0) / 1000), log: S.log, noteZone: S.noteZ || "", tfDrawn: S.tf, noZone: S.noZone, zone: z && { ...z, dir: zoneDir(z), why: [...S.why] }, zones: Z.map((q) => ({ ...q, dir: zoneDir(q) })),
      trade: tr && { ...tr, placedMin: X.m[tr.k][4], fillMin: r && r.fill != null ? X.m[r.fill][4] : null, fillK: r ? r.fill : null }, outcome: r && { how: r.how, R: R == null ? null : +R.toFixed(2), exitMin: X.m[r.k][4], exitK: r.k, bars: X.m.length }, noTrade: !tr, at: Date.now() }; saveLabel(S.label);
    paint();
  }

  // ---------- screens
  const posRR = (q) => Math.abs(q.tp - q.e) / Math.abs(q.e - q.sl);
  function paint() {
    if (!ov) return; stopPlay();
    if (!X) { ov.innerHTML = `<div class="tc-top"><b>Teach Edge</b><button class="btn small" data-t="close">Close</button></div><div class="tc-msg">${err ? `<p>${esc(err)}</p>` : "<p>Loading a chart…</p>"}${err ? '<button class="btn small" data-t="retry">Try again</button>' : ""}</div>`; return; }
    const stepNo = { zone: 0, watch: 1, place: 2, done: 3 }[S.step], n = done + (S.step === "done" ? 0 : 1), nz = S.zones.length;
    const top = `<div class="tc-top"><span class="tc-mk"><b>${esc(X.name)}</b> <small>example ${n} of ${GOAL}${saved != null ? ` · ${saved} saved` : ""}</small></span><button class="btn small tc-soft" data-t="close">Done for now</button></div>
      <div class="tc-bar"><i style="width:${Math.min(100, (100 * (done + (S.step === "done" ? 0 : 0.5))) / GOAL)}%"></i></div>
      <div class="tc-steps">${["Zone", "Watch", "Trade", "Result"].map((w, i) => `<span class="${i < stepNo ? "past" : i === stepNo ? "now" : ""}" style="--c:${["#2ef2a6", "#5cc8ff", "#ffb020", "#c77dff"][i]}">${i + 1} · ${w}</span>`).join("")}</div>`;
    const zoneChips = nz ? `<div class="tc-why tc-zl">${S.zones.map((z, i) => `<button style="--c:${bandsOf()[i].edge}" data-t="delz" data-i="${i}">zone ${i + 1} · ${fx(z.lo)}–${fx(z.hi)} ✕</button>`).join("")}</div>` : "";
    const scale = `<button class="${S.vz > 1 ? "on" : ""}" data-t="vz">↕ ${S.vz > 1 ? `room ×${S.vz}` : "more room"}</button><button class="${S.zoom > 1 ? "on" : ""}" data-t="zoom">↔ ${S.zoom > 1 ? `zoom ×${S.zoom}` : "zoom out"}</button>`;
    let body = "";
    if (S.step === "zone") body = `<p class="tc-ask">${nz ? `<b>${nz} zone${nz > 1 ? "s" : ""} marked.</b> Drag an edge to correct it, drag inside to move it, or drag on an empty spot to add another. Why? (tap all that fit — and say in the note which zone you'd trade from)` : `<b>Draw your zone:</b> press and drag up or down across it on the chart. Then drag its edges to fine-tune. See more than one? Draw them all.`}</p>
      <div class="tc-tf">${[["4h", "4H"], ["1h", "1H"], ["15m", "15m"], ["5m", "5m"]].map(([v, w]) => `<button class="${S.tf === v ? "on" : ""}" data-t="ztf" data-v="${v}">${w}</button>`).join("")}${scale}</div>
      <canvas class="tc-cv"></canvas>${zoneChips}
      ${nz ? `<textarea class="tc-note" data-n="z" rows="2" placeholder="Tell Claude why, in your words (optional) — which candles the zone comes from, which one you'd trade, what you'll wait for">${esc(S.noteZ || "")}</textarea>
      <div class="tc-why">${WHY.map((w, i) => `<button class="${S.why.has(w) ? "on" : ""}" style="--c:${CH[i % CH.length]}" data-w="${esc(w)}">${esc(w)}</button>`).join("")}</div>` : ""}
      <div class="tc-act"><button class="btn small tc-soft" data-t="nozone">No zone I'd trade today</button><button class="btn small primary" data-t="watch" ${nz ? "" : "disabled"}>Watch the day ▶</button></div>`;
    else if (S.step === "watch" || S.step === "place") { const q = S.pos;
      body = `<p class="tc-ask">${S.step === "watch" ? `<b>${ny(X.m[S.k][4])} New York${dayTag(S.k)}.</b> Play it (5m, 15m or 1H). Spot another zone? Drag it on. When you'd trade, pause and tap <b>Trade here</b>.`
        : `<b>${q.dir > 0 ? "BUY" : "SELL"}</b> · entry ${fx(q.e)} · stop ${fx(q.sl)} · target ${fx(q.tp)} · <b>1:${posRR(q).toFixed(1)}</b><br><small>Drag the dots on the lines to move your entry, stop and target. Target off the chart? Tap ↕ more room, or drag it to the edge.</small>`}</p>
        <div class="tc-tf"><button class="${S.wtf === "5m" ? "on" : ""}" data-t="w5">5m</button><button class="${S.wtf === "15m" ? "on" : ""}" data-t="w15">15m</button><button class="${S.wtf === "1h" ? "on" : ""}" data-t="w60">1H</button>${scale}${S.step === "watch" && (X.m[S.k][4] >= 1080 || X.m[S.k][4] < 180) && S.k < (X.london || 0) ? '<button data-t="london">⏩ to 03:00</button>' : ""}</div>
        <canvas class="tc-cv"></canvas>${S.step === "watch" ? zoneChips : ""}
        <div class="tc-act">${S.step === "watch" ? `<button class="btn small" data-t="step">+1 candle</button><button class="btn small" data-t="playp">${S.playing ? "⏸ Pause" : "▶ Play"}</button><button class="btn small" data-t="speed">${S.speed}×</button><button class="btn small tc-soft" data-t="pass">No trade</button><button class="btn small tc-hot" data-t="trade">📍 Trade here</button>`
          : `<button class="btn small" data-t="unplace">Back</button><button class="btn small" data-t="flip">${q.dir > 0 ? "Make it a SELL" : "Make it a BUY"}</button><button class="btn small primary" data-t="confirm" ${(q.e - q.sl) * q.dir > 0 && (q.tp - q.e) * q.dir > 0 ? "" : "disabled"}>Place it ✓</button>`}</div>`; }
    else { const R = S.R, tr = S.trade, r = S.res;
      const word = r && { target: "🎯 Target hit", stop: "🛑 Stopped", "still open": "⏳ Still open 2 days later" }[r.how];
      body = `<p class="tc-ask tc-res ${tr && r.how !== "never filled" ? (S.R >= 0 ? "win" : "loss") : "flat"}">${tr ? (r.how === "never filled" ? "<b>Your order never filled.</b>" : `<b>${word}: ${R >= 0 ? "+" : "−"}${Math.abs(R).toFixed(1)}R</b> (${R >= 0 ? "+" : "−"}$${Math.abs(Math.round(R * 150))} at $150 risk) · ${ny(X.m[r.k][4])}${dayTag(r.k)}.`) : "<b>No trade.</b> Here's how it played out."} <small>${esc(X.day)} · saved ✓</small></p>
        <div class="tc-tf"><button class="${S.wtf === "5m" ? "on" : ""}" data-t="w5">5m</button><button class="${S.wtf === "15m" ? "on" : ""}" data-t="w15">15m</button><button class="${S.wtf === "1h" ? "on" : ""}" data-t="w60">1H</button>${scale}</div>
        <canvas class="tc-cv"></canvas>
        <textarea class="tc-note" data-n="t" rows="2" placeholder="Anything to tell Claude about this one? (optional) — why you entered there, what you'd do differently">${esc(S.noteT || "")}</textarea>
        <div class="tc-act"><button class="btn small primary" data-t="next">${done >= GOAL ? "That's 30 — keep going?" : "Next chart ▶"}</button></div>`; }
    ov.innerHTML = top + body;
    const cv = ov.querySelector("canvas"); if (cv) { draw(cv); hook(cv); }
    if (S.playing && S.step === "watch") startPlay();
  }
  // which day a candle is on, counted from the session you're trading (day 1)
  function dayTag(k) { let d = 0; for (let i = X.at + 1; i <= k; i++) if (X.m[i][4] >= 1080 && X.m[i - 1][4] < 1080) d++; return d ? ` · day ${d + 1}` : ""; }
  function draw(cv) {
    if (S.step === "zone") { // 4H / 1H history, or the last 24 hours on the 15m / 5m — all up to the 18:00 open
      const bars = S.tf === "4h" ? X.h4 : S.tf === "1h" ? X.h : view(X.m.slice(0, X.at + 1), S.tf).bars, slots = Math.min(bars.length, ({ "4h": 150, "1h": 110, "15m": 96, "5m": 120 }[S.tf]) * S.zoom);
      chart(cv, bars, { dec: X.dec, slots, vz: S.vz, bands: bandsOf(true), levels: S.zones.flatMap((q) => [q.lo, q.hi]), now: 1 }); return; }
    const end = S.step === "done" ? X.m.length : S.k + 1, V = view(X.m.slice(0, end), S.wtf), bars = V.bars, at = (k) => V.map[Math.min(k, V.map.length - 1)], tr = S.trade, q = S.step === "place" ? S.pos : tr, lines = [];
    if (q) [["entry", q.e, "#5cc8ff"], ["stop", q.sl, "#ff4d7d"], ["target", q.tp, "#2ef2a6"]].forEach(([lab, v, col]) => lines.push({ v, col, lab, from: at(q.k), grip: S.step === "place" }));
    const marks = []; if (S.res && S.step === "done") { if (S.res.fill != null) marks.push({ i: at(S.res.fill), v: tr.e, col: "#5cc8ff" }); if (S.res.x != null) marks.push({ i: at(S.res.k), v: S.res.x, col: S.res.how === "target" ? "#2ef2a6" : S.res.how === "stop" ? "#ff4d7d" : "#ffc44d" }); }
    const live = S.step !== "done", sl = { "5m": [84, 18], "15m": [60, 10], "1h": [48, 6] }[S.wtf];
    chart(cv, bars, { dec: X.dec, slots: live ? Math.min(sl[0] * S.zoom, bars.length + sl[1]) : bars.length, ahead: live ? sl[1] : 0, vz: S.vz, bands: bandsOf(S.step === "watch"), lines, marks, now: live, soft: S.zones.flatMap((z) => [z.lo, z.hi]), levels: q ? [q.e, q.sl, q.tp] : [] });
  }
  function stopPlay() { if (timer) { clearInterval(timer); timer = null; } }
  function startPlay() { stopPlay(); timer = setInterval(() => { if (!S || S.step !== "watch" || S.k >= X.m.length - 1) { S.playing = false; stopPlay(); if (S && S.step === "watch" && S.k >= X.m.length - 1) { S.res = null; finish(); } else paint(); return; } S.k++; const cv = ov.querySelector("canvas"); if (cv) draw(cv); const t = ov.querySelector(".tc-ask b"); if (t) t.textContent = `${ny(X.m[S.k][4])} New York${dayTag(S.k)}.`; }, 260 / S.speed); }

  // ---------- drag on the chart: draw a zone, move its edges or the whole zone, move entry / stop / target
  function hook(cv) {
    let drag = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const near = (yy, v) => Math.abs(yy - cv._map.y(v)) <= 12;
    cv.addEventListener("pointerdown", (e) => {
      if (!cv._map || S.step === "done") return; const { x, y } = pt(e), p = cv._map.p(y);
      if (S.step === "place") { const q = S.pos, hit = ["tp", "sl", "e"].find((f) => near(y, q[f])); if (!hit) return; drag = { kind: "line", f: hit }; }
      else { // zone / watch: grab a zone edge, a zone body, or start a new zone
        let hit = null; S.zones.forEach((z, i) => { if (near(y, z.hi)) hit = { kind: "edge", i, f: "hi" }; else if (near(y, z.lo)) hit = hit || { kind: "edge", i, f: "lo" }; });
        if (!hit) { const i = S.zones.findIndex((z) => p >= z.lo && p <= z.hi); if (i >= 0) hit = { kind: "move", i, p0: p, z0: { ...S.zones[i] } }; }
        if (!hit) { if (S.zones.length >= 4) return; S.zones.push({ lo: p, hi: p }); hit = { kind: "edge", i: S.zones.length - 1, f: "hi", fresh: true }; S.noZone = false; }
        drag = hit; }
      cv.setPointerCapture(e.pointerId); e.preventDefault(); S.playing = false; stopPlay();
    });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) { if (cv._map && S.step !== "done") { const y = pt(e).y, on = S.step === "place" ? ["tp", "sl", "e"].some((f) => near(y, S.pos[f])) : S.zones.some((z) => near(y, z.hi) || near(y, z.lo)); cv.style.cursor = on ? "ns-resize" : S.step === "place" ? "default" : "crosshair"; } return; }
      const p = cv._map.p(pt(e).y);
      if (drag.kind === "line") S.pos[drag.f] = p;
      else if (drag.kind === "move") { const d = p - drag.p0; S.zones[drag.i] = { lo: drag.z0.lo + d, hi: drag.z0.hi + d }; }
      else { const z = S.zones[drag.i]; z[drag.f] = p; if (z.lo > z.hi) { [z.lo, z.hi] = [z.hi, z.lo]; drag.f = drag.f === "hi" ? "lo" : "hi"; } }
      draw(cv);
    });
    const end = () => { if (!drag) return; const d = drag; drag = null;
      if (d.kind === "line") log("drag:" + d.f, S.pos[d.f]); else { const z = S.zones[d.i]; if (d.fresh && Math.abs(cv._map.y(z.lo) - cv._map.y(z.hi)) < 6) { S.zones.splice(d.i, 1); } else log(d.fresh ? "zoneNew" : "zoneEdit", `${+z.lo.toPrecision(7)}-${+z.hi.toPrecision(7)}`); }
      paint(); };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("wheel", (e) => { e.preventDefault(); S.vz = Math.max(1, Math.min(8, S.vz * (e.deltaY > 0 ? 1.25 : 0.8))); if (S.vz < 1.05) S.vz = 1; S.vz = +S.vz.toFixed(2); draw(cv); }, { passive: false });
  }
  const log = (a, v) => { if (S && S.log.length < 400) S.log.push([a, Math.round((Date.now() - S.t0) / 100) / 10, S.k, ...(v == null ? [] : [typeof v === "number" ? +v.toPrecision(7) : v])]); };
  function onClick(e) {
    const w = e.target.closest("[data-w]"); if (w) { const k = w.dataset.w; S.why.has(k) ? S.why.delete(k) : S.why.add(k); log("why", k); w.classList.toggle("on"); return; }
    const t = e.target.closest("[data-t]"); if (!t) return; const a = t.dataset.t; log(a);
    if (a === "close") return close();
    if (a === "retry") return nextChart();
    if (!S) return;
    if (a === "ztf") { S.tf = t.dataset.v; return paint(); }
    if (a === "zoom") { S.zoom = S.zoom >= 4 ? 1 : S.zoom * 2; return paint(); }
    if (a === "vz") { S.vz = S.vz >= 4 ? 1 : S.vz >= 2 ? 4 : 2; return paint(); }
    if (a === "delz") { S.zones.splice(Number(t.dataset.i), 1); return paint(); }
    if (a === "nozone") { S.noZone = true; S.zones = []; S.step = "watch"; return paint(); }
    if (a === "watch") { S.step = "watch"; return paint(); }
    if (a === "step") { // close the candle that's forming, or show the whole next one
      const M = X.m, L = M.length - 1, bk = (i) => bucket(M[i][4], S.wtf); if (S.k >= L) return paint();
      const tgt = bk(S.k + 1) !== bk(S.k) ? bk(S.k + 1) : bk(S.k); while (S.k < L && bk(S.k + 1) === tgt) S.k++; if (bk(S.k) !== tgt) S.k++; return paint(); }
    if (a === "w5" || a === "w15" || a === "w60") { S.wtf = { w5: "5m", w15: "15m", w60: "1h" }[a]; return paint(); }
    if (a === "london") { const i = X.m.findIndex((b, j) => j > S.k && b[4] >= 180 && b[4] < 1080); if (i > 0) S.k = i; return paint(); }
    if (a === "playp") { S.playing = !S.playing; paint(); if (S.playing) startPlay(); return; }
    if (a === "speed") { S.speed = S.speed === 1 ? 3 : S.speed === 3 ? 8 : S.speed === 8 ? 20 : 1; paint(); if (S.playing) startPlay(); return; }
    if (a === "pass") { S.trade = null; S.res = null; return finish(); }
    if (a === "trade") { // a position tool at the current price: buy if price sits above your nearest zone, else sell — drag it from there
      S.playing = false; const M = X.m, c = M[S.k][3], last = M.slice(Math.max(0, S.k - 11), S.k + 1), risk = Math.max((Math.max(...last.map((b) => b[1])) - Math.min(...last.map((b) => b[2]))) / 2, c * 0.0004);
      const zs = [...S.zones].sort((p, q) => Math.abs((p.lo + p.hi) / 2 - c) - Math.abs((q.lo + q.hi) / 2 - c)), dir = zs[0] ? (c >= (zs[0].lo + zs[0].hi) / 2 ? 1 : -1) : 1;
      S.pos = { dir, e: c, sl: c - dir * risk, tp: c + dir * 3 * risk, k: S.k }; S.step = "place"; return paint(); }
    if (a === "flip") { const q = S.pos, r = Math.abs(q.e - q.sl), rr = posRR(q); q.dir = -q.dir; q.sl = q.e - q.dir * r; q.tp = q.e + q.dir * rr * r; return paint(); }
    if (a === "unplace") { S.step = "watch"; S.pos = null; return paint(); }
    if (a === "confirm") { const q = S.pos; S.trade = { dir: q.dir, e: q.e, sl: q.sl, tp: q.tp, k: q.k }; S.res = play(S.trade, q.k); return finish(); }
    if (a === "next") { if (S.noteT && S.label) saveLabel({ ...S.label, noteTrade: S.noteT }).then(() => saved != null && saved--); return nextChart(); } // same id: updates, doesn't add
  }
  function open() { if (!ov) { ov = document.createElement("div"); ov.className = "teach-ov"; ov.addEventListener("click", onClick); ov.addEventListener("input", (e) => { const n = e.target.dataset && e.target.dataset.n; if (n && S) S[n === "z" ? "noteZ" : "noteT"] = e.target.value.slice(0, 1000); }); addEventListener("resize", () => ov.isConnected && paint()); }
    document.body.appendChild(ov); document.body.classList.add("teach-on"); flushQueue(); if (!X) nextChart(); else paint(); }
  function close() { stopPlay(); if (ov) ov.remove(); document.body.classList.remove("teach-on"); refreshCount(); }

  // ---------- the card on the Test tab
  function paintCard() { if (!card) return; card.innerHTML = `<section class="card teach-card"><div class="card-head"><h2>✏️ Teach Edge your way</h2></div>
    <p class="muted" style="margin:0 0 10px">Real past charts, one after another. Mark <b>your</b> zone, then play the day and place <b>your</b> trade — or pass. After 20–30, Edge learns how you draw and rebuilds the scanner around it.</p>
    <div class="tc-cardrow"><span>${saved == null ? "" : `<b>${saved}</b> examples saved`}</span><span class="tc-cardbtns">${location.pathname === "/teach" ? "" : '<a class="btn small" href="/teach">Full page ↗</a>'}<button class="btn small primary" data-t="open">Start marking ▶</button></span></div></section>`; }
  function mount(host) { if (!host) return; if (!card) { card = document.createElement("div"); card.addEventListener("click", (e) => { if (e.target.closest('[data-t="open"]')) open(); }); refreshCount(); }
    if (card.parentNode !== host) host.appendChild(card); paintCard(); }
  window.EdgeTeach = { mount, open, close, play: (x, tr, from) => { const keep = X; X = x; try { return play(tr, from); } finally { X = keep; } } };
})();
