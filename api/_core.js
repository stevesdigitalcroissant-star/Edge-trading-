// The app's brain: the TradingView webhook, the dashboard actions and the
// trade manager. api/hook.js, api/app.js and server.js are thin wrappers.
const crypto = require("crypto");
const { MARKETS, marketOf, BIAS_FACTORS, biasFromFactors, mergeSettings, DEFAULT_SETTINGS } = require("./_config");
const R = require("./_rules");
const { loadFeed, relevantEvents, blockingEvent } = require("./_news");
const { notify, subscribe, unsubscribe, vapid } = require("./_notify");
const { story } = require("./_story");
const { parts } = require("./_time");

const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const fx = (x) => (x == null ? "—" : Number(x) >= 100 ? Number(x).toFixed(2) : Number(x).toFixed(3));
const id = () => crypto.randomBytes(6).toString("hex");
const BAD_MOODS = { fomo: "FOMO", revenge: "revenge", bored: "boredom" };

// ---------- shared context

async function context(store, now = Date.now()) {
  const [saved, bias, tradesH, journalH, cooldownUntil, newsDoc] = await Promise.all([
    store.get("settings"), store.get("bias"), store.hgetall("trades"), store.hgetall("journal"), store.get("cooldown"),
    loadFeed(store, now).catch(() => ({ ok: false, events: [] })),
  ]);
  const settings = mergeSettings(saved);
  const open = Object.values(tradesH || {});
  const all = Object.values(journalH || {}).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const journal = all.filter((t) => !t.practice); // practice (replay) trades never count toward real limits or stats
  const practice = all.filter((t) => t.practice);
  const events = relevantEvents(newsDoc, now);
  return { now, settings, bias: bias || {}, open, journal, practice, cooldownUntil: cooldownUntil || 0, events, newsOk: newsDoc.ok !== false, newsError: newsDoc.error };
}

function gradeNow(setup, ctx) {
  const graded = R.gradeSetup(setup, {
    settings: ctx.settings, bias: ctx.bias, now: ctx.now,
    news: blockingEvent(ctx.events, setup.market, ctx.now, ctx.settings),
  });
  const guard = R.guardrails(ctx);
  const take = R.canTake({ graded, setup, guard, history: [...ctx.journal, ...ctx.open], settings: ctx.settings, open: ctx.open });
  return { ...graded, take };
}

// ---------- TradingView webhook

async function handleHook(store, broker, body, now = Date.now()) {
  let msg = body;
  if (typeof msg === "string") { try { msg = JSON.parse(msg); } catch { return { status: 400, json: { error: "Send the alert message as JSON" } }; } }
  if (!msg || typeof msg !== "object") return { status: 400, json: { error: "Empty alert" } };
  const secret = process.env.EDGE_HOOK_SECRET;
  if (!secret || msg.secret !== secret) return { status: 401, json: { error: "Wrong webhook secret" } };

  const market = marketOf(msg.symbol || msg.tv);
  if (!market) return { status: 200, json: { ignored: `Not gold, crude or natural gas: ${msg.symbol}` } };

  if (msg.type === "bar") {
    const mark = { price: num(msg.price), high: num(msg.high), low: num(msg.low), time: now, symbol: msg.symbol, bos15: msg.bos15 || "" };
    if (mark.price == null) return { status: 400, json: { error: "bar without price" } };
    await store.set(`price:${market}`, mark);
    const res = await syncTrades(store, broker, { now, market, mark, force: true });
    return { status: 200, json: { ok: true, ...res } };
  }

  if (msg.type === "setup") {
    const s = mergeSettings(await store.get("settings"));
    const setup = {
      id: id(), market, symbol: msg.symbol, tv: msg.tv, dir: msg.dir === "short" ? "short" : "long",
      entry: num(msg.entry), sl: num(msg.sl), tp: num(msg.tp), trend4h: num(msg.trend4h),
      zoneFresh: msg.zoneFresh !== false && msg.zoneFresh !== "false",
      bos15: msg.bos15 !== false && msg.bos15 !== "false",
      close5: msg.close5 !== false && msg.close5 !== "false",
      stopOk: msg.stopOk !== false && msg.stopOk !== "false",
      roomR: num(msg.roomR), zoneTop: num(msg.zoneTop), zoneBot: num(msg.zoneBot),
      lvl4h: num(msg.lvl4h), lvl15: num(msg.lvl15), lvl5: num(msg.lvl5), opp: num(msg.opp),
      sweep: msg.sweep === undefined ? undefined : msg.sweep === true || msg.sweep === "true", sweepName: String(msg.sweepName || "").slice(0, 40), sweepLvl: num(msg.sweepLvl),
      at: now, expires: now + s.setupExpiryMin * 60e3, status: "open",
    };
    if (setup.entry == null || setup.sl == null || setup.entry === setup.sl) return { status: 400, json: { error: "setup needs entry and sl" } };
    await store.hset("setups", setup.id, setup);
    await pruneSetups(store, now);
    const ctx = await context(store, now);
    const g = gradeNow(setup, ctx);
    setup.gradeAtAlert = g.grade;
    await store.hset("setups", setup.id, setup);
    const name = MARKETS[market].name;
    const head = `${g.grade} ${setup.dir.toUpperCase()} ${name} @ ${fx(setup.entry)}  SL ${fx(setup.sl)}`;
    const text = g.take.ok
      ? `✅ ${g.grade} ${MARKETS[market].name} ${setup.dir === "long" ? "BUY" : "SELL"}: ${story(setup, s).short}. Tap to see the picture — valid ${s.setupExpiryMin} min.`
      : `⛔ ${head}\nSkip it: ${g.take.why[0]}`;
    await notify(store, text, g.take.ok ? "setup" : "skip");
    return { status: 200, json: { ok: true, grade: g.grade, takeable: g.take.ok } };
  }

  return { status: 400, json: { error: `Unknown alert type: ${msg.type}` } };
}

