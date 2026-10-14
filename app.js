// Edge dashboard. Vanilla JS: one GET /api/app every 15 s, POST {action} for changes.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fx = (x) => (x == null ? "—" : Number(x) >= 100 ? Number(x).toFixed(2) : Math.abs(Number(x)) < 0.1 ? Number(x).toFixed(7) : Math.abs(Number(x)) < 2 ? Number(x).toFixed(5) : Number(x).toFixed(3));
  const rs = (r) => (r == null ? "—" : `${r > 0 ? "+" : ""}${Number(r).toFixed(2)}R`);
  const cls = (r) => (r > 0.1 ? "pos" : r < -0.1 ? "neg" : "");
  let token = ""; try { token = localStorage.getItem("edge.token") || ""; } catch {}
  let S = null, tab = "now", busy = false, lastSig = "", renderedTab = "";
  try { tab = localStorage.getItem("edge.tab") || "now"; } catch {}
  if (!["now", "coach", "journal", "rules", "watch", "bias"].includes(tab)) tab = { learn: "coach" }[tab] || "now";

  async function api(method, body) {
    const r = await fetch("/api/app", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !(body && ["login", "signup", "recover", "authStatus"].includes(body.action))) { showLogin(); throw new Error("Sign in"); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  function toast(t, ms = 3500) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms); }
  async function act(body, ok) {
    try { const r = await api("POST", body); if (ok) toast(ok); await refresh(); return r; }
    catch (e) { toast(e.message, 7000); return null; }
  }

  window.Edge = { token: () => token, state: () => S, toast, api: (body) => api("POST", body), refresh: () => refresh(), go: (t) => { tab = t; try { localStorage.setItem("edge.tab", tab); } catch {} history.replaceState(null, "", "#" + tab); refresh(); scrollTo(0, 0); } };

  // ---------- notifications on this device (Web Push; iPhone/iPad need Edge on the Home Screen)
  const TABS = ["now", "coach", "journal", "rules", "watch", "bias"];
  const ALIAS = { setups: "now", learn: "coach" }; // old links still land somewhere sensible
  // a link like …/#sim-gold opens the simulator straight away (bookmark it on the laptop / iPad)
  setTimeout(() => { const m = /^#(sim|lab)-(gold|crude|silver|natgas|nq|es|ym|copper)$/.exec(location.hash); if (m && window.EdgeSim) window.EdgeSim[m[1] === "sim" ? "open" : "openLab"](m[2]); }, 1500);
  const fromHash = () => { let h = location.hash.slice(1); h = ALIAS[h] || h; if (TABS.includes(h)) { tab = h; try { localStorage.setItem("edge.tab", tab); } catch {} } };
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
    if (Notification.permission === "denied") return { on: false, text: isIOS ? "Notifications are blocked for Edge. iPhone Settings → Notifications → Edge → Allow Notifications, then come back." : "Notifications are blocked for Edge. Allow them in the browser's site settings, then try again." };
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

  // ---------- account: sign in · create account · forgot password · recovery code
  let authView = "signin", authInfo = { needsSetupCode: false }, pendingCode = null, lastEmail = "";
  try { lastEmail = localStorage.getItem("edge.email") || ""; } catch {}
  async function showLogin() {
    $("#app").hidden = true; $("#login").hidden = false;
    try { authInfo = await api("POST", { action: "authStatus" }); authView = authInfo.hasAccount ? (authView === "recover" ? "recover" : "signin") : "create"; } catch {}
    renderAuth();
  }
  const field = (id, label, type, ac, val = "") => `<label class="f"><span>${label}</span><span class="field">
      <input id="${id}" type="${type}" autocomplete="${ac}" value="${esc(val)}" ${type === "email" ? 'inputmode="email" autocapitalize="off" spellcheck="false"' : ""} required>
      ${type === "password" ? `<button type="button" class="eye" data-eye="${id}" aria-label="Show password"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>` : ""}</span></label>`;
  function renderAuth() {
    const f = $("#loginForm");
    const brand = `<div class="brand"><img src="icon.svg" alt="" width="68" height="68"><span>Edge</span></div>`;
    const V = {
      signin: `${brand}<h1>Welcome back</h1><p class="muted">Only A+ setups. The rules decide — not emotions.</p>
        ${field("aEmail", "Email", "email", "username", lastEmail)}${field("aPw", "Password", "password", "current-password")}
        <button class="btn primary" type="submit">Sign in</button>
        <button type="button" class="link" data-view="recover">Forgot password?</button>`,
      create: `${brand}<h1>Create your account</h1><p class="muted">One account — yours. Use an email you'll remember.</p>
        ${authInfo.storageReady === false ? `<div class="blocks">⏳ Almost ready: storage isn't connected yet. Add your Upstash settings in Vercel, redeploy, then create your account here.</div>` : ""}
        ${field("aEmail", "Email", "email", "username")}${field("aPw", "Password", "password", "new-password")}${field("aPw2", "Confirm password", "password", "new-password")}
        ${authInfo.needsSetupCode ? `${field("aCode", "Setup code", "password", "off")}<small class="muted hint">The EDGE_SETUP_CODE you set in Vercel — so nobody else can claim your app.</small>` : ""}
        <button class="btn primary" type="submit">Create account</button>`,
      recover: `${brand}<h1>Reset your password</h1><p class="muted">Use the recovery code you saved when you created your account.</p>
        ${field("aEmail", "Email", "email", "username", lastEmail)}${field("aCode", "Recovery code", "text", "off")}${field("aPw", "New password", "password", "new-password")}${field("aPw2", "Confirm new password", "password", "new-password")}
        <button class="btn primary" type="submit">Set new password</button>
        <button type="button" class="link" data-view="signin">Back to sign in</button>`,
      code: `${brand}<h1>Save your recovery code</h1><p class="muted">It's the only way back in if you forget your password. It won't be shown again.</p>
        <div class="rcode" id="rcode">${esc(pendingCode || "")}</div>
        <button type="button" class="btn" id="copyCode">Copy code</button>
        <label class="check"><input type="checkbox" id="saved"> I saved it somewhere safe (password manager or notes)</label>
        <button class="btn primary" type="submit" id="codeDone" disabled>Continue</button>`,
    };
    f.innerHTML = V[authView] + `<p id="loginErr" class="err" role="alert"></p>`;
    f.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { authView = b.dataset.view; renderAuth(); }));
    f.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => { const i = $("#" + b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.classList.toggle("on", i.type === "text"); }));
    const cc = $("#copyCode"); if (cc) cc.addEventListener("click", async () => { try { await navigator.clipboard.writeText(pendingCode); cc.textContent = "Copied ✓"; } catch { cc.textContent = "Select and copy it"; } });
    const sv = $("#saved"); if (sv) sv.addEventListener("change", () => ($("#codeDone").disabled = !sv.checked));
    const first = f.querySelector("input:not([value]), input[value='']"); if (first && authView !== "code") setTimeout(() => first.focus(), 50);
  }
  function signedIn(t, email) {
    token = t;
    try { localStorage.setItem("edge.token", t); if (email) localStorage.setItem("edge.email", email); } catch {}
    if (email) lastEmail = email;
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => ($("#" + id) ? $("#" + id).value : "");
    const err = (m) => ($("#loginErr").textContent = m);
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
      if (authView === "code") { pendingCode = null; $("#login").hidden = true; await refresh(); return; }
      if ((authView === "create" || authView === "recover") && v("aPw") !== v("aPw2")) throw new Error("The two passwords don't match.");
      if (authView === "signin") {
        const r = await api("POST", { action: "login", email: v("aEmail"), password: v("aPw") });
        signedIn(r.token, r.email); $("#login").hidden = true; await refresh(); return;
      }
      const r = await api("POST", authView === "create"
        ? { action: "signup", email: v("aEmail"), password: v("aPw"), code: v("aCode") }
        : { action: "recover", email: v("aEmail"), code: v("aCode"), password: v("aPw") });
      signedIn(r.token, r.email); pendingCode = r.recoveryCode; authView = "code"; renderAuth();
    } catch (x) { err(x.message); }
    finally { if (document.body.contains(btn)) btn.disabled = authView === "code" && !($("#saved") || {}).checked; }
  });

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const next = await api("GET");
      // only redraw when something actually changed — a background refresh must never wipe what you opened, typed or scrolled to
      const sig = JSON.stringify({ ...next, now: 0, closeOut: next.closeOut && { warn: next.closeOut.warn, due: next.closeOut.due, minutesLeft: next.closeOut.minutesLeft } });
      const same = S && sig === lastSig && renderedTab === tab;
      S = next; lastSig = sig; $("#app").hidden = false;
      if (!same) render();
    }
    catch (e) { if (e.message !== "Sign in") toast(e.message); }
    finally { busy = false; }
  }

  // light · dark · follow the device — remembered on this device
  const TI = (d) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${d}</svg>`;
  const THEMES = [["", TI('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'), "Follows your device"], ["light", TI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'), "Light"], ["dark", TI('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'), "Dark"]];
  const themeNow = () => { try { return localStorage.getItem("edge.theme") || ""; } catch { return ""; } };
  const themeShow = () => { const t = THEMES.find((x) => x[0] === themeNow()) || THEMES[0], b = $("#themeBtn"); b.innerHTML = t[1]; b.title = `Theme: ${t[2]}`;
    const dark = t[0] === "dark" || (!t[0] && !matchMedia("(prefers-color-scheme: light)").matches); const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? "#08090b" : "#f4f2ee"; };
  themeShow();
  $("#themeBtn").addEventListener("click", () => {
    const i = THEMES.findIndex((x) => x[0] === themeNow()), n = THEMES[(i + 1) % THEMES.length];
    try { n[0] ? localStorage.setItem("edge.theme", n[0]) : localStorage.removeItem("edge.theme"); } catch {}
    if (n[0]) document.documentElement.dataset.theme = n[0]; else delete document.documentElement.dataset.theme;
    themeShow(); toast(`Theme: ${n[2]}`, 1500);
  });
  $("#helpBtn").addEventListener("click", () => { if (tab === "watch") return toast("The live chart coach watches your chart and talks you through it — press Start to begin."); startTour(true); });
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    tab = b.dataset.tab; try { localStorage.setItem("edge.tab", tab); } catch {}
    history.replaceState(null, "", "#" + tab);
    render(); scrollTo(0, 0);
  });

  const time = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const mname = (m) => (S.markets[m] ? S.markets[m].name : m);
  // a setup's / trade's own exits (tested strategies carry theirs; the rest use your settings). beR 0 = no break-even.
  const xpOf = (x) => (x && x.xp) || { beR: S.settings.beAtR, tpR: S.settings.tpAtR };
  const stratName = (x) => (x && x.strategy && S.strategies && S.strategies[x.strategy] ? S.strategies[x.strategy].name : "");
  // your risk in dollars for the order tickets (remembered on this device; default = account × risk %)
  const riskDefault = () => Math.round(S.settings.accountSize * S.settings.riskPct / 100);
  const riskMine = () => { try { const v = Number(localStorage.getItem("edge.riskUSD")); return v > 0 ? v : riskDefault(); } catch { return riskDefault(); } };
  // with your prop account set up, the risk autopilot decides (it starts from your base risk and only ever makes you smaller)
  // supply & demand scanner trades: as many contracts as fit under the band's max; flag it under the min
  const PV = { gold: 10, silver: 1000, crude: 100, natgas: 1000, es: 5, nq: 2, ym: 0.5, copper: 2500, rty: 5, "6e": 12500, "6b": 6250, "6j": 1250000, "6a": 10000, zn: 1000, zb: 1000 };
  const sdQty = (per, aim, hi) => { const top = per > 0 ? Math.floor(hi / per + 1e-9) : 0; return top < 1 ? 0 : Math.min(Math.max(1, Math.round(aim / per)), top); };
  function sdSize(x) {
    const st = S.settings, lo = st.sdRiskMin || 160, a = S.prop && S.prop.auto, hi = Math.min(st.sdRiskMax || 210, a && a.usd > 0 ? a.usd : Infinity), aim = Math.min(st.sdRiskTarget || 190, hi);
    const c = (CONTRACTS[x.market] || [["", PV[x.market] || 1]])[0], per = Math.abs(x.entry - x.sl) * c[1];
    const qty = sdQty(per, aim, hi), risk = Math.round(qty * per);
    return { contract: c[0], qty, risk, per: Math.round(per), lo, hi, aim, under: qty > 0 && risk < lo };
  }
  const riskNow = () => { const a = S.prop && S.prop.auto; return a ? a.usd : riskMine(); };
  const qtyFor = (z, risk) => (z && z.kind === "futures" && z.riskPerContract > 0 ? Math.floor(risk / z.riskPerContract + 1e-9) : null);

  function render() {
    document.body.dataset.tab = tab; // wide screens lay each screen out differently
    for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === tab || (tab === "watch" && b.dataset.tab === "now") || (tab === "bias" && b.dataset.tab === "rules"));
    const live = S.setups.filter((x) => x.status === "open" && x.g.take.ok && !(x.expires && S.now > x.expires)).length;
    $("#setupBadge").hidden = !live; $("#setupBadge").textContent = live;
    const g = S.guard;
    $("#topStatus").className = `pill ${g.ok ? "good" : "bad"}`;
    $("#topStatus").innerHTML = `<span class="dot ${g.ok ? "live" : ""}"></span>${g.ok ? "Ready" : "Locked"}`;
    const coachTab = tab === "watch"; // the live chart coach (screen share) keeps running while you switch tabs
    $("#view").hidden = coachTab;
    homeSync();
    if (window.EdgeCoach) window.EdgeCoach.show(coachTab);
    if (coachTab) return;
    setTimeout(maybeTour, 0);
    const view = $("#view"), fresh = renderedTab !== tab;
    // keep what you had open (alerts, advanced settings, playbook steps) and where you were in the page
    const open = new Set([...view.querySelectorAll("details[open]")].map((d, i) => d.dataset.keep || `#${i}`)), y = scrollY;
    view.innerHTML = ({ now: viewNow, coach: viewCoach, journal: viewJournal, rules: viewRules, bias: viewBias })[tab]();
    if (!fresh) { [...view.querySelectorAll("details")].forEach((d, i) => { if (open.has(d.dataset.keep || `#${i}`)) d.open = true; }); if (Math.abs(scrollY - y) > 1) scrollTo(0, y); }
    view.classList.toggle("enter", fresh); if (fresh) setTimeout(() => view.classList.remove("enter"), 700);
    renderedTab = tab;
    bind();
  }

  // the home chart (home.js): on Today it sits above your cards — beside them on a wide screen
  function homeSync() { const on = tab === "now" && !!S; document.body.classList.toggle("home-on", on); if (window.EdgeHome && S) window.EdgeHome.update(S, on); }
  window.Edge.homeSync = homeSync;

  // ---------- "What am I looking at?" — a guided tour, one thing at a time (auto the first time on each screen; ? in the top bar any time)
  const TOURS = {
    now: [
      ["confirm", "Edge spotted your trade", "Your order filled, so Edge recorded the trade. Check the numbers match your platform, pick how you feel, tap <b>All correct</b>."],
      ["hero", "What to do right now", "One line. <b>Session open</b> = look for your setup. <b>Setup ready</b> = confirm it below. <b>In a trade</b> = hands off. <b>Locked</b> = a limit was hit — done for today."],
      ["setups", "Edge found a setup", "From your TradingView alerts. Check it, say how you feel, and confirm — Edge sends the order with its stop and target."],
      ["open", "Your open trades", "Where price is between your stop and target, and what to do next. Edge pings you at +3R to lock in profit."],
      ["gameplan", "Your game plan", "When London and New York open, Edge sends a 5-minute brief: trades left, what to risk, which markets sit at a zone, the news. A recap comes after the session."],
      ["prop", "Your prop account", "Where the account stands against the firm's rules, what to risk on the next trade (the autopilot only ever makes you smaller), and your real odds of passing."],
      ["plan", "Plan a trade", "Your playbook, step by step. Tick each step as you check it on the chart, type your three prices — Edge checks 3R–10R, sizes it for your $ risk and sends or tracks the order."],
      ["kpis", "Your day in 3 numbers", "Trades taken out of your max, today's result in R (1R = what you risk on one trade), and the loss limit that locks trading for the day."],
      ["push", "Alerts on this device", "Turn this on so Edge can buzz you when an order fills, a setup appears, or it's time to lock in profit."],
    ],
    coach: [
      ["train", "How well you keep your playbook", "Out of the steps in your playbook, how many you kept in your last 20 practice trades."],
      ["sim", "Practice", "A real past day in a TradingView-style chart. Mark your zones, take your trade — every trade gets a scorecard: what you did well and what you missed."],
      ["progress", "Step by step", "Each step of your playbook, green when you keep it. Edge tells you what you're good at and what to work on next."],
      ["reviews", "Your practice trades", "Tap one to see its scorecard and the advice for anything you missed."],
      ["playbook", "Your playbook", "Your strategy in 8 steps. Tap a step for the details — or take the quiz."],
    ],
    journal: [
      ["insights", "What Edge learned about you", "Your best and worst times, markets and moods — from your own trades. It gets sharper the more you trade."],
      ["results", "Your results", "All real trades together. Win rate, total in R, and how many broke a rule."],
      ["journal", "Every trade", "Tap one to add a note or fix the exit price."],
    ],
  };
  function startTour(force = false) {
    const steps = (TOURS[tab] || []).filter(([sel]) => document.querySelector(`[data-tour="${sel}"]`));
    if (!steps.length) { if (force) toast("Nothing to explain on this screen yet."); return; }
    let i = 0;
    const ov = document.createElement("div"); ov.className = "tour"; document.body.appendChild(ov);
    const end = () => { ov.remove(); try { localStorage.setItem(`edge.tour.${tab}`, "1"); } catch {} };
    const show = () => {
      const [sel, title, text] = steps[i], el = document.querySelector(`[data-tour="${sel}"]`);
      if (!el) return end();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        const r = el.getBoundingClientRect(), pad = 6, below = r.top + r.height / 2 < innerHeight / 2;
        ov.innerHTML = `<div class="tour-hole" style="top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
          <div class="tour-bub" style="${below ? `top:${Math.min(innerHeight - 220, r.bottom + 14)}px` : `bottom:${Math.min(innerHeight - 220, innerHeight - r.top + 14)}px`}">
            <div class="row between"><small class="muted">${i + 1} of ${steps.length}</small><button type="button" class="tour-x" data-t="end">Skip</button></div>
            <b>${title}</b><p>${text}</p>
            <div class="row between"><button type="button" class="btn small" data-t="back" ${i ? "" : "disabled"}>‹ Back</button>
              <button type="button" class="btn small primary" data-t="next">${i < steps.length - 1 ? "Next ›" : "Got it"}</button></div></div>`;
        ov.querySelector('[data-t="end"]').onclick = end;
        ov.querySelector('[data-t="back"]').onclick = () => { i = Math.max(0, i - 1); show(); };
        ov.querySelector('[data-t="next"]').onclick = () => { if (++i >= steps.length) end(); else show(); };
      }, 380);
    };
    show();
  }
  function maybeTour() {
    let seen = false; try { seen = !!localStorage.getItem(`edge.tour.${tab}`); } catch {}
    if (!seen && TOURS[tab] && !document.querySelector(".tour")) setTimeout(() => startTour(false), 700);
  }

  // ---------- What Edge learned about you (from your closed trades; practice kept separate)
  function insightsCard(list = S.journal, title = "🧠 What Edge learned about you", small = false) {
    const I = window.EdgeInsights ? window.EdgeInsights.insights(list) : { ready: false, n: 0, need: 5, items: [] };
    const body = !I.ready
      ? `<div class="insight info"><span>🌱</span><div><b>Still learning</b><p>After ${I.need} closed trades Edge starts telling you your best times, markets and habits. You have ${I.n}.</p></div></div>`
      : (small ? I.items.slice(0, 2) : I.items).map((x) => `<div class="insight ${x.kind}"><span>${x.icon}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></div>`).join("") || `<p class="muted">Nothing stands out yet — your results are even across times and markets.</p>`;
    return `<section class="card" data-tour="insights"><div class="card-head"><h2>${title}</h2>${I.ready ? `<span class="muted">${I.n} trades</span>` : ""}</div>${body}${small && I.ready && I.items.length > 2 ? `<a href="#journal" class="muted" style="font-size:13px">See all ${I.items.length} →</a>` : ""}</section>`;
  }

  // ---------- TODAY: what to do now · plan a trade with your playbook · setups Edge found · your open trades
  const PB = () => window.EdgePlaybook;
  const sendsOrders = () => S.broker.kind === "traderspost" || S.broker.kind === "tradovate"; // Edge places the order on Tradovate for you
  // the contracts you can trade (prop firm futures): $ per 1.00 move
  const CONTRACTS = { gold: [["MGC", 10, "Micro gold"], ["GC", 100, "Gold"]], crude: [["MCL", 100, "Micro crude"], ["CL", 1000, "Crude"]], silver: [["SIL", 1000, "Micro silver"], ["SI", 5000, "Silver"]], natgas: [["MNG", 1000, "Micro gas"], ["QG", 2500, "E-mini gas"]], es: [["MES", 5, "Micro S&P"], ["ES", 50, "E-mini S&P"]], nq: [["MNQ", 2, "Micro Nasdaq"], ["NQ", 20, "E-mini Nasdaq"]], ym: [["MYM", 0.5, "Micro Dow"], ["YM", 5, "E-mini Dow"]], copper: [["MHG", 2500, "Micro copper"], ["HG", 25000, "Copper"]], rty: [["M2K", 5, "Micro Russell"], ["RTY", 50, "E-mini Russell"]], "6e": [["M6E", 12500, "Micro euro"], ["6E", 125000, "Euro"]], "6b": [["M6B", 6250, "Micro pound"], ["6B", 62500, "Pound"]], "6j": [["MJY", 1250000, "Micro yen"], ["6J", 12500000, "Yen"]], "6a": [["M6A", 10000, "Micro Aussie"], ["6A", 100000, "Aussie"]], zn: [["ZN", 1000, "10-year note"]], zb: [["ZB", 1000, "30-year bond"]] };
  const PL = { open: false, checks: [], market: "gold", contract: "MGC", dir: "long", entry: "", sl: "", tp: "", mood: "", type: "limit", info: null, busy: false };
  try { Object.assign(PL, JSON.parse(localStorage.getItem("edge.plan") || "{}"), { busy: false, info: null }); } catch {}
  const savePL = () => { try { const { busy, info, ...keep } = PL; localStorage.setItem("edge.plan", JSON.stringify(keep)); } catch {} };
  // London and New York sessions in your own time
  function sessionNow() {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const m = Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
    const L = m >= 120 && m < 480, N = m >= 480 && m < 720;
    const next = m < 120 ? 120 - m : m < 720 ? 0 : 1440 - m + 120;
    return { open: L || N, name: L ? (m >= 480 ? "London + New York" : "London") : N ? "New York" : "", inMin: next };
  }
  function planCalc() {
    const k = PL.dir === "short" ? -1 : 1, e = Number(PL.entry), sl = Number(PL.sl), tp = Number(PL.tp);
    const c = (CONTRACTS[PL.market] || []).find((x) => x[0] === PL.contract) || (CONTRACTS[PL.market] || [])[0];
    const pv = c ? c[1] : 1, risk = riskNow(), s = S.settings;
    const ok3 = [e, sl, tp].every((x) => Number.isFinite(x) && x > 0);
    const r = ok3 ? Math.abs(e - sl) : 0, rr = ok3 && r ? (k * (tp - e)) / r : null;
    const perC = r * pv, qty = perC > 0 ? Math.floor(risk / perC + 1e-9) : 0;
    const need = PB() ? PB().required.filter((x) => !PL.checks.includes(x)) : [];
    let why = "";
    if (need.length) why = `Tick every step first — ${need.length} to go.`;
    else if (!ok3) why = "Fill in the entry, the stop and the target.";
    else if (k * (e - sl) <= 0) why = `For a ${PL.dir === "long" ? "buy" : "sell"} the stop goes ${PL.dir === "long" ? "below" : "above"} the entry.`;
    else if (rr <= 0) why = `For a ${PL.dir === "long" ? "buy" : "sell"} the target goes ${PL.dir === "long" ? "above" : "below"} the entry.`;
    else if (rr < s.minR - 0.005) why = `${rr.toFixed(1)}R — under your ${s.minR}R minimum. No trade.`;
    else if (rr > s.maxR + 0.005) why = `${rr.toFixed(1)}R — past your ${s.maxR}R maximum. Aim for the nearest liquidity.`;
    else if (qty < 1) why = `One ${c[0]} risks $${Math.round(perC)} with this stop — more than your $${risk}.`;
    else if (!PL.mood) why = "How do you feel right now?";
    else if (["fomo", "revenge", "bored"].includes(PL.mood)) why = "Not in this state. Walk away — the next setup will come.";
    else if (!S.guard.ok) why = S.guard.reasons[0];
    return { e, sl, tp, rr, qty, perC, risk, c, why, ready: !why, potential: rr > 0 ? qty * perC * rr : 0 };
  }
  function planCard() {
    const P = PB(); if (!P) return "";
    const s = S.settings;
    if (!PL.open) return `<section class="card plan" data-tour="plan" id="planCard"><div class="plan-intro"><div><h2>🧭 Plan a trade</h2><p class="muted">Edge walks you through your strategy, step by step — and only lets the trade through when every step is there.</p></div><button class="btn primary" data-pl="open">Start</button></div></section>`;
    const done = P.required.filter((x) => PL.checks.includes(x)).length, all = P.required.length;
    const c = planCalc(), routed = sendsOrders();
    const rrCls = c.rr == null ? "" : c.rr < s.minR - 0.005 || c.rr > s.maxR + 0.005 ? "bad" : "good";
    const step = (st, n) => { const on = PL.checks.includes(st.id), info = PL.info === st.id;
      return `<div class="pb-step ${on ? "on" : ""}"><button type="button" class="pb-tick" data-pl="tick" data-a="${st.id}"><i>${on ? "✓" : n}</i><span><b>${esc(st.title)}</b><small>${esc(st.short)}</small></span>${st.req ? "" : `<em>bonus</em>`}</button><button type="button" class="pb-info ${info ? "on" : ""}" data-pl="info" data-a="${st.id}" aria-label="What this means">i</button>${info ? `<p class="pb-text">${esc(st.text)}</p>` : ""}</div>`; };
    const mk = Object.keys(CONTRACTS).filter((m) => S.markets[m]);
    const inp = (f, label) => `<label class="f"><small>${label}</small><input data-plf="${f}" inputmode="decimal" value="${esc(PL[f])}" placeholder="0.00"></label>`;
    const moods = [["calm", "😌 Calm"], ["focused", "🎯 Focused"], ["fomo", "😬 FOMO"], ["revenge", "😤 Revenge"], ["bored", "🥱 Bored"]];
    return `<section class="card plan open" data-tour="plan" id="planCard">
      <div class="card-head"><h2>🧭 Plan a trade</h2><button class="btn small" data-pl="close">Close</button></div>
      <div class="pb-prog"><span style="width:${(done / all) * 100}%"></span></div><p class="muted pb-count">${done === all ? "✅ Every step is there — now the numbers." : `${done} of ${all} steps · tap each one when you've checked it on the chart`}</p>
      <div class="pb-steps">${P.STEPS.map((st, i) => step(st, i + 1)).join("")}</div>
      <div class="pl-nums ${done === all ? "" : "dim"}">
        <div class="chips">${mk.map((m) => `<button type="button" data-pl="mk" data-a="${m}" class="${PL.market === m ? "on" : ""}">${esc(S.markets[m].name)}</button>`).join("")}</div>
        <div class="row" style="gap:8px;margin:8px 0">
          <div class="seg two"><button type="button" data-pl="dir" data-a="long" class="${PL.dir === "long" ? "on p1" : ""}">▲ Long</button><button type="button" data-pl="dir" data-a="short" class="${PL.dir === "short" ? "on m1" : ""}">▼ Short</button></div>
          <select data-plf="contract">${(CONTRACTS[PL.market] || []).map(([r, , n]) => `<option value="${r}" ${PL.contract === r ? "selected" : ""}>${r} · ${n}</option>`).join("")}</select></div>
        <div class="grid3">${inp("entry", "Limit at the FVG start")}${inp("sl", "Stop behind the swing")}${inp("tp", "Target (liquidity)")}</div>
        <div class="pl-calc" id="plCalc">${calcHtml(c, rrCls)}</div>
        <div class="chips moods">${moods.map(([k, l]) => `<button type="button" data-pl="mood" data-a="${k}" class="${PL.mood === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <p class="pl-why ${c.ready ? "good" : ""}" id="plWhy">${c.ready ? `✅ Ready. ${routed ? "Edge sends it to Tradovate with the stop and target attached." : "Place it on your platform, then tap below so Edge tracks it."}` : esc(c.why)}</p>
        <div class="row">${routed ? `<button class="btn good" data-pl="go" data-a="send" ${c.ready && !PL.busy ? "" : "disabled"}>Send ${PL.type} order to Tradovate</button>` : ""}
          <button class="btn ${routed ? "" : "good"}" data-pl="go" data-a="track" ${c.ready && !PL.busy ? "" : "disabled"}>${routed ? "I placed it myself" : "I've placed it — track it"}</button>
          <button type="button" class="link" data-pl="type">${PL.type === "limit" ? "Already in? Market instead" : "Back to a limit order"}</button></div>
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">After the fill: ${P.MANAGE.map(esc).join(" ")}</p>
      </div></section>`;
  }
  function calcHtml(c, rrCls) {
    return `<div><small>Reward : risk</small><b class="${rrCls}">${c.rr == null || !Number.isFinite(c.rr) ? "—" : `${c.rr.toFixed(1)}R`}</b></div>
      <div><small>Contracts</small><b>${c.qty > 0 ? `${c.qty} ${c.c ? c.c[0] : ""}` : "—"}</b></div>
      <div><small>Risk</small><b>${c.qty > 0 ? `$${Math.round(c.qty * c.perC)}` : `$${c.risk}`}</b></div>
      <div><small>If it hits</small><b class="good">${c.potential > 0 ? `+$${Math.round(c.potential).toLocaleString("en-US")}` : "—"}</b></div>`;
  }
  // update the numbers without redrawing the inputs (typing isn't interrupted)
  function planSync() {
    const c = planCalc(), s = S.settings, rrCls = c.rr == null ? "" : c.rr < s.minR - 0.005 || c.rr > s.maxR + 0.005 ? "bad" : "good", routed = sendsOrders();
    const el = $("#plCalc"); if (el) el.innerHTML = calcHtml(c, rrCls);
    const w = $("#plWhy"); if (w) { w.className = `pl-why ${c.ready ? "good" : ""}`; w.textContent = c.ready ? `✅ Ready. ${routed ? "Edge sends it to Tradovate with the stop and target attached." : "Place it on your platform, then tap below so Edge tracks it."}` : c.why; }
    document.querySelectorAll('[data-pl="go"]').forEach((b) => (b.disabled = !c.ready || PL.busy));
  }
  function planSwap() { const el = $("#planCard"); if (!el) return; el.outerHTML = planCard(); bindPlan(); }
  async function planAct(k, a) {
    if (k === "open") { PL.open = true; PL.info = null; }
    else if (k === "close") PL.open = false;
    else if (k === "tick") PL.checks = PL.checks.includes(a) ? PL.checks.filter((x) => x !== a) : [...PL.checks, a];
    else if (k === "info") PL.info = PL.info === a ? null : a;
    else if (k === "mk") { PL.market = a; PL.contract = (CONTRACTS[a] || [[""]])[0][0]; }
    else if (k === "dir") PL.dir = a;
    else if (k === "mood") PL.mood = a;
    else if (k === "type") PL.type = PL.type === "limit" ? "market" : "limit";
    else if (k === "go") {
      PL.busy = true; planSync();
      const r = await act({ action: "planTrade", market: PL.market, contract: PL.contract, dir: PL.dir, entry: PL.entry, sl: PL.sl, tp: PL.tp, riskUSD: riskNow(), emotion: PL.mood, checks: PL.checks, type: PL.type, send: a === "send" },
        a === "send" ? "Sent to Tradovate. Hands off — Edge tells you when it fills." : "Tracking it. Edge tells you when it fills and when to lock in profit.");
      PL.busy = false;
      if (r) { Object.assign(PL, { open: false, checks: [], entry: "", sl: "", tp: "", mood: "", type: "limit" }); savePL(); return; }
      return planSync();
    }
    savePL(); planSwap();
  }
  function bindPlan() {
    const card = $("#planCard"); if (!card) return;
    card.querySelectorAll("[data-pl]").forEach((b) => b.addEventListener("click", () => planAct(b.dataset.pl, b.dataset.a)));
    card.querySelectorAll("[data-plf]").forEach((inp) => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => { PL[inp.dataset.plf] = inp.value.replace(",", "."); savePL(); planSync(); }));
  }
  function ordersCard() {
    const os = S.orders || [];
    if (!os.length) return "";
    return `<section class="card"><div class="card-head"><h2>⏳ Waiting to fill</h2><span class="muted">${os.length} limit order${os.length > 1 ? "s" : ""}</span></div>
      ${os.map((o) => { const t = o.trade; return `<div class="ord-row"><div><b>${esc(mname(o.market))} ${o.dir === "long" ? "BUY" : "SELL"} ${t.units} ${esc(t.contract || "")}</b><small class="muted">limit ${fx(o.entry)} · stop ${fx(o.sl)} · target ${fx(o.tp)} · ${t.tpR}R${o.routed ? " · on Tradovate" : ""}</small></div><button class="btn small" data-cancelord="${esc(o.id)}">Cancel</button></div>`; }).join("")}
      <p class="muted" style="margin:6px 0 0;font-size:12.5px">If price runs to the target without filling you, Edge cancels it — no chasing.</p></section>`;
  }

  // ---------- YOUR PROP ACCOUNT: where it stands, what to risk next, your odds of passing, when you can be paid
  const usd = (x, sign = false) => x == null || !Number.isFinite(x) ? "—" : `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}$${Math.abs(Math.round(x)).toLocaleString("en-US")}`;
  const FIRMS = () => (window.EdgeFirms || {});
  // your own results feed the odds: real trades first, then practice; under 5 → the playbook's 2019–2026 test
  const myRs = () => { const live = S.journal.filter((t) => t.resultR != null).map((t) => t.resultR), pr = (CO.ex || []).filter((x) => x.R != null).map((x) => x.R); return live.length >= 20 ? live : [...live, ...pr]; };
  let oddsMemo = { k: "", v: null };
  function passOdds() {
    const P = S.prop, E = window.EdgeProp; if (!P || !P.acct || !E || P.acct.target == null) return null;
    const rs = myRs(), k = JSON.stringify([P.acct.balance, P.acct.peak, P.acct.best, P.acct.daysTraded, P.cfg, rs.length, rs.reduce((a, b) => a + b, 0)]);
    if (oddsMemo.k !== k) oddsMemo = { k, v: E.simulate(P.acct, P.cfg, rs, { setupsPerDay: P.cfg.setupsPerDay || 1, maxPerDay: S.settings.maxTradesPerDay || 2, days: 20, base: P.cfg.baseRisk || 250, fee: 2 * (P.cfg.feePerContract || 1.5) }) };
    return oddsMemo.v;
  }
  const bar = (pct, c) => `<div class="pbar ${c || ""}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  function propCard() {
    const P = S.prop;
    if (!P || !P.cfg || !P.cfg.enabled) return `<section class="card slim prop-intro" data-tour="prop"><div class="row between"><div><b>🏁 Passing a prop firm?</b><p class="muted" style="margin:4px 0 0">Tradeify, Phidias, MyFundedFutures or Lucid — Edge tracks your drawdown, sizes every trade so one bad day can't end it, and shows your real odds of passing.</p></div><button class="btn small primary" data-propset>Set up</button></div></section>`;
    const c = P.cfg, a = P.acct, au = P.auto, f = FIRMS()[c.firm], plan = f && f.plans[c.plan];
    if (!a) return "";
    const ST = { on: ["On track", "good"], almost: ["Target hit — keep the rules", "warn"], passed: ["Passed 🎉", "good"], "day-locked": ["Done for today", "warn"], failed: ["Drawdown hit", "bad"] }[a.status] || ["", ""];
    const funded = c.phase === "funded";
    const tgt = !funded && a.target != null ? `<div class="pm"><div class="row between"><small>To the target</small><small><b>${a.toTarget > 0 ? `${usd(a.toTarget)} to go` : "reached"}</b> of ${usd(a.target)}</small></div>${bar((a.profit / a.target) * 100, "good")}</div>` : "";
    const room = `<div class="pm"><div class="row between"><small>Room before the drawdown</small><small><b>${usd(a.room)}</b> · floor ${usd(a.floor)}${c.ddType === "eod" ? " (end of day)" : c.ddType === "intraday" ? " (live)" : ""}</small></div>${bar((a.room / c.dd) * 100, a.room < c.dd * 0.35 ? "bad" : a.room < c.dd * 0.6 ? "warn" : "")}</div>`;
    const day = a.dailyRoom != null ? `<div class="pm"><div class="row between"><small>Today's loss limit</small><small><b>${usd(a.dailyRoom)}</b> left of ${usd(a.dailyLoss)}</small></div>${bar((a.dailyRoom / a.dailyLoss) * 100, a.dailyRoom < a.dailyLoss * 0.4 ? "bad" : "")}</div>` : "";
    const con = a.consistencyPct ? `<div class="pm"><div class="row between"><small>Consistency (${a.consistencyPct}%)</small><small>${a.consistCap != null && a.toTarget > 0 ? `today: up to <b>${usd(a.consistCap)}</b> more` : a.consistOk ? "<b class='good'>OK</b>" : `<b class="bad">best day ${usd(a.best)} too big</b> — keep trading small days`}</small></div></div>` : "";
    const mode = { normal: "", protect: `<span class="pill good">protect mode</span>`, consistency: `<span class="pill warn">consistency</span>`, stop: `<span class="pill bad">stop</span>` }[au.mode] || "";
    const auto = `<div class="auto ${au.mode}"><div class="row between"><div><small class="muted">Next trade · risk autopilot</small><b>${au.usd > 0 ? `Risk ${usd(au.usd)}` : "No more trades"}</b></div>${mode}</div><ul>${au.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`;
    const o = !funded ? passOdds() : null;
    const odds = o ? `<div class="odds"><div><b>${Math.round(o.pass5 * 100)}%</b><small>pass in 5 trading days</small></div><div><b>${Math.round(o.passN * 100)}%</b><small>pass in 20 days</small></div><div><b class="${o.fail > 0.15 ? "bad" : ""}">${Math.round(o.fail * 100)}%</b><small>fail in 20 days</small></div></div>
      <p class="muted odds-note">2,000 replays of the next 20 days with ${o.usedOwn ? `your own ${o.n} results` : "your playbook's 2019–2026 test (+0.66R a trade)"}, ${c.setupsPerDay || 1} setup a day on average, sized by the autopilot.${o.medianDays ? ` Typical pass: day ${o.medianDays}.` : ""} An edge needs time — the rules make sure you get it.</p>` : "";
    let pay = "";
    if (funded && window.EdgeProp) {
      const y = window.EdgeProp.payout(a, c, S.now);
      pay = `<div class="pay ${y.eligible ? "ok" : ""}"><div class="row between"><b>💸 ${y.eligible ? `You can request ${usd(y.safe)} now` : "Payout"}</b>${y.split ? `<span class="muted">${esc(y.split)} split</span>` : ""}</div>
        <p class="muted" style="margin:4px 0 0">${y.eligible ? `Request it today${y.paidBy ? ` — usually paid by ${esc(new Date(y.paidBy + "T12:00:00Z").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }))}` : ""}. Leave the buffer in: it's what keeps the account alive.` : [y.needWin ? `${y.needWin} more winning day${y.needWin > 1 ? "s" : ""}${c.payout && c.payout.minWinningDayProfit ? ` (${usd(c.payout.minWinningDayProfit)}+)` : ""}` : "", y.needDays ? `${y.needDays} more trading day${y.needDays > 1 ? "s" : ""}` : "", y.safe <= 0 ? `balance above ${usd(a.size + y.buffer)}` : "", !y.consist ? "a more even spread of days (consistency)" : ""].filter(Boolean).join(" · ") || "Not yet."}</p></div>`;
    }
    return `<section class="card prop" data-tour="prop" id="propCard">
      <div class="card-head"><h2>🏁 ${esc(f ? f.name : "Your account")} <small class="muted">${esc(plan ? plan.name : "")} · ${funded ? "funded" : "evaluation"}</small></h2><button class="btn small" data-propset>Edit</button></div>
      <div class="row between prop-top"><div><small class="muted">Balance</small><b class="num">${usd(a.balance)}</b><span class="${cls(a.profit)}">${usd(a.profit, true)}</span></div><span class="pill ${ST[1]}">${ST[0]}</span></div>
      ${tgt}${room}${day}${con}${auto}${odds}${pay}
      ${a.minDays > a.daysTraded ? `<p class="muted" style="margin:6px 0 0;font-size:12.5px">${a.minDays - a.daysTraded} more trading day${a.minDays - a.daysTraded > 1 ? "s" : ""} required before you can pass.</p>` : ""}
    </section>`;
  }
  function propDialog() {
    const F = FIRMS(), cur = (S.prop && S.prop.cfg) || {};
    let firm = cur.firm && (F[cur.firm] || cur.firm === "custom") ? cur.firm : "tradeify", plan = cur.plan || "", phase = cur.phase || "eval";
    const body = $("#modalBody");
    const fld = (k, label, v, hint = "") => `<label class="f"><small>${label}${hint ? ` <span class="muted">${hint}</span>` : ""}</small><input data-pf="${k}" inputmode="decimal" value="${v == null ? "" : esc(v)}" placeholder="—"></label>`;
    const draw = (fromPreset) => {
      const f = F[firm], plans = f ? Object.entries(f.plans) : [];
      if (f && !f.plans[plan]) plan = plans[0][0];
      const p = f && f.plans[plan], r = p ? (phase === "funded" ? p.funded : p.eval) || p.funded : null;
      const v = fromPreset && r ? { size: 50000, target: phase === "funded" ? null : r.target, ...r, payout: r.payout || {} } : { ...cur, payout: cur.payout || {} };
      const pay = v.payout || {}, an = (S.prop && S.prop.acct) || {};
      body.innerHTML = `<h3>🏁 Your prop account</h3>
        <div class="chips">${Object.entries(F).map(([k, x]) => `<button type="button" data-pfirm="${k}" class="${firm === k ? "on" : ""}">${esc(x.name)}</button>`).join("")}<button type="button" data-pfirm="custom" class="${firm === "custom" ? "on" : ""}">Other</button></div>
        ${f ? `<label class="f" style="margin-top:8px"><small>Account</small><select data-pplan>${plans.map(([k, x]) => `<option value="${k}" ${k === plan ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
        <div class="seg two" style="margin:8px 0"><button type="button" data-pphase="eval" class="${phase === "eval" ? "on p1" : ""}">Evaluation</button><button type="button" data-pphase="funded" class="${phase === "funded" ? "on p1" : ""}">Funded</button></div>
        ${p ? `<p class="muted" style="font-size:12.5px;margin:0 0 6px">${esc(p.note || "")} ${p.src ? `<a href="${esc(p.src)}" target="_blank" rel="noopener">Rules ↗</a>` : ""}<br>Automation: ${esc(f.api || "check with the firm")}.</p>` : ""}
        <p class="muted" style="font-size:12.5px;margin:0 0 6px">Firms change rules often — check every number against your dashboard.</p>
        <div class="grid3">${fld("size", "Account size", v.size ?? 50000)}${phase === "funded" ? "" : fld("target", "Profit target", v.target)}${fld("dd", "Max drawdown", v.dd)}</div>
        <div class="grid3"><label class="f"><small>Drawdown follows</small><select data-pf="ddType">${[["eod", "End of day"], ["intraday", "Live (intraday)"], ["static", "Static"]].map(([k, l]) => `<option value="${k}" ${v.ddType === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>${fld("ddLockAt", "Stops trailing at", v.ddLockAt, "balance")}${fld("dailyLoss", "Daily loss limit", v.dailyLoss)}</div>
        <div class="grid3">${fld("consistencyPct", "Consistency %", v.consistencyPct, "best day ≤")}${fld("minDays", "Min trading days", v.minDays)}${fld("maxMicros", "Max micros", v.maxMicros)}</div>
        <b style="display:block;margin:10px 0 4px">Where it stands now</b>
        <div class="grid3">${fld("balance", "Balance now", an.balance != null ? Math.round(an.balance) : v.size ?? 50000)}${fld("hwm", "Highest end-of-day balance", an.peak != null ? Math.round(an.peak) : "")}${fld("days", "Days traded so far", an.daysTraded ?? 0)}</div>
        <div class="grid3">${fld("baseRisk", "Normal risk a trade", cur.baseRisk ?? 250, "$")}${fld("setupsPerDay", "A+ setups a day", cur.setupsPerDay ?? 1, "average")}${fld("feePerContract", "Fees a contract", cur.feePerContract ?? 1.5, "$ round turn")}</div>
        ${phase === "funded" ? `<details open><summary><b>Payout rules</b></summary><div class="grid3">${fld("p.minWinningDays", "Winning days", pay.minWinningDays)}${fld("p.minWinningDayProfit", "Winning day =", pay.minWinningDayProfit, "$+")}${fld("p.minDays", "Min days", pay.minDays)}</div><div class="grid3">${fld("p.buffer", "Buffer above start", pay.buffer)}${fld("p.cap", "Max a payout", pay.cap)}${fld("p.processingDays", "Paid within", pay.processingDays, "business days")}</div><input type="hidden" data-pf="p.split" value="${esc(pay.split || "")}"></details>` : ""}
        <p class="err" id="pErr"></p>
        <div class="row"><button class="btn primary" type="button" id="pSave">Save</button>${cur.enabled ? `<button class="btn" type="button" id="pOff">Turn off</button>` : ""}<button class="btn" value="cancel">Cancel</button></div>`;
      body.querySelectorAll("[data-pfirm]").forEach((b) => b.addEventListener("click", () => { firm = b.dataset.pfirm; plan = ""; draw(true); }));
      const ps = body.querySelector("[data-pplan]"); if (ps) ps.addEventListener("change", () => { plan = ps.value; draw(true); });
      body.querySelectorAll("[data-pphase]").forEach((b) => b.addEventListener("click", () => { phase = b.dataset.pphase; draw(true); }));
      $("#pSave").addEventListener("click", async () => {
        const g = (k) => { const el = body.querySelector(`[data-pf="${k}"]`); return el ? el.value.replace(",", ".").replace(/[$\s]/g, "") : undefined; };
        const payout = {}; body.querySelectorAll('[data-pf^="p."]').forEach((el) => (payout[el.dataset.pf.slice(2)] = el.value));
        const cfg = { enabled: true, firm, plan: F[firm] ? plan : "", phase, size: g("size"), target: g("target"), dd: g("dd"), ddType: g("ddType"), ddLockAt: g("ddLockAt"), dailyLoss: g("dailyLoss"), consistencyPct: g("consistencyPct"), minDays: g("minDays"), maxMicros: g("maxMicros"),
          baseRisk: g("baseRisk"), setupsPerDay: g("setupsPerDay"), feePerContract: g("feePerContract"), payout: phase === "funded" ? payout : cur.payout, anchor: { balance: g("balance"), hwm: g("hwm") || g("balance"), days: g("days") } };
        try { $("#pSave").disabled = true; await api("POST", { action: "propSave", cfg }); $("#modal").close(); toast("Saved. The autopilot sizes every trade from now on."); refresh(); }
        catch (e) { $("#pErr").textContent = e.message; $("#pSave").disabled = false; }
      });
      const off = $("#pOff"); if (off) off.addEventListener("click", async () => { await api("POST", { action: "propOff" }).catch(() => {}); $("#modal").close(); refresh(); });
    };
    draw(!cur.enabled && !cur.firm);
    $("#modal").showModal();
  }
  function propSwap() { const el = $("#propCard"); if (el) { el.outerHTML = propCard(); $("#view").querySelectorAll("#propCard [data-propset]").forEach((b) => b.addEventListener("click", propDialog)); } }

  // ---------- S&D SCANNER: 1H zone + 5m shift found by TradingView on 14 markets (crude is off) — one tap sends the limit
  const SD_TV = ["MGC1!", "SIL1!", "MNG1!", "MES1!", "MNQ1!", "MYM1!", "M2K1!", "MHG1!", "6E1!", "6B1!", "6J1!", "6A1!", "ZN1!", "ZB1!"];
  function sdCard(x) {
    const g = x.g, live = x.status === "open" && !(x.expires && S.now > x.expires);
    const z = sdSize(x);
    const kind = { FVG: "fair value gap", breaker: "breaker block", mitigation: "mitigation block" }[x.kind] || x.kind || "";
    const chips = [[`1H ${x.dir === "long" ? "demand" : "supply"} ${fx(x.zoneBot)}–${fx(x.zoneTop)}`, true], ["5m MSS" + (x.mss != null ? ` past ${fx(x.mss)}` : ""), true], ...(x.trend4h ? [[x.trend4h === (x.dir === "short" ? -1 : 1) ? "4H trend with you" : "4H trend against you — your call", x.trend4h === (x.dir === "short" ? -1 : 1)]] : []), ...(x.fill != null ? [x.fill > 1 ? ["Price wicked past the zone's far edge (no close) — deep, your call", true] : x.fill >= 0.3 ? [`Zone filled ${Math.round(x.fill * 100)}% — past the 30% line`, true] : [`Zone filled only ${Math.round(x.fill * 100)}% — under 30%, price may go deeper first`, false]] : []), [`Entry: ${kind}`, true], [`Target ${Number(x.rr || 0).toFixed(1)}R`, true], x.liq == null ? ["No 5m swing in the way", true] : x.liqR >= x.rr - 0.05 ? [`Nearest 5m swing ${fx(x.liq)} (${Number(x.liqR).toFixed(1)}R) — room for the target`, true] : [`5m swing ${fx(x.liq)} at ${Number(x.liqR).toFixed(1)}R before the target — your call`, false]];
    return `<div class="card radar ${live ? "" : "dim"}" data-tour="setup">
      <div class="row between"><div class="row"><div class="grade A">S&amp;D</div>
        <div><h3>${esc(mname(x.market))} · ${x.dir === "long" ? "▲ BUY limit" : "▼ SELL limit"}</h3><span class="muted">${time(x.at)} · ${esc(x.tv || x.symbol || "")}</span></div></div>
        <span class="pill">${live ? `${Math.max(0, Math.round((x.expires - S.now) / 60e3))} min left` : esc(x.status === "open" ? "expired" : x.status)}</span></div>
      <div class="levels"><div><small>Limit</small><b>${fx(x.entry)}</b></div><div><small>Stop</small><b>${fx(x.sl)}</b></div><div><small>Target</small><b>${fx(x.tp)}</b></div><div><small>Size</small><b>${z.qty > 0 ? `${z.qty} ${esc(z.contract)}` : "too wide"}</b></div></div>
      <div class="sc-list">${chips.concat([z.qty < 1 ? [`One ${z.contract} risks $${z.per} — over your $${z.hi}`, false] : z.under ? [`Risk $${z.risk} — under your $${z.lo}–$${z.hi} (one more would go over $${z.hi})`, false] : [`Risk $${z.risk} (aim ~$${z.aim}, $${z.lo}–$${z.hi})`, true]]).map(([t, ok]) => `<span class="${ok ? "ok" : "no"}">${ok ? "✓" : "!"} ${esc(t)}</span>`).join("")}</div>
      ${live && !g.take.ok ? `<div class="blocks">${g.take.why.map((w) => `<div>⛔ ${esc(w)}</div>`).join("")}</div>` : ""}
      ${live ? `<p class="muted" style="margin:6px 0;font-size:12.5px">Look at it first: price came back into the 1H zone and the 5m closed past its last swing. ${sendsOrders() ? "Confirm and Edge sends the limit with its stop and target to Tradovate." : "Place the limit yourself; Edge tracks it."} The setup expires 4 hours after the alert. Risk ${usd(z.risk)}.</p>
        <div class="row"><button class="btn ${g.take.ok && z.qty > 0 ? "good" : ""}" data-take="${esc(x.id)}" ${g.take.ok && z.qty > 0 ? "" : "disabled"}>${g.take.ok ? (z.qty > 0 ? "Confirm the limit" : "Stop too wide for your risk") : "Not allowed"}</button><button class="btn" data-skip="${esc(x.id)}">Skip</button></div>` : ""}
    </div>`;
  }

  // ---------- RADAR: your playbook found by TradingView on all 8 markets — graded, one tap to send the limit
  function radarCard(x) {
    const g = x.g, live = x.status === "open" && !(x.expires && S.now > x.expires), k = x.dir === "short" ? -1 : 1;
    const risk = riskNow(), pv = { gold: 10, silver: 1000, crude: 100, natgas: 1000, es: 5, nq: 2, ym: 0.5, copper: 2500 }[x.market] || 1;
    const qty = Math.floor(risk / (Math.abs(x.entry - x.sl) * pv) + 1e-9), mic = (CONTRACTS[x.market] || [[""]])[0][0];
    const chips = [[x.withTrend ? "With the trend" : x.fromHtfZone ? "Counter-trend from a 4H zone" : "Against the trend", x.withTrend || x.fromHtfZone], [x.fresh ? "Fresh 15m zone" : "Zone already used", x.fresh], [x.liq ? "Liquidity taken" : "No liquidity sweep (bonus)", x.liq ? true : null], [`${Number(x.rr || 0).toFixed(1)}R`, x.rr >= S.settings.minR], [x.session ? `${x.session} session` : "Session", !!x.session]];
    return `<div class="card radar ${live ? "" : "dim"}" data-tour="setup">
      <div class="row between"><div class="row"><div class="grade ${g.grade === "A+" ? "Ap" : g.grade}">${esc(g.grade)}</div>
        <div><h3>${esc(mname(x.market))} · ${x.dir === "long" ? "▲ BUY limit" : "▼ SELL limit"}</h3><span class="muted">${time(x.at)} · ${esc(x.tv || x.symbol || "")}</span></div></div>
        <span class="pill">${live ? `${Math.max(0, Math.round((x.expires - S.now) / 60e3))} min left` : esc(x.status === "open" ? "expired" : x.status)}</span></div>
      <div class="levels"><div><small>Limit (FVG start)</small><b>${fx(x.entry)}</b></div><div><small>Stop</small><b>${fx(x.sl)}</b></div><div><small>Target</small><b>${fx(x.tp)}</b></div><div><small>Size</small><b>${qty > 0 ? `${qty} ${esc(mic)}` : "too wide"}</b></div></div>
      <div class="sc-list">${chips.map(([t, ok]) => `<span class="${ok ? "ok" : ok === null ? "" : "no"}">${ok ? "✓" : ok === null ? "·" : "!"} ${esc(t)}</span>`).join("")}</div>
      ${live && !g.take.ok ? `<div class="blocks">${g.take.why.map((w) => `<div>⛔ ${esc(w)}</div>`).join("")}</div>` : ""}
      ${live ? `<p class="muted" style="margin:6px 0;font-size:12.5px">Check it on your chart first: is the 15m zone really the base before the explosive move? Then confirm — ${sendsOrders() ? "Edge sends the limit with its stop and target to Tradovate." : "place the limit yourself; Edge tracks it."} Risk ${usd(qty > 0 ? qty * Math.abs(x.entry - x.sl) * pv : risk)}.</p>
        <div class="row"><button class="btn ${g.take.ok && qty > 0 ? "good" : ""}" data-take="${esc(x.id)}" ${g.take.ok && qty > 0 ? "" : "disabled"}>${g.take.ok ? (qty > 0 ? "Confirm the limit" : "Stop too wide for your risk") : "Not allowed"}</button><button class="btn" data-skip="${esc(x.id)}">Skip</button></div>` : ""}
    </div>`;
  }

  // the three steps to get Edge working for you — ticks itself off as each one is done
  function getSetCard() {
    const prop = !!(S.prop && S.prop.cfg && S.prop.cfg.enabled);
    const radar = Object.entries(S.prices || {}).filter(([, p]) => p && (p.swing15Low != null || p.trendD != null) && S.now - p.time < 3 * 864e5).map(([m]) => m);
    const push = !!pushSub || (S.push && S.push.devices.length > 0);
    let hide = false; try { hide = localStorage.getItem("edge.setupDone") === "1"; } catch {}
    if (hide || (prop && radar.length >= 14 && push)) return "";
    const row = (ok, n, title, text, btn) => `<div class="su-row ${ok ? "ok" : ""}"><i>${ok ? "✓" : n}</i><div><b>${title}</b><p class="muted">${text}</p></div>${ok ? "" : btn}</div>`;
    return `<section class="card setup-steps" data-tour="getset"><div class="card-head"><h2>🚀 Get set up</h2><button type="button" class="link" data-suhide>Hide</button></div>
      ${row(prop, 1, "Your prop account", prop ? "The autopilot sizes every trade." : "Pick your firm and plan, type where the account stands — Edge does the rest.", `<button class="btn small primary" data-propset>Set up</button>`)}
      ${row(radar.length >= 14, 2, `S&D scanner in TradingView${radar.length ? ` · ${radar.length}/14 markets` : ""}`, radar.length ? `Watching: ${radar.map(mname).join(", ")}.` : "On a computer: copy the script, add it to a 5-minute chart, create one alert per market (paid TradingView plan).", `<button class="btn small" data-copypine="edge_sd_scanner">Copy script</button>`)}
      ${row(push, 3, "Notifications on this phone", push ? "Setups, fills and your game plan reach you anywhere." : "So the radar can reach you when the app is closed.", pushCapable && Notification.permission !== "denied" ? `<button class="btn small" data-pushon>Turn on</button>` : "")}
      ${!radar.length ? `<details class="su-how"><summary>How to add the scanner alerts</summary><ol class="steps"><li>Tap <b>Copy script</b> (your secret is inside), open TradingView on a computer.</li><li>Pine Editor → select all, delete, paste → <b>Save</b> → <b>Add to chart</b> on a <b>5-minute</b> chart of <code>MGC1!</code>.</li><li>Alert (⏰) → Condition: <b>Edge S&amp;D</b> → <b>Any alert() function call</b> → Notifications → <b>Webhook URL</b>: <code>${esc(location.origin)}/api/hook</code> → Create.</li><li>Switch the chart to each of <code>${SD_TV.slice(1).join(" ")}</code> and create the same alert — 14 in all (crude is off).</li></ol></details>` : ""}
    </section>`;
  }

  function viewNow() {
    const g = S.guard, s = S.settings;
    const live = S.setups.filter((x) => x.status === "open" && x.g.take.ok && !(x.expires && S.now > x.expires));
    const inTrade = S.open.length, ses = sessionNow();
    const [stateTxt, stateColor, headline, sub] = !g.ok
      ? ["Locked", "var(--bad)", "Not trading right now.", g.reasons.map(esc).join("<br>")]
      : live.length ? ["Setup ready", "var(--accent)", `${live.length} setup${live.length > 1 ? "s" : ""} waiting for your OK.`, `Check it below — it's only valid for ${Math.max(1, Math.round((Math.min(...live.map((x) => x.expires || S.now + s.setupExpiryMin * 60e3)) - S.now) / 60e3))} more minutes.`]
      : inTrade ? ["In a trade", "var(--info)", "Hands off. The plan manages it.", S.open.map((t) => `${esc(mname(t.market))}: ${t.lockR != null ? `lock in +${t.lockR}R at +${t.beR}R, then trail · ` : ""}target ${t.tpR ? `${t.tpR}R` : fx(t.tp)}`).join("<br>")]
      : (S.orders || []).length ? ["Order waiting", "var(--info)", "Your limit is in. Let price come to you.", "No chasing — if it runs to the target without you, it's cancelled."]
      : ses.open ? ["Session open", "var(--good)", `${ses.name} session — look for your setup.`, "Big picture → 15m zone → 5m / 1m change of character. No setup, no trade."]
      : ["Ready", "var(--good)", "Market's quiet for you.", `London opens in ${Math.floor(ses.inMin / 60)}h ${String(ses.inMin % 60).padStart(2, "0")}m. Practise in Coach meanwhile.`];
    const share = S.share.share, C = 2 * Math.PI * 40;
    const hero = `<section class="card hero" data-tour="hero" style="--state:${stateColor}">
      <div><div class="state"><span class="dot ${g.ok ? "live" : ""}"></span>${stateTxt}</div>
        <div class="headline">${headline}</div><p class="sub">${sub}</p></div>
      <div class="ring" data-tour="ring" title="Planned trades out of your last ${S.share.taken || 0}">
        <svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="7"/>
          <circle cx="46" cy="46" r="40" fill="none" stroke-width="7" stroke-linecap="round" stroke="url(#goldGrad)" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - share / 100)}"/></svg>
        <div class="lbl"><b>${share}%</b><small>planned</small></div></div>
    </section>`;
    const stats = `<div class="kpis" data-tour="kpis">
      <div><small>Trades</small><b>${g.tradesToday}<small class="muted"> / ${s.maxTradesPerDay}</small></b><em>taken today</em></div>
      <div><small>Today</small><b class="${cls(g.rToday)}">${rs(g.rToday)}</b><em>profit / loss</em></div>
      <div><small>Loss limit</small><b>−${s.maxDailyLossR}R</b><em>stop for the day</em></div>
    </div>`;
    const ps = pushStatus();
    const pushNudge = ps.on ? "" : `<section class="card slim push-nudge" data-tour="push"><div class="row between"><div><b>🔔 Notifications on this ${isIOS ? "iPhone" : "device"}</b><p class="muted" style="margin:4px 0 0">${ps.ios ? esc(ps.text) : pushCapable && Notification.permission !== "denied" ? "Setups, fills, \"lock in profit now\" — straight to your lock screen. Tap Turn on, then Allow." : esc(ps.text)}</p></div>${pushCapable && Notification.permission !== "denied" ? `<button class="btn small primary" data-pushon>Turn on</button>` : ""}</div></section>`;
    const ce = S.closeOut || {}, n = S.open.length;
    const ceBanner = n && (ce.warn || ce.due) ? `<div class="banner bad">⏰ ${ce.due ? `Close-out time (${esc(s.flatBy)}) — get out now.` : `${ce.minutesLeft} min to the close-out (${esc(s.flatBy)}).`}
        <p>You're in ${n} trade${n > 1 ? "s" : ""}. Your prop firm closes you if you don't.</p>
        <button class="btn danger closeall" data-closeall style="margin-top:8px">⛔ Close everything</button></div>` : "";
    const pend = S.open.filter((t) => t.pending).map(confirmCard).join("");
    const setups = live.length ? `<section class="card" data-tour="setups"><div class="card-head"><h2>📣 Edge found a setup</h2><span class="muted">confirm to send it</span></div><div class="setup-list">${live.map((x) => (x.strategy === "sd" ? sdCard(x) : x.strategy === "playbook" ? radarCard(x) : setupCard(x))).join("")}</div></section>` : "";
    if (S.prop && S.prop.cfg && S.prop.cfg.enabled && !CO.ex) loadExamples(); // your practice results feed the pass odds
    const openCard = n ? `<section class="card" data-tour="open"><div class="card-head"><h2>Open trades</h2><button class="btn small closeall" data-closeall>Close everything</button></div>${S.open.map(tradeCard).join("")}</section>` : "";
    const nextNews = S.news.events.filter((e) => e.block && e.time > S.now - s.newsAfterMin * 60e3).slice(0, 3);
    const news = nextNews.length ? `<section class="card slim" data-tour="news"><div class="card-head"><h2>📰 Big news</h2><span class="muted">no trades ${s.newsBeforeMin} min either side</span></div><div class="news">${nextNews.map((e) => { const liveN = S.now >= e.time - s.newsBeforeMin * 60e3 && S.now <= e.time + s.newsAfterMin * 60e3; return `<div class="ev ${liveN ? "live" : ""}"><span class="num">${day(e.time).split(",")[0]} ${time(e.time)}</span><span>${esc(e.title)}<br><small class="muted">${e.markets.map(mname).join(" · ")}</small></span><span class="pill ${liveN ? "bad" : "warn"}">${liveN ? "NO TRADES" : e.impact}</span></div>`; }).join("")}</div></section>` : "";
    const alerts = `<details class="card slim" data-tour="log" data-keep="alerts"><summary><b>Alerts</b> <span class="muted">${S.log.length ? `· last ${time(S.log[0].at)}` : ""}</span></summary><div class="log" style="margin-top:8px">${S.log.slice(0, 15).map((l) => `<div><time>${day(l.at)} ${time(l.at)}</time>${esc(l.text)}</div>`).join("") || `<p class="muted">Nothing yet.</p>`}</div></details>`;
    const gp = S.gameplan && S.now - S.gameplan.at < 10 * 3600e3 ? `<section class="card slim gameplan" data-tour="gameplan"><div class="row between"><b>${esc(S.gameplan.title)}</b><small class="muted">${time(S.gameplan.at)}</small></div>${S.gameplan.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</section>` : "";
    return `${ceBanner}${pend}${getSetCard()}${hero}${gp}${setups}${openCard}${ordersCard()}${propCard()}${planCard()}${stats}${pushNudge}${news}${S.journal.length >= 5 ? insightsCard(S.journal, "🧠 Edge noticed", true) : ""}${alerts}`;
  }

  // A trade Edge recorded by itself when your planned order filled: check the numbers in one tap
  function confirmCard(t) {
    const f = (k, label, v) => `<label class="f"><small>${label}</small><input data-cf="${k}" data-id="${esc(t.id)}" inputmode="decimal" value="${v ?? ""}" placeholder="how many?"></label>`;
    const moods = [["calm", "😌 Calm"], ["focused", "🎯 Focused"], ["fomo", "😬 FOMO"], ["revenge", "😤 Revenge"], ["bored", "🥱 Bored"]];
    return `<section class="card confirm" data-tour="confirm">
      <div class="row between"><h3 style="margin:0">✅ ${esc(mname(t.market))} ${t.dir === "long" ? "BUY" : "SELL"} filled — is this right?</h3><span class="pill warn">check</span></div>
      <p class="muted" style="margin:6px 0 10px">Edge saw your ${t.strategy === "london" ? "stop" : "limit"} order fill and recorded it. Fix anything that's different on your platform.</p>
      <div class="grid4">${f("entry", "Entry", fx(t.entry))}${f("sl", "Stop", fx(t.initialSL))}${f("tp", `Target (${xpOf(t).tpR}R)`, fx(t.tp))}${f("units", t.contract ? `${esc(t.contract)} contracts` : "Size", t.units || "")}</div>
      <div class="chips moods" data-id="${esc(t.id)}">${moods.map(([k, l]) => `<button type="button" data-cmood="${k}" class="${k === "calm" ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="btn good" data-confirm="${esc(t.id)}">✓ All correct</button><button class="btn" data-dismiss="${esc(t.id)}">I didn't take it</button></div>
    </section>`;
  }

  // The orders to place before the move (London stop orders, natural gas zone limits), sized for your risk.
  function plansCard() {
    const ps = (S.plans || []).filter((p) => S.now < p.expires);
    if (!ps.length) return "";
    const risk = riskNow();
    const leg = (p, L) => {
      const q = qtyFor(L.size, risk);
      const qty = L.size.kind === "futures" ? (q >= 1 ? `${q} ${esc(L.size.contract)}` : `skip — 1 ${esc(L.size.contract)} risks $${Math.round(L.size.riskPerContract)}`) : `${Number(L.size.qty).toFixed(2)} ${esc(S.markets[p.market].unit)}`;
      return `<div class="levels" style="grid-template-columns:repeat(2,1fr);margin:6px 0">
        <div><small>${L.dir === "long" ? "BUY" : "SELL"} ${L.order.toUpperCase()}</small><b>${fx(L.entry)}</b></div>
        <div><small>Contracts</small><b>${qty}</b></div>
        <div><small>Stop loss</small><b>${fx(L.sl)}</b></div>
        <div><small>Take profit (${p.tpR}R)</small><b>${fx(L.tp)}</b></div></div>
        ${L.be != null ? `<p class="muted" style="margin:0 0 6px">Break-even: when price reaches <b>${fx(L.be)}</b> (+${p.beR}R), Edge tells you to move the stop to entry.</p>` : ""}`;
    };
    return `<section class="card" data-tour="plans"><div class="card-head"><h2>📋 Orders to place now</h2><span class="muted">risk $${risk} each · change it on a setup card</span></div>
      ${ps.map((p) => `<div class="card" style="background:var(--panel2);margin-bottom:10px">
        <div class="row between"><h3>${esc(mname(p.market))} · ${esc(p.name)}</h3><span class="pill">until ${time(p.expires)}</span></div>
        ${p.rangeHi != null ? `<p class="muted" style="margin:4px 0">Asian range ${fx(p.rangeLo)} – ${fx(p.rangeHi)}.</p>` : ""}
        ${p.legs.map((L) => leg(p, L)).join("")}
        <p style="margin:6px 0 0"><b>${p.strategy === "london" ? "Place both orders with their stop and target. The moment one fills, cancel the other one." : "Place the limit order(s) with their stop and target. Cancel them when the window ends."}</b></p></div>`).join("")}
    </section>`;
  }

  function tradeCard(t) {
    const s = S.settings, e = xpOf(t);
    const lo = -1, hi = e.tpR, span = hi - lo, pct = (r) => `${Math.max(0, Math.min(100, ((r - lo) / span) * 100))}%`;
    const r = t.r ?? 0;
    const manual = t.source === "manual";
    const routed = t.source === "traderspost" || t.source === "tradovate";
    const beAdvised = manual && !t.beMoved && e.beR > 0 && (t.maxR || 0) >= e.beR;
    return `<div class="card" style="background:var(--panel2);margin-bottom:10px">
      <div class="row between"><h3>${esc(mname(t.market))} · ${t.dir.toUpperCase()}${stratName(t) ? ` <small class="muted">${esc(stratName(t))}</small>` : ""}</h3>
        <span class="pill ${t.pending ? "warn" : t.grade === "A+" ? "good" : "warn"}">${t.pending ? "check it ↑" : esc(t.grade)}</span></div>
      <div class="ruler" style="--zero:${pct(0)};--be:${pct(e.beR > 0 ? e.beR : 0)}">
        <div class="bar"></div>
        <span class="tick" style="left:${pct(-1)}">SL −1R</span>
        <span class="tick" style="left:${pct(0)}">Entry</span>
        ${e.beR > 0 ? `<span class="tick" style="left:${pct(e.beR)}">BE ${e.beR}R</span>` : ""}
        <span class="tick" style="left:${pct(hi)}">TP ${hi}R</span>
        <span class="max" style="left:${pct(t.maxR || 0)}" title="best so far"></span>
        <span class="now" style="left:${pct(r)}"></span>
      </div>
      <div class="row between"><b class="${cls(r)} num" style="font-size:22px">${rs(t.r)}</b>
        <span class="muted">${t.beMoved ? "🔒 Stop at break-even — can't lose" : e.beR > 0 ? `Stop moves to BE at ${e.beR}R` : "No break-even in this plan — stop or target"}</span></div>
      <div class="levels">
        <div><small>Entry</small><b>${fx(t.entry)}</b></div>
        <div><small>Stop</small><b>${fx(t.currentSL ?? t.initialSL)}</b></div>
        <div><small>BE at</small><b>${e.beR > 0 ? fx(t.plan && t.plan.beTrigger) : "—"}</b></div>
        <div><small>Target</small><b>${fx(t.tp)}</b></div>
      </div>
      ${t.units ? `<p class="muted">Size: ${t.unitLabel === "contracts" ? `<b>${t.units} ${esc(t.contract || "")} contract${t.units > 1 ? "s" : ""}</b> · risk $${t.riskUSD}` : `${Number(t.units).toFixed(t.units < 10 ? 2 : 0)} ${esc(S.markets[t.market]?.unit || "units")}${manual ? ` ≈ ${(t.units / (s.lots[t.market] || 1)).toFixed(2)} lots (1 lot = ${s.lots[t.market]})` : ""}`}</p>` : ""}
      ${(t.ruleBreaks || []).length ? `<p class="err">Rule break logged: ${t.ruleBreaks.map(esc).join(", ")}</p>` : ""}
      ${beAdvised ? `<div class="blocks">🔒 Move your stop to <b>${fx(t.plan.beStop)}</b> now.</div>` : ""}
      ${t.trailSuggest != null ? `<div class="blocks trail">↗️ New 15m swing — move your stop to <b>${fx(t.trailSuggest)}</b>. <button class="btn small primary" data-traildone="${esc(t.id)}">Done</button></div>` : ""}
      <div class="row">
        ${manual && !t.beMoved && e.beR > 0 ? `<button class="btn small ${beAdvised ? "primary" : ""}" data-be="${esc(t.id)}">I moved my stop to break-even</button>` : ""}
        <button class="btn small danger" data-close="${esc(t.id)}">Close trade</button>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:13px">${manual ? "Manual: Edge tells you when to act, you click in TradingView." : routed ? (e.beR > 0 ? "Sent to Tradovate. Edge moves the stop to break-even at +" + e.beR + "R. Hands off." : "Sent to Tradovate. Stop and target are set. Hands off.") : "Edge is managing this trade. Hands off."}${t.lastPriceAt ? ` · price ${time(t.lastPriceAt)}` : ""}</p>
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
    return `<section class="card" data-tour="news"><h2>News that moves your markets</h2>
      ${S.news.ok || market ? "" : `<p class="err">Calendar feed unavailable${S.news.error ? ` (${esc(S.news.error)})` : ""} — only the weekly energy reports are shown. Check ForexFactory for CPI / NFP / FOMC.</p>`}
      <div class="news">${rows || `<p class="muted">Nothing big coming up.</p>`}</div></section>`;
  }

  function logCard() {
    return `<section class="card" data-tour="log"><h2>Alerts</h2><div class="log">${S.log.slice(0, 12).map((l) => `<div><time>${day(l.at)} ${time(l.at)}</time>${esc(l.text)}</div>`).join("") || `<p class="muted">Nothing yet. Alerts land here — and on your phone once notifications are on.</p>`}</div></section>`;
  }

  // ---------- COACH: train in the simulator · see how well you keep your playbook · learn it by heart
  const SC_NAMES = { htf: "Big picture", trend: "Trend", zone: "15m zone", entry: "Entry at the FVG", stop: "Stop behind the swing", rr: "3R – 10R", session: "Session & limits", manage: "Management" };
  const CO = { ex: null, at: 0, loading: false, open: null, q: 0, ans: {}, quiz: false };
  function loadExamples(force = false) {
    if (CO.loading || (!force && CO.ex && Date.now() - CO.at < 30e3)) return;
    CO.loading = true;
    api("POST", { action: "teachList" }).then((r) => { CO.ex = r.examples || []; CO.at = Date.now(); }).catch(() => { CO.ex = CO.ex || []; })
      .finally(() => { CO.loading = false; if (tab === "coach") coachSwap(); else if (tab === "now") propSwap(); });
  }
  window.Edge.examplesChanged = () => { CO.at = 0; }; // a new practice trade was saved → reload on the next visit
  function coachSwap() {
    const el = $("#coachBody"); if (!el) return;
    const open = new Set([...el.querySelectorAll("details[open][data-keep]")].map((d) => d.dataset.keep));
    el.innerHTML = coachBody();
    el.querySelectorAll("details[data-keep]").forEach((d) => { if (open.has(d.dataset.keep)) d.open = true; });
    bindCoach();
  }
  function viewCoach() { loadExamples(); return `<div id="coachBody">${coachBody()}</div>`; }
  function coachBody() {
    const P = PB(), ex = (CO.ex || []).filter((x) => x.score && x.score.length), last = ex.slice(0, 20);
    const kept = last.reduce((a, x) => a + x.score.filter((c) => c.ok).length, 0), total = last.reduce((a, x) => a + x.score.length, 0);
    const pct = total ? Math.round((kept / total) * 100) : 0, textbook = last.filter((x) => x.score.every((c) => c.ok)).length, C = 2 * Math.PI * 40;
    const sumR = last.reduce((a, x) => a + (x.R || 0), 0);
    const hero = `<section class="card hero" data-tour="train" style="--state:var(--accent)">
      <div><div class="state">Coach · train, review, improve</div>
        <div class="headline">${!CO.ex ? "Loading your practice…" : last.length ? `${pct}% of your playbook kept` : "Train on real past days."}</div>
        <p class="sub">${last.length ? `Last ${last.length} practice trade${last.length > 1 ? "s" : ""} · ${textbook} textbook · ${sumR >= 0 ? "+" : ""}${sumR.toFixed(1)}R` : "Pick a market below. Mark your zones, take your trade — Edge scores it against your playbook and shows you what you did well and what you missed."}</p></div>
      <div class="ring"><svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="7"/>
        <circle cx="46" cy="46" r="40" fill="none" stroke-width="7" stroke-linecap="round" stroke="url(#goldGrad)" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/></svg>
        <div class="lbl"><b>${last.length ? `${pct}%` : "—"}</b><small>rules kept</small></div></div></section>`;
    const sims = [["nq", "💻", "Nasdaq", "MNQ"], ["es", "🗽", "S&P 500", "MES"], ["ym", "🏛️", "Dow", "MYM"], ["gold", "🥇", "Gold", "MGC"], ["silver", "🥈", "Silver", "SIL"], ["crude", "🛢️", "Crude oil", "MCL"], ["copper", "🟠", "Copper", "MHG"], ["natgas", "🔥", "Natural gas", "QG"]];
    const practice = `<section class="card" data-tour="sim"><div class="card-head"><h2>🕹 Practice</h2><span class="muted">real past days · like TradingView</span></div>
      <div class="sim-tiles">${sims.map(([m, ic, n, c]) => `<button type="button" class="sim-tile" data-sim="${m}"><span>${ic}</span><b>${n}</b><small>${c}</small></button>`).join("")}</div>
      <p class="muted" style="margin:10px 0 0;font-size:12.5px">Start on the weekly / daily / 4H, mark the zones, drop to the 15m, then take the trade on the 5m. Every trade gets a scorecard.</p></section>`;
    // how well each step is kept, over the last 20 trades
    const by = {}; for (const x of last) for (const c of x.score) { const b = (by[c.id] = by[c.id] || { ok: 0, n: 0 }); b.n++; if (c.ok) b.ok++; }
    const rows = Object.keys(SC_NAMES).filter((k) => by[k]).map((k) => ({ k, p: Math.round((by[k].ok / by[k].n) * 100), n: by[k].n }));
    const weak = rows.filter((r) => r.p < 80).sort((a, b) => a.p - b.p).slice(0, 2), strong = rows.filter((r) => r.p >= 80).sort((a, b) => b.p - a.p).slice(0, 2);
    const progress = rows.length ? `<section class="card" data-tour="progress"><div class="card-head"><h2>📊 Your playbook, step by step</h2><span class="muted">last ${last.length}</span></div>
      <div class="sc-bars">${rows.map((r) => `<div class="sc-bar ${r.p >= 80 ? "good" : r.p >= 50 ? "mid" : "bad"}"><span>${SC_NAMES[r.k]}</span><div><i style="width:${r.p}%"></i></div><b>${r.p}%</b></div>`).join("")}</div>
      ${strong.length ? `<div class="insight good"><span>💪</span><div><b>You're good at: ${strong.map((r) => SC_NAMES[r.k]).join(" and ")}</b><p>Keep doing exactly that.</p></div></div>` : ""}
      ${weak.length ? `<div class="insight bad"><span>🎯</span><div><b>Work on: ${weak.map((r) => SC_NAMES[r.k]).join(" and ")}</b><p>${esc(weak.map((r) => (last.flatMap((x) => x.score).find((c) => c.id === r.k && !c.ok) || {}).text || "").filter(Boolean)[0] || "")}</p></div></div>` : `<div class="insight good"><span>🏆</span><div><b>Every step above 80%</b><p>You know your playbook. Keep the reps going — then it's live, small.</p></div></div>`}</section>` : "";
    const recent = ex.slice(0, 8);
    const trades = recent.length ? `<section class="card" data-tour="reviews"><div class="card-head"><h2>🔍 Your practice trades</h2><span class="muted">tap one</span></div>
      ${recent.map((x) => { const ok = x.score.filter((c) => c.ok).length, all = x.score.length, open = CO.open === x.id;
        return `<div class="ex ${open ? "open" : ""}"><button type="button" class="ex-row" data-ex="${esc(x.id)}"><span class="ex-sc ${ok === all ? "good" : ok >= all - 2 ? "mid" : "bad"}">${ok}/${all}</span><span><b>${esc(mname(x.market))} ${x.dir === "long" ? "▲ long" : "▼ short"}</b><small class="muted">${esc(x.simDay || "")} · ${esc(x.how || "")}</small></span><b class="${cls(x.R)}">${rs(x.R)}</b></button>
          ${open ? `<div class="ex-body"><div class="sc-list">${x.score.map((c) => `<span class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "!"} ${esc(c.title)}</span>`).join("")}</div>${x.score.filter((c) => !c.ok).map((c) => `<p><b>${esc(c.title)}</b><br><span class="muted">${esc(c.text)}</span></p>`).join("") || `<p class="good">✅ Textbook. Everything in your playbook was there.</p>`}${x.note ? `<p class="muted">📝 ${esc(x.note)}</p>` : ""}</div>` : ""}</div>`; }).join("")}
      <div class="row" style="margin-top:8px"><button class="btn small" data-teachdl>⬇ Download for Claude</button><span class="muted" style="font-size:12.5px">${(CO.ex || []).length} saved — send me the file to sharpen your rules.</span></div></section>` : "";
    const quiz = P && CO.quiz ? (() => {
      const q = P.QUIZ[CO.q]; if (!q) { const right = Object.entries(CO.ans).filter(([i, a]) => P.QUIZ[i][2] === a).length; return `<div class="quiz-done"><b>${right}/${P.QUIZ.length}</b><p>${right === P.QUIZ.length ? "Perfect — you know your playbook." : "Go over the ones you missed, then try again."}</p><button class="btn small" data-qz="reset">Again</button></div>`; }
      const a = CO.ans[CO.q];
      return `<div class="quiz"><small class="muted">Question ${CO.q + 1} of ${P.QUIZ.length}</small><b>${esc(q[0])}</b>${q[1].map((o, i) => `<button type="button" class="qopt ${a == null ? "" : i === q[2] ? "right" : i === a ? "wrong" : ""}" data-qz="ans" data-a="${i}" ${a == null ? "" : "disabled"}>${esc(o)}</button>`).join("")}${a != null ? `<p class="${a === q[2] ? "good" : "bad"}">${a === q[2] ? "✅ " : "✋ "}${esc(q[3])}</p><button class="btn small primary" data-qz="next">Next ›</button>` : ""}</div>`;
    })() : "";
    const book = P ? `<section class="card" data-tour="playbook"><div class="card-head"><h2>📘 Your playbook</h2><button class="btn small" data-qz="${CO.quiz ? "hide" : "start"}">${CO.quiz ? "Hide quiz" : "🧠 Quiz me"}</button></div>
      ${quiz}
      <div class="pb-book">${P.STEPS.map((st, i) => `<details data-keep="pb-${st.id}"><summary><i>${i + 1}</i><span><b>${st.icon} ${esc(st.title)}</b><small>${esc(st.short)}${st.req ? "" : " · bonus"}</small></span></summary><p>${esc(st.text)}</p></details>`).join("")}</div>
      <div class="pb-manage"><b>In the trade</b>${P.MANAGE.map((m) => `<span>${esc(m)}</span>`).join("")}</div></section>` : "";
    // readiness: is your practice good enough to risk real money? (and, with your prop account set up, your odds of passing it)
    const Rd = window.EdgeProp && CO.ex ? window.EdgeProp.readiness(CO.ex) : null, od = S.prop && S.prop.cfg && S.prop.cfg.enabled && S.prop.cfg.phase !== "funded" ? passOdds() : null;
    const ready = Rd ? `<section class="card readiness" data-tour="ready"><div class="card-head"><h2>🚦 Ready for the evaluation?</h2><span class="pill ${Rd.ready ? "good" : Rd.score >= 65 ? "warn" : ""}">${Rd.score}/100</span></div>
      <div class="odds"><div><b>${Rd.n}</b><small>practice trades</small></div><div><b class="${Rd.expectancy > 0.3 ? "good" : Rd.expectancy < 0 ? "bad" : ""}">${Rd.expectancy == null ? "—" : rs(Rd.expectancy)}</b><small>average a trade</small></div><div><b>${Rd.keptPct == null ? "—" : `${Rd.keptPct}%`}</b><small>playbook kept</small></div></div>
      ${Rd.ready ? `<div class="insight good"><span>✅</span><div><b>Your practice shows an edge, with the rules kept.</b><p>Go live small — the risk autopilot keeps you inside the firm's rules.</p></div></div>` : `<ul class="why">${Rd.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`}
      ${od ? `<p class="muted" style="margin:8px 0 0">${od.usedOwn ? "With your results" : "With your playbook's tested results (+0.66R a trade)"}, on your prop account: <b>${Math.round(od.pass5 * 100)}%</b> chance to pass in 5 trading days, <b>${Math.round(od.passN * 100)}%</b> in 20, <b>${Math.round(od.fail * 100)}%</b> to fail.</p>` : ""}</section>` : "";
    return `${hero}${practice}${ready}${progress}${trades}${book}`;
  }
  function bindCoach() {
    const v = $("#coachBody"); if (!v) return;
    v.querySelectorAll("[data-sim]").forEach((b) => b.addEventListener("click", () => window.EdgeSim ? window.EdgeSim.open(b.dataset.sim) : toast("Simulator still loading — try again.")));
    v.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { CO.open = CO.open === b.dataset.ex ? null : b.dataset.ex; coachSwap(); }));
    v.querySelectorAll("[data-qz]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.qz;
      if (k === "start") { CO.quiz = true; CO.q = 0; CO.ans = {}; } else if (k === "hide") CO.quiz = false;
      else if (k === "ans") CO.ans[CO.q] = Number(b.dataset.a); else if (k === "next") CO.q++; else if (k === "reset") { CO.q = 0; CO.ans = {}; }
      coachSwap();
    }));
    v.querySelectorAll("[data-teachdl]").forEach((b) => b.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(CO.ex || [], null, 1)], { type: "application/json" }));
      a.download = `edge-examples-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    }));
  }

  // ---------- SETUPS
  function viewSetups() {
    if (!S.setups.length) return `<section class="card"><div class="empty"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></svg><b>No setups yet</b><span>TradingView is watching gold, oil and gas for you. When an A+ setup appears, it lands here with its picture and your phone buzzes.</span><span style="margin-top:6px">Waiting is the strategy.</span></div></section>`;
    return `<div class="setup-list">${S.setups.map(setupCard).join("")}</div>`;
  }
  // ---------- Trade map: the setup as a picture (same colours as the TradingView chart)
  const TF = { c4h: "var(--c4h)", c15: "var(--c15)", c5: "var(--c5)", liq: "var(--liq)" };
  function tradeMap(x) {
    const s = S.settings, k = x.dir === "short" ? -1 : 1, R = Math.abs(x.entry - x.sl);
    const be = s.beAtR > 0 ? x.entry + k * s.beAtR * R : null, tp = x.entry + k * s.tpAtR * R;
    const zTop = x.zoneTop ?? x.sl + k * 0.8 * R, zBot = x.zoneBot ?? x.sl + k * 0.2 * R;
    const zNear = k > 0 ? Math.max(zTop, zBot) : Math.min(zTop, zBot), zFar = k > 0 ? Math.min(zTop, zBot) : Math.max(zTop, zBot);
    const l15 = x.lvl15 ?? x.entry - k * 0.35 * R, l5 = x.lvl5 ?? x.entry - k * 0.1 * R;
    const l4 = x.lvl4h ?? zNear + k * 2.2 * R;
    const oppIn = x.opp != null && k * (x.opp - tp) <= 1.2 * R; // only draw the opposing zone if it's close
    const liq = x.sweep && x.sweepLvl != null && k * (x.sweepLvl - x.sl) > 0 ? x.sweepLvl : null;
    const prices = [x.sl, x.entry, ...(be != null ? [be] : []), tp, zTop, zBot, l4, l15, l5, ...(oppIn ? [x.opp] : []), ...(liq != null ? [liq] : [])];
    let lo = Math.min(...prices), hi = Math.max(...prices); const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const W = 360, H = 300, L = 8, X = 250, y = (p) => 10 + (H - 20) * (1 - (p - lo) / (hi - lo));
    const react = x.sl + k * 0.2 * R;
    const pts = [[70, y(zNear + (l4 - zNear) * 0.35)], [100, y(l4 + k * 0.5 * R)], [135, y(react)], [165, y(l15 + k * 0.25 * R)], [190, y((l15 + react) / 2)], [214, y(x.entry)]];
    // timeframe labels in a column on the left, nudged apart so they never overlap
    const left = [[l4, "4H BOS", "var(--c4h)"], [l15, "15m BOS", "var(--c15)"], [l5, "5m BOS", "var(--c5)"]].map(([p, t, c]) => ({ y: y(p), t, c })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < left.length; i++) if (left[i].y - left[i - 1].y < 13) left[i].y = left[i - 1].y + 13;
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
    const dot = (p, n, c) => `<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="${c}"/><text x="${p[0]}" y="${p[1] + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${n}</text>`;
    // right-hand price tags, nudged apart so they never overlap
    const tags = [[tp, `TP ${fx(tp)}`, "var(--good)"], ...(be != null ? [[be, `BE ${fx(be)}`, "var(--warn)"]] : []), [x.entry, `Entry ${fx(x.entry)}`, "var(--text)"], [x.sl, `SL ${fx(x.sl)}`, "var(--bad)"]]
      .map(([p, t, c]) => ({ y: y(p), t, c })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 15) tags[i].y = tags[i - 1].y + 15;
    const hline = (p, x1, x2, c, dash = "", w = 1.5) => `<line x1="${x1}" x2="${x2}" y1="${y(p)}" y2="${y(p)}" stroke="${c}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
    const lab = (p, xx, t, c, below) => `<text x="${xx}" y="${y(p) + (below ? 12 : -4)}" font-size="10" font-weight="700" fill="${c}">${t}</text>`;
    const below4 = k < 0, zoneName = k > 0 ? "4H DEMAND" : "4H SUPPLY", oppName = k > 0 ? "4H SUPPLY" : "4H DEMAND";
    return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trade map">
      <rect x="${L}" width="${X - L}" y="${Math.min(y(zTop), y(zBot))}" height="${Math.abs(y(zTop) - y(zBot))}" fill="var(--c4h)" opacity=".22" rx="3"/>
      <text x="${L + 4}" y="${(k > 0 ? y(zFar) - 4 + 14 : y(zFar) + 4 - 6)}" font-size="10" font-weight="700" fill="var(--c4h)">${zoneName}</text>
      ${oppIn ? `${hline(x.opp, L, X, "var(--c4h)", "2 3", 1.5)}${lab(x.opp, L + 4, `${oppName} starts`, "var(--c4h)", k < 0)}` : ""}
      ${hline(l4, 58, 150, "var(--c4h)", "", 2.5)}${hline(l15, 58, 205, "var(--c15)", "6 4", 2)}${hline(l5, 58, X, "var(--c5)", "2 3", 2)}
      ${left.map((t) => `<text x="${L + 2}" y="${t.y + 4}" font-size="10" font-weight="800" fill="${t.c}">${t.t}</text>`).join("")}
      ${be != null ? hline(be, 205, X, "var(--warn)", "4 3") : ""}${hline(tp, 205, X, "var(--good)")}${hline(x.sl, 100, X, "var(--bad)")}${hline(x.entry, 205, X, "var(--text)")}
      ${liq != null ? `${hline(liq, 100, 205, "var(--liq)", "3 3", 1.5)}<text x="${150}" y="${y(liq) + (k > 0 ? -4 : 12)}" font-size="10" font-weight="800" fill="var(--liq)">$$$ taken</text>` : ""}
      <path d="${path}" fill="none" stroke="var(--text)" stroke-width="2.2" stroke-linejoin="round" opacity=".85"/>
      <path d="M214,${y(x.entry)} L246,${y(tp)}" stroke="var(--good)" stroke-width="2" stroke-dasharray="4 3" fill="none"/>
      ${dot(pts[1], 1, "var(--c4h)")}${dot(pts[2], 2, "var(--c4h)")}${dot(pts[3], 3, "var(--c15)")}${dot(pts[5], 4, "var(--c5)")}
      ${tags.map((t) => `<text x="${X + 6}" y="${t.y + 4}" font-size="11" font-weight="700" fill="${t.c}">${t.t}</text>`).join("")}
    </svg>`;
  }
  function storyBlock(x) {
    const st = x.story; if (!st) return "";
    if (st.simple) return `<details class="story" open><summary><b>${esc(st.headline)}</b></summary>
      <ol class="tfsteps">${st.steps.map((p) => `<li style="--c:${TF[p.color]}"><b>${esc(p.tf)} · ${esc(p.title)}</b><br><span class="muted">${esc(p.text)}</span></li>`).join("")}</ol>
      <p class="plan">🎯 ${esc(st.plan.text)}</p></details>`;
    return `<details class="story" open><summary><b>${esc(st.headline)}</b></summary>
      ${tradeMap(x)}
      <div class="legend"><span><i style="background:var(--c4h)"></i>4H</span><span><i style="background:var(--c15)"></i>15m</span><span><i style="background:var(--c5)"></i>5m</span>${x.sweep ? `<span><i style="background:var(--liq)"></i>liquidity</span>` : ""}<span class="muted">same colours on your TradingView chart</span></div>
      <ol class="tfsteps">${st.steps.map((p) => `<li style="--c:${TF[p.color]}"><b>${esc(p.tf)} · ${esc(p.title)}</b><br><span class="muted">${esc(p.text)}</span></li>`).join("")}</ol>
      <p class="plan">🎯 ${esc(st.plan.text)}</p></details>`;
  }

  // The numbers to type into TradingView's order panel.
  // You type the dollars you want to risk; Edge works out the whole contracts (never above that risk).
  function ticket(x, tp) {
    const z = x.size, s = S.settings, risk = riskNow(), e = xpOf(x);
    const q = qtyFor(z, risk);
    const too = z.kind === "futures" && q < 1;
    const qty = z.kind === "futures" ? `${q} ${esc(z.contract)} contract${q === 1 ? "" : "s"}` : `${z.qty.toFixed(z.qty < 10 ? 2 : 0)} ${esc(S.markets[x.market].unit)} ≈ ${(z.qty / (s.lots[x.market] || 1)).toFixed(2)} lots`;
    return `<div class="card" data-tour="ticket" style="background:var(--panel2);margin:8px 0">
      <div class="row between"><b>Order for TradingView</b>
        ${z.kind === "futures" ? `<label class="row" style="gap:6px;margin:0"><small class="muted">Risk $</small><input data-risk="${esc(x.id)}" data-rpc="${z.riskPerContract}" inputmode="decimal" value="${risk}" style="width:90px"></label>` : ""}</div>
      ${too ? `<div class="blocks" data-riskwarn="${esc(x.id)}">⛔ One ${esc(z.contract)} contract risks $${z.riskPerContract} — more than $${risk}. Skip it${["GC", "CL", "NG", "QG", "SI", "ES"].includes(z.contract) ? " or use the micro contract" : ""}.</div>` : ""}
      <div class="levels" style="grid-template-columns:repeat(2,1fr)">
        <div><small>${x.dir === "long" ? "BUY" : "SELL"} · Market</small><b data-qty="${esc(x.id)}">${qty}</b></div>
        <div><small>Risk</small><b data-totrisk="${esc(x.id)}">$${z.kind === "futures" ? Math.round(q * z.riskPerContract * 100) / 100 : z.totalRisk}${z.stopTicks ? ` · ${z.stopTicks} ticks` : ""}</b></div>
        <div><small>Stop loss</small><b>${fx(x.sl)}</b></div>
        <div><small>Take profit (${e.tpR}R)</small><b>${fx(tp)}</b></div>
      </div>
      ${z.kind === "futures" ? `<p class="muted" style="margin:6px 0 0;font-size:13px">One ${esc(z.contract)} risks $${z.riskPerContract} with this stop.</p>` : ""}</div>`;
  }

  function setupCard(x) {
    const s = S.settings, g = x.g, e = xpOf(x);
    const risk = Math.abs(x.entry - x.sl), k = x.dir === "short" ? -1 : 1;
    const be = e.beR > 0 ? x.entry + k * e.beR * risk : null, tp = x.entry + k * e.tpR * risk;
    const live = x.status === "open" && !(x.expires && S.now > x.expires);
    return `<div class="card setup ${live ? "" : "dim"}" data-tour="setup">
      <div class="row between">
        <div class="row"><div class="grade ${g.grade === "A+" ? "Ap" : g.grade}">${g.grade}</div>
          <div><h3>${esc(mname(x.market))} · ${x.dir.toUpperCase()}${stratName(x) ? ` <small class="muted">${esc(stratName(x))}</small>` : ""}</h3><span class="muted">${day(x.at)} ${time(x.at)} · ${esc(x.tv || x.symbol)}</span></div></div>
        <span class="pill ${x.status === "taken" ? "good" : ""}">${live ? `${Math.max(0, Math.round((x.expires - S.now) / 60e3))} min left` : esc(x.status === "open" ? "expired" : x.status)}</span>
      </div>
      <div class="levels" data-tour="levels">
        <div><small>Entry</small><b>${fx(x.entry)}</b></div>
        <div><small>Stop</small><b>${fx(x.sl)}</b></div>
        <div><small>${e.beR > 0 ? `BE at ${e.beR}R` : "Break-even"}</small><b>${e.beR > 0 ? fx(be) : "none"}</b></div>
        <div><small>TP ${e.tpR}R</small><b>${fx(tp)}</b></div>
      </div>
      ${storyBlock(x)}
      ${g.info ? `<p class="muted" style="margin:6px 0">${esc(g.info)}</p>` : ""}
      <details class="checkwrap" data-tour="checklist"><summary>Checklist — ${g.checks.filter((c) => c.pass).length}/${g.checks.length} passed</summary>
      <ul class="checks">${g.checks.map((c) => `<li class="${c.pass ? "" : "no"}"><span>${esc(c.label)}${c.note ? ` <small>(${esc(c.note)})</small>` : ""}</span></li>`).join("")}</ul></details>
      ${live && !g.take.ok ? `<div class="blocks">${g.take.why.map((w) => `<div>⛔ ${esc(w)}</div>`).join("")}</div>` : ""}
      ${live && S.broker.kind !== "oanda" ? ticket(x, tp) : ""}
      ${live ? `<div class="row">${(() => { const tooBig = x.size && x.size.kind === "futures" && qtyFor(x.size, riskNow()) < 1 && S.broker.kind !== "oanda"; const ok = g.take.ok && !tooBig;
        return `<button class="btn ${ok ? "good" : ""}" data-take="${esc(x.id)}" ${ok ? "" : "disabled"}>${ok ? (S.broker.kind === "manual" ? "I'm taking it" : sendsOrders() ? "Take it — send to Tradovate" : "Take it — place the order") : tooBig ? "Too big for your risk" : "Not allowed"}</button>`; })()}
        <button class="btn" data-skip="${esc(x.id)}">Skip</button></div>` : ""}
    </div>`;
  }

  function takeDialog(id) {
    const x = S.setups.find((y) => y.id === id);
    const manual = S.broker.kind === "manual";
    const sd = x.strategy === "sd", z = sd ? sdSize(x) : null;
    const e = xpOf(x), risk = sd ? z.hi : riskNow(), radar = x.strategy === "playbook" || sd;
    const q = sd ? z.qty : radar ? Math.floor(risk / (Math.abs(x.entry - x.sl) * ({ gold: 10, silver: 1000, crude: 100, natgas: 1000, es: 5, nq: 2, ym: 0.5, copper: 2500 }[x.market] || 1)) + 1e-9) : qtyFor(x.size, risk);
    const mic = sd ? z.contract : radar ? (CONTRACTS[x.market] || [[""]])[0][0] : x.size && x.size.contract;
    const riskTxt = sd ? `$${z.risk}` : radar && q > 0 ? `$${Math.round(q * Math.abs(x.entry - x.sl) * ({ gold: 10, silver: 1000, crude: 100, natgas: 1000, es: 5, nq: 2, ym: 0.5, copper: 2500 }[x.market] || 1))}` : `$${risk}`;
    const beTxt = sd ? "No break-even, no lock: the stop and the 1:3 target stay where they are." : radar ? `At +${S.settings.lockAtR || 3}R Edge locks in profit, then trails behind each new 15m swing.` : e.beR > 0 ? `At +${e.beR}R ${S.broker.kind === "manual" ? "Edge tells you to move the stop to break-even" : "the stop moves to break-even"}.` : "No break-even in this plan.";
    const moods = [["calm", "😌 Calm"], ["focused", "🎯 Focused"], ["fomo", "😬 Afraid to miss it"], ["revenge", "😤 Want my money back"], ["bored", "🥱 Bored"]];
    const body = $("#modalBody");
    if (sd) return sdTakeDialog(x, z, moods, body);
    body.innerHTML = `<h3>${esc(mname(x.market))} ${x.dir.toUpperCase()} · ${x.g.grade}</h3>
      <p>Before you click: how do you feel <b>right now</b>? Be honest — this is your journal.</p>
      <div class="moods">${moods.map(([k, l]) => `<button type="button" data-mood="${k}">${l}</button>`).join("")}</div>
      ${sendsOrders() ? `<p>Edge sends <b>${x.dir === "long" ? "BUY" : "SELL"} ${q ?? (x.size && x.size.qty)} ${esc(mic || "")}</b> (${riskTxt} risk) ${radar ? `as a limit at <b>${fx(x.entry)}</b>` : "at market"} to your Tradovate account, with the stop at <b>${fx(x.sl)}</b> and the target at <b>${fx(radar ? x.tp : x.entry + (x.dir === "short" ? -1 : 1) * e.tpR * Math.abs(x.entry - x.sl))}</b>. ${beTxt}</p>`
        : manual && radar ? `<p class="muted">${q ? `<b>${q} ${esc(mic || "")}</b> for ${riskTxt} risk. ` : ""}Place a limit at <b>${fx(x.entry)}</b> with stop <b>${fx(x.sl)}</b> and target <b>${fx(x.tp)}</b>. Edge tracks it and tells you when it fills. ${beTxt}</p>`
        : manual ? `<label class="f">Your fill price (leave empty if ${fx(x.entry)})<input id="fill" inputmode="decimal" placeholder="${fx(x.entry)}"></label>
        <p class="muted">${q != null ? `<b>${q} ${esc(mic || "")}</b> for ${riskTxt} risk. ` : ""}${radar ? `Place a limit at <b>${fx(x.entry)}</b> with stop <b>${fx(x.sl)}</b> and target <b>${fx(x.tp)}</b>.` : `Place it in TradingView with stop <b>${fx(x.sl)}</b> and take-profit at ${e.tpR}R.`} ${beTxt}</p>`
        : `<p class="muted">Edge places a market order with your stop at <b>${fx(x.sl)}</b> and take-profit at ${e.tpR}R, sized for $${risk} risk. ${beTxt}</p>`}
      <p class="muted">I accept the stop. I won't move it further away. I won't move the target.</p>
      <div class="row"><button class="btn good" type="button" id="confirmTake" disabled>Confirm</button><button class="btn" value="cancel">Cancel</button></div>`;
    let mood = "";
    body.querySelectorAll("[data-mood]").forEach((b) => b.addEventListener("click", () => {
      mood = b.dataset.mood; body.querySelectorAll("[data-mood]").forEach((y) => y.classList.toggle("on", y === b)); $("#confirmTake").disabled = false;
    }));
    $("#confirmTake").addEventListener("click", async () => {
      $("#confirmTake").disabled = true;
      const r = await act({ action: "take", setupId: id, emotion: mood, entry: manual && !radar ? $("#fill").value : undefined, riskUSD: risk }, "Trade on. Hands off — the rules manage it now.");
      $("#modal").close();
      if (r) { tab = "now"; render(); }
    });
    $("#modal").showModal();
  }

  // the four judgement calls the scanner can't see — ticked on the confirm screen, scored in the journal
  const SD_JUDGE = [
    ["disp", () => "Strong move away from the zone (displacement)"],
    ["liq", () => "Liquidity taken before / at the zone"],
    ["base", () => "Short time at the base (1–3 candles)"],
    ["fill", () => "Price filled 30%+ of the zone before the 5m MSS"],
    ["pd", (x) => (x.dir === "long" ? "Zone in discount (lower half of the range)" : "Zone in premium (upper half of the range)")],
  ];
  function judgeCard() {
    const tr = S.journal.filter((t) => t.judge && t.resultR != null);
    if (!tr.length) return "";
    const g = (list, label) => { const n = list.length, R = list.reduce((s, t) => s + t.resultR, 0), w = n ? Math.round((list.filter((t) => t.resultR > 0).length / n) * 100) : null;
      return `<div class="stat"><small>${label} (${n})</small><b class="${cls(R)}">${rs(Math.round(R * 10) / 10)}</b><small>${w == null ? "—" : `${w}% wins`}</small></div>`; };
    const score = (t) => SD_JUDGE.filter(([k]) => t.judge[k]).length;
    return `<section class="card"><h2>👁 Your eye vs the scanner</h2><p class="muted" style="margin-top:0">S&amp;D trades by how many of the 4 checks you ticked. After 30+ trades this tells you whether your judgement adds an edge.</p><div class="grid2">
      ${g(tr.filter((t) => score(t) === 4), "All 4 ✓")}${g(tr.filter((t) => score(t) === 3), "3 of 4")}${g(tr.filter((t) => score(t) <= 2), "2 or fewer")}</div>
      <div class="grid2" style="margin-top:8px">${SD_JUDGE.map(([k, l]) => g(tr.filter((t) => t.judge[k]), `✓ ${l({ dir: "long" }).split(" (")[0]}`)).join("")}</div></section>`;
  }

  // scanner setup: change the limit, stop, target or contracts — risk, R and profit follow as you type
  function sdTakeDialog(x, z, moods, body) {
    const k = x.dir === "short" ? -1 : 1, pv = (CONTRACTS[x.market] || [["", PV[x.market] || 1]])[0][1];
    const f = (key, label, v) => `<label class="f">${label}<input data-sd="${key}" inputmode="decimal" type="number" step="any" value="${v}"></label>`;
    body.innerHTML = `<h3>${esc(mname(x.market))} · ${x.dir === "long" ? "▲ BUY" : "▼ SELL"} limit</h3>
      <p class="muted" style="margin-top:0">Change anything you want. Contracts aim for about $${z.aim} risk ($${z.lo}–$${z.hi}) until you set them yourself.</p>
      <div class="grid2">${f("entry", "Limit", x.entry)}${f("sl", "Stop", x.sl)}${f("tp", "Target", x.tp)}${f("qty", `Contracts (${esc(z.contract)})`, z.qty)}</div>
      <div class="sc-list" id="sdLive" style="margin:10px 0"></div>
      <p style="margin-bottom:4px"><b>Your eye</b> <span class="muted">— tick what you see on the chart. Edge keeps score so you'll know if your judgement beats the scanner.</span></p>
      <div class="sd-judge">${SD_JUDGE.map(([k, l]) => `<label><input type="checkbox" data-judge="${k}"${k === "fill" && x.fill >= 0.3 ? " checked" : ""}> ${esc(l(x))}</label>`).join("")}</div>
      <p>How do you feel <b>right now</b>?</p>
      <div class="moods">${moods.map(([m, l]) => `<button type="button" data-mood="${m}">${l}</button>`).join("")}</div>
      <p class="muted">${sendsOrders() ? "Edge sends the limit with this stop and target to Tradovate." : "Place this limit yourself; Edge tracks it and tells you when it fills."} I accept the stop. I won't move it further away.</p>
      <div class="row"><button class="btn good" type="button" id="confirmTake" disabled>Confirm</button><button class="btn" value="cancel">Cancel</button></div>`;
    const inp = (key) => body.querySelector(`[data-sd="${key}"]`), val = (key) => Number(inp(key).value);
    let mood = "", qtyMine = false;
    const calc = () => {
      const e = val("entry"), sl = val("sl"), tp = val("tp"), per = Math.abs(e - sl) * pv;
      const okSide = k * (e - sl) > 0 && k * (tp - e) > 0;
      if (!qtyMine && okSide && per > 0) inp("qty").value = sdQty(per, z.aim, z.hi);
      const q = Math.floor(val("qty")), risk = Math.round(q * per), rr = okSide ? Math.abs(tp - e) / Math.abs(e - sl) : 0;
      const chips = !okSide ? [[`For a ${x.dir === "long" ? "buy the stop goes below and the target above" : "sell the stop goes above and the target below"} the limit`, false]]
        : [[`Risk $${risk}`, risk >= z.lo && risk <= z.hi], [`${rr.toFixed(1)}R`, rr >= 1], [`+$${Math.round(q * Math.abs(tp - e) * pv)} at the target`, true]];
      if (okSide && q < 1) chips.push(["0 contracts", false]);
      $("#sdLive").innerHTML = chips.map(([t, ok]) => `<span class="${ok ? "ok" : "no"}">${ok ? "✓" : "!"} ${esc(t)}</span>`).join("");
      $("#confirmTake").disabled = !mood || !okSide || q < 1 || rr < 0.5;
      return { e, sl, tp, q };
    };
    body.querySelectorAll("[data-sd]").forEach((el) => el.addEventListener("input", () => { if (el.dataset.sd === "qty") qtyMine = true; calc(); }));
    body.querySelectorAll("[data-mood]").forEach((b) => b.addEventListener("click", () => { mood = b.dataset.mood; body.querySelectorAll("[data-mood]").forEach((y) => y.classList.toggle("on", y === b)); calc(); }));
    calc();
    $("#confirmTake").addEventListener("click", async () => {
      const v = calc(); $("#confirmTake").disabled = true;
      const judge = Object.fromEntries(SD_JUDGE.map(([k]) => [k, !!(body.querySelector(`[data-judge="${k}"]`) || {}).checked]));
      const r = await act({ action: "take", setupId: x.id, emotion: mood, entry: v.e, sl: v.sl, tp: v.tp, qty: v.q, judge }, "Limit in. Hands off — the stop and target do the work.");
      $("#modal").close();
      if (r) { tab = "now"; render(); }
    });
    $("#modal").showModal();
  }

  function closeAllDialog() {
    const manual = S.open.filter((t) => t.source === "manual");
    const body = $("#modalBody");
    body.innerHTML = `<h3>Close all ${S.open.length} trade${S.open.length > 1 ? "s" : ""}?</h3>
      <p>${S.open.map((t) => `${esc(mname(t.market))} ${t.dir} (${rs(t.r)})`).join("<br>")}</p>
      ${sendsOrders() || S.broker.kind === "oanda" ? `<p class="muted">Edge sends the exit orders to your account now.</p>` : ""}
      ${manual.length ? `<p class="err">Edge can't reach trades you placed by hand: also close them in TradingView — Trading Panel → Positions → close all (or right-click the position → Close).</p>` : ""}
      <div class="row"><button class="btn danger closeall" type="button" id="doCloseAll">⛔ Close everything</button><button class="btn" value="cancel">Cancel</button></div>`;
    $("#doCloseAll").addEventListener("click", async () => {
      $("#doCloseAll").disabled = true;
      const r = await act({ action: "closeAll" });
      $("#modal").close();
      if (r) toast(r.failed && r.failed.length ? `Some failed — close them by hand: ${r.failed.join("; ")}` : `${r.closed} closed.${r.manual ? " Close the hand-placed ones in TradingView too." : ""}`, 8000);
    });
    $("#modal").showModal();
  }

  function closeDialog(id) {
    const t = S.open.find((y) => y.id === id);
    const manual = t.source === "manual" || t.source === "traderspost" || t.source === "tradovate";
    const e = xpOf(t);
    const early = (t.r ?? 0) < e.tpR - 0.1 && !t.beMoved;
    const body = $("#modalBody");
    body.innerHTML = `<h3>Close ${esc(mname(t.market))} ${t.dir}?</h3>
      ${early ? `<p class="err">Your plan is ${e.beR > 0 ? `break-even at ${e.beR}R and ` : ""}exit at ${e.tpR}R. Closing now is outside the plan — it will be logged as an early exit.</p>` : ""}
      ${manual ? `<label class="f">Exit price<input id="exitPx" inputmode="decimal" value="${t.lastPrice ?? ""}"></label>` : ""}
      <div class="row"><button class="btn danger" type="button" id="doClose">Close it</button><button class="btn" value="cancel">Keep it</button></div>`;
    $("#doClose").addEventListener("click", async () => { await act({ action: "close", tradeId: id, exit: manual ? $("#exitPx").value : undefined }, "Closed."); $("#modal").close(); });
    $("#modal").showModal();
  }

  // ---------- BIAS
  let fillApplied = false; // after "Fill from free data", show the suggestions until saved
  function viewBias() {
    const fd = S.fundamentals, sug = (fd && fd.suggestions) || {};
    const head = `<section class="card" data-tour="bias"><div class="row between"><h2 style="margin:0">Weekly fundamentals</h2>
        <button class="btn small primary" id="fillBias">↻ Fill from free data</button></div>
        <p class="muted" style="margin:8px 0 0">Edge reads the COT report (CFTC), the dollar and real yields (FRED) and oil & gas inventories (EIA), and suggests an answer for each line it can measure, with the numbers. You check the rest and save.${fd ? ` Last read ${day(fd.at)} ${time(fd.at)}.` : ""}</p>
        ${fd && fd.errors && fd.errors.length ? `<p class="err" style="margin:6px 0 0">Not available: ${fd.errors.map(esc).join(" · ")}</p>` : ""}</section>`;
    return head + Object.keys(S.markets).map((m) => {
      const b = S.bias[m], f = S.biasFactors[m], ms = sug[m] || {};
      const age = b ? Math.floor((S.now - b.updated) / 864e5) : null;
      const stale = !b || age > 7;
      const label = b ? (b.dir === "long" ? "Bullish" : b.dir === "short" ? "Bearish" : "Neutral") : "Not set";
      return `<section class="card" data-biascard="${m}">
        <div class="row between"><h3>${esc(S.markets[m].name)}</h3>
          <span class="pill ${stale ? "warn" : b.dir === "long" ? "good" : b.dir === "short" ? "bad" : ""}">${label}${b ? ` · score ${b.score > 0 ? "+" : ""}${b.score}` : ""}${b ? ` · ${age === 0 ? "today" : `${age}d ago`}` : ""}</span></div>
        <p class="muted">Every Sunday (or after a big report): answer each line. Score ≥ +2 = bullish, ≤ −2 = bearish. Trades against your bias lose their A+.</p>
        ${f.map((x) => {
          const auto = ms[x.id];
          const v = fillApplied && auto ? auto.value : b && b.answers ? b.answers[x.id] || 0 : 0;
          const ev = auto ? auto.text : b && b.evidence && b.evidence[x.id];
          return `<div class="factor"><b>${esc(x.label)}${auto ? ` <span class="pill" style="font-size:11px;padding:1px 7px">auto</span>` : ""}</b><small class="muted">${esc(x.hint)}</small>
            ${ev ? `<small class="evidence">📊 ${esc(ev)}</small>` : ""}
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
  // the same scorecard as practice, on your real trades: the steps you ticked in the planner, the session, the R, how you managed it
  const nyMinOf = (t) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)); return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value); };
  function liveScore(t) {
    const P = PB(); if (!P || !t.openedAt) return [];
    const ck = t.checks || [], out = [];
    for (const st of P.STEPS) if (st.req && !["rr", "session"].includes(st.id)) out.push({ id: st.id, title: st.title, ok: ck.includes(st.id), text: ck.includes(st.id) ? "" : `Not ticked in the planner — ${st.short.toLowerCase()}.` });
    const rr = t.tpR || (t.initialSL != null && t.tp != null ? Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.initialSL) : null);
    out.push({ id: "rr", title: "3R – 10R", ok: rr != null && rr >= S.settings.minR - 0.05 && rr <= S.settings.maxR + 0.05, text: rr == null ? "No target recorded." : `Planned ${rr.toFixed(1)}R.` });
    const m = nyMinOf(t.openedAt);
    out.push({ id: "session", title: "Session & limits", ok: m >= 120 && m < 690, text: m >= 120 && m < 690 ? "" : "Taken outside London / New York." });
    const lock = S.settings.lockAtR || 3, breaks = t.ruleBreaks || [];
    const gaveBack = (t.maxR || 0) >= lock && (t.resultR || 0) < 0.5;
    out.push({ id: "manage", title: "Management", ok: !breaks.length && !gaveBack, text: breaks.length ? `Rule break: ${breaks.join(", ")}.` : gaveBack ? `It reached +${lock}R and came back — lock in profit at +${lock}R.` : "" });
    return out;
  }
  const tradeDay = (t) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)); const g = (k) => Number(p.find((x) => x.type === k).value); let d = Date.UTC(g("year"), g("month") - 1, g("day")) / 864e5; if (g("hour") >= 18) d++; return d; };

  function viewJournal() {
    const st = S.stats;
    const grp = (x, l) => `<div class="stat"><small>${l} (${x.n})</small><b class="${cls(x.totalR)}">${rs(x.totalR)}</b><small>${x.winRate == null ? "" : `${x.winRate}% wins`}</small></div>`;
    const jrow = (t) => `<div class="jrow" data-j="${esc(t.id)}">
        <span><b>${esc(mname(t.market))} ${t.dir}</b> <span class="pill ${t.grade === "A+" ? "good" : "warn"}">${esc(t.grade)}</span>${t.emotion ? ` <small class="muted">${esc(t.emotion)}</small>` : ""}</span>
        <b class="r ${cls(t.resultR)}">${rs(t.resultR)}</b>
        <small class="muted">${day(t.closedAt)} · ${esc(t.exitReason)}${(t.ruleBreaks || []).length ? " · ⚠ rule break" : ""}</small>
        <small class="muted">${t.maxR != null ? `best ${rs(t.maxR)}` : ""}</small>
        ${t.note ? `<small style="grid-column:1/-1">${esc(t.note)}</small>` : ""}
        ${(() => { const sc = t.practice ? [] : liveScore(t); if (!sc.length) return ""; const ok = sc.filter((c) => c.ok).length;
          return `<div class="sc-list" style="grid-column:1/-1;margin-top:4px"><span class="${ok === sc.length ? "ok" : ""}">${ok}/${sc.length} kept</span>${sc.filter((c) => !c.ok).map((c) => `<span class="no" title="${esc(c.text)}">! ${esc(c.title)}</span>`).join("")}${S.markets[t.market] ? `<button type="button" class="link" data-snap="${esc(t.id)}">View on chart ›</button>` : ""}</div>`; })()}</div>`;
    const rows = S.journal.map(jrow).join("");
    return `${judgeCard()}${insightsCard()}${S.practice.length >= 5 ? insightsCard(S.practice, "🧠 From your practice trades") : ""}<section class="card" data-tour="results"><h2>Results</h2><div class="grid2">
        <div class="stat"><small>Total</small><b class="${cls(st.totalR)}">${rs(st.totalR)}</b><small>${st.n} trades</small></div>
        <div class="stat"><small>Win rate</small><b>${st.winRate == null ? "—" : st.winRate + "%"}</b><small>avg ${rs(st.avgR)}</small></div>
        <div class="stat"><small>Hit the target</small><b>${st.targets}</b><small>each trade's own target</small></div>
        <div class="stat"><small>Saved by break-even</small><b>${st.breakEvens}</b><small>would-be losses</small></div>
        ${grp(st.aPlus, "A+ trades")}${grp(st.other, "A / B")}${grp(st.unplanned, "Unplanned")}
        <div class="stat"><small>Trades with a rule break</small><b class="${st.ruleBreaks ? "neg" : ""}">${st.ruleBreaks}</b></div>
      </div></section>
      ${S.practice.length ? `<section class="card"><h2>Practice — not counted above</h2><div class="grid2">
        <div class="stat"><small>Practice total</small><b class="${cls(S.practiceStats.totalR)}">${rs(S.practiceStats.totalR)}</b><small>${S.practiceStats.n} trades</small></div>
        <div class="stat"><small>Win rate</small><b>${S.practiceStats.winRate == null ? "—" : S.practiceStats.winRate + "%"}</b><small>avg ${rs(S.practiceStats.avgR)}</small></div>
        ${grp(S.practiceStats.aPlus, "A+ practice")}${grp(S.practiceStats.unplanned, "Unplanned practice")}</div>
        ${S.practice.slice(0, 30).map(jrow).join("")}</section>` : ""}
      <section class="card" data-tour="journal"><div class="row between"><h2 style="margin:0">Journal</h2><button class="btn small" id="logTrade">＋ Log a trade I took</button></div>${rows || `<p class="muted">Closed trades appear here.</p>`}</section>`;
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

  // Settings → Connect Tradovate: like TradingView — straight to Tradovate's own sign-in page, then back here
  function tradovateConnect() {
    if (!S.tvOAuth) return tradovateDialog();
    const body = $("#modalBody");
    body.innerHTML = `<h3>Connect Tradovate</h3>
      <div class="tv-envs"><button type="button" class="btn tv-connect" data-oenv="live">Live account</button><button type="button" class="btn" data-oenv="demo">Demo account</button></div>
      <p class="err" id="tvErr"></p>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">You'll sign in on Tradovate's page and come straight back. Edge never sees your password.</p>
      <div class="row" style="margin-top:10px"><button class="btn" value="cancel">Cancel</button></div>`;
    body.querySelectorAll("[data-oenv]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Opening Tradovate…";
      try { const r = await api("POST", { action: "tradovateOAuth", env: b.dataset.oenv }); location.href = r.url; }
      catch (e) { $("#tvErr").textContent = e.message; b.disabled = false; b.textContent = b.dataset.oenv === "live" ? "Live account" : "Demo account"; }
    }));
    $("#modal").showModal();
  }
  // back from Tradovate's sign-in page
  { const q = new URLSearchParams(location.search), tv = q.get("tv");
    if (tv) { setTimeout(() => toast(tv === "ok" ? `✅ Tradovate connected${q.get("acct") ? ` · ${q.get("acct")}` : ""}${q.get("env") === "demo" ? " (demo)" : ""}` : `Tradovate: ${q.get("msg") || "couldn't connect"}`, 7000), 600); history.replaceState(null, "", location.pathname + location.hash); } }

  // the fallback when Tradovate sign-in isn't set up on the server: one short form; Edge signs in to check it before saving anything
  function tradovateDialog() {
    const body = $("#modalBody");
    body.innerHTML = `<h3>Connect Tradovate</h3>
      <div class="seg two" id="tvEnv" style="margin:4px 0 10px"><button type="button" data-env="demo" class="on p1">Demo</button><button type="button" data-env="live">Live</button></div>
      <label class="f">Username<input id="tvUser" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
      <label class="f">Password<input id="tvPw" type="password" autocomplete="current-password"></label>
      <label class="f">API key ID (CID)<input id="tvCid" inputmode="numeric" autocomplete="off"></label>
      <label class="f">API secret<input id="tvSec" type="password" autocomplete="off"></label>
      <label class="f">Account name <small class="muted">(only if you have several)</small><input id="tvAcct" autocomplete="off" autocapitalize="characters"></label>
      <p class="err" id="tvErr"></p>
      <div class="row"><button class="btn primary" type="button" id="tvGo">Connect</button><button class="btn" value="cancel">Cancel</button></div>
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">Get the API key in Tradovate → Settings → API Access (your prop firm must allow it). Edge checks the details by signing in, then keeps them encrypted on your server — they never come back to this screen. Start on Demo and send one test trade.</p>`;
    let env = "demo";
    body.querySelectorAll("[data-env]").forEach((b) => b.addEventListener("click", () => { env = b.dataset.env; body.querySelectorAll("[data-env]").forEach((y) => (y.className = y === b ? `on ${env === "live" ? "m1" : "p1"}` : "")); }));
    $("#tvGo").addEventListener("click", async () => {
      const go = $("#tvGo"); go.disabled = true; go.textContent = "Connecting…"; $("#tvErr").textContent = "";
      try {
        const r = await api("POST", { action: "tradovateConnect", env, username: $("#tvUser").value, password: $("#tvPw").value, cid: $("#tvCid").value, secret: $("#tvSec").value, account: $("#tvAcct").value });
        $("#modal").close(); toast(`Connected to Tradovate ${env} · ${r.account && r.account.name ? r.account.name : ""}`); refresh();
      } catch (e) { $("#tvErr").textContent = e.message; go.disabled = false; go.textContent = "Connect"; }
    });
    $("#modal").showModal();
    setTimeout(() => $("#tvUser").focus(), 50);
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
        <div class="row between"><span class="pill ${ps.on ? "good" : "warn"}" style="white-space:normal;max-width:100%">${esc(ps.text)}</span>
          ${ps.on ? `<span class="row"><button class="btn small" data-testalert>Send a test</button><button class="btn small danger" data-pushoff>Turn off here</button></span>` : pushCapable && Notification.permission !== "denied" ? `<button class="btn small primary" data-pushon>Turn on for this device</button>` : ""}</div>
        ${ps.ios ? `<ol class="steps muted" style="margin-top:10px"><li>In Safari, tap <b>Share</b> (the square with the arrow).</li><li>Tap <b>Add to Home Screen</b> → Add.</li><li>Open <b>Edge</b> from your Home Screen, sign in, and tap <b>Turn on</b>.</li></ol>` : ""}
        <p class="muted">Devices receiving alerts: ${S.push.devices.length ? S.push.devices.map((d) => esc(d.label || "device")).join(", ") : "none yet"}. Turn it on on each phone, iPad or computer you want alerts on.</p>
        <div class="grid2">${kinds.map(([k, l]) => `<label class="f" style="flex-direction:row;display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" data-notify="${k}" style="width:auto" ${s.notify[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
      </section>`;
    const tvCard = `<section class="card"><h2>TradingView setup</h2>
        <p class="muted" style="margin-top:0">One script, your strategy. TradingView doesn't let apps install it, so it's one copy-paste — your secret is already inside.</p>
        <div class="stat radar-pine"><small>⭐ Supply &amp; demand scanner — 1H zones, 5m confirmation, 14 markets (crude is off)</small><b style="font-size:14px">5-minute chart, one per market: ${SD_TV.map((t) => `<code>${t}</code>`).join(" · ")}</b>
          <p class="muted" style="margin:6px 0">Draws the live 1H demand / supply zone, waits for price to come back into it and the 5m to close past its last swing, then sends Edge the limit (fair value gap or breaker), stop 2 ticks past the low / high and the nearest 5m swing target (1.5R–6R). Orders only 02:00–11:30 New York. Needs a paid TradingView plan: one alert per market, 14 in all.</p>
          <button class="btn small primary" data-copypine="edge_sd_scanner">Copy S&amp;D scanner</button></div>
        <ol class="steps">
          <li>Tap <b>Copy S&amp;D scanner</b>, then on a computer open TradingView on a <b>5-minute</b> chart.</li>
          <li>Bottom panel → <b>Pine Editor</b> → <b>delete everything already there</b> (Ctrl+A / ⌘A, then Delete), paste → <b>Save</b> → <b>Add to chart</b>.</li>
          <li><b>Alert</b> (clock icon) → Condition: the Edge script → <b>Any alert() function call</b> (or "alert() function calls only") → Notifications → tick <b>Webhook URL</b> and paste the address below → Create.</li>
          <li>Change the symbol and create the same alert again — one alert per market.</li>
        </ol>
        <div class="row" style="margin-top:12px"><button class="btn small" id="copyHook">Copy webhook URL</button></div>
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">Webhook URL: <code>${esc(location.origin)}/api/hook</code>${S.hookReady ? "" : ` · <span class="err">EDGE_HOOK_SECRET isn't set in Vercel yet</span>`}</p>
      </section>`;
    const stratCard = `<section class="card"><h2>📘 Your strategy</h2>
        <p class="muted" style="margin-top:0">The numbers Edge holds you to when you plan a trade on Today — and scores your practice against.</p>
        <div class="grid2">${n("minR", "Never take less than (R)", "0.5")}${n("maxR", "Target at most (R)", "0.5")}
          ${n("lockAtR", "Lock in profit when the trade reaches (R)", "0.5")}${n("lockToR", "…by moving the stop to (R)", "0.5")}
          <label class="f">Risk per trade ($)<input id="riskUsd" type="number" step="10" value="${riskNow()}"></label>
          ${n("sdRiskMin", "S&D scanner: risk at least ($)", "10")}${n("sdRiskTarget", "S&D scanner: aim for ($)", "10")}${n("sdRiskMax", "S&D scanner: risk at most ($)", "10")}
          ${n("maxTradesPerDay", "Max trades per day")}${n("maxDailyLossR", "Stop for the day after losing (R)", "0.5")}${n("cooldownMin", "Break after a loss (min)", "5")}</div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-saverules>Save</button></div></section>`;
    return `${stratCard}${notifCard}<section class="card"><h2>Connections</h2>
        <div class="grid2">
          <div class="stat"><small>TradingView webhook</small><b style="font-size:15px">${ok(S.hookReady)}</b></div>
          <div class="stat"><small>Broker</small><b style="font-size:15px">${esc(S.broker.label)}</b>${S.broker.account && !S.broker.account.error ? `<small>${S.broker.account.name ? `${esc(S.broker.account.name)} · ` : ""}${S.broker.account.balance != null ? `${esc(S.broker.account.currency)} ${Number(S.broker.account.balance).toFixed(2)}` : ""}</small>` : S.broker.account && S.broker.account.error ? `<small class="err">${esc(S.broker.account.error)}</small>` : ""}</div>
          <div class="stat"><small>Phone notifications</small><b style="font-size:15px">${S.push.devices.length ? `<span class="pill good">${S.push.devices.length} device${S.push.devices.length > 1 ? "s" : ""}</span>` : `<span class="pill warn">off</span>`}</b></div>
          <div class="stat"><small>Storage</small><b style="font-size:15px">${S.storage === "memory" ? `<span class="pill bad">not saved</span>` : esc(S.storage)}</b></div>
        </div>
        ${S.broker.kind === "manual" ? `<div class="connect"><button class="btn tv-connect" data-tvconnect>Connect Tradovate</button>
          <p class="muted">${S.tvOAuth ? "Sign in on Tradovate's page — Edge then places your trades (entry, stop, target) and sees the fills itself." : "Edge places your trades on your Tradovate account — entry, stop and target — and sees the fills itself. You'll need your Tradovate login and an API key (Tradovate → Settings → API Access)."}</p></div>`
          : S.broker.kind === "tradovate" ? `<div class="connect ok"><b>✅ Tradovate connected</b>${S.broker.account && S.broker.account.name ? ` <span class="muted">· ${esc(S.broker.account.name)}</span>` : ""}${S.broker.account && S.broker.account.error ? `<p class="err" style="margin:6px 0 0;flex-basis:100%">${esc(S.broker.account.error)}</p>${/expired|sign-in/i.test(S.broker.account.error) ? `<button class="btn tv-connect" data-tvconnect style="flex-basis:100%">Reconnect Tradovate</button>` : ""}` : ""}${S.tradovateApp ? `<button class="btn small" data-tvdisconnect style="margin-left:auto">Disconnect</button>` : ""}</div>` : ""}
        <p class="muted">Webhook URL for your TradingView alert: <code>${esc(hook)}</code></p>
        <div class="row"><button class="btn small" data-testalert>Send a test alert</button></div>
      </section>
      ${tvCard}
      <section class="card slim"><div class="row between"><div><b>🏁 Prop account</b><p class="muted" style="margin:4px 0 0">${S.prop && S.prop.cfg && S.prop.cfg.enabled ? `${esc((FIRMS()[S.prop.cfg.firm] || {}).name || "Custom")} · ${S.prop.cfg.phase === "funded" ? "funded" : "evaluation"} — the risk autopilot sizes every trade.` : "Not set up — your firm's rules, the risk autopilot and your pass odds."}</p></div><button class="btn small" data-propset>${S.prop && S.prop.cfg && S.prop.cfg.enabled ? "Edit" : "Set up"}</button></div></section>
      <details class="card adv" data-keep="adv"><summary><h2>Advanced</h2><span class="muted">exits, hours, AI coach</span></summary>
      <section class="card"><h2>Exits</h2><div class="grid2">
        ${n("beAtR", "Supply & demand: stop to break-even at (R)", "0.1")}${n("tpAtR", "Supply & demand: take profit at (R)", "0.1")}${n("beOffsetR", "Break-even buffer (R)", "0.01")}
        <label class="f">Target moved further away<select data-set="enforceTP"><option value="true" ${s.enforceTP ? "selected" : ""}>Put it back (greed check)</option><option value="false" ${s.enforceTP ? "" : "selected"}>Allow</option></select></label>
        <label class="f">15m structure breaks against me<select data-set="structureExit">${["notify", "close", "off"].map((v) => `<option ${s.structureExit === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="f">Big news & stop not at BE<select data-set="newsOpenTrade">${["warn", "close"].map((v) => `<option ${s.newsOpenTrade === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      </div></section>
      <section class="card"><h2>Risk & discipline</h2><div class="grid2">
        ${n("riskPct", "Risk per trade (% — used when no $ amount is set)", "0.1")}${n("accountSize", "Account size (manual mode)", "100")}
        ${n("maxOpen", "Max open trades")}
        ${n("setupExpiryMin", "Setup valid for (min)", "1")}
        ${n("maxChaseR", "Refuse entry if price ran past it by (R)", "0.1")}
        ${n("newsBeforeMin", "No trades before news (min)", "5")}${n("newsAfterMin", "No trades after news (min)", "5")}
      </div></section>
      <section class="card"><h2>Session close-out</h2><div class="grid2">
        <label class="f">Be out of every trade by (${esc(s.tz)})<input data-set="flatBy" value="${esc(s.flatBy)}" placeholder="16:40"></label>
        ${n("flatWarnMin", "Warn me this many minutes before", "5")}${n("noNewTradesMin", "No new trades this close to it (min)", "5")}
        <label class="f">At the close-out<select data-set="autoFlat"><option value="false" ${s.autoFlat ? "" : "selected"}>Warn me loudly</option><option value="true" ${s.autoFlat ? "selected" : ""}>Close Edge-managed trades for me</option></select></label>
      </div><p class="muted">Set this a few minutes before your prop firm's own close-out time (check their rules).</p></section>
      <section class="card"><h2>Coach</h2><div class="grid2">
        ${n("coachIdleSec", "Check the chart every (s) while waiting", "5")}${n("coachTradeSec", "…and while in a trade (s)", "5")}
        ${n("coachDailyChecks", "Max checks per day (cost guard)", "50")}
        <div class="stat"><small>Claude connection</small><b style="font-size:15px">${S.coach.ready ? `<span class="pill good">on</span>` : `<span class="pill warn">add ANTHROPIC_API_KEY</span>`}</b></div>
      </div></section>
      <section class="card"><h2>Trading hours</h2><div class="grid2">${sess}
        <label class="f">Time zone<input data-set="tz" value="${esc(s.tz)}"></label></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-saverules>Save</button></div>
        <p class="muted">Changing rules is allowed — but never in the middle of a trade, and never right after a loss.</p></section>
      <section class="card"><h2>Weekly bias (optional)</h2><p class="muted" style="margin-top:0">COT, dollar, yields, inventories — a note on each market for the week.</p><a class="btn small" href="#bias">Open weekly bias</a></section>
      </details>
      <section class="card"><h2>Account</h2>
        <div class="acct"><div class="avatar">${esc((S.account && S.account.email || "?")[0].toUpperCase())}</div>
          <div><b>${esc(S.account ? S.account.email : "")}</b><small class="muted">Member since ${S.account ? new Date(S.account.created).toLocaleDateString([], { month: "long", year: "numeric" }) : ""}</small></div></div>
        <details class="checkwrap" style="margin-top:12px"><summary>Change password</summary>
          <div class="grid2" style="margin-top:10px">
            <label class="f">Current password<input id="cpOld" type="password" autocomplete="current-password"></label>
            <label class="f">New password<input id="cpNew" type="password" autocomplete="new-password"></label>
            <label class="f">Confirm new password<input id="cpNew2" type="password" autocomplete="new-password"></label>
          </div>
          <div class="row" style="margin-top:10px"><button class="btn small primary" id="cpSave">Change password</button><small class="muted">Signs out your other devices.</small></div>
        </details>
        <div class="row" style="margin-top:12px"><button class="btn small" id="newCode">New recovery code</button><button class="btn small danger" id="signOut">Sign out</button></div>
      </section>`;
  }

  // ---------- events
  function bind() {
    const v = $("#view");
    bindPlan(); bindCoach();
    v.querySelectorAll("[data-snap]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation(); const t = S.journal.find((x) => x.id === b.dataset.snap); if (!t || !window.EdgeSim) return toast("Simulator still loading — try again.");
      window.EdgeSim.open(t.market, { day: tradeDay(t.openedAt), at: Math.max(0, nyMinOf(t.openedAt) - 90), src: "free" });
    }));
    v.querySelectorAll("[data-suhide]").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("edge.setupDone", "1"); } catch {} render(); }));
    v.querySelectorAll("[data-propset]").forEach((b) => b.addEventListener("click", propDialog));
    v.querySelectorAll("[data-traildone]").forEach((b) => b.addEventListener("click", () => act({ action: "trailDone", tradeId: b.dataset.traildone }, "Stop trailed. Profit locked — hands off.")));
    v.querySelectorAll("[data-cancelord]").forEach((b) => b.addEventListener("click", () => act({ action: "cancelOrder", id: b.dataset.cancelord }, "Order cancelled — cancel it on your platform too if you placed it yourself.")));
    v.querySelectorAll("[data-take]").forEach((b) => b.addEventListener("click", () => takeDialog(b.dataset.take)));
    v.querySelectorAll("[data-cmood]").forEach((b) => b.addEventListener("click", () => b.parentElement.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === b))));
    v.querySelectorAll("[data-confirm]").forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.confirm, card = b.closest(".confirm"), val = (k) => (card.querySelector(`[data-cf="${k}"]`) || {}).value;
      const mood = (card.querySelector("[data-cmood].on") || {}).dataset?.cmood || "calm";
      const r = await act({ action: "confirmTrade", tradeId: id, entry: val("entry"), sl: val("sl"), tp: val("tp"), units: val("units"), emotion: mood }, ["fomo", "revenge", "bored"].includes(mood) ? "Noted. Stick to the stop and target — no adding, no moving." : "Confirmed. Hands off — Edge manages it.");
      if (r) refresh();
    }));
    v.querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", async () => { if (await act({ action: "dismissTrade", tradeId: b.dataset.dismiss }, "Removed.")) refresh(); }));
    v.querySelectorAll("[data-risk]").forEach((inp) => inp.addEventListener("input", () => {
      const risk = Number(inp.value), rpc = Number(inp.dataset.rpc), id = inp.dataset.risk;
      if (!(risk > 0) || !(rpc > 0)) return;
      try { localStorage.setItem("edge.riskUSD", String(risk)); } catch {}
      const q = Math.floor(risk / rpc + 1e-9), x = S.setups.find((y) => y.id === id);
      const qEl = v.querySelector(`[data-qty="${CSS.escape(id)}"]`), rEl = v.querySelector(`[data-totrisk="${CSS.escape(id)}"]`);
      if (qEl) qEl.textContent = `${q} ${x && x.size ? x.size.contract : ""} contract${q === 1 ? "" : "s"}`;
      if (rEl) rEl.textContent = `$${Math.round(q * rpc * 100) / 100}`;
    }));
    v.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => act({ action: "skip", setupId: b.dataset.skip }, "Skipped. Good.")));
    v.querySelectorAll("[data-be]").forEach((b) => b.addEventListener("click", () => act({ action: "beDone", tradeId: b.dataset.be }, "🔒 Break-even. This trade can't hurt you now.")));
    v.querySelectorAll("[data-closeall]").forEach((b) => b.addEventListener("click", closeAllDialog));
    v.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(b.dataset.close)));
    v.querySelectorAll("[data-j]").forEach((b) => b.addEventListener("click", () => noteDialog(b.dataset.j)));
    v.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      const seg = b.parentElement; seg.dataset.v = b.dataset.val;
      seg.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === b));
    }));
    v.querySelectorAll("[data-sim]").forEach((b) => b.addEventListener("click", () => window.EdgeSim ? window.EdgeSim.open(b.dataset.sim) : toast("Simulator still loading — try again.")));
    v.querySelectorAll("[data-lab]").forEach((b) => b.addEventListener("click", () => window.EdgeSim ? window.EdgeSim.openLab(b.dataset.lab) : toast("Still loading — try again.")));
    v.querySelectorAll("[data-savebias]").forEach((b) => b.addEventListener("click", () => {
      const card = b.closest("[data-biascard]"), answers = {};
      card.querySelectorAll("[data-factor]").forEach((s) => (answers[s.dataset.factor] = Number(s.dataset.v)));
      const ms = (S.fundamentals && S.fundamentals.suggestions && S.fundamentals.suggestions[b.dataset.savebias]) || {};
      const evidence = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v.text]));
      act({ action: "bias", market: b.dataset.savebias, answers, evidence, note: card.querySelector("[data-note]").value }, "Bias saved for the week.");
    }));
    v.querySelectorAll("[data-pushon]").forEach((b) => b.addEventListener("click", enablePush));
    v.querySelectorAll("[data-pushoff]").forEach((b) => b.addEventListener("click", disablePush));
    v.querySelectorAll("[data-notify]").forEach((el) => el.addEventListener("change", () => act({ action: "settings", patch: { notify: { [el.dataset.notify]: el.checked } } }, "Saved.")));
    const fb = $("#fillBias"); if (fb) fb.addEventListener("click", async () => {
      fb.disabled = true; fb.textContent = "Reading the data…";
      try { S.fundamentals = await api("POST", { action: "autoBias" }); fillApplied = true; render(); toast("Suggestions filled in — check them and tap Save."); }
      catch (e) { toast(e.message, 7000); fb.disabled = false; fb.textContent = "↻ Fill from free data"; }
    });
    v.querySelectorAll("[data-copypine]").forEach((cpn) => cpn.addEventListener("click", async () => {
      try {
        const [{ secret }, src] = await Promise.all([api("POST", { action: "tvSetup" }), fetch(`/pine/${cpn.dataset.copypine}.pine`, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error("Couldn't load the script"); return r.text(); })]);
        const code = secret ? src.replace('input.string("change-me"', `input.string(${JSON.stringify(secret)}`) : src;
        await navigator.clipboard.writeText(code);
        toast(secret ? "Script copied — with your secret inside. In TradingView's Pine Editor press Ctrl+A (⌘A on Mac), Delete, then paste." : "Script copied. Set EDGE_HOOK_SECRET in Vercel, then put it in the script's settings.", 6000);
      } catch (e) { toast(e.message || "Couldn't copy — open it on a computer and try again.", 6000); }
    }));
    const chk = $("#copyHook"); if (chk) chk.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.origin + "/api/hook"); toast("Webhook URL copied."); } catch { toast(location.origin + "/api/hook", 8000); } });
    const lt = $("#logTrade"); if (lt) lt.addEventListener("click", logTradeDialog);
    v.querySelectorAll("[data-tvconnect]").forEach((b) => b.addEventListener("click", tradovateConnect));
    v.querySelectorAll("[data-tvdisconnect]").forEach((b) => b.addEventListener("click", async () => { if (confirm("Disconnect Tradovate? Edge stops placing orders for you (open positions stay on Tradovate).")) act({ action: "tradovateDisconnect" }, "Tradovate disconnected."); }));
    v.querySelectorAll("[data-testalert]").forEach((b) => b.addEventListener("click", async () => { const r = await act({ action: "testAlert" }); if (r) toast(r.sent ? "Sent — check your phone." : "No device has notifications on yet — tap Turn on first."); }));
    const so = $("#signOut"); if (so) so.addEventListener("click", () => { try { localStorage.removeItem("edge.token"); } catch {} token = ""; authView = "signin"; showLogin(); });
    const cp = $("#cpSave"); if (cp) cp.addEventListener("click", async () => {
      if ($("#cpNew").value !== $("#cpNew2").value) return toast("The two new passwords don't match.");
      try { const r = await api("POST", { action: "changePassword", current: $("#cpOld").value, next: $("#cpNew").value }); signedIn(r.token); toast("Password changed. Other devices are signed out."); render(); }
      catch (e) { toast(e.message, 6000); }
    });
    const nc = $("#newCode"); if (nc) nc.addEventListener("click", async () => {
      try {
        const r = await api("POST", { action: "newRecoveryCode" });
        const body = $("#modalBody");
        body.innerHTML = `<h3>Your new recovery code</h3><p class="muted">The old one no longer works. Save this one now — it won't be shown again.</p><div class="rcode">${esc(r.recoveryCode)}</div><div class="row"><button class="btn primary" value="ok">I saved it</button></div>`;
        $("#modal").showModal();
      } catch (e) { toast(e.message); }
    });
    v.querySelectorAll("[data-saverules]").forEach((sr) => sr.addEventListener("click", () => {
      const ru = $("#riskUsd"); if (ru && Number(ru.value) > 0) try { localStorage.setItem("edge.riskUSD", String(Number(ru.value))); } catch {}
      const patch = { sessions: {} };
      v.querySelectorAll("[data-set]").forEach((el) => {
        const k = el.dataset.set;
        patch[k] = el.type === "number" ? Number(el.value) : el.value === "true" ? true : el.value === "false" ? false : el.value;
      });
      v.querySelectorAll("[data-sess]").forEach((el) => (patch.sessions[el.dataset.sess] = el.value.split("-").map((x) => x.trim())));
      patch.notify = {}; v.querySelectorAll("[data-notify]").forEach((el) => (patch.notify[el.dataset.notify] = el.checked));
      act({ action: "settings", patch }, "Saved.");
    }));
  }

  if (token) refresh(); else showLogin();
  // no auto-refresh on Bias / Rules: it would wipe what you are typing
  setInterval(() => { if (token && !document.hidden && !$("#modal").open && !["bias", "rules", "coach", "watch"].includes(tab) && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#view input, #view textarea, #view select"))) refresh(); }, 15000);
  // back from the lock screen / another app: refresh, unless you're in the middle of something (a dialog, typing, the simulator)
  const typing = () => document.activeElement && document.activeElement.closest && document.activeElement.closest("#view input, #view textarea, #view select");
  document.addEventListener("visibilitychange", () => { if (!document.hidden && token && !$("#modal").open && !typing() && !document.body.classList.contains("sim-on")) refresh(); });
})();
