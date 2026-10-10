// Practice on FX Replay (free). The Edge script can't run there, so you find the
// five steps yourself and tick them; ENTER only unlocks when all five are done.
// Edge gives the exact break-even and target prices to set, then you log how it ended.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const STEPS = [
    ["4H trend", "4H trend", "The last 4H candle CLOSED beyond a swing — above the last high for a long, below the last low for a short."],
    ["fresh zone", "4H zone touched", "Price is back in a 4H demand (long) / supply (short) zone."],
    ["liquidity taken", "Liquidity taken (A+)", "Price swept stops beyond a level, then closed back inside. Without it: only an A, and only on the zone's first visit."],
    ["15m break", "15m break of structure", "A 15m candle CLOSED beyond the last 15m swing, in your direction."],
    ["5m close", "5m candle close", "A 5m candle CLOSED beyond the last 5m swing — this candle's close is your entry."],
  ];
  const LIQ = ["previous day high/low", "Asian session high/low", "15m swing high/low"];
  const MARKETS = [["gold", "Gold"], ["crude", "Crude oil"], ["natgas", "Natural gas"]];

  let root = null;
  let p = { market: "gold", dir: "long", steps: {}, liquidity: "", entry: "", sl: "", trade: null, price: "" };
  try { p = { ...p, ...JSON.parse(localStorage.getItem("edge.practice") || "{}") }; } catch {}
  const save = () => { try { localStorage.setItem("edge.practice", JSON.stringify(p)); } catch {} };

  const settings = () => (window.Edge && window.Edge.state() && window.Edge.state().settings) || { beAtR: 2, tpAtR: 3.2, beOffsetR: 0.05 };
  const dp = (x) => { const m = String(x).match(/\.(\d+)/); return Math.max(2, m ? m[1].length : 0); };
  const plan = (dir, entry, sl) => {
    const s = settings(), k = dir === "long" ? 1 : -1, risk = Math.abs(entry - sl), d = dp(entry);
    const f = (x) => x.toFixed(d);
    return { risk, k, f, be: f(entry + k * s.beAtR * risk), beStop: f(entry + k * s.beOffsetR * risk), tp: f(entry + k * s.tpAtR * risk), s };
  };
  const done = () => STEPS.filter(([k]) => p.steps[k]).length;
  // A+ = all five · A = all but the sweep, on the zone's first visit · otherwise no trade
  const gradeNow = () => {
    const core = ["4H trend", "fresh zone", "15m break", "5m close"].every((k) => p.steps[k]);
    return !core ? "" : p.steps["liquidity taken"] ? "A+" : p.firstVisit ? "A" : "";
  };

  function html() {
    const s = settings();
    const n = done(), grade = gradeNow(), all = grade !== "";
    const e = Number(p.entry), sl = Number(p.sl);
    const ok = p.entry !== "" && p.sl !== "" && Number.isFinite(e) && Number.isFinite(sl) && (p.dir === "long" ? e > sl : e < sl);
    const st = window.Edge && window.Edge.state() && window.Edge.state().practiceStats;

    if (p.trade) {
      const t = p.trade, pl = plan(t.dir, t.entry, t.sl), px = Number(p.price);
      let r = null, msg = `Set your take-profit at ${pl.tp} now. Stop stays at ${pl.f(t.sl)}. At ${pl.be} move the stop to ${pl.beStop}.`, cls = "good";
      if (p.price !== "" && Number.isFinite(px)) {
        r = Math.round(((pl.k * (px - t.entry)) / pl.risk) * 100) / 100;
        if (r >= s.tpAtR) { msg = `Target reached (+${s.tpAtR}R). Out — tap "Target hit".`; cls = "bad"; }
        else if (r >= s.beAtR || t.beMoved) { msg = t.beMoved ? `Stop at break-even (${pl.beStop}). Target ${pl.tp}. Hands off.` : `+${s.beAtR}R — move your stop to ${pl.beStop} NOW.`; cls = t.beMoved ? "good" : "bad"; }
        else if (r < 0) msg = `Down ${Math.abs(r)}R. The stop at ${pl.f(t.sl)} does the job — don't move it.`;
        else msg = `Hold. At ${pl.be} move the stop to ${pl.beStop}.`;
      }
      return `
        <section class="banner ${cls}" style="font-size:19px">${esc(msg)}${r != null ? `<p>${r > 0 ? "+" : ""}${r}R</p>` : ""}</section>
        <section class="card">
          <div class="row between"><h2 style="margin:0">Practice trade — ${esc(MARKETS.find((m) => m[0] === t.market)[1])} ${esc(t.dir)}</h2><span class="pill ${t.grade === "A+" ? "good" : "warn"}">${esc(t.grade)}</span></div>
          <div class="levels" style="grid-template-columns:repeat(2,1fr)">
            <div><small>Entry</small><b>${pl.f(t.entry)}</b></div><div><small>Stop</small><b>${pl.f(t.sl)}</b></div>
            <div><small>At +${s.beAtR}R</small><b>${pl.be} → stop ${pl.beStop}</b></div><div><small>Target ${s.tpAtR}R</small><b>${pl.tp}</b></div>
          </div>
          <label class="f"><span>Price on FX Replay now (optional — Edge tells you what to do)</span><input id="pPrice" inputmode="decimal" value="${esc(p.price)}" placeholder="e.g. ${pl.f(t.entry)}"></label>
          <label class="check" style="margin-top:10px"><input type="checkbox" id="pBe" ${t.beMoved ? "checked" : ""}> I moved my stop to break-even</label>
          <h2 style="margin-top:16px">How did it end?</h2>
          <div class="row">
            <button class="btn primary" data-out="tp">🎯 Target hit</button>
            <button class="btn" data-out="be">🔒 Break-even stop</button>
            <button class="btn" data-out="sl">✋ Stopped (−1R)</button>
          </div>
          <div class="row" style="margin-top:8px"><input id="pExit" inputmode="decimal" placeholder="…or I closed at this price"><button class="btn small" data-out="exit">Log</button></div>
          <input id="pNote" placeholder="One line: did you follow the plan?" style="margin-top:8px">
          <p class="muted" style="font-size:12px"><a href="#" id="pCancel">Cancel this practice trade</a></p>
        </section>${statsHtml(st)}`;
    }

    return `
      <section class="card">
        <h2 style="margin-top:0">Practice on FX Replay — free</h2>
        <p class="muted">The Edge script can't run inside FX Replay, so here <b>you</b> find the steps — that's the skill you're training. Tick each one only when you can point at it on the chart. All 5 = A+. Everything but the sweep, on the zone's first visit = A.</p>
        <div class="seg" style="margin:10px 0" id="pMkt">${MARKETS.map(([k, l]) => `<button type="button" class="${p.market === k ? "on z" : ""}" data-m="${k}">${l}</button>`).join("")}</div>
        <div class="seg" style="margin:0 0 12px;grid-template-columns:1fr 1fr" id="pDir">
          <button type="button" class="${p.dir === "long" ? "on p1" : ""}" data-d="long">Long</button>
          <button type="button" class="${p.dir === "short" ? "on m1" : ""}" data-d="short">Short</button></div>
        <div style="display:grid;gap:12px">${STEPS.map(([k, label, hint], i) => `
          <label class="check"><input type="checkbox" data-step="${esc(k)}" ${p.steps[k] ? "checked" : ""}>
            <span><b style="color:var(--text)">${i + 1}. ${esc(label)}</b><br><small>${esc(hint)}</small>
            ${k === "fresh zone" && p.steps[k] && !p.steps["liquidity taken"] ? `<br><label class="check" style="margin-top:6px"><input type="checkbox" id="pFirst" ${p.firstVisit ? "checked" : ""}> First visit to this zone since it formed</label>` : ""}
            ${k === "liquidity taken" && p.steps[k] ? `<br><select id="pLiq" style="margin-top:6px">${["", ...LIQ].map((l) => `<option ${p.liquidity === l ? "selected" : ""} value="${esc(l)}">${l ? esc(l) : "Which one?"}</option>`).join("")}</select>` : ""}</span></label>`).join("")}
        </div>
      </section>
      <section class="banner ${grade === "A+" ? "good" : "bad"}" style="font-size:18px">${grade === "A+" ? `A+ — all 5 steps done. Enter on the 5m close.` : grade === "A" ? "A — no liquidity sweep, first visit. Tradeable. Enter on the 5m close." : `${n}/5 — no trade. ${n === 4 && !p.steps["liquidity taken"] ? "Second visit without a liquidity sweep = no trade." : "Wait for the missing step."}`}</section>
      <section class="card">
        <div class="grid2">
          <label class="f"><span>Entry (5m close)</span><input id="pEntry" inputmode="decimal" value="${esc(p.entry)}"></label>
          <label class="f"><span>Stop loss</span><input id="pSl" inputmode="decimal" value="${esc(p.sl)}"></label>
        </div>
        ${ok ? (() => { const pl = plan(p.dir, e, sl); return `<div class="levels" style="grid-template-columns:repeat(2,1fr)">
          <div><small>Take profit ${s.tpAtR}R</small><b>${pl.tp}</b></div><div><small>At +${s.beAtR}R</small><b>${pl.be} → ${pl.beStop}</b></div></div>
          <p class="muted" style="font-size:13px">In FX Replay: stop at ${pl.f(sl)}, take-profit at ${pl.tp}. Write ${pl.be} down — that's where the stop goes to break-even.</p>`; })() : p.entry !== "" && p.sl !== "" ? `<div class="blocks">The stop has to be ${p.dir === "long" ? "below" : "above"} the entry.</div>` : ""}
        <div class="row" style="margin-top:10px">
          <button class="btn primary" id="pEnter" ${all && ok ? "" : "disabled"}>I entered — guide me</button>
        </div>
        ${!all && ok ? `<p class="muted" style="font-size:12px"><a href="#" id="pAnyway">I took it anyway (logged as a rule break — it shows in your stats)</a></p>` : ""}
      </section>${statsHtml(st)}`;
  }

  function statsHtml(st) {
    if (!st || !st.n) return `<section class="card"><p class="muted" style="margin:0">Your practice results show here and in Journal → Practice. Aim for 30+ practice trades that follow the plan before going live.</p></section>`;
    const share = st.n ? Math.round((st.aPlus.n / st.n) * 100) : 0;
    return `<section class="card"><h2>Practice so far</h2><div class="grid2">
      <div class="stat"><small>Trades</small><b>${st.n}</b><small>${st.ruleBreaks} with a rule break</small></div>
      <div class="stat"><small>A+ share</small><b class="pos">${share}%</b><small>A+ or A only</small></div>
      <div class="stat"><small>Total</small><b class="${st.totalR >= 0 ? "pos" : "neg"}">${st.totalR > 0 ? "+" : ""}${st.totalR}R</b><small>avg ${st.avgR ?? "—"}R</small></div>
      <div class="stat"><small>A+ only</small><b class="${st.aPlus.totalR >= 0 ? "pos" : "neg"}">${st.aPlus.totalR > 0 ? "+" : ""}${st.aPlus.totalR}R</b><small>win ${st.aPlus.winRate ?? "—"}%</small></div>
    </div></section>`;
  }

  async function log(outcome) {
    const t = p.trade;
    const exit = outcome === "exit" ? Number(($("#pExit", root) || {}).value) : undefined;
    if (outcome === "exit" && !Number.isFinite(exit)) return window.Edge.toast("Type the price you closed at.");
    try {
      const r = await fetch("/api/app", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.Edge.token()}` },
        body: JSON.stringify({ action: "practiceLog", grade: t.grade, market: t.market, dir: t.dir, entry: t.entry, sl: t.sl, steps: t.steps, liquidity: t.liquidity, outcome, exit, openedAt: t.at, note: ($("#pNote", root) || {}).value || "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      const res = j.trade.resultR;
      window.Edge.toast(`Logged: ${res > 0 ? "+" : ""}${res}R (${j.trade.exitReason})${j.trade.ruleBreaks.length ? " · " + j.trade.ruleBreaks.join(", ") : " · plan followed ✓"}`, 7000);
      p = { ...p, steps: {}, liquidity: "", firstVisit: false, entry: "", sl: "", trade: null, price: "" }; save();
      if (window.Edge.refresh) await window.Edge.refresh();
      render();
    } catch (e) { window.Edge.toast(e.message, 6000); }
  }

  function enter(force) {
    const grade = gradeNow();
    if (!grade && !force) return;
    p.trade = { market: p.market, dir: p.dir, entry: Number(p.entry), sl: Number(p.sl), steps: { ...p.steps }, liquidity: p.liquidity, grade: grade || "no trade", beMoved: false, at: Date.now() };
    p.price = ""; save(); render();
  }

  function bind() {
    root.querySelectorAll("#pMkt [data-m]").forEach((b) => b.addEventListener("click", () => { p.market = b.dataset.m; save(); render(); }));
    root.querySelectorAll("#pDir [data-d]").forEach((b) => b.addEventListener("click", () => { p.dir = b.dataset.d; save(); render(); }));
    root.querySelectorAll("[data-step]").forEach((c) => c.addEventListener("change", () => { p.steps[c.dataset.step] = c.checked; save(); render(); }));
    const lq = $("#pLiq", root); if (lq) lq.addEventListener("change", () => { p.liquidity = lq.value; save(); });
    const fv = $("#pFirst", root); if (fv) fv.addEventListener("change", () => { p.firstVisit = fv.checked; save(); render(); });
    for (const [id, key] of [["#pEntry", "entry"], ["#pSl", "sl"], ["#pPrice", "price"]]) {
      const el = $(id, root);
      if (el) el.addEventListener("change", () => { p[key] = el.value.trim().replace(",", "."); save(); render(); });
    }
    const en = $("#pEnter", root); if (en) en.addEventListener("click", () => enter(false));
    const an = $("#pAnyway", root); if (an) an.addEventListener("click", (e) => { e.preventDefault(); enter(true); });
    const be = $("#pBe", root); if (be) be.addEventListener("change", () => { p.trade.beMoved = be.checked; save(); render(); });
    root.querySelectorAll("[data-out]").forEach((b) => b.addEventListener("click", () => log(b.dataset.out)));
    const cc = $("#pCancel", root); if (cc) cc.addEventListener("click", (e) => { e.preventDefault(); p.trade = null; save(); render(); });
  }
  function render() { if (!root || !root.isConnected) return; root.innerHTML = html(); bind(); }

  window.EdgePractice = { mount(el) { root = el; render(); } };
})();