async function pruneSetups(store, now) {
  const all = await store.hgetall("setups");
  for (const [k, v] of Object.entries(all)) if (!v || now - v.at > 3 * 864e5) await store.hdel("setups", k);
}

// ---------- news reminders (sent once per event, ahead of the no-trade window)

async function newsReminders(store, ctx) {
  const s = ctx.settings;
  const clock = (t) => { const p = parts(t, s.tz); return `${p.hh}:${String(p.mm).padStart(2, "0")}`; };
  for (const e of ctx.events) {
    const lead = e.time - ctx.now;
    if (!e.block || lead <= 0 || lead > (s.newsBeforeMin + 15) * 60e3) continue;
    if (await store.hget("newsSent", e.id)) continue;
    await store.hset("newsSent", e.id, ctx.now);
    const names = e.markets.map((m) => (MARKETS[m] ? MARKETS[m].name : m)).join(", ");
    await notify(store, `📰 ${e.title} at ${clock(e.time)} (in ${Math.round(lead / 60e3)} min). No new ${names} trades from ${clock(e.time - s.newsBeforeMin * 60e3)} to ${clock(e.time + s.newsAfterMin * 60e3)}.`, "news");
  }
}

// ---------- trade manager

// Runs on every TradingView heartbeat, every dashboard refresh and (locally) on a timer.
async function syncTrades(store, broker, { now = Date.now(), market = null, mark = null, force = false } = {}) {
  const last = (await store.get("lastSync")) || 0;
  if (!force && now - last < 4000) return { skipped: true };
  await store.set("lastSync", now);
  const ctx = await context(store, now);
  const s = ctx.settings;
  const out = { managed: 0, closed: 0, actions: [] };
  await newsReminders(store, ctx).catch(() => {});

  if (broker.kind === "oanda") {
    let live;
    try { live = await broker.openTrades(); } catch (e) { return { error: e.message }; }
    const liveIds = new Set(live.map((t) => t.brokerId));

    // closed since last time → journal
    for (const t of ctx.open.filter((x) => x.source === broker.kind && !liveIds.has(x.brokerId))) {
      try {
        const b = await broker.trade(t.brokerId);
        if (b.state === "CLOSED") { await recordClose(store, t, b.exit, b.closedAt || now, b.pnl, s); out.closed++; }
      } catch {}
    }

    const prices = await broker.prices(live.map((t) => t.instrument)).catch(() => ({}));
    for (const b of live) {
      const key = `${broker.kind}:${b.brokerId}`;
      let t = ctx.open.find((x) => x.id === key);
      const mkt = marketOf(b.instrument.replace("_", "")); // XAU_USD → gold, WTICO_USD/BCO_USD → crude, NATGAS_USD → natgas
      if (!t) {
        t = { id: key, source: broker.kind, brokerId: b.brokerId, market: mkt, instrument: b.instrument, dir: b.dir, grade: "unplanned",
          entry: b.entry, initialSL: b.currentSL, openedAt: b.openedAt || now, maxR: 0, ruleBreaks: [], notified: {} };
        await notify(store, `👀 New ${MARKETS[mkt] ? MARKETS[mkt].name : b.instrument} trade spotted that didn't come from an Edge setup — logged as UNPLANNED.`, "warn");
      }
      Object.assign(t, { units: b.units, currentSL: b.currentSL, tp: b.tp });
      if (t.initialSL == null && b.currentSL != null) t.initialSL = b.currentSL;
      const p = prices[b.instrument];
      if (p && t.initialSL != null) {
        const m = { price: t.dir === "short" ? p.ask : p.bid };
        if (mark && market === t.market) { m.high = mark.high; m.low = mark.low; }
        await manage(store, broker, t, m, ctx, out, mark && market === t.market ? mark.bos15 : "");
      } else if (t.initialSL == null) {
        await once(store, t, "nostop", "⚠️ Trade with NO stop loss. Put one in now.");
      }
      out.managed++;
      await store.hset("trades", t.id, t);
    }
    return out;
  }

  // manual mode: prices come from the TradingView heartbeat
  for (const t of ctx.open.filter((x) => x.source === "manual" || x.source === "traderspost")) {
    const m = market === t.market && mark ? mark : await store.get(`price:${t.market}`);
    if (!m || now - m.time > 15 * 60e3) continue;
    const k = R.sign(t.dir);
    const stop = t.currentSL ?? t.initialSL;
    const hitStop = k > 0 ? (m.low ?? m.price) <= stop : (m.high ?? m.price) >= stop;
    const hitTP = t.tp != null && (k > 0 ? (m.high ?? m.price) >= t.tp : (m.low ?? m.price) <= t.tp);
    if (hitStop || hitTP) {
      await recordClose(store, t, hitStop ? stop : t.tp, now, null, s, " (auto-detected from the chart — edit if your fill was different)");
      out.closed++;
      continue;
    }
    await manage(store, broker, t, m, ctx, out, market === t.market && mark ? mark.bos15 : "");
    out.managed++;
    await store.hset("trades", t.id, t);
  }
  return out;
}

