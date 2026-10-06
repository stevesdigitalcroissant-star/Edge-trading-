// Edge dashboard. Vanilla JS: one GET /api/app every 15 s, POST {action} for changes.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fx = (x) => (x == null ? "—" : Number(x) >= 100 ? Number(x).toFixed(2) : Number(x).toFixed(3));
  const rs = (r) => (r == null ? "—" : `${r > 0 ? "+" : ""}${Number(r).toFixed(2)}R`);
  const cls = (r) => (r > 0.1 ? "pos" : r < -0.1 ? "neg" : "");
  let token = ""; try { token = localStorage.getItem("edge.token") || ""; } catch {}
  let S = null, tab = "now", busy = false;
  try { tab = localStorage.getItem("edge.tab") || "now"; } catch {}

  async function api(method, body) {
    const r = await fetch("/api/app", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !(body && body.action === "login")) { showLogin(); throw new Error("Sign in"); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  function toast(t, ms = 3500) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms); }
  async function act(body, ok) {
    try { const r = await api("POST", body); if (ok) toast(ok); await refresh(); return r; }
    catch (e) { toast(e.message, 7000); return null; }
  }

  window.Edge = { token: () => token, state: () => S, toast };

  // ---------- notifications on this device (Web Push; iPhone/iPad need Edge on the Home Screen)
  const TABS = ["now", "coach", "setups", "bias", "journal", "rules"];
  const fromHash = () => { const h = location.hash.slice(1); if (TABS.includes(h)) { tab = h; try { localStorage.setItem("edge.tab", tab); } catch {} } };
  fromHash();
  addEventListener("hashchange", () => { fromHash(); if (S) render(); });
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushCapable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let swReg = null, pushSub = null;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(async (r) => {
      swReg = r;
      if (pushCapable) pushSub = await r.pushManager.getSubscription();
      if (S) render();
    }).catch(() => {});
  }
  const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  function pushStatus() {
    if (pushSub) return { on: true, text: "On for this device" };
    if (!pushCapable) return isIOS && !standalone
      ? { on: false, ios: true, text: "On iPhone / iPad: tap Share → Add to Home Screen, open Edge from the new icon, then come back here." }
      : { on: false, text: "This browser can't receive notifications. Use Chrome, Edge, Firefox or Safari." };
    if (Notification.permission === "denied") return { on: false, text: "Notifications are blocked for Edge. Allow them in the device settings, then try again." };
    return { on: false, text: "Off for this device" };
  }
  async function enablePush() {
    try {
      if (!S.push.publicKey) throw new Error("Push isn't available on the server.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications weren't allowed.");
      const reg = swReg || (await navigator.serviceWorker.ready);
      pushSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(S.push.publicKey) });
      const label = isIOS ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !/iPhone/.test(navigator.userAgent) ? "iPad" : "iPhone") : /Android/.test(navigator.userAgent) ? "Android" : "Computer";
      await api("POST", { action: "pushSubscribe", subscription: pushSub.toJSON(), label });
      await act({ action: "testAlert" }, "Notifications on. A test alert is on its way.");
    } catch (e) { toast(e.message, 7000); }
  }
  async function disablePush() {
    try { if (pushSub) { await api("POST", { action: "pushUnsubscribe", endpoint: pushSub.endpoint }); await pushSub.unsubscribe(); } pushSub = null; toast("Notifications off for this device."); render(); }
    catch (e) { toast(e.message); }
  }

  function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { token: t } = await api("POST", { action: "login", password: $("#pw").value });
      token = t; try { localStorage.setItem("edge.token", t); } catch {}
      $("#login").hidden = true; await refresh();
    } catch (err) { $("#loginErr").textContent = err.message; }
  });

  async function refresh() {
    if (busy) return;
    busy = true;
    try { S = await api("GET"); $("#app").hidden = false; render(); }
    catch (e) { if (e.message !== "Sign in") toast(e.message); }
    finally { busy = false; }
  }

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    tab = b.dataset.tab; try { localStorage.setItem("edge.tab", tab); } catch {}
    history.replaceState(null, "", "#" + tab);
    render(); scrollTo(0, 0);
  });

  const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const mname = (m) => (S.markets[m] ? S.markets[m].name : m);

  function render() {
    for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
    const live = S.setups.filter((x) => x.status === "open" && x.g.take.ok).length;
    $("#setupBadge").hidden = !live; $("#setupBadge").textContent = live;
    const g = S.guard;
    $("#topStatus").className = `pill ${g.ok ? "good" : "bad"}`;
    $("#topStatus").textContent = g.ok ? "Ready" : "Locked";
    const coachTab = tab === "coach";
    $("#view").hidden = coachTab;
    if (window.EdgeCoach) window.EdgeCoach.show(coachTab);
    if (coachTab) return;
    $("#view").innerHTML = ({ now: viewNow, setups: viewSetups, bias: viewBias, journal: viewJournal, rules: viewRules })[tab]();
    bind();
  }

  // ---------- NOW
  function viewNow() {
    const g = S.guard, s = S.settings;
    const banner = g.ok
      ? `<div class="banner good">Ready — waiting for an A+ setup.<p class="muted">No setup = no trade. Patience is the position.</p></div>`
      : `<div class="banner bad">Not trading right now.<p>${g.reasons.map(esc).join("<br>")}</p></div>`;
    const stats = `<div class="grid2">
      <div class="stat"><small>Trades today</small><b>${g.tradesToday} / ${s.maxTradesPerDay}</b></div>
      <div class="stat"><small>Today</small><b class="${cls(g.rToday)}">${rs(g.rToday)}</b></div>
      <div class="stat"><small>A+ share (last ${S.share.taken || 0})</small><b class="${S.share.share >= s.minAPlusShare ? "pos" : "neg"}">${S.share.share}%</b></div>
      <div class="stat"><small>Daily loss limit</small><b>−${s.maxDailyLossR}R</b></div>
    </div>`;
    const open = S.open.length ? S.open.map(tradeCard).join("") : `<p class="muted">No open trades.</p>`;
    const ps = pushStatus();
    const pushNudge = ps.on ? "" : `<section class="card"><div class="row between"><b>🔔 Get alerts on this ${isIOS ? "device" : "device"}</b>${pushCapable && Notification.permission !== "denied" ? `<button class="btn small primary" data-pushon>Turn on</button>` : ""}</div><p class="muted" style="margin:6px 0 0">${esc(ps.text)}</p></section>`;
    return `${banner}${pushNudge}${stats}<section class="card"><h2>Open trades</h2>${open}</section>${newsCard(6)}${logCard()}`;
  }

  function tradeCard(t) {
    const s = S.settings;
    const lo = -1, hi = s.tpAtR, span = hi - lo, pct = (r) => `${Math.max(0, Math.min(100, ((r - lo) / span) * 100))}%`;
    const r = t.r ?? 0;
    const manual = t.source === "manual";
    const beAdvised = manual && !t.beMoved && (t.maxR || 0) >= s.beAtR;
    return `<div class="card" style="background:var(--panel2);margin-bottom:10px">
      <div class="row between"><h3>${esc(mname(t.market))} · ${t.dir.toUpperCase()}</h3>
        <span class="pill ${t.grade === "A+" ? "good" : "warn"}">${esc(t.grade)}</span></div>
      <div class="ruler" style="--zero:${pct(0)};--be:${pct(s.beAtR)}">
        <div class="bar"></div>
        <span class="tick" style="left:${pct(-1)}">SL −1R</span>
        <span class="tick" style="left:${pct(0)}">Entry</span>
        <span class="tick" style="left:${pct(s.beAtR)}">BE ${s.beAtR}R</span>
        <span class="tick" style="left:${pct(hi)}">TP ${hi}R</span>
        <span class="max" style="left:${pct(t.maxR || 0)}" title="best so far"></span>
        <span class="now" style="left:${pct(r)}"></span>
      </div>
      <div class="row between"><b class="${cls(r)} num" style="font-size:22px">${rs(t.r)}</b>
        <span class="muted">${t.beMoved ? "🔒 Stop at break-even — can't lose" : `Stop moves to BE at ${s.beAtR}R`}</span></div>
      <div class="levels">
        <div><small>Entry</small><b>${fx(t.entry)}</b></div>
        <div><small>Stop</small><b>${fx(t.currentSL ?? t.initialSL)}</b></div>
        <div><small>BE trigger</small><b>${fx(t.plan && t.plan.beTrigger)}</b></div>
        <div><small>Target</small><b>${fx(t.tp)}</b></div>
      </div>
      ${t.units ? `<p class="muted">Size: ${Number(t.units).toFixed(t.units < 10 ? 2 : 0)} ${esc(S.markets[t.market]?.unit || "units")}${manual ? ` ≈ ${(t.units / (s.lots[t.market] || 1)).toFixed(2)} lots (1 lot = ${s.lots[t.market]})` : ""}</p>` : ""}
      ${(t.ruleBreaks || []).length ? `<p class="err">Rule break logged: ${t.ruleBreaks.map(esc).join(", ")}</p>` : ""}
      ${beAdvised ? `<div class="blocks">🔒 Move your stop to <b>${fx(t.plan.beStop)}</b> now.</div>` : ""}
      <div class="row">
        ${manual && !t.beMoved ? `<button class="btn small ${beAdvised ? "primary" : ""}" data-be="${esc(t.id)}">I moved my stop to break-even</button>` : ""}
        <button class="btn small danger" data-close="${esc(t.id)}">Close trade</button>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">${manual ? "Manual: Edge tells you when to act, you click in TradingView." : "Edge is managing this trade. Hands off."}${t.lastPriceAt ? ` · price ${time(t.lastPriceAt)}` : ""}</p>
    </div>`;
  }

  function newsCard(limit, market) {
    const ev = S.news.events.filter((e) => !market || e.markets.includes(market)).slice(0, limit);
    const now = S.now, s = S.settings;
    const rows = ev.map((e) => {
      const live = e.block && now >= e.time - s.newsBeforeMin * 60e3 && now <= e.time + s.newsAfterMin * 60e3;
      return `<div class="ev ${live ? "live" : ""}"><span class="num">${day(e.time).split(",")[0]} ${time(e.time)}</span>
        <span>${esc(e.title)}${e.forecast ? ` <small class="muted">f ${esc(e.forecast)} · p ${esc(e.previous)}</small>` : ""}<br><small class="muted">${e.markets.map(mname).join(" · ")}</small></span>
        <span class="pill ${e.block ? (live ? "bad" : "warn") : ""}">${live ? "NO TRADES" : e.impact}</span></div>`;
    }).join("");
    return `<section class="card"><h2>News that moves your markets</h2>
      ${S.news.ok || market ? "" : `<p class="err">Calendar feed unavailable${S.news.error ? ` (${esc(S.news.error)})` : ""} — only the weekly energy reports are shown. Check ForexFactory for CPI / NFP / FOMC.</p>`}
      <div class="news">${rows || `<p class="muted">Nothing big coming up.</p>`}</div></section>`;
  }

  function logCard() {
    return `<section class="card"><h2>Alerts</h2><div class="log">${S.log.slice(0, 12).map((l) => `<div><time>${day(l.at)} ${time(l.at)}</time>${esc(l.text)}</div>`).join("") || `<p class="muted">Nothing yet. Alerts from TradingView land here (and on your phone if Telegram is set up).</p>`}</div></section>`;
  }

  // ---------- SETUPS
  function viewSetups() {
    if (!S.setups.length) return `<section class="card"><h2>Setups</h2><p class="muted">No setups yet. When the TradingView script spots one, it shows up here, graded.</p><p class="muted">Waiting is the strategy. Most of trading is not trading.</p></section>`;
    return `<div class="setup-list">${S.setups.map(setupCard).join("")}</div>`;
  }
  function setupCard(x) {
    const s = S.settings, g = x.g;
    const risk = Math.abs(x.entry - x.sl), k = x.dir === "short" ? -1 : 1;
    const be = x.entry + k * s.beAtR * risk, tp = x.entry + k * s.tpAtR * risk;
    const live = x.status === "open" && !(x.expires && S.now > x.expires);
    const units = (s.accountSize * s.riskPct / 100) / risk;
    return `<div class="card setup ${live ? "" : "dim"}">
      <div class="row between">
        <div class="row"><div class="grade ${g.grade === "A+" ? "Ap" : g.grade}">${g.grade}</div>
          <div><h3>${esc(mname(x.market))} · ${x.dir.toUpperCase()}</h3><span class="muted">${day(x.at)} ${time(x.at)} · ${esc(x.tv || x.symbol)}</span></div></div>
        <span class="pill ${x.status === "taken" ? "good" : ""}">${live ? `${Math.max(0, Math.round((x.expires - S.now) / 60e3))} min left` : esc(x.status === "open" ? "expired" : x.status)}</span>
      </div>
      <div class="levels">
        <div><small>Entry</small><b>${fx(x.entry)}</b></div>
        <div><small>Stop</small><b>${fx(x.sl)}</b></div>
        <div><small>BE at ${s.beAtR}R</small><b>${fx(be)}</b></div>
        <div><small>TP ${s.tpAtR}R</small><b>${fx(tp)}</b></div>
      </div>
      <ul class="checks">${g.checks.map((c) => `<li class="${c.pass ? "" : "no"}"><span>${esc(c.label)}${c.note ? ` <small>(${esc(c.note)})</small>` : ""}</span></li>`).join("")}</ul>
      ${live && !g.take.ok ? `<div class="blocks">${g.take.why.map((w) => `<div>⛔ ${esc(w)}</div>`).join("")}</div>` : ""}
      ${live && S.broker.kind === "manual" ? `<p class="muted">Size at ${s.riskPct}% of ${s.accountSize}: <b>${units.toFixed(units < 10 ? 2 : 0)} ${esc(S.markets[x.market].unit)}</b> ≈ ${(units / (s.lots[x.market] || 1)).toFixed(2)} lots</p>` : ""}
      ${live ? `<div class="row"><button class="btn ${g.take.ok ? "good" : ""}" data-take="${esc(x.id)}" ${g.take.ok ? "" : "disabled"}>${g.take.ok ? (S.broker.kind === "manual" ? "I'm taking it" : "Take it — place the order") : "Not allowed"}</button>
        <button class="btn" data-skip="${esc(x.id)}">Skip</button></div>` : ""}
    </div>`;
  }

  function takeDialog(id) {
    const x = S.setups.find((y) => y.id === id);
    const manual = S.broker.kind === "manual";
    const moods = [["calm", "😌 Calm"], ["focused", "🎯 Focused"], ["fomo", "😬 Afraid to miss it"], ["revenge", "😤 Want my money back"], ["bored", "🥱 Bored"]];
    const body = $("#modalBody");
    body.innerHTML = `<h3>${esc(mname(x.market))} ${x.dir.toUpperCase()} · ${x.g.grade}</h3>
      <p>Before you click: how do you feel <b>right now</b>? Be honest — this is your journal.</p>
      <div class="moods">${moods.map(([k, l]) => `<button type="button" data-mood="${k}">${l}</button>`).join("")}</div>
      ${manual ? `<label class="f">Your fill price (leave empty if ${fx(x.entry)})<input id="fill" inputmode="decimal" placeholder="${fx(x.entry)}"></label>
        <p class="muted">Place it in TradingView with stop <b>${fx(x.sl)}</b> and take-profit at ${S.settings.tpAtR}R. Edge will tell you when to move the stop.</p>`
        : `<p class="muted">Edge places a market order with your stop at <b>${fx(x.sl)}</b> and take-profit at ${S.settings.tpAtR}R, sized at ${S.settings.riskPct}% risk. At +${S.settings.beAtR}R the stop moves to break-even by itself.</p>`}
      <p class="muted">I accept the stop. I won't move it further away. I won't move the target.</p>
      <div class="row"><button class="btn good" type="button" id="confirmTake" disabled>Confirm</button><button class="btn" value="cancel">Cancel</button></div>`;
    let mood = "";
    body.querySelectorAll("[data-mood]").forEach((b) => b.addEventListener("click", () => {
      mood = b.dataset.mood; body.querySelectorAll("[data-mood]").forEach((y) => y.classList.toggle("on", y === b)); $("#confirmTake").disabled = false;
    }));
    $("#confirmTake").addEventListener("click", async () => {
      $("#confirmTake").disabled = true;
      const r = await act({ action: "take", setupId: id, emotion: mood, entry: manual ? $("#fill").value : undefined }, "Trade on. Hands off — the rules manage it now.");
      $("#modal").close();
      if (r) { tab = "now"; render(); }
    });
    $("#modal").showModal();
  }

  function closeDialog(id) {
    const t = S.open.find((y) => y.id === id);
    const manual = t.source === "manual";
    const early = (t.r ?? 0) < S.settings.tpAtR - 0.1 && !t.beMoved;
    const body = $("#modalBody");
    body.innerHTML = `<h3>Close ${esc(mname(t.market))} ${t.dir}?</h3>
      ${early ? `<p class="err">Your plan is break-even at ${S.settings.beAtR}R and exit at ${S.settings.tpAtR}R. Closing now is outside the plan — it will be logged as an early exit.</p>` : ""}
      ${manual ? `<label class="f">Exit price<input id="exitPx" inputmode="decimal" value="${t.lastPrice ?? ""}"></label>` : ""}
      <div class="row"><button class="btn danger" type="button" id="doClose">Close it</button><button class="btn" value="cancel">Keep it</button></div>`;
    $("#doClose").addEventListener("click", async () => { await act({ action: "close", tradeId: id, exit: manual ? $("#exitPx").value : undefined }, "Closed."); $("#modal").close(); });
    $("#modal").showModal();
  }

  // ---------- BIAS
  function viewBias() {
    return Object.keys(S.markets).map((m) => {
      const b = S.bias[m], f = S.biasFactors[m];
      const age = b ? Math.floor((S.now - b.updated) / 864e5) : null;
      const stale = !b || age > 7;
      const label = b ? (b.dir === "long" ? "Bullish" : b.dir === "short" ? "Bearish" : "Neutral") : "Not set";
      return `<section class="card" data-biascard="${m}">
        <div class="row between"><h3>${esc(S.markets[m].name)}</h3>
          <span class="pill ${stale ? "warn" : b.dir === "long" ? "good" : b.dir === "short" ? "bad" : ""}">${label}${b ? ` · score ${b.score > 0 ? "+" : ""}${b.score}` : ""}${b ? ` · ${age === 0 ? "today" : `${age}d ago`}` : ""}</span></div>
        <p class="muted">Every Sunday (or after a big report): answer each line. Score ≥ +2 = bullish, ≤ −2 = bearish. Trades against your bias lose their A+.</p>
        ${f.map((x) => {
          const v = b && b.answers ? b.answers[x.id] || 0 : 0;
          return `<div class="factor"><b>${esc(x.label)}</b><small class="muted">${esc(x.hint)}</small>
            <div class="seg" data-factor="${x.id}" data-v="${v}">
              <button type="button" class="m1 ${v === -1 ? "on" : ""}" data-val="-1">Bearish</button>
              <button type="button" class="z ${v === 0 ? "on" : ""}" data-val="0">Neutral</button>
              <button type="button" class="p1 ${v === 1 ? "on" : ""}" data-val="1">Bullish</button></div></div>`;
        }).join("")}
        <label class="f" style="margin-top:10px">Notes (what you read, levels to watch)<textarea rows="2" data-note>${esc(b ? b.note : "")}</textarea></label>
        <div class="row" style="margin-top:10px"><button class="btn primary" data-savebias="${m}">Save ${esc(S.markets[m].name)} bias</button></div>
      </section>${newsCard(5, m)}`;
    }).join("");
  }

  // ---------- JOURNAL
  function viewJournal() {
    const st = S.stats;
    const grp = (x, l) => `<div class="stat"><small>${l} (${x.n})</small><b class="${cls(x.totalR)}">${rs(x.totalR)}</b><small>${x.winRate == null ? "" : `${x.winRate}% wins`}</small></div>`;
    const jrow = (t) => `<div class="jrow" data-j="${esc(t.id)}">
        <span><b>${esc(mname(t.market))} ${t.dir}</b> <span class="pill ${t.grade === "A+" ? "good" : "warn"}">${esc(t.grade)}</span>${t.emotion ? ` <small class="muted">${esc(t.emotion)}</small>` : ""}</span>
        <b class="r ${cls(t.resultR)}">${rs(t.resultR)}</b>
        <small class="muted">${day(t.closedAt)} · ${esc(t.exitReason)}${(t.ruleBreaks || []).length ? " · ⚠ rule break" : ""}</small>
        <small class="muted">${t.maxR != null ? `best ${rs(t.maxR)}` : ""}</small>
        ${t.note ? `<small style="grid-column:1/-1">${esc(t.note)}</small>` : ""}</div>`;
    const rows = S.journal.map(jrow).join("");
    return `<section class="card"><h2>Results</h2><div class="grid2">
        <div class="stat"><small>Total</small><b class="${cls(st.totalR)}">${rs(st.totalR)}</b><small>${st.n} trades</small></div>
        <div class="stat"><small>Win rate</small><b>${st.winRate == null ? "—" : st.winRate + "%"}</b><small>avg ${rs(st.avgR)}</small></div>
        <div class="stat"><small>Hit the target</small><b>${st.targets}</b><small>at ${S.settings.tpAtR}R</small></div>
        <div class="stat"><small>Saved by break-even</small><b>${st.breakEvens}</b><small>would-be losses</small></div>
        ${grp(st.aPlus, "A+ trades")}${grp(st.other, "A / B")}${grp(st.unplanned, "Unplanned")}
        <div class="stat"><small>Trades with a rule break</small><b class="${st.ruleBreaks ? "neg" : ""}">${st.ruleBreaks}</b></div>
      </div></section>
      ${S.practice.length ? `<section class="card"><h2>Practice (FX Replay) — not counted above</h2><div class="grid2">
        <div class="stat"><small>Practice total</small><b class="${cls(S.practiceStats.totalR)}">${rs(S.practiceStats.totalR)}</b><small>${S.practiceStats.n} trades</small></div>
        <div class="stat"><small>Win rate</small><b>${S.practiceStats.winRate == null ? "—" : S.practiceStats.winRate + "%"}</b><small>avg ${rs(S.practiceStats.avgR)}</small></div>
        ${grp(S.practiceStats.aPlus, "A+ practice")}${grp(S.practiceStats.unplanned, "Unplanned practice")}</div>
        ${S.practice.slice(0, 30).map(jrow).join("")}</section>` : ""}
      <section class="card"><div class="row between"><h2 style="margin:0">Journal</h2><button class="btn small" id="logTrade">＋ Log a trade I took</button></div>${rows || `<p class="muted">Closed trades appear here.</p>`}</section>`;
  }

  function noteDialog(id) {
    const t = [...S.journal, ...S.practice].find((y) => y.id === id);
    const body = $("#modalBody");
    body.innerHTML = `<h3>${esc(mname(t.market))} ${t.dir} · ${rs(t.resultR)}</h3>
      <p class="muted">Entry ${fx(t.entry)} · stop ${fx(t.initialSL)} · exit ${fx(t.exit)} · ${esc(t.exitReason)}</p>
      ${t.source === "manual" || /^coach/.test(t.source || "") ? `<label class="f">Exit price (fix if different)<input id="jExit" inputmode="decimal" value="${t.exit ?? ""}"></label>` : ""}
      <label class="f">What did you learn? Did you follow the plan?<textarea id="jNote" rows="4">${esc(t.note || "")}</textarea></label>
      <div class="row"><button class="btn primary" type="button" id="jSave">Save</button><button class="btn" value="cancel">Cancel</button></div>`;
    $("#jSave").addEventListener("click", async () => { await act({ action: "note", tradeId: id, note: $("#jNote").value, exit: $("#jExit") ? $("#jExit").value : undefined }, "Saved."); $("#modal").close(); });
    $("#modal").showModal();
  }

  function logTradeDialog() {
    const body = $("#modalBody");
    body.innerHTML = `<h3>Log a trade you opened yourself</h3>
      <p class="muted">It will be tracked and managed like the others, but counts as <b>unplanned</b> (not A+).</p>
      <label class="f">Market<select id="mMarket">${Object.keys(S.markets).map((m) => `<option value="${m}">${esc(S.markets[m].name)}</option>`).join("")}</select></label>
      <label class="f">Direction<select id="mDir"><option value="long">Long</option><option value="short">Short</option></select></label>
      <label class="f">Entry<input id="mEntry" inputmode="decimal"></label>
      <label class="f">Stop loss<input id="mSL" inputmode="decimal"></label>
      <div class="row"><button class="btn primary" type="button" id="mSave">Track it</button><button class="btn" value="cancel">Cancel</button></div>`;
    $("#mSave").addEventListener("click", async () => {
      const r = await act({ action: "manualOpen", market: $("#mMarket").value, dir: $("#mDir").value, entry: $("#mEntry").value, sl: $("#mSL").value }, "Tracking it.");
      if (r) $("#modal").close();
    });
    $("#modal").showModal();
  }

  // ---------- RULES
  function viewRules() {
    const s = S.settings;
    const n = (k, label, step = "1") => `<label class="f">${label}<input data-set="${k}" type="number" step="${step}" value="${s[k]}"></label>`;
    const sess = Object.keys(S.markets).map((m) => `<label class="f">${esc(S.markets[m].name)} hours (${esc(s.tz)})<input data-sess="${m}" value="${esc(s.sessions[m].join("-"))}" placeholder="08:00-14:30"></label>`).join("");
    const ok = (b) => (b ? `<span class="pill good">on</span>` : `<span class="pill warn">off</span>`);
    const hook = `${location.origin}/api/hook`;
    const ps = pushStatus();
    const kinds = [["setup", "A+ setups ready to take"], ["action", "Act now: move stop to break-even, take profit, Coach alerts"], ["warn", "Rule checks: stop moved, no stop, structure broke against you"], ["news", "News coming (before the no-trade window)"], ["closed", "Trade closed + result"], ["locked", "Done for the day (limits hit)"], ["skip", "Setups that aren't A+ (to see what you skipped)"], ["info", "Other"]];
    const notifCard = `<section class="card"><h2>Notifications</h2>
        <div class="row between"><span class="pill ${ps.on ? "good" : "warn"}">${esc(ps.text)}</span>
          ${ps.on ? `<span class="row"><button class="btn small" data-testalert>Send a test</button><button class="btn small danger" data-pushoff>Turn off here</button></span>` : pushCapable && Notification.permission !== "denied" ? `<button class="btn small primary" data-pushon>Turn on for this device</button>` : ""}</div>
        ${ps.ios ? `<ol class="steps muted" style="margin-top:10px"><li>In Safari, tap <b>Share</b> (the square with the arrow).</li><li>Tap <b>Add to Home Screen</b> → Add.</li><li>Open <b>Edge</b> from your Home Screen, sign in, and tap <b>Turn on</b>.</li></ol>` : ""}
        <p class="muted">Devices receiving alerts: ${S.push.devices.length ? S.push.devices.map((d) => esc(d.label || "device")).join(", ") : "none yet"}. Turn it on on each phone, iPad or computer you want alerts on.</p>
        <div class="grid2">${kinds.map(([k, l]) => `<label class="f" style="flex-direction:row;display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" data-notify="${k}" style="width:auto" ${s.notify[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
      </section>`;
    return `${notifCard}<section class="card"><h2>Connections</h2>
        <div class="grid2">
          <div class="stat"><small>TradingView webhook</small><b style="font-size:15px">${ok(S.hookReady)}</b></div>
          <div class="stat"><small>Broker</small><b style="font-size:15px">${esc(S.broker.label)}</b>${S.broker.account && !S.broker.account.error ? `<small>${esc(S.broker.account.currency)} ${Number(S.broker.account.balance).toFixed(2)}</small>` : S.broker.account && S.broker.account.error ? `<small class="err">${esc(S.broker.account.error)}</small>` : ""}</div>
          <div class="stat"><small>Phone alerts (Telegram)</small><b style="font-size:15px">${ok(S.telegram)}</b></div>
          <div class="stat"><small>Storage</small><b style="font-size:15px">${S.storage === "memory" ? `<span class="pill bad">not saved</span>` : esc(S.storage)}</b></div>
        </div>
        <p class="muted">Webhook URL for your TradingView alert: <code>${esc(hook)}</code></p>
        <div class="row"><button class="btn small" data-testalert>Send a test alert</button></div>
      </section>
      <section class="card"><h2>Exits</h2><div class="grid2">
        ${n("beAtR", "Stop to break-even at (R)", "0.1")}${n("tpAtR", "Take profit at (R)", "0.1")}${n("beOffsetR", "Break-even buffer (R)", "0.01")}
        <label class="f">Target moved further away<select data-set="enforceTP"><option value="true" ${s.enforceTP ? "selected" : ""}>Put it back (greed check)</option><option value="false" ${s.enforceTP ? "" : "selected"}>Allow</option></select></label>
        <label class="f">15m structure breaks against me<select data-set="structureExit">${["notify", "close", "off"].map((v) => `<option ${s.structureExit === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="f">Big news & stop not at BE<select data-set="newsOpenTrade">${["warn", "close"].map((v) => `<option ${s.newsOpenTrade === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      </div></section>
      <section class="card"><h2>Risk & discipline</h2><div class="grid2">
        ${n("riskPct", "Risk per trade (%)", "0.1")}${n("accountSize", "Account size (manual mode)", "100")}
        ${n("maxTradesPerDay", "Max trades per day")}${n("maxDailyLossR", "Stop for the day after losing (R)", "0.5")}
        ${n("cooldownMin", "Cool-down after a loss (min)", "5")}${n("maxOpen", "Max open trades")}
        ${n("minAPlusShare", "Minimum A+ share (%)", "5")}${n("setupExpiryMin", "Setup valid for (min)", "1")}
        ${n("maxChaseR", "Refuse entry if price ran past it by (R)", "0.1")}
        ${n("newsBeforeMin", "No trades before news (min)", "5")}${n("newsAfterMin", "No trades after news (min)", "5")}
      </div></section>
      <section class="card"><h2>Coach</h2><div class="grid2">
        ${n("coachIdleSec", "Check the chart every (s) while waiting", "5")}${n("coachTradeSec", "…and while in a trade (s)", "5")}
        ${n("coachDailyChecks", "Max checks per day (cost guard)", "50")}
        <div class="stat"><small>Claude connection</small><b style="font-size:15px">${S.coach.ready ? `<span class="pill good">on</span>` : `<span class="pill warn">add ANTHROPIC_API_KEY</span>`}</b></div>
      </div></section>
      <section class="card"><h2>Trading hours</h2><div class="grid2">${sess}
        <label class="f">Time zone<input data-set="tz" value="${esc(s.tz)}"></label></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="saveRules">Save rules</button></div>
        <p class="muted">Changing rules is allowed — but never in the middle of a trade, and never right after a loss.</p></section>
      <section class="card"><h2>Account</h2><button class="btn small" id="signOut">Sign out</button></section>`;
  }

  // ---------- events
  function bind() {
    const v = $("#view");
    v.querySelectorAll("[data-take]").forEach((b) => b.addEventListener("click", () => takeDialog(b.dataset.take)));
    v.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => act({ action: "skip", setupId: b.dataset.skip }, "Skipped. Good.")));
    v.querySelectorAll("[data-be]").forEach((b) => b.addEventListener("click", () => act({ action: "beDone", tradeId: b.dataset.be }, "🔒 Break-even. This trade can't hurt you now.")));
    v.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(b.dataset.close)));
    v.querySelectorAll("[data-j]").forEach((b) => b.addEventListener("click", () => noteDialog(b.dataset.j)));
    v.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      const seg = b.parentElement; seg.dataset.v = b.dataset.val;
      seg.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === b));
    }));
    v.querySelectorAll("[data-savebias]").forEach((b) => b.addEventListener("click", () => {
      const card = b.closest("[data-biascard]"), answers = {};
      card.querySelectorAll("[data-factor]").forEach((s) => (answers[s.dataset.factor] = Number(s.dataset.v)));
      act({ action: "bias", market: b.dataset.savebias, answers, note: card.querySelector("[data-note]").value }, "Bias saved for the week.");
    }));
    v.querySelectorAll("[data-pushon]").forEach((b) => b.addEventListener("click", enablePush));
    v.querySelectorAll("[data-pushoff]").forEach((b) => b.addEventListener("click", disablePush));
    v.querySelectorAll("[data-notify]").forEach((el) => el.addEventListener("change", () => act({ action: "settings", patch: { notify: { [el.dataset.notify]: el.checked } } }, "Saved.")));
    const lt = $("#logTrade"); if (lt) lt.addEventListener("click", logTradeDialog);
    v.querySelectorAll("[data-testalert]").forEach((b) => b.addEventListener("click", async () => { const r = await act({ action: "testAlert" }); if (r) toast(r.telegram ? "Sent — check your devices." : "Logged. No device has notifications on yet."); }));
    const so = $("#signOut"); if (so) so.addEventListener("click", () => { try { localStorage.removeItem("edge.token"); } catch {} token = ""; showLogin(); });
    const sr = $("#saveRules"); if (sr) sr.addEventListener("click", () => {
      const patch = { sessions: {} };
      v.querySelectorAll("[data-set]").forEach((el) => {
        const k = el.dataset.set;
        patch[k] = el.type === "number" ? Number(el.value) : el.value === "true" ? true : el.value === "false" ? false : el.value;
      });
      v.querySelectorAll("[data-sess]").forEach((el) => (patch.sessions[el.dataset.sess] = el.value.split("-").map((x) => x.trim())));
      patch.notify = {}; v.querySelectorAll("[data-notify]").forEach((el) => (patch.notify[el.dataset.notify] = el.checked));
      act({ action: "settings", patch }, "Rules saved.");
    });
  }

  if (token) refresh(); else showLogin();
  // no auto-refresh on Bias / Rules: it would wipe what you are typing
  setInterval(() => { if (token && !document.hidden && !$("#modal").open && !["bias", "rules", "coach"].includes(tab)) refresh(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && token) refresh(); });
})();
