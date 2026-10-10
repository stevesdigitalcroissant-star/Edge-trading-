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
    if (r.status === 401 && !(body && ["login", "signup", "recover", "authStatus"].includes(body.action))) { showLogin(); throw new Error("Sign in"); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  function toast(t, ms = 3500) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms); }
  async function act(body, ok) {
    try { const r = await api("POST", body); if (ok) toast(ok); await refresh(); return r; }
    catch (e) { toast(e.message, 7000); return null; }
  }

  window.Edge = { token: () => token, state: () => S, toast, refresh: () => refresh(), go: (t) => { tab = t; try { localStorage.setItem("edge.tab", tab); } catch {} history.replaceState(null, "", "#" + tab); refresh(); scrollTo(0, 0); } };

  // ---------- notifications on this device (Web Push; iPhone/iPad need Edge on the Home Screen)
  const TABS = ["now", "learn", "coach", "setups", "bias", "journal", "rules"];
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
  // a setup's / trade's own exits (tested strategies carry theirs; the rest use your settings). beR 0 = no break-even.
  const xpOf = (x) => (x && x.xp) || { beR: S.settings.beAtR, tpR: S.settings.tpAtR };
  const stratName = (x) => (x && x.strategy && S.strategies && S.strategies[x.strategy] ? S.strategies[x.strategy].name : "");
  // your risk in dollars for the order tickets (remembered on this device; default = account × risk %)
  const riskDefault = () => Math.round(S.settings.accountSize * S.settings.riskPct / 100);
  const riskNow = () => { try { const v = Number(localStorage.getItem("edge.riskUSD")); return v > 0 ? v : riskDefault(); } catch { return riskDefault(); } };
  const qtyFor = (z, risk) => (z && z.kind === "futures" && z.riskPerContract > 0 ? Math.floor(risk / z.riskPerContract + 1e-9) : null);

  function render() {
    for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
    const live = S.setups.filter((x) => x.status === "open" && x.g.take.ok).length;
    $("#setupBadge").hidden = !live; $("#setupBadge").textContent = live;
    const g = S.guard;
    $("#topStatus").className = `pill ${g.ok ? "good" : "bad"}`;
    $("#topStatus").innerHTML = `<span class="dot ${g.ok ? "live" : ""}"></span>${g.ok ? "Ready" : "Locked"}`;
    const coachTab = tab === "coach";
    $("#view").hidden = coachTab;
    if (window.EdgeCoach) window.EdgeCoach.show(coachTab);
    if (coachTab) return;
    $("#view").innerHTML = ({ now: viewNow, learn: viewLearn, setups: viewSetups, bias: viewBias, journal: viewJournal, rules: viewRules })[tab]();
    bind();
  }

  // ---------- LEARN: interactive — live session clock, step-by-step chart walkthroughs, a quiz, the week, a practice log
  const LEARN_WEEK = [
    ["Read & look", "📖", "Play both walkthroughs below and take the quiz. Put the Edge scripts on TradingView (Rules → TradingView setup). Scroll back 10 days on gold: find the box and which side broke each morning."],
    ["Gold", "🥇", "Bar Replay on 5-minute MGC1!. Replay 20 mornings, one candle at a time. Log each trade below."],
    ["Crude", "🛢️", "Same on MCL1!: 20 mornings. Crude orders only go live at 03:00 New York."],
    ["Silver + gas", "⚡", "10 silver mornings (skip tiny boxes). Then 1-hour QG1!: mark old zones (5+ days) and replay 10 sessions of the gas windows."],
    ["Full days", "🗓️", "Replay 5 full days with every market and the daily rules: 2 London trades max, gas zones on top, stop for the day at −2R."],
    ["Review", "🔍", "Compare your numbers with the test below. Rules kept on 95%+? Write down your 3 most common mistakes."],
    ["Live, tiny", "🚀", "Edge on with your prop evaluation (or demo): 1 micro contract, follow the alerts exactly. Log how you felt each time."],
  ];
  const TEST = { "london:gold": [43, 0.13], "london:crude": [30, 0.13], "london:silver": [39, 0.1], "ngzone:natgas": [47, 0.65] };
  const SLOTS = [["london:gold", "Gold", "🥇"], ["london:crude", "Crude", "🛢️"], ["london:silver", "Silver", "🥈"], ["ngzone:natgas", "Gas", "🔥"]];
  const WALK = {
    london: { name: "London breakout", sub: "gold · crude oil · silver", steps: [
      ["The quiet hours", "From 18:00 to 02:00 New York, Asia is quiet. Its high and low make the box."],
      ["Two orders, set and forget", "Buy stop at the box high, sell stop at the box low — stop and target attached to each."],
      ["London picks a side", "The first order that fills is your trade. Cancel the other one straight away."],
      ["Stop and target", "Stop at the other side of the box. Target 2R for gold and silver, 3R for crude."],
      ["Lock it in", "At +1.5R (gold) or +1R (crude, silver) move the stop to your entry. Edge pings you."],
      ["Let it pay", "Hands off until target, stop or 16:40 New York. One winner pays for 2–3 losers."],
    ] },
    gas: { name: "Natural gas zones", sub: "your idea, tested", steps: [
      ["Spot the explosion", "On the 1-hour Heikin Ashi chart: a candle about twice as big as the last 20."],
      ["Draw the zone", "On the candle just before it: from its wick to the start of its body. Valid until a candle closes through it."],
      ["Let it age", "Only zones at least 5 trading days old. Fresh ones lost money in the test."],
      ["Wait for your window", "Price comes back (1st or 2nd touch) inside 06:00–09:00 or 11:00–12:00 New York. Your limit fills."],
      ["Stop and target", "Stop just past the far side of the zone. Target 3R."],
      ["Lock it, let it pay", "Break-even at +2R, then hands off. 47% of these won: +0.65R a trade on average."],
    ] },
  };
  const QUIZ = [
    ["Gold's Asian box: high 2412, low 2402. Where does the buy stop go?", ["2402", "2407", "2412"], 2, "On the box high. If London breaks up, you're in."],
    ["Your gold buy filled at 2412. Where's the stop?", ["2402 — the box low", "2407 — the middle", "2392 — extra room"], 0, "The other side of the box. Middle-of-box stops lost badly in the test."],
    ["Risk is 10 points. Gold's target is 2R. Where do you take profit?", ["2422", "2432", "2442"], 1, "2412 + 2 × 10 = 2432."],
    ["The buy filled. What about the sell stop?", ["Leave it, just in case", "Cancel it now", "Move it closer"], 1, "One trade per market per day. Cancel it the moment the other fills."],
    ["Crude breaks out of its box at 02:30 New York. Do you take it?", ["Yes, straight away", "No — crude orders go live at 03:00"], 1, "Crude's window is 03:00–08:00. Before that, wait."],
    ["A gas zone is 2 days old and price is back at it in your window.", ["Take it — fresh zone", "Skip — zones must be 5+ days old"], 1, "Young zones lost money in the test. Old ones made +42R."],
    ["You're up 1.2R on crude and it looks weak.", ["Close it, lock the profit", "Stick to the plan: break-even at 1R, then target or stop"], 1, "Every 'close early' rule did worse in the tests. The plan already protects you."],
  ];
  const L = { walk: "london", step: { london: 0, gas: 0 }, q: 0, ans: {}, day: null, play: null, log: { slot: "london:gold", dir: "long", out: "tp", ok: true } };
  const weekDone = () => { try { return JSON.parse(localStorage.getItem("edge.week") || "[]"); } catch { return []; } };

  // New York time ↔ this device: today's offset, in minutes
  function nyOffset() {
    const now = new Date();
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const ny = Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
    const loc = now.getHours() * 60 + now.getMinutes();
    return { off: (((loc - ny) % 1440) + 1440) % 1440, loc };
  }
  const hhmm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`);
  const LANES = [
    ["Asian box forms", "var(--c4h)", [[18 * 60, 26 * 60]]],
    ["Gold & silver orders", "var(--gold)", [[2 * 60, 8 * 60]]],
    ["Crude orders", "var(--c15)", [[3 * 60, 8 * 60]]],
    ["Gas zone windows", "var(--good)", [[6 * 60, 9 * 60], [11 * 60, 12 * 60]]],
  ];
  function clockHtml() {
    const { off, loc } = nyOffset();
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop().replace(/_/g, " "); } catch { return "your time"; } })();
    const pct = (m) => `${((((m % 1440) + 1440) % 1440) / 1440) * 100}%`;
    const lanes = LANES.map(([name, col, wins]) => {
      let segs = "", state = null;
      for (const [a0, b0] of wins) {
        const a = a0 + off, b = b0 + off; // local minutes (may pass midnight)
        for (const [x, y] of [[a, b], [a - 1440, b - 1440], [a + 1440, b + 1440]]) {
          const s = Math.max(0, x), e = Math.min(1440, y);
          if (e > s) segs += `<i style="left:${(s / 1440) * 100}%;width:${((e - s) / 1440) * 100}%;background:${col}"></i>`;
          if (loc >= x && loc < y) state = { open: true, left: y - loc };
        }
        if (!state || !state.open) {
          const until = (((a - loc) % 1440) + 1440) % 1440;
          if (!state || until < state.until) state = { open: false, until };
        }
      }
      const chip = state.open ? `<b class="lopen">● open · ${dur(state.left)} left</b>` : `<span class="muted">opens in ${dur(state.until)}</span>`;
      return `<div class="lane"><div class="lname"><span><i style="background:${col}"></i>${name}</span>${chip}</div><div class="ltrack">${segs}<b class="tnow" style="left:${pct(loc)}"></b></div></div>`;
    }).join("");
    const ticks = [0, 6, 12, 18].map((h) => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("");
    return `<div class="lclock">${lanes}<div class="lticks">${ticks}<b class="tnowlbl" style="left:${pct(loc)}">now ${hhmm(loc)}</b></div></div>
      <p class="muted" style="margin:10px 0 0;font-size:12.5px">In ${esc(tz)} time · New York is ${hhmm(loc - off)} · close-out ${hhmm(16 * 60 + 40 + off)} your time</p>`;
  }

  // The animated chart: elements of earlier steps stay, the current step's elements animate in
  function walkSvg(kind, st) {
    const g = (n, inner) => (n > st ? "" : `<g class="${n === st ? "enter" : ""}">${inner}</g>`);
    const p = (n, d, stroke = "var(--text)", w = 2.2, extra = "") => (n > st ? "" : `<path d="${d}" pathLength="1" class="${n === st ? "draw" : ""}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`);
    const tx = (x, y, t, c = "var(--text)", a = "start", w = 700) => `<text x="${x}" y="${y}" fill="${c}" font-size="10" font-weight="${w}" text-anchor="${a}" paint-order="stroke" stroke="var(--panel2)" stroke-width="3.5" stroke-linejoin="round">${t}</text>`;
    const ln = (x1, y, x2, c, dash = "") => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${c}" stroke-width="1.8" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
    const dot = (x, y, c) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${c}" class="ping"/>`;
    const badge = (x, y, t, c) => `<rect x="${x - 26}" y="${y - 12}" width="52" height="20" rx="10" fill="${c}"/><text x="${x}" y="${y + 2}" fill="#fff" font-size="10.5" font-weight="800" text-anchor="middle">${t}</text>`;
    if (kind === "london") {
      return `<svg viewBox="0 0 340 190" class="walksvg">
        ${g(0, `<rect x="20" y="100" width="130" height="30" rx="3" fill="var(--c4h)" opacity=".16" stroke="var(--c4h)" stroke-opacity=".7"/>${tx(24, 94, "ASIA BOX · 18:00 → 02:00", "var(--c4h)")}`)}
        ${p(0, "M20,115 L35,106 L50,122 L65,108 L80,126 L95,104 L110,118 L125,110 L140,124 L150,116")}
        ${g(1, `${ln(150, 100, 330, "var(--good)", "5 4")}${st < 3 ? tx(328, 112, "BUY STOP", "var(--good)", "end") : ""}`)}
        ${st < 2 ? g(1, `${ln(150, 130, 330, "var(--bad)", "5 4")}${tx(328, 144, "SELL STOP", "var(--bad)", "end")}`) : g(1, `${ln(150, 130, 330, "var(--bad)", "2 6")}`)}
        ${p(2, "M150,116 L165,120 L180,108 L192,100 L205,92", "var(--text)")}
        ${g(2, `${dot(192, 100, "var(--good)")}${tx(196, 160, "✕ sell stop cancelled", "var(--bad)")}${tx(160, 86, "FILLED", "var(--good)")}`)}
        ${st >= 3 && st < 4 ? g(3, `${ln(192, 130, 330, "var(--bad)")}${tx(200, 144, "STOP = box low", "var(--bad)")}`) : ""}
        ${g(3, `${ln(150, 40, 330, "var(--good)")}${tx(152, 34, "TARGET · 2R (crude 3R)", "var(--good)")}`)}
        ${p(4, "M205,92 L215,98 L230,74 L242,80 L258,55 L270,62", "var(--text)")}
        ${g(4, `${ln(150, 55, 330, "var(--warn)", "3 3")}${tx(152, 51, "+1.5R → move the stop", "var(--warn)")}<g class="slide">${ln(192, 100, 330, "var(--bad)")}${tx(212, 116, "stop now at entry", "var(--bad)")}</g>`)}
        ${p(5, "M270,62 L290,44 L305,48 L318,38", "var(--text)")}
        ${g(5, badge(300, 20, "+2R ✓", "var(--good)"))}
      </svg>`;
    }
    const c = (x, o, cl, h, l, col, glow = "") => `<line x1="${x + 6}" y1="${h}" x2="${x + 6}" y2="${l}" stroke="${col}" stroke-width="1.5"/><rect x="${x}" y="${Math.min(o, cl)}" width="12" height="${Math.max(2, Math.abs(cl - o))}" rx="2" fill="${col}" ${glow}/>`;
    return `<svg viewBox="0 0 340 190" class="walksvg">
      ${g(3, `<rect x="232" y="14" width="100" height="160" rx="6" fill="var(--c15)" opacity=".08"/>${tx(282, 184, "06:00–09:00 NY", "var(--c15)", "middle")}`)}
      ${g(1, `<rect x="38" y="124" width="292" height="14" rx="2" fill="var(--good)" opacity=".2" stroke="var(--good)" stroke-opacity=".7"/>${tx(42, 154, "ZONE: wick → start of the body", "var(--good)")}`)}
      ${g(0, `${c(20, 118, 126, 114, 132, "var(--bad)")}${c(38, 124, 130, 122, 138, "var(--bad)")}${c(56, 130, 70, 66, 132, "var(--good)", st === 0 ? `class="glow"` : "")}${st === 0 ? tx(74, 80, "← 2× bigger: explosive", "var(--text)") : ""}`)}
      ${p(2, "M62,66 L90,60 L110,72 L135,50 L160,64 L185,58 L205,80 L225,100")}
      ${g(2, `<path d="M70,30 L222,30" stroke="var(--muted)" stroke-width="1.2" marker-end="url(#arr)" marker-start="url(#arr)"/>${tx(146, 24, "5+ trading days", "var(--muted)", "middle")}`)}
      ${p(3, "M225,100 L245,116 L258,124")}
      ${g(3, `${dot(258, 124, "var(--good)")}${tx(252, 116, "LIMIT BUY", "var(--good)", "end")}`)}
      ${g(4, `${ln(240, 142, 334, "var(--bad)")}${tx(330, 156, "STOP", "var(--bad)", "end")}${ln(240, 70, 334, "var(--good)")}${tx(330, 64, "TARGET 3R", "var(--good)", "end")}`)}
      ${p(5, "M258,124 L270,112 L282,100 L294,104 L306,86 L318,80 L330,68")}
      ${g(5, `${ln(240, 88, 334, "var(--warn)", "3 3")}${tx(236, 84, "+2R → stop to entry", "var(--warn)", "end")}${badge(300, 40, "+3R ✓", "var(--good)")}`)}
      <defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10z" fill="var(--muted)"/></marker></defs>
    </svg>`;
  }
  function walkHtml() {
    const k = L.walk, w = WALK[k], st = L.step[k], n = w.steps.length, [title, text] = w.steps[st];
    return `<div class="seg pills" style="grid-template-columns:1fr 1fr">${Object.entries(WALK).map(([id, x]) => `<button type="button" data-l="walk" data-a="${id}" class="${id === k ? "on" : ""}">${x.name}</button>`).join("")}</div>
      <div class="walkstage">${walkSvg(k, st)}</div>
      <div class="walkcap"><span class="stepno">${st + 1}/${n}</span><div><b>${title}</b><p>${text}</p></div></div>
      <div class="walknav">
        <button class="btn small" data-l="prev" ${st ? "" : "disabled"}>‹ Back</button>
        <div class="dots">${w.steps.map((_, i) => `<button type="button" data-l="go" data-a="${i}" class="${i === st ? "on" : i < st ? "done" : ""}" aria-label="step ${i + 1}"></button>`).join("")}</div>
        ${st < n - 1 ? `<button class="btn small primary" data-l="next">Next ›</button>` : `<button class="btn small primary" data-l="go" data-a="0">↺ Again</button>`}
      </div>
      <button class="btn small ghostbtn" data-l="play">${L.play ? "⏸ Pause" : "▶ Play it for me"}</button>`;
  }

  function quizHtml() {
    if (L.q >= QUIZ.length) {
      const score = QUIZ.filter((q, i) => L.ans[i] === q[2]).length;
      return `<div class="quizdone"><div class="bigscore">${score}<small>/${QUIZ.length}</small></div>
        <p>${score === QUIZ.length ? "Perfect. You know the rules — now train your hands with Bar Replay." : score >= 5 ? "Nearly there. Replay the walkthrough for the ones you missed." : "Play the walkthroughs again, then retry."}</p>
        <button class="btn small primary" data-l="qreset">↺ Try again</button></div>`;
    }
    const [q, opts, ok, why] = QUIZ[L.q], a = L.ans[L.q];
    return `<div class="qbar"><i style="width:${(L.q / QUIZ.length) * 100}%"></i></div>
      <p class="muted" style="margin:8px 0 2px;font-size:12px">Question ${L.q + 1} of ${QUIZ.length}</p>
      <h3 class="qq">${q}</h3>
      <div class="qopts">${opts.map((o, i) => `<button type="button" data-l="ans" data-a="${i}" ${a != null ? "disabled" : ""} class="${a == null ? "" : i === ok ? "right" : i === a ? "wrong" : "faded"}">${o}${a != null && i === ok ? " ✓" : a === i && i !== ok ? " ✕" : ""}</button>`).join("")}</div>
      ${a != null ? `<div class="qwhy ${a === ok ? "good" : "bad"}"><b>${a === ok ? "Right." : "Not quite."}</b> ${why}</div><button class="btn small primary" data-l="qnext" style="margin-top:10px">${L.q < QUIZ.length - 1 ? "Next question ›" : "See my score"}</button>` : ""}`;
  }

  function weekHtml() {
    const done = weekDone();
    if (L.day == null) { L.day = LEARN_WEEK.findIndex((_, i) => !done.includes(i)); if (L.day < 0) L.day = 6; }
    const [t, ic, d] = LEARN_WEEK[L.day], isDone = done.includes(L.day);
    return `<div class="daychips">${LEARN_WEEK.map(([tt, icon], i) => `<button type="button" data-l="day" data-a="${i}" class="${i === L.day ? "on" : ""} ${done.includes(i) ? "done" : ""}"><span>${done.includes(i) ? "✓" : icon}</span><small>Day ${i + 1}</small></button>`).join("")}</div>
      <div class="daycard ${isDone ? "done" : ""}"><div class="row between"><b>Day ${L.day + 1} · ${t}</b><span class="pill ${isDone ? "good" : ""}">${isDone ? "done" : "to do"}</span></div>
        <p class="muted" style="margin:6px 0 10px">${d}</p>
        <button class="btn small ${isDone ? "" : "primary"}" data-l="daydone">${isDone ? "Undo" : "✓ Mark day done"}</button></div>`;
  }

  function logHtml() {
    const lg = L.log, bt = (S.practice || []).filter((t) => t.source === "backtest");
    const chip = (key, val, label, on) => `<button type="button" data-l="${key}" data-a="${val}" class="${on ? "on" : ""}">${label}</button>`;
    const cards = SLOTS.map(([slot, name, ic]) => {
      const [stg, mk] = slot.split(":"), a = bt.filter((t) => t.strategy === stg && t.market === mk);
      const n = a.length, won = a.filter((t) => t.resultR > 0.1).length, tot = Math.round(a.reduce((x, t) => x + t.resultR, 0) * 100) / 100;
      const ok = a.filter((t) => t.grade === "A+").length, [tw, ta] = TEST[slot], wr = n ? Math.round((won / n) * 100) : 0;
      return `<div class="rcard"><div class="row between"><b>${ic} ${name}</b><b class="${cls(tot)}">${n ? rs(tot) : "—"}</b></div>
        <div class="rbar" title="your win rate ${wr}% · test ${tw}%"><i style="width:${wr}%"></i><em style="left:${tw}%"></em></div>
        <small>won <b>${n ? wr + "%" : "—"}</b> <span class="muted">· test ${tw}%</span></small>
        <small class="muted">${n} trade${n === 1 ? "" : "s"} · rules ${n ? Math.round((ok / n) * 100) + "%" : "—"}</small></div>`;
    }).join("");
    return `<div class="chips">${SLOTS.map(([v, l, ic]) => chip("lslot", v, `${ic} ${l}`, lg.slot === v)).join("")}</div>
      <div class="chips two">${chip("ldir", "long", "▲ Buy", lg.dir === "long")}${chip("ldir", "short", "▼ Sell", lg.dir === "short")}</div>
      <div class="chips outs">${chip("lout", "tp", "🎯<br>Target", lg.out === "tp")}${chip("lout", "be", "🛡️<br>Break-even", lg.out === "be")}${chip("lout", "sl", "✋<br>Stop", lg.out === "sl")}${chip("lout", "flat", "⏰<br>16:40 out", lg.out === "flat")}</div>
      ${lg.out === "flat" ? `<label class="f">Your R at 16:40 (e.g. 0.6 or −0.4)<input id="btR" inputmode="decimal"></label>` : ""}
      <div class="grid2"><label class="f">Day you replayed<input id="btDate" type="date"></label><label class="f">Note<input id="btNote" placeholder="what you saw / felt"></label></div>
      <button type="button" class="switch ${lg.ok ? "on" : ""}" data-l="lok"><i></i>I followed every rule on this one</button>
      <button class="btn primary" data-l="save" style="width:100%;margin-top:10px">Save trade</button>
      <div class="rgrid">${cards}</div>
      <p class="muted" style="margin:8px 0 0;font-size:12.5px">The marker on each bar is the test's win rate. After 20 trades you can easily be 15 points off — that's luck. This week, watch the rules column.</p>`;
  }

  function viewLearn() {
    const done = weekDone(), bt = (S.practice || []).filter((t) => t.source === "backtest");
    const total = bt.length, okAll = bt.filter((t) => t.grade === "A+").length, C = 2 * Math.PI * 40;
    const ready = total >= 60 && okAll / Math.max(1, total) >= 0.95;
    return `<section class="card hero" style="--state:var(--accent)">
        <div><div class="state">Learn · your first week</div>
          <div class="headline">Two strategies. Seven days. Then Edge.</div>
          <p class="sub">${ready ? "✅ Ready: 60+ replayed trades with the rules kept." : `${total}/60 replayed trades · rules kept ${total ? Math.round((okAll / total) * 100) : 0}% (need 95%)`}</p></div>
        <div class="ring"><svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="7"/>
          <circle cx="46" cy="46" r="40" fill="none" stroke-width="7" stroke-linecap="round" stroke="url(#goldGrad)" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - done.length / 7)}"/></svg>
          <div class="lbl"><b>${done.length}/7</b><small>days</small></div></div></section>

      <section class="card"><div class="card-head"><h2>⏱ Right now</h2><span class="muted">your time</span></div><div id="lClock">${clockHtml()}</div></section>

      <section class="card"><div class="card-head"><h2>🎬 See it step by step</h2></div><div id="lWalk">${walkHtml()}</div></section>

      <section class="card"><div class="card-head"><h2>🧠 Quick quiz</h2><span class="muted">${QUIZ.length} questions</span></div><div id="lQuiz">${quizHtml()}</div></section>

      <section class="card"><div class="card-head"><h2>🗓 Your week</h2></div><div id="lWeek">${weekHtml()}</div></section>

      <section class="card"><div class="card-head"><h2>⏪ How to backtest</h2><span class="muted">swipe →</span></div>
        <div class="hscroll">${[
          ["📈", "Open the chart", "5-min MGC1! / MCL1! / SIL1! — or 1-hour QG1! for gas — with the Edge script on it."],
          ["⏮", "Go back in time", "Click Replay in the top bar and pick a day, around 17:00 New York."],
          ["➡️", "One candle at a time", "Shift + → steps forward. Never peek ahead."],
          ["✏️", "Mark the box", "At 02:00 (03:00 crude) note the box high and low — your two orders."],
          ["🎯", "Run the plan", "Fill → break-even at its level → target, stop or 16:40."],
          ["📝", "Log it", "20 seconds, right below. Be honest about the rules."],
        ].map(([ic, t, d], i) => `<div class="hcard"><span class="hnum">${i + 1}</span><div class="hic">${ic}</div><b>${t}</b><p class="muted">${d}</p></div>`).join("")}</div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">Shortcut: each script's <b>Strategy Tester</b> tab shows the results of these rules on your chart in one click. Replay is still the training — it teaches your eyes and hands.</p></section>

      <section class="card"><div class="card-head"><h2>📝 Log a replayed trade</h2></div><div id="lLog">${logHtml()}</div></section>

      <section class="card"><h2>📡 Longer, sharper history</h2>
        <p class="muted" style="margin:0">Free data only keeps 60 days of 15-minute candles. <b>TradingView Premium</b> replays all its intraday history (years). For Edge's own tests, <b>Databento</b> has official CME futures data back 15+ years, pay as you go, with free credit to start.</p></section>`;
  }

  // Learn interactions: swap one widget at a time (no full re-render, so animations and typing aren't lost)
  function learnSwap(id, html) { const el = $("#" + id); if (el) { el.innerHTML = html; bindLearn(); } }
  function learnAct(k, a) {
    const W = WALK[L.walk];
    if (k === "walk") { L.walk = a; stopPlay(); return learnSwap("lWalk", walkHtml()); }
    if (k === "next") { L.step[L.walk] = Math.min(W.steps.length - 1, L.step[L.walk] + 1); return learnSwap("lWalk", walkHtml()); }
    if (k === "prev") { L.step[L.walk] = Math.max(0, L.step[L.walk] - 1); stopPlay(); return learnSwap("lWalk", walkHtml()); }
    if (k === "go") { L.step[L.walk] = Number(a); stopPlay(); return learnSwap("lWalk", walkHtml()); }
    if (k === "play") {
      if (L.play) { stopPlay(); return learnSwap("lWalk", walkHtml()); }
      if (L.step[L.walk] >= W.steps.length - 1) L.step[L.walk] = 0;
      L.play = setInterval(() => {
        if (tab !== "learn" || !$("#lWalk")) return stopPlay();
        if (L.step[L.walk] >= WALK[L.walk].steps.length - 1) { stopPlay(); return learnSwap("lWalk", walkHtml()); }
        L.step[L.walk]++; learnSwap("lWalk", walkHtml());
      }, 2600);
      return learnSwap("lWalk", walkHtml());
    }
    if (k === "ans") { L.ans[L.q] = Number(a); return learnSwap("lQuiz", quizHtml()); }
    if (k === "qnext") { L.q++; return learnSwap("lQuiz", quizHtml()); }
    if (k === "qreset") { L.q = 0; L.ans = {}; return learnSwap("lQuiz", quizHtml()); }
    if (k === "day") { L.day = Number(a); return learnSwap("lWeek", weekHtml()); }
    if (k === "daydone") {
      const d = new Set(weekDone()); d.has(L.day) ? d.delete(L.day) : d.add(L.day);
      try { localStorage.setItem("edge.week", JSON.stringify([...d])); } catch {}
      if (d.has(L.day)) { const nx = LEARN_WEEK.findIndex((_, i) => !d.has(i)); if (nx >= 0) L.day = nx; toast("Day done. 👏"); }
      return render();
    }
    const keep = () => ({ date: ($("#btDate") || {}).value || "", note: ($("#btNote") || {}).value || "" });
    const restore = (v) => { if ($("#btDate")) $("#btDate").value = v.date; if ($("#btNote")) $("#btNote").value = v.note; };
    if (["lslot", "ldir", "lout", "lok"].includes(k)) {
      const v = keep();
      if (k === "lslot") L.log.slot = a; if (k === "ldir") L.log.dir = a; if (k === "lout") L.log.out = a; if (k === "lok") L.log.ok = !L.log.ok;
      learnSwap("lLog", logHtml()); return restore(v);
    }
    if (k === "save") {
      const [strategy, market] = L.log.slot.split(":"), v = keep();
      return act({ action: "backtestLog", strategy, market, dir: L.log.dir, outcome: L.log.out, r: (($("#btR") || {}).value || "").replace("−", "-"), date: v.date, rulesOk: L.log.ok, note: v.note }, "Saved ✓")
        .then((r) => { if (r) { L.log.ok = true; render(); } });
    }
  }
  function stopPlay() { if (L.play) { clearInterval(L.play); L.play = null; } }
  function bindLearn() {
    document.querySelectorAll("#view [data-l]:not([data-bound])").forEach((b) => {
      b.dataset.bound = "1";
      b.addEventListener("click", () => learnAct(b.dataset.l, b.dataset.a));
    });
  }
  setInterval(() => { if (tab === "learn" && $("#lClock") && !document.hidden) $("#lClock").innerHTML = clockHtml(); }, 30000);

  // ---------- NOW
  function viewNow() {
    const g = S.guard, s = S.settings;
    const live = S.setups.filter((x) => x.status === "open" && x.g.take.ok).length;
    const inTrade = S.open.length;
    const [stateTxt, stateColor, headline, sub] = !g.ok
      ? ["Locked", "var(--bad)", "Not trading right now.", g.reasons.map(esc).join("<br>")]
      : live ? ["Setup ready", "var(--accent)", `${live} A+ setup${live > 1 ? "s" : ""} waiting for you.`, `<a href="#setups" style="color:var(--accent);font-weight:600">Open it →</a> it's only valid for ${s.setupExpiryMin} minutes.`]
      : inTrade ? ["In a trade", "var(--info)", "Hands off. The rules manage it.", S.open.map((t) => { const e = xpOf(t); return `${esc(mname(t.market))}: ${e.beR > 0 ? `break-even at +${e.beR}R · ` : ""}exit at +${e.tpR}R`; }).join("<br>")]
      : ["Ready", "var(--good)", "Waiting for an A+ setup.", "No setup, no trade. Patience is the position."];
    const share = S.share.share, C = 2 * Math.PI * 40, okShare = true;
    const hero = `<section class="card hero" style="--state:${stateColor}">
      <div><div class="state"><span class="dot ${g.ok ? "live" : ""}"></span>${stateTxt}</div>
        <div class="headline">${headline}</div><p class="sub">${sub}</p></div>
      <div class="ring" title="A+ share of your last ${S.share.taken || 0} trades">
        <svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="7"/>
          <circle cx="46" cy="46" r="40" fill="none" stroke-width="7" stroke-linecap="round" stroke="${okShare ? "url(#goldGrad)" : "var(--bad)"}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - share / 100)}"/></svg>
        <div class="lbl"><b>${share}%</b><small>A+ share</small></div></div>
    </section>`;
    const stats = `<div class="kpis">
      <div><small>Trades</small><b>${g.tradesToday}<small class="muted"> / ${s.maxTradesPerDay}</small></b></div>
      <div><small>Today</small><b class="${cls(g.rToday)}">${rs(g.rToday)}</b></div>
      <div><small>Loss limit</small><b>−${s.maxDailyLossR}R</b></div>
    </div>`;
    const open = S.open.length ? S.open.map(tradeCard).join("")
      : `<div class="empty"><svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/></svg><b>No open trades</b><span>When you take an A+ setup, it shows up here with its plan.</span></div>`;
    const ps = pushStatus();
    const pushNudge = ps.on ? "" : `<section class="card"><div class="row between"><b>🔔 Get alerts on this device</b>${pushCapable && Notification.permission !== "denied" ? `<button class="btn small primary" data-pushon>Turn on</button>` : ""}</div><p class="muted" style="margin:6px 0 0">${esc(ps.text)}</p></section>`;
    const ce = S.closeOut || {}, n = S.open.length;
    const ceBanner = n && (ce.warn || ce.due) ? `<div class="banner bad">⏰ ${ce.due ? `Close-out time (${esc(s.flatBy)}) — get out now.` : `${ce.minutesLeft} min to the close-out (${esc(s.flatBy)}).`}
        <p>You're in ${n} trade${n > 1 ? "s" : ""}. Your prop firm closes you if you don't.</p>
        <button class="btn danger closeall" data-closeall style="margin-top:8px">⛔ Close everything</button></div>` : "";
    const head = `<div class="card-head"><h2>Open trades</h2>${n ? `<button class="btn small closeall" data-closeall>Close everything</button>` : ""}</div>`;
    return `${ceBanner}${hero}${stats}${pushNudge}${plansCard()}<section class="card">${head}${open}</section>${newsCard(6)}${logCard()}`;
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
    return `<section class="card"><div class="card-head"><h2>📋 Orders to place now</h2><span class="muted">risk $${risk} each · change it on a setup card</span></div>
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
    const routed = t.source === "traderspost";
    const beAdvised = manual && !t.beMoved && e.beR > 0 && (t.maxR || 0) >= e.beR;
    return `<div class="card" style="background:var(--panel2);margin-bottom:10px">
      <div class="row between"><h3>${esc(mname(t.market))} · ${t.dir.toUpperCase()}${stratName(t) ? ` <small class="muted">${esc(stratName(t))}</small>` : ""}</h3>
        <span class="pill ${t.grade === "A+" ? "good" : "warn"}">${esc(t.grade)}</span></div>
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
    return `<section class="card"><h2>News that moves your markets</h2>
      ${S.news.ok || market ? "" : `<p class="err">Calendar feed unavailable${S.news.error ? ` (${esc(S.news.error)})` : ""} — only the weekly energy reports are shown. Check ForexFactory for CPI / NFP / FOMC.</p>`}
      <div class="news">${rows || `<p class="muted">Nothing big coming up.</p>`}</div></section>`;
  }

  function logCard() {
    return `<section class="card"><h2>Alerts</h2><div class="log">${S.log.slice(0, 12).map((l) => `<div><time>${day(l.at)} ${time(l.at)}</time>${esc(l.text)}</div>`).join("") || `<p class="muted">Nothing yet. Alerts from TradingView land here (and on your phone if Telegram is set up).</p>`}</div></section>`;
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
    const be = x.entry + k * s.beAtR * R, tp = x.entry + k * s.tpAtR * R;
    const zTop = x.zoneTop ?? x.sl + k * 0.8 * R, zBot = x.zoneBot ?? x.sl + k * 0.2 * R;
    const zNear = k > 0 ? Math.max(zTop, zBot) : Math.min(zTop, zBot), zFar = k > 0 ? Math.min(zTop, zBot) : Math.max(zTop, zBot);
    const l15 = x.lvl15 ?? x.entry - k * 0.35 * R, l5 = x.lvl5 ?? x.entry - k * 0.1 * R;
    const l4 = x.lvl4h ?? zNear + k * 2.2 * R;
    const oppIn = x.opp != null && k * (x.opp - tp) <= 1.2 * R; // only draw the opposing zone if it's close
    const liq = x.sweep && x.sweepLvl != null && k * (x.sweepLvl - x.sl) > 0 ? x.sweepLvl : null;
    const prices = [x.sl, x.entry, be, tp, zTop, zBot, l4, l15, l5, ...(oppIn ? [x.opp] : []), ...(liq != null ? [liq] : [])];
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
    const tags = [[tp, `TP ${fx(tp)}`, "var(--good)"], [be, `BE ${fx(be)}`, "var(--warn)"], [x.entry, `Entry ${fx(x.entry)}`, "var(--text)"], [x.sl, `SL ${fx(x.sl)}`, "var(--bad)"]]
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
      ${hline(be, 205, X, "var(--warn)", "4 3")}${hline(tp, 205, X, "var(--good)")}${hline(x.sl, 100, X, "var(--bad)")}${hline(x.entry, 205, X, "var(--text)")}
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
    return `<div class="card" style="background:var(--panel2);margin:8px 0">
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
    return `<div class="card setup ${live ? "" : "dim"}">
      <div class="row between">
        <div class="row"><div class="grade ${g.grade === "A+" ? "Ap" : g.grade}">${g.grade}</div>
          <div><h3>${esc(mname(x.market))} · ${x.dir.toUpperCase()}${stratName(x) ? ` <small class="muted">${esc(stratName(x))}</small>` : ""}</h3><span class="muted">${day(x.at)} ${time(x.at)} · ${esc(x.tv || x.symbol)}</span></div></div>
        <span class="pill ${x.status === "taken" ? "good" : ""}">${live ? `${Math.max(0, Math.round((x.expires - S.now) / 60e3))} min left` : esc(x.status === "open" ? "expired" : x.status)}</span>
      </div>
      <div class="levels">
        <div><small>Entry</small><b>${fx(x.entry)}</b></div>
        <div><small>Stop</small><b>${fx(x.sl)}</b></div>
        <div><small>${e.beR > 0 ? `BE at ${e.beR}R` : "Break-even"}</small><b>${e.beR > 0 ? fx(be) : "none"}</b></div>
        <div><small>TP ${e.tpR}R</small><b>${fx(tp)}</b></div>
      </div>
      ${storyBlock(x)}
      ${g.info ? `<p class="muted" style="margin:6px 0">${esc(g.info)}</p>` : ""}
      <details class="checkwrap"><summary>Checklist — ${g.checks.filter((c) => c.pass).length}/${g.checks.length} passed</summary>
      <ul class="checks">${g.checks.map((c) => `<li class="${c.pass ? "" : "no"}"><span>${esc(c.label)}${c.note ? ` <small>(${esc(c.note)})</small>` : ""}</span></li>`).join("")}</ul></details>
      ${live && !g.take.ok ? `<div class="blocks">${g.take.why.map((w) => `<div>⛔ ${esc(w)}</div>`).join("")}</div>` : ""}
      ${live && S.broker.kind !== "oanda" ? ticket(x, tp) : ""}
      ${live ? `<div class="row">${(() => { const tooBig = x.size && x.size.kind === "futures" && qtyFor(x.size, riskNow()) < 1 && S.broker.kind !== "oanda"; const ok = g.take.ok && !tooBig;
        return `<button class="btn ${ok ? "good" : ""}" data-take="${esc(x.id)}" ${ok ? "" : "disabled"}>${ok ? (S.broker.kind === "manual" ? "I'm taking it" : S.broker.kind === "traderspost" ? "Take it — send the order" : "Take it — place the order") : tooBig ? "Too big for your risk" : "Not allowed"}</button>`; })()}
        <button class="btn" data-skip="${esc(x.id)}">Skip</button></div>` : ""}
    </div>`;
  }

  function takeDialog(id) {
    const x = S.setups.find((y) => y.id === id);
    const manual = S.broker.kind === "manual";
    const e = xpOf(x), risk = riskNow(), q = qtyFor(x.size, risk);
    const beTxt = e.beR > 0 ? `At +${e.beR}R ${S.broker.kind === "manual" ? "Edge tells you to move the stop to break-even" : "the stop moves to break-even"}.` : "No break-even in this plan.";
    const moods = [["calm", "😌 Calm"], ["focused", "🎯 Focused"], ["fomo", "😬 Afraid to miss it"], ["revenge", "😤 Want my money back"], ["bored", "🥱 Bored"]];
    const body = $("#modalBody");
    body.innerHTML = `<h3>${esc(mname(x.market))} ${x.dir.toUpperCase()} · ${x.g.grade}</h3>
      <p>Before you click: how do you feel <b>right now</b>? Be honest — this is your journal.</p>
      <div class="moods">${moods.map(([k, l]) => `<button type="button" data-mood="${k}">${l}</button>`).join("")}</div>
      ${S.broker.kind === "traderspost" ? `<p>Edge sends <b>${x.dir === "long" ? "BUY" : "SELL"} ${q ?? (x.size && x.size.qty)} ${esc(x.size && x.size.contract || "")}</b> ($${risk} risk) at market to your Tradovate account, with the stop at <b>${fx(x.sl)}</b> and the target at <b>${fx(x.entry + (x.dir === "short" ? -1 : 1) * e.tpR * Math.abs(x.entry - x.sl))}</b>. ${beTxt}</p>`
        : manual ? `<label class="f">Your fill price (leave empty if ${fx(x.entry)})<input id="fill" inputmode="decimal" placeholder="${fx(x.entry)}"></label>
        <p class="muted">${q != null ? `<b>${q} ${esc(x.size.contract)}</b> for $${risk} risk. ` : ""}Place it in TradingView with stop <b>${fx(x.sl)}</b> and take-profit at ${e.tpR}R. ${beTxt}</p>`
        : `<p class="muted">Edge places a market order with your stop at <b>${fx(x.sl)}</b> and take-profit at ${e.tpR}R, sized for $${risk} risk. ${beTxt}</p>`}
      <p class="muted">I accept the stop. I won't move it further away. I won't move the target.</p>
      <div class="row"><button class="btn good" type="button" id="confirmTake" disabled>Confirm</button><button class="btn" value="cancel">Cancel</button></div>`;
    let mood = "";
    body.querySelectorAll("[data-mood]").forEach((b) => b.addEventListener("click", () => {
      mood = b.dataset.mood; body.querySelectorAll("[data-mood]").forEach((y) => y.classList.toggle("on", y === b)); $("#confirmTake").disabled = false;
    }));
    $("#confirmTake").addEventListener("click", async () => {
      $("#confirmTake").disabled = true;
      const r = await act({ action: "take", setupId: id, emotion: mood, entry: manual ? $("#fill").value : undefined, riskUSD: risk }, "Trade on. Hands off — the rules manage it now.");
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
      ${S.broker.kind === "traderspost" || S.broker.kind === "oanda" ? `<p class="muted">Edge sends the exit orders to your account now.</p>` : ""}
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
    const manual = t.source === "manual" || t.source === "traderspost";
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
    const head = `<section class="card"><div class="row between"><h2 style="margin:0">Weekly fundamentals</h2>
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
        <div class="stat"><small>Hit the target</small><b>${st.targets}</b><small>each trade's own target</small></div>
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
    const tvCard = `<section class="card"><h2>TradingView setup</h2>
        <p class="muted" style="margin-top:0">TradingView doesn't let apps install scripts, so it's one copy-paste per script. Your secret is already inside.</p>
        <div class="grid2">
          <div class="stat"><small>London breakout — gold, crude, silver</small><b style="font-size:14px">5-minute charts: <code>MGC1!</code> · <code>MCL1!</code> · <code>SIL1!</code></b><button class="btn small primary" data-copypine="edge_london_breakout" style="margin-top:6px">Copy London script</button></div>
          <div class="stat"><small>Natural gas zones</small><b style="font-size:14px">1-hour chart, normal candles: <code>QG1!</code> or <code>MNG1!</code></b><button class="btn small primary" data-copypine="edge_natgas_zones" style="margin-top:6px">Copy gas zones script</button></div>
          <div class="stat"><small>Supply &amp; demand (the original)</small><b style="font-size:14px">5-minute charts: gold, crude, gas</b><button class="btn small" data-copypine="edge_supply_demand" style="margin-top:6px">Copy S&amp;D script</button></div>
        </div>
        <ol class="steps">
          <li>Tap a <b>Copy</b> button above, then on a computer open TradingView on the chart it says.</li>
          <li>Bottom panel → <b>Pine Editor</b> → <b>delete everything already there</b> (Ctrl+A / ⌘A, then Delete), paste → <b>Save</b> → <b>Add to chart</b>.</li>
          <li><b>Alert</b> (clock icon) → Condition: the Edge script → <b>alert() function calls only</b> → Notifications → tick <b>Webhook URL</b> and paste the address below → Create.</li>
          <li>One alert per chart. The first candle shows up in Edge's log.</li>
        </ol>
        <div class="row" style="margin-top:12px"><button class="btn small" id="copyHook">Copy webhook URL</button></div>
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">Webhook URL: <code>${esc(location.origin)}/api/hook</code>${S.hookReady ? "" : ` · <span class="err">EDGE_HOOK_SECRET isn't set in Vercel yet</span>`}</p>
      </section>`;
    return `${notifCard}${tvCard}<section class="card"><h2>Connections</h2>
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
        ${n("beAtR", "Supply & demand: stop to break-even at (R)", "0.1")}${n("tpAtR", "Supply & demand: take profit at (R)", "0.1")}${n("beOffsetR", "Break-even buffer (R)", "0.01")}
        <label class="f">Target moved further away<select data-set="enforceTP"><option value="true" ${s.enforceTP ? "selected" : ""}>Put it back (greed check)</option><option value="false" ${s.enforceTP ? "" : "selected"}>Allow</option></select></label>
        <label class="f">15m structure breaks against me<select data-set="structureExit">${["notify", "close", "off"].map((v) => `<option ${s.structureExit === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="f">Big news & stop not at BE<select data-set="newsOpenTrade">${["warn", "close"].map((v) => `<option ${s.newsOpenTrade === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      </div></section>
      <section class="card"><h2>Risk & discipline</h2><div class="grid2">
        ${n("riskPct", "Risk per trade (%)", "0.1")}${n("accountSize", "Account size (manual mode)", "100")}
        ${n("maxTradesPerDay", "Max trades per day")}${n("maxDailyLossR", "Stop for the day after losing (R)", "0.5")}
        ${n("cooldownMin", "Cool-down after a loss (min)", "5")}${n("maxOpen", "Max open trades")}
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
        <div class="row" style="margin-top:12px"><button class="btn primary" id="saveRules">Save rules</button></div>
        <p class="muted">Changing rules is allowed — but never in the middle of a trade, and never right after a loss.</p></section>
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
    v.querySelectorAll("[data-take]").forEach((b) => b.addEventListener("click", () => takeDialog(b.dataset.take)));
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
    if (tab === "learn") bindLearn(); else stopPlay();
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
    v.querySelectorAll("[data-testalert]").forEach((b) => b.addEventListener("click", async () => { const r = await act({ action: "testAlert" }); if (r) toast(r.telegram ? "Sent — check your devices." : "Logged. No device has notifications on yet."); }));
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
  setInterval(() => { if (token && !document.hidden && !$("#modal").open && !["bias", "rules", "coach", "learn"].includes(tab)) refresh(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && token) refresh(); });
})();