async function once(store, t, code, text, kind = "warn") {
  t.notified = t.notified || {};
  if (t.notified[code]) return false;
  t.notified[code] = Date.now();
  await notify(store, text, kind);
  return true;
}

async function manage(store, broker, t, mark, ctx, out, bos15) {
  const s = ctx.settings;
  const name = MARKETS[t.market] ? MARKETS[t.market].name : t.instrument;
  const ev = R.evaluateTrade(t, mark, s);
  t.r = ev.r; t.maxR = ev.maxR; t.lastPrice = mark.price; t.lastPriceAt = ctx.now;
  if (ev.beDone && !t.beMoved && t.currentSL != null) t.beMoved = true;
  const routed = t.source === "traderspost" && broker.kind === "traderspost"; // Edge sends the changes to Tradovate
  const manual = !routed && t.source !== "oanda";
  const k = R.sign(t.dir);
  const ticker = t.ticker || t.symbol;

  for (const a of ev.actions) {
    if (a.ruleBreak && !(t.ruleBreaks || []).includes(a.code || a.type)) t.ruleBreaks = [...(t.ruleBreaks || []), a.code || a.type];
    if (a.type === "warn") { await once(store, t, a.code, `⚠️ ${name}: ${a.text}`); continue; }
    if (a.type === "moveSL") {
      if (routed) {
        if (t.notified && t.notified.be) continue;
        try {
          await broker.breakeven(ticker);
          t.currentSL = t.entry; t.beMoved = true;
          await once(store, t, "be", `🔒 ${name}: +${s.beAtR}R reached — stop moved to break-even (${fx(t.entry)}) on Tradovate. This trade can't lose now.`, "action");
        } catch (e) {
          await once(store, t, "be", `❗ ${name}: +${s.beAtR}R reached but the break-even order failed (${e.message}). Move your stop to ${fx(t.entry)} yourself NOW.`, "action");
        }
        continue;
      }
      if (manual) {
        await once(store, t, "be", `🔒 ${name}: +${s.beAtR}R reached. Move your stop to ${fx(a.price)} (break-even) NOW, then tap "Done" in Edge.`, "action");
        continue;
      }
      // price already slipped back through break-even → the rule says get out now
      if (k * (mark.price - a.price) <= 0) {
        await broker.close(t.brokerId).catch(() => {});
        await notify(store, `🔒 ${name}: touched +${s.beAtR}R and came back — closed at break-even, as your rule says.`, "action");
      } else {
        try {
          await broker.setOrders(t.brokerId, t.instrument, { sl: a.price });
          t.currentSL = a.price; t.beMoved = true;
          await notify(store, `🔒 ${name}: ${a.text} Stop now ${fx(a.price)}.`, "action");
        } catch (e) { await once(store, t, "befail", `❗ ${name}: couldn't move the stop (${e.message}). Move it to ${fx(a.price)} yourself.`); }
      }
      out.actions.push({ trade: t.id, ...a });
      continue;
    }
    if (a.type === "setTP") {
      if (manual || routed) { await once(store, t, `tp${a.ruleBreak ? "w" : ""}`, `🎯 ${name}: ${a.text} Set it at ${fx(a.price)}.`, "action"); continue; }
      try {
        await broker.setOrders(t.brokerId, t.instrument, { tp: a.price });
        t.tp = a.price;
        await notify(store, `🎯 ${name}: ${a.text} (${fx(a.price)})`, "action");
      } catch (e) { await once(store, t, "tpfail", `❗ ${name}: couldn't set the take-profit (${e.message}).`); }
      out.actions.push({ trade: t.id, ...a });
    }
  }

  // 15m structure turned against the trade
  const against = (t.dir === "long" && bos15 === "down") || (t.dir === "short" && bos15 === "up");
  if (against && s.structureExit !== "off") {
    if (s.structureExit === "close" && !manual) {
      await (routed ? broker.exit(ticker) : broker.close(t.brokerId)).catch(() => {});
      await notify(store, `🧱 ${name}: 15m structure broke against you at ${ev.r}R — closed, as your settings say.`, "action");
    } else {
      await once(store, t, `bos${Math.floor(ctx.now / 9e5)}`, `🧱 ${name}: 15m structure just broke AGAINST your ${t.dir} (${ev.r}R now). Your plan: ${t.beMoved ? "stop is at break-even, let it work" : "consider closing — the reason for the trade is gone"}.`);
    }
  }

  // big news coming while the trade can still lose
  if (!t.beMoved) {
    const soon = ctx.events.find((e) => e.block && e.markets.includes(t.market) && e.time > ctx.now && e.time - ctx.now <= s.newsBeforeMin * 60e3);
    if (soon) {
      if (s.newsOpenTrade === "close" && !manual) {
        if (await once(store, t, `news:${soon.id}`, `📰 ${name}: ${soon.title} in ${Math.round((soon.time - ctx.now) / 60e3)} min — closing before it (${ev.r}R).`, "action")) await (routed ? broker.exit(ticker) : broker.close(t.brokerId)).catch(() => {});
      } else {
        await once(store, t, `news:${soon.id}`, `📰 ${name}: ${soon.title} in ${Math.round((soon.time - ctx.now) / 60e3)} min and your stop isn't at break-even yet (${ev.r}R). Decide now: close or accept the risk.`);
      }
    }
  }
}

async function recordClose(store, t, exit, closedAt, pnl, s, note = "") {
  const resultR = exit != null && t.initialSL != null ? R.round(R.rAt(t, exit)) : null;
  const j = { ...t, exit, closedAt, pnl, resultR, exitReason: exit != null ? R.exitReason(t, exit, s) + note : "unknown" };
  delete j.notified;
  await store.hset("journal", t.id, j);
  await store.hdel("trades", t.id);
  const name = MARKETS[t.market] ? MARKETS[t.market].name : t.instrument;
  const mood = resultR == null ? "" : resultR > 0.1 ? "💰" : resultR < -0.1 ? "🩹 Loss taken cleanly — that's the job. Cool-down started." : "🛡️ Break-even — the rule protected you.";
  await notify(store, `${name} ${t.dir} closed: ${resultR == null ? "?" : (resultR > 0 ? "+" : "") + resultR + "R"} (${j.exitReason}). ${mood}`, "closed");
  // tell the phone when the day is over (trade count or daily loss limit)
  const ctx = await context(store, closedAt);
  const g = R.guardrails({ ...ctx, open: ctx.open.filter((x) => x.id !== t.id) });
  const dayOver = g.reasons.find((r) => /until tomorrow/.test(r));
  if (dayOver) await notify(store, `🔒 ${dayOver} Close the charts.`, "locked");
}

// ---------- dashboard

function stats(journal) {
  const done = journal.filter((t) => t.resultR != null);
  const sum = (a) => R.round(a.reduce((x, t) => x + t.resultR, 0));
  const by = (f) => { const a = done.filter(f); return { n: a.length, totalR: sum(a), winRate: a.length ? Math.round((a.filter((t) => t.resultR > 0.1).length / a.length) * 100) : null }; };
  return {
    n: done.length,
    totalR: sum(done),
    avgR: done.length ? R.round(sum(done) / done.length) : null,
    winRate: done.length ? Math.round((done.filter((t) => t.resultR > 0.1).length / done.length) * 100) : null,
    breakEvens: done.filter((t) => /break-even/.test(t.exitReason || "")).length,
    targets: done.filter((t) => /target/.test(t.exitReason || "")).length,
    ruleBreaks: done.filter((t) => (t.ruleBreaks || []).length).length,
    aPlus: by((t) => t.grade === "A+"),
    other: by((t) => t.grade !== "A+" && t.grade !== "unplanned"),
    unplanned: by((t) => t.grade === "unplanned"),
  };
}

async function state(store, broker, now = Date.now()) {
  if (broker.kind === "oanda") await syncTrades(store, broker, { now }).catch(() => {});
  const ctx = await context(store, now);
  await newsReminders(store, ctx).catch(() => {});
  const setupsH = await store.hgetall("setups");
  const setups = Object.values(setupsH).sort((a, b) => b.at - a.at).slice(0, 25).map((x) => ({ ...x, g: gradeNow(x, ctx), size: R.orderSize(x, ctx.settings), story: story(x, ctx.settings) }));
  const prices = {};
  for (const m of Object.keys(MARKETS)) prices[m] = await store.get(`price:${m}`);
  let account = null;
  if (broker.kind === "oanda") account = await broker.account().catch((e) => ({ error: e.message }));
  const open = ctx.open.map((t) => ({ ...t, plan: t.initialSL != null ? R.plan(t, ctx.settings) : null }));
  return {
    now, settings: ctx.settings, defaults: DEFAULT_SETTINGS, markets: Object.fromEntries(Object.entries(MARKETS).map(([k, v]) => [k, { name: v.name, unit: v.unit }])),
    biasFactors: BIAS_FACTORS, bias: ctx.bias, setups, open, journal: ctx.journal.slice(0, 200), stats: stats(ctx.journal),
    practice: ctx.practice.slice(0, 200), practiceStats: stats(ctx.practice), coach: { ready: !!process.env.ANTHROPIC_API_KEY, session: await store.get("coach") },
    share: R.aPlusShare([...ctx.journal, ...ctx.open]), guard: R.guardrails(ctx),
    news: { ok: ctx.newsOk, error: ctx.newsError, events: ctx.events.filter((e) => e.time > now - 2 * 3600e3) },
    prices, log: await store.lrange("log", 40),
    broker: { kind: broker.kind, label: broker.label, account },
    push: { publicKey: (await vapid(store).catch(() => null) || {}).publicKey || null, devices: Object.values(await store.hgetall("push")).map((d) => ({ label: d.label, added: d.added })) },
    storage: store.kind, hookReady: !!process.env.EDGE_HOOK_SECRET, telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
}

async function take(store, broker, { setupId, emotion, entry: myEntry }, now = Date.now()) {
  const setup = await store.hget("setups", setupId);
  if (!setup) throw new Error("Setup not found");
  if (BAD_MOODS[emotion]) {
    await store.set("cooldown", now + 15 * 60e3);
    await notify(store, `🧘 Skipped a trade because of ${BAD_MOODS[emotion]}. 15-minute break started. That's discipline.`, "skip");
    throw new Error(`Trading on ${BAD_MOODS[emotion]} is how the account got hurt before. 15-minute break — walk away from the screen.`);
  }
  const ctx = await context(store, now);
  const g = gradeNow(setup, ctx);
  if (!g.take.ok) throw new Error(g.take.why.join(" "));
  const s = ctx.settings;
  const k = R.sign(setup.dir);
  const base = { id: "", market: setup.market, dir: setup.dir, grade: g.grade, setupId, emotion: emotion || "calm", maxR: 0, ruleBreaks: [], notified: {}, openedAt: now };

  if (broker.kind === "manual" || broker.kind === "traderspost") {
    const routed = broker.kind === "traderspost";
    // routed: the order goes out at market now — check the latest chart price for chasing
    const hb = routed ? await store.get(`price:${setup.market}`) : null;
    const entry = num(myEntry) ?? (hb && now - hb.time < 6 * 60e3 ? hb.price : setup.entry);
    if (k * (entry - setup.sl) <= 0) throw new Error("That entry is on the wrong side of the stop.");
    const risk = Math.abs(entry - setup.sl);
    if (k * (entry - setup.entry) / Math.abs(setup.entry - setup.sl) > s.maxChaseR) throw new Error(`Price ran more than ${s.maxChaseR}R past the entry. No chasing — wait for the next setup.`);
    const size = R.orderSize(setup, s, entry);
    if (size.kind === "futures" && size.qty < 1) throw new Error(`One ${size.contract} contract would risk $${size.riskPerContract}, more than your $${size.riskUSD} limit. Skip this one${size.contract === "GC" || size.contract === "CL" || size.contract === "NG" || size.contract === "QG" ? " — or trade the micro contract" : ""}.`);
    const riskUSD = size.totalRisk;
    const tp = entry + k * s.tpAtR * risk;
    if (routed) {
      if (size.kind !== "futures") throw new Error("Sending orders through TradersPost is set up for futures (MGC, MCL, QG…). Use a futures chart.");
      await broker.order({ ticker: setup.symbol, dir: setup.dir, qty: size.qty, sl: setup.sl, tp, price: entry, ref: setupId });
    }
    const t = { ...base, id: `${routed ? "tp" : "manual"}:${id()}`, source: routed ? "traderspost" : "manual", symbol: setup.symbol, ticker: setup.symbol, entry, initialSL: setup.sl, currentSL: setup.sl, tp, units: size.qty, unitLabel: size.unit, contract: size.contract || null, riskUSD };
    if (routed) await notify(store, `▶️ Order sent: ${setup.dir === "long" ? "BUY" : "SELL"} ${size.qty} ${size.contract} · SL ${fx(setup.sl)} · TP ${fx(tp)}. Hands off — Edge moves the stop to break-even at +${s.beAtR}R.`, "action");
    await store.hset("trades", t.id, t);
    await store.hset("setups", setupId, { ...setup, status: "taken" });
    return { trade: t };
  }

  const acct = await broker.account();
  const riskUSD = await broker.toUSD(acct.balance * s.riskPct / 100, acct.currency);
  const instrument = MARKETS[setup.market].instrument(setup.symbol || "");
  const px = (await broker.prices([instrument]))[instrument];
  if (!px) throw new Error(`No live price for ${instrument}`);
  const entryNow = setup.dir === "short" ? px.bid : px.ask;
  if (k * (entryNow - setup.sl) <= 0) throw new Error("Price is already past the stop — the setup failed. Skip it.");
  const chased = (k * (entryNow - setup.entry)) / Math.abs(setup.entry - setup.sl);
  if (chased > s.maxChaseR) throw new Error(`Price already ran ${R.round(chased)}R past the entry. No chasing — wait for the next setup.`);
  const units = R.sizeUnits(riskUSD, entryNow, setup.sl);
  const tpGuess = entryNow + k * s.tpAtR * Math.abs(entryNow - setup.sl);
  const fill = await broker.marketOrder({ instrument, dir: setup.dir, units, sl: setup.sl, tp: tpGuess });
  const tp = fill.price + k * s.tpAtR * Math.abs(fill.price - setup.sl);
  if (Math.abs(tp - tpGuess) > 1e-9) await broker.setOrders(fill.brokerId, instrument, { tp }).catch(() => {});
  const t = { ...base, id: `${broker.kind}:${fill.brokerId}`, source: broker.kind, brokerId: fill.brokerId, instrument, entry: fill.price, initialSL: setup.sl, currentSL: setup.sl, tp, units: fill.units, riskUSD };
  await store.hset("trades", t.id, t);
  await store.hset("setups", setupId, { ...setup, status: "taken" });
  await notify(store, `▶️ ${MARKETS[setup.market].name} ${setup.dir} opened @ ${fx(fill.price)} · SL ${fx(setup.sl)} · BE at ${s.beAtR}R · TP ${fx(tp)} (${s.tpAtR}R). Hands off — Edge manages it.`, "action");
  return { trade: t };
}

async function action(store, broker, body, now = Date.now()) {
  const a = body.action;
  if (a === "take") return take(store, broker, body, now);
  if (a === "skip") {
    const s = await store.hget("setups", body.setupId);
    if (s) await store.hset("setups", s.id, { ...s, status: "skipped", skipReason: body.reason || "" });
    return { ok: true };
  }
  if (a === "bias") {
    if (!BIAS_FACTORS[body.market]) throw new Error("Unknown market");
    const answers = {};
    for (const f of BIAS_FACTORS[body.market]) answers[f.id] = Math.max(-1, Math.min(1, Number((body.answers || {})[f.id]) || 0));
    const b = (await store.get("bias")) || {};
    b[body.market] = { ...biasFromFactors(answers), answers, note: String(body.note || "").slice(0, 500), updated: now };
    await store.set("bias", b);
    return { ok: true, bias: b[body.market] };
  }
  if (a === "settings") {
    const cur = mergeSettings(await store.get("settings"));
    const p = body.patch || {};
    const nums = ["riskPct", "accountSize", "beAtR", "beOffsetR", "tpAtR", "maxTradesPerDay", "maxDailyLossR", "cooldownMin", "maxOpen", "minAPlusShare", "newsBeforeMin", "newsAfterMin", "setupExpiryMin", "maxChaseR", "coachIdleSec", "coachTradeSec", "coachDailyChecks"];
    for (const k of nums) if (p[k] != null && Number.isFinite(Number(p[k]))) cur[k] = Number(p[k]);
    if (cur.riskPct > 3) throw new Error("Risk per trade above 3% isn't allowed here. That's the greed talking.");
    if (cur.beAtR <= 0 || cur.tpAtR <= cur.beAtR) throw new Error("Take-profit must be beyond the break-even trigger.");
    for (const k of ["enforceTP"]) if (typeof p[k] === "boolean") cur[k] = p[k];
    if (["warn", "close"].includes(p.newsOpenTrade)) cur.newsOpenTrade = p.newsOpenTrade;
    if (["notify", "close", "off"].includes(p.structureExit)) cur.structureExit = p.structureExit;
    if (typeof p.tz === "string" && p.tz) cur.tz = p.tz;
    if (p.notify) for (const k of Object.keys(cur.notify)) if (typeof p.notify[k] === "boolean") cur.notify[k] = p.notify[k];
    if (p.sessions) for (const m of Object.keys(MARKETS)) if (Array.isArray(p.sessions[m]) && p.sessions[m].every((x) => /^\d{1,2}:\d{2}$/.test(x))) cur.sessions[m] = p.sessions[m].slice(0, 2);
    await store.set("settings", cur);
    return { ok: true, settings: cur };
  }
  if (a === "manualOpen") {
    // log a trade you opened yourself (counts as unplanned)
    const market = body.market, dir = body.dir === "short" ? "short" : "long";
    const entry = num(body.entry), sl = num(body.sl);
    if (!MARKETS[market] || entry == null || sl == null || R.sign(dir) * (entry - sl) <= 0) throw new Error("Need market, direction, entry and a stop on the right side.");
    const s = mergeSettings(await store.get("settings"));
    const k = R.sign(dir);
    const t = { id: `manual:${id()}`, source: "manual", market, dir, grade: "unplanned", entry, initialSL: sl, currentSL: sl, tp: num(body.tp) ?? entry + k * s.tpAtR * Math.abs(entry - sl), units: num(body.units), openedAt: now, maxR: 0, ruleBreaks: [], notified: {} };
    await store.hset("trades", t.id, t);
    return { trade: t };
  }
  if (a === "beDone") {
    const t = await store.hget("trades", body.tradeId);
    if (!t) throw new Error("Trade not found");
    const s = mergeSettings(await store.get("settings"));
    t.currentSL = R.plan(t, s).beStop; t.beMoved = true;
    await store.hset("trades", t.id, t);
    return { ok: true };
  }
  if (a === "editTrade") {
    const t = await store.hget("trades", body.tradeId);
    if (!t || t.source !== "manual") throw new Error("Only manual trades can be edited");
    const e = num(body.entry);
    if (e != null && R.sign(t.dir) * (e - t.initialSL) > 0) t.entry = e;
    await store.hset("trades", t.id, t);
    return { ok: true };
  }
  if (a === "close") {
    const t = await store.hget("trades", body.tradeId);
    if (!t) throw new Error("Trade not found");
    if (t.source === "manual" || t.source === "traderspost") {
      if (t.source === "traderspost" && broker.kind === "traderspost") await broker.exit(t.ticker || t.symbol);
      const exit = num(body.exit) ?? (t.source === "traderspost" ? t.lastPrice : null);
      if (exit == null) throw new Error("Enter your exit price");
      await recordClose(store, t, exit, now, null, mergeSettings(await store.get("settings")), t.source === "traderspost" ? " (sent to Tradovate — correct the exit price if needed)" : "");
    } else {
      await broker.close(t.brokerId);
      await syncTrades(store, broker, { now, force: true });
    }
    return { ok: true };
  }
  if (a === "note") {
    const j = await store.hget("journal", body.tradeId);
    if (!j) throw new Error("Trade not found");
    j.note = String(body.note || "").slice(0, 1000);
    if (body.exit != null && num(body.exit) != null && (j.source === "manual" || /^coach/.test(j.source || ""))) {
      j.exit = num(body.exit);
      j.resultR = R.round(R.rAt(j, j.exit));
      j.exitReason = R.exitReason(j, j.exit, mergeSettings(await store.get("settings")));
    }
    await store.hset("journal", j.id, j);
    return { ok: true };
  }
  if (a === "testAlert") {
    const ok = await notify(store, "👋 Edge is connected. Only A+ from here.", "info");
    return { ok, telegram: ok };
  }
  if (a === "pushSubscribe") { await subscribe(store, body.subscription, body.label); return { ok: true }; }
  if (a === "pushUnsubscribe") { await unsubscribe(store, body.endpoint); return { ok: true }; }
  throw new Error(`Unknown action: ${a}`);
}

// Single-user sign-in: the session token is an HMAC of the password.
function sessionToken() {
  const pw = process.env.EDGE_PASSWORD || "";
  return pw ? crypto.createHmac("sha256", pw).update("edge-session-v1").digest("hex") : "";
}
function authorized(headers) {
  const want = sessionToken();
  const got = String(headers.authorization || "").replace(/^Bearer\s+/i, "");
  return !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
function login(password) {
  const pw = process.env.EDGE_PASSWORD || "";
  if (!pw) throw new Error("Set EDGE_PASSWORD in the environment first.");
  const a = crypto.createHash("sha256").update(String(password || "")).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new Error("Wrong password");
  return sessionToken();
}

module.exports = { handleHook, syncTrades, newsReminders, state, action, take, login, authorized, context, gradeNow, stats };
