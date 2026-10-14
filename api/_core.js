// The app's brain: the TradingView webhook, the dashboard actions and the
// trade manager. api/hook.js, api/app.js and server.js are thin wrappers.
const crypto = require("crypto");
const { MARKETS, marketOf, BIAS_FACTORS, biasFromFactors, mergeSettings, DEFAULT_SETTINGS, STRATEGIES, strategyPlan } = require("./_config");
const R = require("./_rules");
const { loadFeed, relevantEvents, blockingEvent } = require("./_news");
const { notify, subscribe, unsubscribe, vapid } = require("./_notify");
const { story } = require("./_story");
const fundamentals = require("./_fundamentals");
const { parts } = require("./_time");

const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const fx = (x) => (x == null ? "—" : Number(x) >= 100 ? Number(x).toFixed(2) : Math.abs(Number(x)) < 0.1 ? Number(x).toFixed(7) : Math.abs(Number(x)) < 2 ? Number(x).toFixed(5) : Number(x).toFixed(3));
const rp = (x) => (x == null ? x : Math.round(x * 1e6) / 1e6); // computed prices without float dust
const id = () => crypto.randomBytes(6).toString("hex");
// brokers Edge sends orders to for you (Tradovate direct, or Tradovate through TradersPost); "manual" = you click yourself
const ROUTED = (b) => !!b && (b.kind === "tradovate" || b.kind === "traderspost");
const routedTo = (t, b) => ROUTED(b) && t.source === b.kind;
const Prop = require("../prop.js");
// ---------- your prop account + the tilt guard: the same maths the app shows, enforced here before any order goes out
async function propNow(store, ctx, now) {
  const cfg = await store.get("prop");
  if (!cfg || !cfg.enabled) return null;
  const acct = Prop.account(ctx.journal, cfg, now);
  const today = Prop.tradingDay(now), todays = ctx.journal.filter((t) => t.closedAt && Prop.tradingDay(t.closedAt) === today).sort((a, b) => b.closedAt - a.closedAt);
  const lastLoss = todays.find((t) => (t.resultR || 0) < -0.1);
  const auto = Prop.autopilot(acct, cfg, { base: cfg.baseRisk || 250, lastLossRisk: lastLoss ? lastLoss.riskUSD : null, minR: ctx.settings.minR });
  return { cfg, acct, auto };
}
function tilt(ctx, now, riskUSD) {
  const nyMin = (() => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(now)); return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value); })();
  const s = ctx.settings;
  if (s.sessionGuard !== false && !(nyMin >= 180 && nyMin < 660)) return { block: "Outside your hours (London open → New York morning, 03:00–11:00 New York). That's not your edge — wait for tomorrow's session." };
  const recent = [...ctx.journal, ...ctx.open].filter((t) => t.openedAt && now - t.openedAt < 30 * 60e3);
  if (recent.length >= 2) return { block: "Two trades in the last 30 minutes. Slow down — step away for a few minutes, the next setup will come." };
  const today = Prop.tradingDay(now), lastLoss = ctx.journal.filter((t) => t.closedAt && Prop.tradingDay(t.closedAt) === today && (t.resultR || 0) < -0.1).sort((a, b) => b.closedAt - a.closedAt)[0];
  if (lastLoss && lastLoss.riskUSD && riskUSD > lastLoss.riskUSD * 1.01) return { cap: lastLoss.riskUSD, why: `Sized down to $${lastLoss.riskUSD} — never bigger after a loss.` };
  return {};
}
const PRACTICE_STEPS = ["4H trend", "fresh zone", "liquidity taken", "15m break", "5m close"];
const BAD_MOODS = { fomo: "FOMO", revenge: "revenge", bored: "boredom" };

// ---------- shared context

async function context(store, now = Date.now()) {
  const [saved, bias, tradesH, journalH, cooldownUntil, newsDoc, ordersH] = await Promise.all([
    store.get("settings"), store.get("bias"), store.hgetall("trades"), store.hgetall("journal"), store.get("cooldown"),
    loadFeed(store, now).catch(() => ({ ok: false, events: [] })), store.hgetall("orders"),
  ]);
  const settings = mergeSettings(saved);
  const open = Object.values(tradesH || {});
  const all = Object.values(journalH || {}).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const journal = all.filter((t) => !t.practice); // practice (replay) trades never count toward real limits or stats
  const practice = all.filter((t) => t.practice);
  const events = relevantEvents(newsDoc, now);
  const waiting = Object.values(ordersH || {}).map((o) => o.trade).filter(Boolean); // limits placed, not filled yet
  return { now, settings, bias: bias || {}, open, waiting, journal, practice, cooldownUntil: cooldownUntil || 0, events, newsOk: newsDoc.ok !== false, newsError: newsDoc.error };
}

function gradeNow(setup, ctx) {
  const graded = R.gradeSetup(setup, {
    settings: ctx.settings, bias: ctx.bias, now: ctx.now,
    news: blockingEvent(ctx.events, setup.market, ctx.now, ctx.settings),
  });
  const busy = [...ctx.open, ...(ctx.waiting || [])]; // waiting limits count toward the daily cap, open trades and the one-per-group rule
  const guard = R.guardrails({ ...ctx, open: busy });
  const take = R.canTake({ graded, setup, guard, history: [...ctx.journal, ...busy], settings: ctx.settings, open: busy });
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
  if (!market) return { status: 200, json: { ignored: `Not a market Edge trades: ${msg.symbol}` } };

  if (msg.type === "bar") {
    const mark = { price: num(msg.price), high: num(msg.high), low: num(msg.low), time: now, symbol: msg.symbol, bos15: msg.bos15 || "",
      swing15Low: num(msg.swing15Low), swing15High: num(msg.swing15High), trendD: num(msg.trendD), trend4h: num(msg.trend4h), near: String(msg.near || "").slice(0, 80) };
    if (mark.price == null) return { status: 400, json: { error: "bar without price" } };
    await store.set(`price:${market}`, mark);
    const res = await syncTrades(store, broker, { now, market, mark, force: true });
    await gamePlan(store, now).catch(() => {});
    return { status: 200, json: { ok: true, ...res } };
  }

  if (msg.type === "setup") {
    const r = await createSetup(store, market, msg, now, { broker });
    if (r.error) return { status: 400, json: { error: r.error } };
    if (r.ignored) return { status: 200, json: { ignored: true, why: r.why } };
    return { status: 200, json: { ok: true, grade: r.grade, takeable: r.takeable, autoTrade: r.autoTrade ? r.autoTrade.id : null, ...(r.quiet ? { quiet: true } : {}) } };
  }

  if (msg.type === "plan") {
    const r = await createPlan(store, market, msg, now);
    if (r.error) return { status: 400, json: { error: r.error } };
    return { status: 200, json: { ok: true, legs: r.plan.legs.length } };
  }

  return { status: 400, json: { error: `Unknown alert type: ${msg.type}` } };
}

// Your own style for a London market (Learn → Style lab): stop as a share of the Asian box, target, break-even.
function withStyle(sp, s, market) {
  const st = sp && sp.strategy === "london" && s.style && s.style[market];
  if (!st) return sp;
  return { ...sp, tpR: st.tpR || sp.tpR, beR: st.beR ?? sp.beR, stopFrac: st.stopFrac || 1, mine: true };
}
const styleSl = (sp, dir, entry, hi, lo) => (sp.stopFrac && sp.stopFrac < 1 && hi > lo ? entry - R.sign(dir) * sp.stopFrac * (hi - lo) : null);

// A setup from the radar script: graded against your playbook, then on your phone with the exact order
// days since your last real trade (opened or closed); before the first one, since Edge first saw a setup
async function idleDays(store, ctx, now) {
  const times = [...ctx.journal, ...ctx.open].map((t) => Math.max(t.openedAt || 0, t.closedAt || 0)).filter(Boolean);
  let last = times.length ? Math.max(...times) : 0;
  if (!last) { last = (await store.get("activityStart")) || 0; if (!last) { await store.set("activityStart", now); last = now; } }
  return Math.max(0, (now - last) / 864e5);
}

async function radarSetup(store, market, msg, now, s) {
  const b = (x) => x === true || x === "true";
  const sd = msg.strategy === "sd";
  if (sd && market === "crude") return { ignored: true, why: "Crude is off for supply & demand — it lost money in every test." };
  const setup = { id: id(), market, source: sd ? "scanner" : "radar", strategy: sd ? "sd" : "playbook", symbol: msg.symbol, tv: msg.tv, dir: msg.dir === "short" ? "short" : "long",
    kind: String(msg.kind || "").slice(0, 20), mss: num(msg.mss), liq: sd ? num(msg.liq) : undefined, liqR: sd ? num(msg.liqR) : undefined, fill: sd ? num(msg.fill) : undefined, aplus: sd ? (msg.aplus == null ? null : msg.aplus === true || msg.aplus === "true") : undefined, vol: sd ? num(msg.vol) : undefined, tpMax: sd ? num(msg.tpMax) : undefined, rrMax: sd ? num(msg.rrMax) : undefined,
    entry: num(msg.entry), sl: num(msg.sl), tp: num(msg.tp), rr: num(msg.rr), zoneTop: num(msg.zoneTop), zoneBot: num(msg.zoneBot), trendD: num(msg.trendD), trend4h: num(msg.trend4h),
    withTrend: b(msg.withTrend), fromHtfZone: b(msg.fromHtfZone), fresh: msg.fresh !== false && msg.fresh !== "false", ...(sd ? {} : { liq: b(msg.liq) }), session: String(msg.session || ""), near: String(msg.near || "").slice(0, 80),
    at: now, expires: now + (num(msg.validMin) || s.radarValidMin || 180) * 60e3, status: "open" };
  const k = R.sign(setup.dir);
  if (setup.entry == null || setup.sl == null || setup.tp == null || k * (setup.entry - setup.sl) <= 0 || k * (setup.tp - setup.entry) <= 0) return { error: "setup needs entry, sl and tp on the right sides" };
  if (setup.rr == null) setup.rr = R.round(Math.abs(setup.tp - setup.entry) / Math.abs(setup.entry - setup.sl));
  await store.hset("setups", setup.id, setup);
  await pruneSetups(store, now);
  const ctx = await context(store, now);
  const g = gradeNow(setup, ctx);
  setup.grade = g.grade; await store.hset("setups", setup.id, setup);
  const name = MARKETS[market].name, side = setup.dir === "long" ? "BUY" : "SELL";
  // A+ setups always reach you; the others only once you've gone fallbackAfterDays without a trade (the account's
  // inactivity rule), so you still trade at least once every inactivityDays
  let pre = "";
  if (sd && setup.aplus === false) {
    const idle = await idleDays(store, ctx, now);
    setup.idleDays = Math.floor(idle); await store.hset("setups", setup.id, setup);
    if (idle < (s.fallbackAfterDays ?? 4)) {
      await notify(store, `👀 Not A+ — ${name} ${side} @ ${fx(setup.entry)} (${setup.kind}). Edge only alerts A+ setups until you've gone ${s.fallbackAfterDays ?? 4} days without a trade.`, "skip");
      return { setup, grade: g.grade, takeable: g.take.ok, why: g.take.why || [], quiet: true };
    }
    pre = `⏳ ${Math.floor(idle)} days without a trade (${s.inactivityDays ?? 7}-day rule) — not A+, but valid: `;
  }
  if (sd) await notify(store, g.take.ok
    ? `${pre}📣 ${setup.aplus ? "A+ " : ""}${name} ${side} limit ${fx(setup.entry)} · stop ${fx(setup.sl)} · target ${fx(setup.tp)} (${R.round(setup.rr, 1)}R) · 1H ${setup.dir === "long" ? "demand" : "supply"} ${fx(setup.zoneBot)}–${fx(setup.zoneTop)} · 4H ${setup.trend4h === R.sign(setup.dir) ? "with you" : setup.trend4h ? "against you" : "?"} · 5m MSS → ${setup.kind}${setup.liqR != null && setup.liqR < setup.rr ? ` · ⚠️ 5m swing at ${R.round(setup.liqR, 1)}R` : ""}${setup.rrMax != null && setup.rrMax > setup.rr + 0.25 ? ` · highest target ${fx(setup.tpMax)} (${R.round(setup.rrMax, 1)}R)` : ""}${setup.vol != null ? ` · volume ${R.round(setup.vol, 1)}× avg` : ""}${setup.fill != null ? ` · zone filled ${Math.round(setup.fill * 100)}%${setup.fill < 0.3 ? " ⚠️ under 30%" : ""}` : ""}. Tap to see it and send it.`
    : `👀 ${name} ${side} setup @ ${fx(setup.entry)} — not now: ${g.take.why[0]}`, g.take.ok ? "setup" : "skip");
  else await notify(store, g.take.ok
    ? `📣 ${g.grade} ${name} ${side} limit ${fx(setup.entry)} · stop ${fx(setup.sl)} · target ${fx(setup.tp)} (${R.round(setup.rr, 1)}R)${setup.liq ? " · liquidity taken" : ""}. Open Edge to confirm.`
    : `⛔ ${g.grade} ${name} ${side} @ ${fx(setup.entry)} — skip it: ${g.take.why[0]}`, g.take.ok ? "setup" : "skip");
  return { setup, grade: g.grade, takeable: g.take.ok, why: g.take.why || [] };
}

// The orders to place BEFORE the move, for a tested strategy:
//   london: the Asian range is set → a buy stop at its high and a sell stop at its low (whichever fills first
//           is the trade — then cancel the other), stop at the other side of the range.
//   ngzone: the nearest qualifying natural gas zones → a buy limit at the demand zone, a sell limit at the supply zone.
// Each leg comes with its contracts for your risk, the stop and the target, so you can place them and walk away.
async function createPlan(store, market, msg, now) {
  const s = mergeSettings(await store.get("settings"));
  const sp = withStyle(strategyPlan(msg.strategy, market), s, market);
  if (!sp) return { error: `No ${msg.strategy} strategy for ${market}` };
  const legs = [];
  for (const L of Array.isArray(msg.legs) ? msg.legs.slice(0, 4) : []) {
    const dir = L.dir === "short" ? "short" : "long", entry = num(L.entry);
    const sl = styleSl(sp, dir, entry, num(msg.rangeHi), num(msg.rangeLo)) ?? num(L.sl);
    if (entry == null || sl == null || R.sign(dir) * (entry - sl) <= 0) continue;
    const k = R.sign(dir), risk = Math.abs(entry - sl);
    const leg = { dir, entry, sl, tp: rp(entry + k * sp.tpR * risk), be: sp.beR > 0 ? rp(entry + k * sp.beR * risk) : null, order: msg.strategy === "london" ? "stop" : "limit", note: String(L.note || "").slice(0, 60) };
    leg.size = R.orderSize({ ...leg, market, symbol: msg.symbol }, s);
    legs.push(leg);
  }
  if (!legs.length) return { error: "plan without valid orders" };
  const plan = {
    market, strategy: msg.strategy, name: sp.name + (sp.mine ? " · your style" : ""), symbol: String(msg.symbol || "").slice(0, 30), at: now,
    expires: now + (num(msg.validMin) || 6 * 60) * 60e3, tpR: sp.tpR, beR: sp.beR, legs,
    rangeHi: num(msg.rangeHi), rangeLo: num(msg.rangeLo),
  };
  await store.set(`plan:${market}`, plan);
  const mkt = MARKETS[market].name;
  const qty = (z) => (z.kind === "futures" ? (z.qty >= 1 ? `${z.qty} ${z.contract}` : `0 ${z.contract} (stop too wide for your risk — skip)`) : `${R.round(z.qty, 2)} ${MARKETS[market].unit}`);
  const line = (L) => `${L.dir === "long" ? "BUY" : "SELL"} ${L.order.toUpperCase()} ${fx(L.entry)} · ${qty(L.size)} · SL ${fx(L.sl)} · TP ${fx(L.tp)}${L.be != null ? ` · BE at ${fx(L.be)}` : ""}`;
  const how = msg.strategy === "london" ? "Place both. When one fills, CANCEL the other." : "Place them; cancel at the end of the window if not filled.";
  await notify(store, `📋 ${mkt} ${sp.name} plan:\n${legs.map(line).join("\n")}\n${how}`, "setup");
  return { plan };
}

// A setup from the TradingView alert or read off the chart: store it, grade it, tell the phone.
async function createSetup(store, market, msg, now, { source = "alert", broker = null } = {}) {
  const s = mergeSettings(await store.get("settings"));
  if (msg.strategy === "playbook" || msg.strategy === "sd") return radarSetup(store, market, msg, now, s);
  const sp = msg.strategy ? withStyle(strategyPlan(String(msg.strategy), market), s, market) : null;
  if (msg.strategy && !sp) return { error: `No ${msg.strategy} strategy for ${market}` };
  const setup = {
    id: id(), market, source, symbol: msg.symbol, tv: msg.tv, dir: msg.dir === "short" ? "short" : "long",
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
  if (sp) {
    // the exits come from the tested plan, never from the alert
    if (sp.mine) { const sl2 = styleSl(sp, setup.dir, setup.entry, num(msg.rangeHi), num(msg.rangeLo)); if (sl2 != null) setup.sl = rp(sl2); }
    Object.assign(setup, {
      strategy: sp.strategy, tpR: sp.tpR, beR: sp.beR, extra: sp.extra, stopFrac: sp.stopFrac || null, mine: !!sp.mine,
      rangeHi: num(msg.rangeHi), rangeLo: num(msg.rangeLo), rangeAtr: num(msg.rangeAtr), trend: num(msg.trend),
      zoneAgeDays: num(msg.zoneAgeDays), touch: num(msg.touch),
    });
    setup.tp = null;
  }
  if (setup.entry == null || setup.sl == null || setup.entry === setup.sl) return { error: "setup needs entry and sl" };
  if (R.sign(setup.dir) * (setup.entry - setup.sl) <= 0) return { error: "the stop is on the wrong side of the entry" };
  if (setup.tp == null) setup.tp = rp(setup.entry + R.sign(setup.dir) * R.exits(setup, s).tpR * Math.abs(setup.entry - setup.sl));
  await store.hset("setups", setup.id, setup);
  await pruneSetups(store, now);
  const ctx = await context(store, now);
  const g = gradeNow(setup, ctx);
  setup.gradeAtAlert = g.grade;
  await store.hset("setups", setup.id, setup);
  const name = MARKETS[market].name + (sp ? ` ${sp.name}` : "");
  const head = `${g.grade} ${setup.dir.toUpperCase()} ${name} @ ${fx(setup.entry)}  SL ${fx(setup.sl)}`;
  // A tested strategy's alert fires the moment its planned order fills. In manual mode Edge records the trade
  // itself (pending) and asks you to check the entry, stop, target and contracts — no typing it in.
  let autoTrade = null;
  if (sp && g.take.ok && (!broker || broker.kind === "manual")) {
    autoTrade = await autoOpen(store, setup, g, s, now);
    await notify(store, `✅ ${name} ${setup.dir === "long" ? "BUY" : "SELL"} — your ${setup.strategy === "london" ? "stop" : "limit"} order should have filled at ${fx(setup.entry)}. Tap to check entry ${fx(setup.entry)} · stop ${fx(setup.sl)} · target ${fx(setup.tp)}.`, "action");
    return { setup, grade: g.grade, takeable: true, why: [], autoTrade };
  }
  const text = g.take.ok
    ? `✅ ${g.grade} ${name} ${setup.dir === "long" ? "BUY" : "SELL"}: ${story(setup, s).short}. Tap to see the picture — valid ${s.setupExpiryMin} min.`
    : sp ? `⛔ ${head}\nIf your order filled anyway, close it: ${g.take.why[0]}` : `⛔ ${head}\nSkip it: ${g.take.why[0]}`;
  await notify(store, text, g.take.ok ? "setup" : "skip");
  return { setup, grade: g.grade, takeable: g.take.ok, why: g.take.why || [] };
}

// The trade your planned order opened — recorded as pending until you confirm the numbers.
async function autoOpen(store, setup, g, s, now) {
  const size = R.orderSize(setup, s);
  const xp = R.exits(setup, s);
  const t = {
    id: `auto:${id()}`, source: "manual", pending: true, auto: true, market: setup.market, dir: setup.dir, grade: g.grade, setupId: setup.id,
    symbol: setup.symbol, ticker: setup.symbol, entry: setup.entry, initialSL: setup.sl, currentSL: setup.sl, tp: setup.tp,
    units: size.kind === "futures" ? size.qty : R.round(size.qty, 2), unitLabel: size.unit, contract: size.contract || null, riskUSD: size.totalRisk,
    strategy: setup.strategy, tpR: xp.tpR, beR: xp.beR, extra: !!setup.extra, openedAt: now, maxR: 0, ruleBreaks: [], notified: {},
  };
  await store.hset("trades", t.id, t);
  await store.hset("setups", setup.id, { ...setup, status: "taken" });
  return t;
}

// What to do now in an open trade, in one line (the PC trade guide speaks it).
function guide(t, s, price) {
  const p = R.plan(t, s);
  const r = price == null ? t.r : R.round(R.rAt(t, price));
  const stop = t.currentSL ?? t.initialSL;
  const bePending = !t.beMoved && p.beR > 0 && (t.maxR || 0) >= p.beR;
  let urgency = "info", text;
  if (t.tp != null && price != null && R.sign(t.dir) * (price - t.tp) >= 0) { urgency = "act_now"; text = `Target hit — close it now at ${fx(t.tp)}. Don't wait for more.`; }
  else if (bePending) { urgency = "act_now"; text = `Move your stop to ${fx(p.beStop)} now — break-even. Then tap Done.`; }
  else if (t.beMoved) text = `Stop is at break-even. Target ${fx(t.tp)}. Hands off — let it work.`;
  else if (r != null && r < 0) { urgency = "warn"; text = `Down ${Math.abs(r)}R. Your stop at ${fx(stop)} does the job — don't move it, don't add.`; }
  else text = p.beR > 0 ? `Hold. Stop at ${fx(stop)}. At ${fx(p.beTrigger)} (+${p.beR}R) move it to break-even.` : `Hold. Stop at ${fx(stop)}, target ${fx(t.tp)}. No break-even for this one — let it hit one or the other.`;
  return { r, maxR: t.maxR || 0, urgency, text, beTrigger: p.beTrigger, beStop: p.beStop, tp: t.tp, stop, tpR: p.tpR, beR: p.beR };
}

async function pruneSetups(store, now) {
  const all = await store.hgetall("setups");
  for (const [k, v] of Object.entries(all)) if (!v || now - v.at > 3 * 864e5) await store.hdel("setups", k);
}

// ---------- session close-out: warn before it, and (if switched on) get out by itself

async function closeOutCheck(store, broker, ctx) {
  const s = ctx.settings, ce = R.closeOut(ctx.now, s);
  if (!ctx.open.length) return;
  const today = require("./_time").dayKey(ctx.now, s.tz);
  if (ce.warn && (await store.get("closeoutWarned")) !== today) {
    await store.set("closeoutWarned", today);
    await notify(store, `⏰ ${ce.minutesLeft} min to the close-out (${s.flatBy}). You have ${ctx.open.length} open trade${ctx.open.length > 1 ? "s" : ""}. Open Edge → Close everything.`, "action");
  }
  if (ce.due && (await store.get("closeoutDone")) !== today) {
    await store.set("closeoutDone", today);
    if (s.autoFlat) { await closeAll(store, broker, { now: ctx.now, reason: "close-out time", auto: true }); return true; }
    else await notify(store, `⛔ Close-out time (${s.flatBy}) and you're still in ${ctx.open.length} trade${ctx.open.length > 1 ? "s" : ""}. Close everything NOW — your prop firm will.`, "action");
  }
}

// One button to get out of everything.
// auto: only the trades Edge can actually close (TradersPost / OANDA); hand-placed ones get a loud reminder instead.
async function closeAll(store, broker, { now = Date.now(), reason = "Close everything", auto = false } = {}) {
  const ctx = await context(store, now);
  const s = ctx.settings, sentTickers = new Set(), out = { closed: 0, failed: [], manual: 0 };
  for (const t of ctx.open) {
    try {
      if (t.source === "oanda" && broker.kind === "oanda") { await broker.close(t.brokerId); out.closed++; continue; }
      if (routedTo(t, broker)) {
        const tk = t.ticker || t.symbol;
        if (!sentTickers.has(tk)) { await broker.exit(tk, t); sentTickers.add(tk); }
      } else { out.manual++; if (auto) continue; }
      const hb = await store.get(`price:${t.market}`);
      const exit = hb && now - hb.time < 10 * 60e3 ? hb.price : t.lastPrice ?? t.entry;
      await recordClose(store, t, exit, now, null, s, t.source === "manual" ? ` (${reason} — make sure it's closed in TradingView)` : ` (${reason})`);
      out.closed++;
    } catch (e) { out.failed.push(`${t.market}: ${e.message}`); }
  }
  if (broker.kind === "oanda") await syncTrades(store, broker, { now, force: true }).catch(() => {});
  await notify(store, `🧹 ${reason}: ${out.closed} trade${out.closed === 1 ? "" : "s"} closed${out.manual ? ` — ${out.manual} ${out.manual === 1 ? "was" : "were"} placed by hand: close ${out.manual === 1 ? "it" : "them"} in TradingView too (Positions → Close all)` : ""}${out.failed.length ? `. ❗ Failed: ${out.failed.join("; ")} — close by hand NOW` : ""}.`, out.failed.length ? "action" : "closed");
  return out;
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

// ---------- your 5-minute game plan: a brief when London (03:00 New York) and New York (08:00) open, a recap after (11:00)
// Sent once each from the TradingView heartbeat — so it arrives even when the app is closed.
const GP_SLOTS = [["london", 180, "🇬🇧 London is open"], ["ny", 480, "🇺🇸 New York is open"], ["recap", 660, "🏁 Session over"]];
async function gamePlan(store, now = Date.now()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(now));
  const g = (k) => (p.find((x) => x.type === k) || {}).value, m = Number(g("hour")) * 60 + Number(g("minute"));
  if (["Sat", "Sun"].includes(g("weekday"))) return null;
  const slot = GP_SLOTS.find(([, at]) => m >= at && m < at + 30); if (!slot) return null;
  const key = `gp:${Prop.tradingDay(now)}:${slot[0]}`;
  if (await store.get(key)) return null;
  await store.set(key, now);
  const ctx = await context(store, now), s = ctx.settings, guard = R.guardrails(ctx), pn = await propNow(store, ctx, now).catch(() => null);
  const $ = (x) => `$${Math.round(x).toLocaleString("en-US")}`, lines = [];
  if (slot[0] === "recap") {
    const today = Prop.tradingDay(now), done = ctx.journal.filter((t) => t.closedAt && Prop.tradingDay(t.closedAt) === today);
    const r = done.reduce((a, t) => a + (t.resultR || 0), 0);
    lines.push(done.length ? `${done.length} trade${done.length > 1 ? "s" : ""} today · ${r >= 0 ? "+" : ""}${R.round(r, 2)}R` : "No trades today — no A+ setup is a fine day.");
    if (pn) lines.push(`Account ${$(pn.acct.balance)} · ${$(pn.acct.room)} room${pn.acct.toTarget != null ? ` · ${pn.acct.toTarget > 0 ? `${$(pn.acct.toTarget)} to target` : "target reached"}` : ""}.`);
    if (ctx.open.length) lines.push(`${ctx.open.length} trade${ctx.open.length > 1 ? "s" : ""} still open — the stop and target are set; hands off.`);
    lines.push("Log how it went in Edge, then step away from the charts.");
  } else {
    const idle = Math.floor(await idleDays(store, ctx, now)), lim = s.inactivityDays ?? 7;
    if (idle >= lim - 2) lines.push(`⏳ ${idle} days without a trade — the account needs one within ${lim} days (${Math.max(0, lim - idle)} left). Edge now alerts every valid setup, not only A+.`);
    const left = Math.max(0, s.maxTradesPerDay - guard.tradesToday);
    if (!guard.ok) lines.push(`⛔ No trading: ${guard.reasons[0]}`);
    else lines.push(`${left} trade${left === 1 ? "" : "s"} left today${pn ? ` · risk ${pn.auto.usd > 0 ? $(pn.auto.usd) : "nothing — " + pn.auto.why[0]}` : ""}.`);
    if (pn && pn.acct.toTarget != null) lines.push(`${pn.acct.toTarget > 0 ? `${$(pn.acct.toTarget)} to the target` : "Target reached"} · ${$(pn.acct.room)} before the drawdown.`);
    const near = [];
    for (const mk of Object.keys(MARKETS)) { const mark = await store.get(`price:${mk}`); if (mark && mark.near && now - mark.time < 3 * 3600e3) near.push(`${MARKETS[mk].name}: ${mark.near}${mark.trendD ? ` (daily ${mark.trendD > 0 ? "up" : "down"})` : ""}`); }
    lines.push(near.length ? `Near a zone: ${near.slice(0, 4).join(" · ")}.` : "No market at a higher-timeframe zone yet — wait for price to come to you.");
    const news = ctx.events.filter((e) => e.block && e.time > now && e.time - now < 5 * 3600e3).slice(0, 2);
    if (news.length) lines.push(`📰 ${news.map((e) => `${e.title} ${new Date(e.time).toLocaleTimeString("en-US", { timeZone: s.tz || "America/New_York", hour: "2-digit", minute: "2-digit" })}`).join(" · ")} — no trades ${s.newsBeforeMin} min either side.`);
  }
  const text = `${slot[2]}. ${lines.join(" ")}`;
  await store.set("gameplan", { slot: slot[0], at: now, text, lines, title: slot[2] });
  await notify(store, text, "info");
  return text;
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
  if (await closeOutCheck(store, broker, ctx).catch(() => false)) return { ...out, closedAll: true };

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

  // your planned limit orders: filled when price trades through the entry; cancelled if price runs to the target without you
  for (const o of Object.values((await store.hgetall("orders")) || {})) {
    if (o.routed && broker.status && o.trade.tv) { // Tradovate direct: ask the platform whether the limit filled
      const st = await broker.status(o.trade.tv.orderId).catch(() => null);
      if (st && /Filled/.test(st.status)) {
        await store.hdel("orders", o.id);
        const px = st.price ?? o.entry, t = { ...o.trade, entry: px, openedAt: now, filledAt: now };
        if (R.sign(t.dir) * (px - t.initialSL) > 0) t.tpR = R.round(Math.abs(t.tp - px) / Math.abs(px - t.initialSL)); // R measured from the real fill
        await store.hset("trades", t.id, t);
        await notify(store, `✅ ${MARKETS[o.market].name}: your ${o.dir === "long" ? "buy" : "sell"} limit filled on Tradovate at ${fx(px)}. Stop ${fx(o.sl)} · target ${fx(o.tp)} are working. Hands off until +${s.lockAtR}R.`, "action");
        continue;
      }
      if (st && /Canceled|Rejected|Expired/.test(st.status)) {
        await store.hdel("orders", o.id);
        await notify(store, `ℹ️ ${MARKETS[o.market].name}: your limit order was ${st.status.toLowerCase()} on Tradovate.`, "info");
        continue;
      }
    }
    const m = market === o.market && mark ? mark : await store.get(`price:${o.market}`);
    if (!m || now - m.time > 15 * 60e3 || m.time < o.placedAt) continue;
    const k = R.sign(o.dir), lo = m.low ?? m.price, hi = m.high ?? m.price, name = MARKETS[o.market].name;
    if ((k > 0 ? lo <= o.entry : hi >= o.entry) && !(o.routed && broker.status && o.trade.tv)) { // (Tradovate direct reports its own fills)
      await store.hdel("orders", o.id);
      const t = { ...o.trade, openedAt: now, filledAt: now };
      await store.hset("trades", t.id, t);
      await notify(store, `✅ ${name}: your ${o.dir === "long" ? "buy" : "sell"} limit filled at ${fx(o.entry)}. Stop ${fx(o.sl)} · target ${fx(o.tp)}. Hands off until +${s.lockAtR}R.`, "action");
    } else if (k > 0 ? hi >= o.tp : lo <= o.tp) {
      await store.hdel("orders", o.id);
      if (o.routed && ROUTED(broker)) await broker.exit(o.trade.ticker, o.trade).catch(() => {});
      await notify(store, `🏃 ${name}: price ran to your target without filling the limit — order ${o.routed ? "cancelled on Tradovate" : "cancelled (cancel it on your platform too)"}. No chasing.`, "action");
    }
  }

  // manual mode: prices come from the TradingView heartbeat
  for (const t of ctx.open.filter((x) => x.source === "manual" || x.source === "traderspost" || x.source === "tradovate")) {
    if (routedTo(t, broker) && broker.status && t.tv) { // Tradovate direct: did the stop or the target fill?
      let done = null;
      for (const [k2, how] of [["stopId", "stop"], ["tpId", "target"]]) {
        if (!t.tv[k2] || done) continue;
        const st = await broker.status(t.tv[k2]).catch(() => null);
        if (st && /Filled/.test(st.status)) done = { px: st.price ?? (how === "stop" ? t.currentSL ?? t.initialSL : t.tp), how };
      }
      if (done) { await recordClose(store, t, done.px, now, null, s, ` (${done.how} filled on Tradovate)`); out.closed++; continue; }
    }
    const m = market === t.market && mark ? mark : await store.get(`price:${t.market}`);
    if (!m || now - m.time > 15 * 60e3) continue;
    const k = R.sign(t.dir);
    const stop = t.currentSL ?? t.initialSL;
    const hitStop = k > 0 ? (m.low ?? m.price) <= stop : (m.high ?? m.price) >= stop;
    const hitTP = t.tp != null && (k > 0 ? (m.high ?? m.price) >= t.tp : (m.low ?? m.price) <= t.tp);
    if ((hitStop || hitTP) && !(routedTo(t, broker) && broker.status && t.tv)) {
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
  const routed = routedTo(t, broker); // Edge sends the changes to Tradovate
  const manual = !routed && t.source !== "oanda";
  const k = R.sign(t.dir);
  const ticker = t.ticker || t.symbol;

  // after the +3R lock: trail the stop behind each new 15m swing (the radar script reports them with every 5m candle)
  if (t.lockR != null && t.beMoved && s.trail15 !== false) {
    const sw = k > 0 ? mark.swing15Low : mark.swing15High, spec = require("./_config").futuresSpec(t.symbol || t.ticker || "");
    const lvl = sw != null ? rp(sw - k * 2 * (spec ? spec.tick : 0)) : null, cur = t.currentSL ?? t.initialSL;
    if (lvl != null && k * (lvl - cur) > 0 && k * (mark.price - lvl) > 0 && t.trailAt !== lvl) {
      t.trailAt = lvl;
      if (routed && broker.moveStop && t.tv && t.tv.stopId) {
        try { await broker.moveStop(t, lvl); t.currentSL = lvl; await notify(store, `↗️ ${name}: new 15m swing — stop trailed to ${fx(lvl)} on Tradovate (${R.round(R.rAt(t, lvl))}R locked).`, "action"); }
        catch (e) { await notify(store, `❗ ${name}: couldn't trail the stop (${e.message}). Move it to ${fx(lvl)} yourself.`, "action"); }
      } else { t.trailSuggest = lvl; await notify(store, `↗️ ${name}: new 15m swing — move your stop to ${fx(lvl)} (${R.round(R.rAt(t, lvl))}R locked), then tap Done in Edge.`, "action"); }
    }
  }
  for (const a of ev.actions) {
    if (a.ruleBreak && !(t.ruleBreaks || []).includes(a.code || a.type)) t.ruleBreaks = [...(t.ruleBreaks || []), a.code || a.type];
    if (a.type === "warn") { await once(store, t, a.code, `⚠️ ${name}: ${a.text}`); continue; }
    if (a.type === "moveSL") {
      if (routed && broker.moveStop && t.tv && t.tv.stopId) { // Tradovate direct: Edge moves the stop on the platform itself
        if (t.notified && t.notified.be) continue;
        try {
          await broker.moveStop(t, a.price);
          t.currentSL = a.price; t.beMoved = true;
          await once(store, t, "be", `🔒 ${name}: +${ev.plan.beR}R reached — stop moved to ${fx(a.price)} on Tradovate${a.lock ? ` (+${t.lockR}R locked in). Trail it behind each new 15m swing from here` : ". This trade can't lose now"}.`, "action");
        } catch (e) {
          await once(store, t, "be", `❗ ${name}: +${ev.plan.beR}R reached but moving the stop failed (${e.message}). Move it to ${fx(a.price)} yourself NOW.`, "action");
        }
        continue;
      }
      if (a.lock && (routed || manual)) { // your playbook: lock in profit at +3R, then trail behind the 15m swings (you move it on the platform)
        await once(store, t, "be", `🔒 ${name}: ${a.text} Move your stop to ${fx(a.price)} now, then tap "Done" in Edge.`, "action");
        continue;
      }
      if (routed) {
        if (t.notified && t.notified.be) continue;
        try {
          await broker.breakeven(ticker);
          t.currentSL = t.entry; t.beMoved = true;
          await once(store, t, "be", `🔒 ${name}: +${ev.plan.beR}R reached — stop moved to break-even (${fx(t.entry)}) on Tradovate. This trade can't lose now.`, "action");
        } catch (e) {
          await once(store, t, "be", `❗ ${name}: +${ev.plan.beR}R reached but the break-even order failed (${e.message}). Move your stop to ${fx(t.entry)} yourself NOW.`, "action");
        }
        continue;
      }
      if (manual) {
        await once(store, t, "be", `🔒 ${name}: +${ev.plan.beR}R reached. Move your stop to ${fx(a.price)} (break-even) NOW, then tap "Done" in Edge.`, "action");
        continue;
      }
      // price already slipped back through break-even → the rule says get out now
      if (k * (mark.price - a.price) <= 0) {
        await broker.close(t.brokerId).catch(() => {});
        await notify(store, `🔒 ${name}: touched +${ev.plan.beR}R and came back — closed at break-even, as your rule says.`, "action");
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

  // 15m structure turned against the trade (supply & demand trades only — the tested strategies did better
  // holding to their stop or target: closing early on a reversal signal cut their results in the tests)
  const against = !t.strategy && ((t.dir === "long" && bos15 === "down") || (t.dir === "short" && bos15 === "up"));
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
  const spec = require("./_config").futuresSpec(t.symbol || t.ticker || "");
  const pc = await store.get("prop").catch(() => null), fee = (pc && pc.feePerContract != null ? Number(pc.feePerContract) : 1.5) * (t.units || 0);
  const usd = pnl != null ? Number(pnl) : spec && t.units && exit != null ? R.round(R.sign(t.dir) * (exit - t.entry) * spec.pv * t.units - fee) : null;
  const j = { ...t, exit, closedAt, pnl, resultR, usd, feeUSD: pnl == null && spec ? fee : 0, exitReason: exit != null ? R.exitReason(t, exit, s) + note : "unknown" };
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
  if (broker.kind === "oanda" || broker.kind === "tradovate") await syncTrades(store, broker, { now }).catch(() => {});
  const ctx = await context(store, now);
  await newsReminders(store, ctx).catch(() => {});
  await closeOutCheck(store, broker, ctx).catch(() => {});
  const setupsH = await store.hgetall("setups");
  const setups = Object.values(setupsH).sort((a, b) => b.at - a.at).slice(0, 25).map((x) => ({ ...x, g: gradeNow(x, ctx), size: R.orderSize(x, ctx.settings), story: story(x, ctx.settings), xp: R.exits(x, ctx.settings) }));
  const prices = {}, plans = [];
  for (const m of Object.keys(MARKETS)) {
    prices[m] = await store.get(`price:${m}`);
    const pl = await store.get(`plan:${m}`);
    if (pl && now < pl.expires) plans.push(pl);
  }
  let account = null;
  if (broker.kind === "oanda" || broker.kind === "tradovate") account = await broker.account().catch((e) => ({ error: e.message }));
  const open = ctx.open.map((t) => ({ ...t, plan: t.initialSL != null ? R.plan(t, ctx.settings) : null, xp: R.exits(t, ctx.settings) }));
  return {
    now, settings: ctx.settings, defaults: DEFAULT_SETTINGS, markets: Object.fromEntries(Object.entries(MARKETS).map(([k, v]) => [k, { name: v.name, unit: v.unit }])),
    biasFactors: BIAS_FACTORS, bias: ctx.bias, setups, plans, strategies: STRATEGIES, open, journal: ctx.journal.slice(0, 200), stats: stats(ctx.journal),
    practice: ctx.practice.slice(0, 200), practiceStats: stats(ctx.practice), coach: { ready: !!process.env.ANTHROPIC_API_KEY, session: await store.get("coach") },
    share: R.aPlusShare([...ctx.journal, ...ctx.open]), guard: R.guardrails(ctx),
    news: { ok: ctx.newsOk, error: ctx.newsError, events: ctx.events.filter((e) => e.time > now - 2 * 3600e3) },
    prop: await propNow(store, ctx, now).catch(() => null) || ((await store.get("prop")) ? { cfg: await store.get("prop"), acct: null, auto: null } : null),
    gameplan: await store.get("gameplan"), prices, log: await store.lrange("log", 40), orders: Object.values((await store.hgetall("orders")) || {}).sort((a, b) => b.placedAt - a.placedAt),
    broker: { kind: broker.kind, label: broker.label, account },
    fundamentals: await store.get("fundamentals"),
    closeOut: R.closeOut(now, ctx.settings),
    push: { publicKey: (await vapid(store).catch(() => null) || {}).publicKey || null, devices: Object.values(await store.hgetall("push")).map((d) => ({ label: d.label, added: d.added })) },
    tradovateApp: !!(await store.get("tradovateConn").catch(() => null)), storage: store.kind, hookReady: !!process.env.EDGE_HOOK_SECRET, telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
}

async function take(store, broker, { setupId, emotion, entry: myEntry, riskUSD: myRisk, sl: mySl, tp: myTp, qty: myQty, judge }, now = Date.now()) {
  const setup = await store.hget("setups", setupId);
  if (!setup) throw new Error("Setup not found");
  if (setup.strategy === "playbook" || setup.strategy === "sd") { // the radar's / scanner's setup is a limit: it goes out like a trade you planned yourself
    const ctx0 = await context(store, now), g0 = gradeNow(setup, ctx0);
    if (!g0.take.ok) throw new Error(g0.take.why.join(" "));
    const spec = require("./_config").futuresSpec(setup.symbol || "");
    const micro = spec ? ({ GC: "MGC", CL: "MCL", SI: "SIL", NG: "MNG", QG: "MNG", ES: "MES", NQ: "MNQ", YM: "MYM", HG: "MHG", RTY: "M2K", "6E": "M6E", "6B": "M6B", "6A": "M6A", "6J": "MJY" })[spec.root] || spec.root : null;
    const sdx = setup.strategy === "sd"; // scanner setups: your own limit / stop / target / contracts if you changed them
    const r = await planTrade(store, broker, { market: setup.market, contract: micro, dir: setup.dir, entry: (sdx && num(myEntry)) || setup.entry, sl: (sdx && num(mySl)) || setup.sl, tp: (sdx && num(myTp)) || setup.tp, qty: sdx ? num(myQty) : null, judge: sdx ? judge : null, riskUSD: myRisk, emotion, checks: require("../playbook.js").required, type: "limit", send: true, sd: setup.strategy === "sd", ...(setup.strategy === "sd" ? { riskUSD: mergeSettings(await store.get("settings")).sdRiskMax } : {}), note: setup.strategy === "sd" ? `S&D scanner · ${setup.kind}` : `radar setup ${setup.grade || ""}` }, now);
    await store.hset("setups", setupId, { ...setup, status: "taken" });
    return r;
  }
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
  const xp = R.exits(setup, s);
  const base = { id: "", market: setup.market, dir: setup.dir, grade: g.grade, setupId, emotion: emotion || "calm", maxR: 0, ruleBreaks: [], notified: {}, openedAt: now,
    ...(setup.strategy ? { strategy: setup.strategy, tpR: xp.tpR, beR: xp.beR, extra: !!setup.extra } : {}) };
  const beTxt = xp.beR > 0 ? `moves the stop to break-even at +${xp.beR}R` : "leaves the stop alone (no break-even in this plan)";

  if (broker.kind === "manual" || ROUTED(broker)) {
    const routed = ROUTED(broker);
    // routed: the order goes out at market now — check the latest chart price for chasing
    const hb = routed ? await store.get(`price:${setup.market}`) : null;
    const entry = num(myEntry) ?? (hb && now - hb.time < 6 * 60e3 ? hb.price : setup.entry);
    if (k * (entry - setup.sl) <= 0) throw new Error("That entry is on the wrong side of the stop.");
    const risk = Math.abs(entry - setup.sl);
    if (k * (entry - setup.entry) / Math.abs(setup.entry - setup.sl) > s.maxChaseR) throw new Error(`Price ran more than ${s.maxChaseR}R past the entry. No chasing — wait for the next setup.`);
    let want = num(myRisk);
    const tg = tilt(ctx, now, want || 0);
    if (tg.block) throw new Error(tg.block);
    if (tg.cap) want = Math.min(want || tg.cap, tg.cap);
    const pn = await propNow(store, ctx, now);
    if (pn) { if (pn.auto.usd <= 0) throw new Error(pn.auto.why[0]); want = Math.min(want || pn.auto.usd, pn.auto.usd); }
    const size = R.orderSize(setup, s, entry, want);
    if (pn && pn.cfg.maxMicros && size.qty > pn.cfg.maxMicros) size.qty = pn.cfg.maxMicros;
    if (size.kind === "futures" && size.qty < 1) throw new Error(`One ${size.contract} contract would risk $${size.riskPerContract}, more than your $${size.riskUSD} limit. Skip this one${size.contract === "GC" || size.contract === "CL" || size.contract === "NG" || size.contract === "QG" ? " — or trade the micro contract" : ""}.`);
    const riskUSD = size.totalRisk;
    const tp = rp(entry + k * xp.tpR * risk);
    if (routed) {
      if (size.kind !== "futures") throw new Error("Sending orders through TradersPost is set up for futures (MGC, MCL, QG…). Use a futures chart.");
      var sent = await broker.order({ ticker: setup.symbol, dir: setup.dir, qty: size.qty, sl: setup.sl, tp, price: entry, ref: setupId });
    }
    const t = { ...base, id: `${routed ? "tp" : "manual"}:${id()}`, source: routed ? broker.kind : "manual", ...(sent && sent.orderId ? { tv: sent } : {}), symbol: setup.symbol, ticker: setup.symbol, entry, initialSL: setup.sl, currentSL: setup.sl, tp, units: size.qty, unitLabel: size.unit, contract: size.contract || null, riskUSD };
    if (routed) await notify(store, `▶️ Order sent: ${setup.dir === "long" ? "BUY" : "SELL"} ${size.qty} ${size.contract} · SL ${fx(setup.sl)} · TP ${fx(tp)}. Hands off — Edge ${beTxt}.`, "action");
    await store.hset("trades", t.id, t);
    await store.hset("setups", setupId, { ...setup, status: "taken" });
    return { trade: t };
  }

  const acct = await broker.account();
  const riskUSD = num(myRisk) > 0 ? num(myRisk) : await broker.toUSD(acct.balance * s.riskPct / 100, acct.currency);
  const instrument = MARKETS[setup.market].instrument(setup.symbol || "");
  const px = (await broker.prices([instrument]))[instrument];
  if (!px) throw new Error(`No live price for ${instrument}`);
  const entryNow = setup.dir === "short" ? px.bid : px.ask;
  if (k * (entryNow - setup.sl) <= 0) throw new Error("Price is already past the stop — the setup failed. Skip it.");
  const chased = (k * (entryNow - setup.entry)) / Math.abs(setup.entry - setup.sl);
  if (chased > s.maxChaseR) throw new Error(`Price already ran ${R.round(chased)}R past the entry. No chasing — wait for the next setup.`);
  const units = R.sizeUnits(riskUSD, entryNow, setup.sl);
  const tpGuess = entryNow + k * xp.tpR * Math.abs(entryNow - setup.sl);
  const fill = await broker.marketOrder({ instrument, dir: setup.dir, units, sl: setup.sl, tp: tpGuess });
  const tp = fill.price + k * xp.tpR * Math.abs(fill.price - setup.sl);
  if (Math.abs(tp - tpGuess) > 1e-9) await broker.setOrders(fill.brokerId, instrument, { tp }).catch(() => {});
  const t = { ...base, id: `${broker.kind}:${fill.brokerId}`, source: broker.kind, brokerId: fill.brokerId, instrument, entry: fill.price, initialSL: setup.sl, currentSL: setup.sl, tp, units: fill.units, riskUSD };
  await store.hset("trades", t.id, t);
  await store.hset("setups", setupId, { ...setup, status: "taken" });
  await notify(store, `▶️ ${MARKETS[setup.market].name} ${setup.dir} opened @ ${fx(fill.price)} · SL ${fx(setup.sl)}${xp.beR > 0 ? ` · BE at ${xp.beR}R` : ""} · TP ${fx(tp)} (${xp.tpR}R). Hands off — Edge manages it.`, "action");
  return { trade: t };
}

// A trade you planned step by step in Edge (Today → Plan a trade): every step of your playbook ticked, 3R–10R,
// sized for your dollar risk. Sent to Tradovate as a limit (or market) order with its stop and target when
// TradersPost is connected and you confirm — otherwise Edge tracks the order you place yourself.
async function planTrade(store, broker, body, now) {
  const PB = require("../playbook.js");
  const s = mergeSettings(await store.get("settings"));
  const market = body.market;
  if (!MARKETS[market]) throw new Error("Pick a market.");
  const dir = body.dir === "short" ? "short" : "long", k = R.sign(dir);
  const entry = num(body.entry), sl = num(body.sl), tp = num(body.tp);
  if (entry == null || sl == null || tp == null) throw new Error("Fill in the entry, the stop and the target.");
  if (k * (entry - sl) <= 0) throw new Error(`For a ${dir === "long" ? "buy" : "sell"}, the stop goes ${dir === "long" ? "below" : "above"} the entry.`);
  if (k * (tp - entry) <= 0) throw new Error(`For a ${dir === "long" ? "buy" : "sell"}, the target goes ${dir === "long" ? "above" : "below"} the entry.`);
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  const sdMode = !!body.sd; // the supply & demand rules: target = nearest liquidity, 1.5R–6R
  if (sdMode && (rr < 0.49 || rr > 10.01)) throw new Error(`That's ${rr.toFixed(1)}R — keep the target between 0.5R and 10R.`);
  if (!sdMode && rr < s.minR - 0.005) throw new Error(`That's ${rr.toFixed(1)}R. Your rule: never under ${s.minR}R — skip it or find a better entry.`);
  if (!sdMode && rr > s.maxR + 0.005) throw new Error(`${rr.toFixed(1)}R is past your ${s.maxR}R maximum — aim for the nearest opposing liquidity.`);
  const checks = Array.isArray(body.checks) ? body.checks.map(String) : [];
  const missing = PB.required.filter((x) => !checks.includes(x));
  if (missing.length) throw new Error(`Not ticked yet: ${missing.map((x) => PB.byId[x].title.toLowerCase()).join(", ")}. If it's not there, there's no trade.`);
  if (BAD_MOODS[body.emotion]) {
    await store.set("cooldown", now + 15 * 60e3);
    await notify(store, `🧘 Skipped a trade because of ${BAD_MOODS[body.emotion]}. 15-minute break started. That's discipline.`, "skip");
    throw new Error(`Trading on ${BAD_MOODS[body.emotion]} is how accounts get hurt. 15-minute break — walk away from the screen.`);
  }
  const ctx = await context(store, now);
  const waiting = Object.values((await store.hgetall("orders")) || {});
  const guard = R.guardrails({ ...ctx, open: [...ctx.open, ...waiting.map((o) => o.trade)] });
  if (!guard.ok) throw new Error(guard.reasons.join(" "));
  const root = String(body.contract || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || { gold: "MGC", crude: "MCL", natgas: "MNG", silver: "SIL", es: "MES", nq: "MNQ", ym: "MYM", copper: "MHG", rty: "M2K", "6e": "M6E", "6b": "M6B", "6j": "MJY", "6a": "M6A", zn: "ZN", zb: "ZB" }[market];
  const symbol = `${root}1!`;
  let riskUSD = num(body.riskUSD);
  const tg = tilt(ctx, now, riskUSD || 0);
  if (tg.block) throw new Error(tg.block);
  if (tg.cap) riskUSD = Math.min(riskUSD || tg.cap, tg.cap);
  const pn = await propNow(store, ctx, now);
  if (pn) { if (pn.auto.usd <= 0) throw new Error(pn.auto.why[0]); riskUSD = Math.min(riskUSD || pn.auto.usd, pn.auto.usd); }
  const size = R.orderSize({ symbol, sl }, s, entry, riskUSD);
  if (sdMode && !(num(body.qty) > 0) && size.kind === "futures") { // as close to your target risk as the stop allows, never over the max
    const cap = Math.min(s.sdRiskMax, pn ? pn.auto.usd : Infinity);
    size.qty = R.sdQty(size.riskPerContract, Math.min(s.sdRiskTarget, cap), cap); size.totalRisk = R.round(size.qty * size.riskPerContract);
  }
  if (sdMode && num(body.qty) > 0) { // you picked the number of contracts yourself
    size.qty = Math.floor(num(body.qty)); size.totalRisk = R.round(size.qty * size.riskPerContract);
    if (pn && size.totalRisk > pn.auto.usd + 0.5) throw new Error(`${size.qty} ${size.contract} risks $${size.totalRisk} — your prop account allows $${pn.auto.usd} right now.`);
  }
  if (pn && pn.cfg.maxMicros && size.qty > pn.cfg.maxMicros) size.qty = pn.cfg.maxMicros;
  if (size.kind !== "futures") throw new Error(`${root} isn't a futures contract Edge knows.`);
  if (size.qty < 1) throw new Error(`One ${size.contract} would risk $${size.riskPerContract} with this stop — more than your $${size.riskUSD}. Use the micro contract or skip it.`);
  const routed = ROUTED(broker) && !!body.send;
  const type = body.type === "market" ? "market" : "limit";
  const lockR = !sdMode && rr > s.lockAtR + 0.25 ? s.lockToR : null;
  const trade = { id: `plan:${id()}`, market, dir, grade: "A+", source: routed ? broker.kind : "manual", symbol, ticker: symbol, entry, initialSL: sl, currentSL: sl, tp,
    strategy: sdMode ? "sd" : "playbook", tpR: R.round(rr), beR: lockR != null ? s.lockAtR : 0, lockR, units: size.qty, unitLabel: size.unit, contract: size.contract, riskUSD: size.totalRisk,
    emotion: ["calm", "focused"].includes(body.emotion) ? body.emotion : "calm", checks, note: String(body.note || "").slice(0, 500), maxR: 0, ruleBreaks: [], notified: {}, openedAt: now,
    ...(body.judge && typeof body.judge === "object" ? { judge: Object.fromEntries(["disp", "liq", "base", "fill", "pd"].map((j) => [j, body.judge[j] === true])) } : {}) };
  if (routed) { const sent = await broker.order({ ticker: symbol, dir, qty: size.qty, sl, tp, price: entry, ref: trade.id, type }); if (sent && sent.orderId) trade.tv = sent; }
  const side = `${dir === "long" ? "BUY" : "SELL"} ${size.qty} ${size.contract}`;
  if (type === "market") {
    await store.hset("trades", trade.id, trade);
    await notify(store, `▶️ ${routed ? "Order sent" : "Tracking"}: ${side} @ ${fx(entry)} · SL ${fx(sl)} · TP ${fx(tp)} (${rr.toFixed(1)}R).`, "action");
    return { trade };
  }
  const order = { id: trade.id, market, dir, entry, sl, tp, routed, placedAt: now, trade };
  await store.hset("orders", order.id, order);
  await notify(store, `📝 ${routed ? "Limit sent to Tradovate" : "Limit order planned"}: ${side} @ ${fx(entry)} · SL ${fx(sl)} · TP ${fx(tp)} (${rr.toFixed(1)}R). Edge tells you when it fills.`, "action");
  return { order };
}

async function action(store, broker, body, now = Date.now()) {
  const a = body.action;
  if (a === "take") return take(store, broker, body, now);
  if (a === "planTrade") return planTrade(store, broker, body, now);
  if (a === "propSave") { // your prop account: firm, plan, rules (all editable), where it stands now
    const c = body.cfg || {}, n = (x) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
    const cur = (await store.get("prop")) || {};
    const next = { ...cur, enabled: c.enabled !== false, firm: String(c.firm || cur.firm || "custom").slice(0, 30), plan: String(c.plan || cur.plan || "").slice(0, 40), phase: c.phase === "funded" ? "funded" : "eval",
      size: n(c.size) ?? 50000, target: n(c.target), dd: n(c.dd) ?? 2000, ddType: ["eod", "intraday", "static"].includes(c.ddType) ? c.ddType : "eod", ddLockAt: n(c.ddLockAt), dailyLoss: n(c.dailyLoss),
      consistencyPct: n(c.consistencyPct), minDays: n(c.minDays) || 0, maxMicros: n(c.maxMicros), baseRisk: n(c.baseRisk) ?? cur.baseRisk ?? 250, feePerContract: n(c.feePerContract) ?? 1.5,
      setupsPerDay: n(c.setupsPerDay) ?? cur.setupsPerDay ?? 1, inactivityDays: n(c.inactivityDays) ?? cur.inactivityDays ?? null, payout: c.payout && typeof c.payout === "object" ? Object.fromEntries(Object.entries(c.payout).map(([k, v]) => [k, k === "split" ? String(v || "").slice(0, 12) : n(v)])) : cur.payout || {} };
    if (c.anchor || !cur.anchor) next.anchor = { balance: n(c.anchor && c.anchor.balance) ?? next.size, hwm: n(c.anchor && c.anchor.hwm) ?? n(c.anchor && c.anchor.balance) ?? next.size, days: n(c.anchor && c.anchor.days) || 0, at: now };
    if (!(next.dd > 0)) throw new Error("Enter the drawdown amount.");
    await store.set("prop", next);
    if (next.inactivityDays > 0) { const st = (await store.get("settings")) || {}; await store.set("settings", { ...st, inactivityDays: next.inactivityDays }); }
    return { ok: true, prop: next };
  }
  if (a === "propRead") { // a screenshot of your firm's rules → the rules + a plan built around them (nothing saved yet)
    const RR = require("./_rulesread");
    const rules = await RR.readRules(body.image);
    return { ok: true, rules, ...RR.planFromRules(rules) };
  }
  if (a === "propOff") { const cur = (await store.get("prop")) || {}; await store.set("prop", { ...cur, enabled: false }); return { ok: true }; }
  if (a === "cancelOrder") {
    const o = await store.hget("orders", String(body.id || ""));
    if (!o) throw new Error("That order isn't waiting any more.");
    if (o.routed && ROUTED(broker)) await broker.exit(o.trade.ticker, o.trade).catch(() => {});
    await store.hdel("orders", o.id);
    return { ok: true };
  }
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
    const evidence = {};
    for (const [k, v] of Object.entries(body.evidence || {})) if (answers[k] !== undefined) evidence[k] = String(v).slice(0, 200);
    b[body.market] = { ...biasFromFactors(answers), answers, evidence, note: String(body.note || "").slice(0, 500), updated: now };
    await store.set("bias", b);
    return { ok: true, bias: b[body.market] };
  }
  if (a === "settings") {
    const cur = mergeSettings(await store.get("settings"));
    const p = body.patch || {};
    const nums = ["sdRiskMin", "sdRiskTarget", "sdRiskMax", "minR", "maxR", "lockAtR", "lockToR", "riskPct", "accountSize", "beAtR", "beOffsetR", "tpAtR", "maxTradesPerDay", "maxDailyLossR", "cooldownMin", "maxOpen", "newsBeforeMin", "newsAfterMin", "setupExpiryMin", "maxChaseR", "coachIdleSec", "coachTradeSec", "coachDailyChecks", "flatWarnMin", "noNewTradesMin", "inactivityDays", "fallbackAfterDays"];
    for (const k of nums) if (p[k] != null && Number.isFinite(Number(p[k]))) cur[k] = Number(p[k]);
    if (cur.riskPct > 3) throw new Error("Risk per trade above 3% isn't allowed here. That's the greed talking.");
    if (cur.beAtR < 0 || (cur.beAtR > 0 && cur.tpAtR <= cur.beAtR)) throw new Error("Take-profit must be beyond the break-even trigger (or set break-even to 0 = off).");
    cur.beV2 = true;
    cur.riskV5 = true;
    for (const k of ["enforceTP"]) if (typeof p[k] === "boolean") cur[k] = p[k];
    if (["warn", "close"].includes(p.newsOpenTrade)) cur.newsOpenTrade = p.newsOpenTrade;
    if (typeof p.flatBy === "string" && /^\d{1,2}:\d{2}$/.test(p.flatBy)) cur.flatBy = p.flatBy;
    if (typeof p.autoFlat === "boolean") cur.autoFlat = p.autoFlat;
    if (["notify", "close", "off"].includes(p.structureExit)) cur.structureExit = p.structureExit;
    if (typeof p.tz === "string" && p.tz) cur.tz = p.tz;
    if (p.notify) for (const k of Object.keys(cur.notify)) if (typeof p.notify[k] === "boolean") cur.notify[k] = p.notify[k];
    if (p.style) {
      cur.style = { ...(cur.style || {}) };
      for (const m of ["gold", "crude", "silver"]) {
        const v = p.style[m];
        if (v === null) { delete cur.style[m]; continue; }
        if (!v) continue;
        const stopFrac = Number(v.stopFrac), tpR = Number(v.tpR), beR = Number(v.beR);
        if (!(stopFrac >= 0.2 && stopFrac <= 1) || !(tpR >= 1 && tpR <= 6) || !(beR >= 0 && beR < tpR)) throw new Error("Style: stop 20–100% of the box, target 1–6R, break-even below the target.");
        cur.style[m] = { stopFrac, tpR, beR, tested: v.tested ? String(v.tested).slice(0, 200) : "", at: now };
      }
    }
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
  if (a === "confirmTrade") {
    // you checked the trade Edge recorded: fix what's different, say how you feel
    const t = await store.hget("trades", body.tradeId);
    if (!t) throw new Error("Trade not found");
    const k = R.sign(t.dir);
    const entry = num(body.entry) ?? t.entry, sl = num(body.sl) ?? t.initialSL, tp = num(body.tp) ?? t.tp;
    if (k * (entry - sl) <= 0) throw new Error("The stop must be below the entry for a buy, above it for a sell.");
    if (k * (tp - entry) <= 0) throw new Error("The target must be above the entry for a buy, below it for a sell.");
    const units = num(body.units);
    Object.assign(t, { entry, initialSL: sl, currentSL: sl, tp, pending: false, confirmedAt: now, emotion: ["calm", "focused", "fomo", "revenge", "bored"].includes(body.emotion) ? body.emotion : t.emotion || "calm" });
    if (units != null && units > 0) t.units = units;
    const spec = require("./_config").futuresSpec(t.symbol || "");
    if (spec && t.units) t.riskUSD = R.round(Math.abs(entry - sl) * spec.pv * t.units);
    // a target further than the plan is greed — logged, and Edge will remind you
    const planTp = entry + k * R.exits(t, mergeSettings(await store.get("settings"))).tpR * Math.abs(entry - sl);
    if (k * (tp - planTp) > Math.abs(entry - sl) * 0.05) t.ruleBreaks = [...new Set([...(t.ruleBreaks || []), "target past the plan"])];
    await store.hset("trades", t.id, t);
    return { trade: t };
  }
  if (a === "dismissTrade") {
    // the order didn't fill (or you didn't place it): forget the trade, no journal entry
    const t = await store.hget("trades", body.tradeId);
    if (!t || !t.pending) throw new Error("Only an unconfirmed trade can be removed");
    await store.hdel("trades", t.id);
    if (t.setupId) { const x = await store.hget("setups", t.setupId); if (x) await store.hset("setups", x.id, { ...x, status: "skipped", skipReason: "not filled" }); }
    return { ok: true };
  }
  if (a === "trailDone") { // you moved the stop to the trailing level Edge gave you
    const t = await store.hget("trades", body.tradeId);
    if (!t || t.trailSuggest == null) throw new Error("No trailing stop waiting for this trade.");
    t.currentSL = t.trailSuggest; delete t.trailSuggest;
    await store.hset("trades", t.id, t);
    return { ok: true };
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
    if (t.source === "manual" || t.source === "traderspost" || t.source === "tradovate") {
      const sentOut = routedTo(t, broker);
      if (sentOut) await broker.exit(t.ticker || t.symbol, t);
      const exit = num(body.exit) ?? (sentOut || t.source !== "manual" ? t.lastPrice ?? t.entry : null);
      if (exit == null) throw new Error("Enter your exit price");
      await recordClose(store, t, exit, now, null, mergeSettings(await store.get("settings")), sentOut ? " (closed on Tradovate — correct the exit price if needed)" : "");
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
  if (a === "practiceLog") {
    // a replay (FX Replay) trade, checked step by step by you — never counts toward real limits or stats
    const market = body.market, dir = body.dir === "short" ? "short" : "long";
    const entry = num(body.entry), sl = num(body.sl);
    if (!MARKETS[market] || entry == null || sl == null || R.sign(dir) * (entry - sl) <= 0) throw new Error("Need market, direction, entry and a stop on the right side.");
    const s = mergeSettings(await store.get("settings"));
    const k = R.sign(dir), risk = Math.abs(entry - sl);
    const steps = {};
    for (const key of PRACTICE_STEPS) steps[key] = !!(body.steps || {})[key];
    const missing = PRACTICE_STEPS.filter((key) => !steps[key]);
    const outcome = ["tp", "be", "sl", "exit", "flat"].includes(body.outcome) ? body.outcome : null;
    if (!outcome) throw new Error("How did it end? Target, break-even, stop, or your exit price.");
    const exit = outcome === "tp" ? entry + k * s.tpAtR * risk : outcome === "be" ? entry + k * s.beOffsetR * risk : outcome === "sl" ? sl : num(body.exit);
    if (exit == null) throw new Error("Enter the price you got out at.");
    const t = {
      // A = every step but the liquidity sweep, on the first visit to the zone (your rule) — allowed, not a break
      id: `practice:${id()}`, source: "practice", practice: true, market, dir, grade: !missing.length ? "A+" : body.grade === "A" && missing.length === 1 && missing[0] === "liquidity taken" ? "A" : "unplanned",
      entry, initialSL: sl, currentSL: outcome === "be" ? exit : sl, tp: entry + k * s.tpAtR * risk, beMoved: outcome === "be",
      steps, liquidity: String(body.liquidity || "").slice(0, 40), emotion: ["calm", "fomo", "revenge", "bored"].includes(body.emotion) ? body.emotion : "calm",
      openedAt: num(body.openedAt) || now, ruleBreaks: body.grade === "A" && missing.length === 1 && missing[0] === "liquidity taken" ? [] : missing.map((m) => `skipped: ${m}`), maxR: null,
    };
    const resultR = R.round(R.rAt(t, exit));
    if (outcome === "exit" && resultR > 0 && resultR < s.tpAtR - 0.15) t.ruleBreaks.push("closed early (greed/fear)");
    // "flat" = out at the close-out time — that's the rule, not a break
    if (resultR < -1.15) t.ruleBreaks.push("lost more than 1R (stop moved?)");
    const j = { ...t, exit, closedAt: now, pnl: null, resultR, exitReason: outcome === "flat" ? "session close-out" : R.exitReason(t, exit, s), note: String(body.note || "").slice(0, 1000) };
    await store.hset("journal", j.id, j);
    return { trade: j };
  }
  if (a === "backtestLog") {
    // a trade you replayed by hand (TradingView Bar Replay) for one of the tested strategies — practice only
    // "sd" = your supply & demand style from the simulator: its target varies, so the result is the R you had
    const sp = strategyPlan(String(body.strategy || ""), body.market) || (body.strategy === "sd" && ["gold", "crude", "silver"].includes(body.market) ? { strategy: "sd", tpR: 20, beR: 0 } : null);
    if (!sp) throw new Error("Pick a strategy and one of its markets.");
    const dir = body.dir === "short" ? "short" : "long";
    const outcome = ["tp", "be", "sl", "flat"].includes(body.outcome) ? body.outcome : null;
    if (!outcome) throw new Error("How did it end? Target, break-even, stop or close-out.");
    const flatR = num(body.r);
    if (outcome === "flat" && flatR == null) throw new Error("Enter the R you had at the close-out (e.g. 0.6 or -0.4).");
    const resultR = R.round(outcome === "tp" ? sp.tpR : outcome === "be" ? 0 : outcome === "sl" ? -1 : Math.max(-1, Math.min(sp.tpR, flatR)));
    const when = Date.parse(String(body.date || "")) || now;
    const rulesOk = body.rulesOk !== false;
    const j = {
      id: `practice:${id()}`, source: "backtest", practice: true, strategy: sp.strategy, tpR: sp.tpR, beR: sp.beR, market: body.market, dir,
      grade: rulesOk ? "A+" : "unplanned", ruleBreaks: rulesOk ? [] : ["didn't follow the rules"], openedAt: when, closedAt: when, resultR,
      exitReason: { tp: "target", be: "break-even", sl: "stop", flat: "session close-out" }[outcome] + " (replay)", note: String(body.note || "").slice(0, 500), maxR: null,
    };
    // how you placed it (the Style lab learns your stop and target from these)
    const st = body.style || {};
    if (Number.isFinite(Number(st.stopFrac)) || Number.isFinite(Number(st.tpR))) j.style = { stopFrac: num(st.stopFrac), tpR: num(st.tpR), beAt: num(st.beAt) };
    await store.hset("journal", j.id, j);
    return { trade: j };
  }
  if (a === "teachLog") {
    // "Teach Edge": a practice trade with everything you saw — the zones you drew (and on which timeframe), where you
    // entered, your stop and target, how it ended and why you took it. Edge learns your eye from these.
    const ex = body.example || {};
    const clean = (v, n) => String(v == null ? "" : v).slice(0, n);
    const nums = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(o[k])]));
    const draws = (Array.isArray(ex.draws) ? ex.draws : []).slice(0, 60).map((d) => ({ type: clean(d.type, 4), tf: num(d.tf), ...nums(d, ["p", "p1", "p2", "t1", "t2"]), label: clean(d.label, 40) }));
    const j = {
      id: `teach:${id()}`, at: now, market: clean(ex.market, 12), dir: ex.dir === "short" ? "short" : "long", ...nums(ex, ["tIn", "tOut", "e", "sl", "tp", "R", "usd", "viewTf"]),
      how: clean(ex.how, 40), draws, note: clean(ex.note, 1000), simDay: clean(ex.simDay, 12),
      // the simulator's scorecard against your playbook: which steps you kept and which you missed
      score: (Array.isArray(ex.score) ? ex.score : []).slice(0, 12).map((c) => ({ id: clean(c.id, 12), ok: !!c.ok, title: clean(c.title, 80), text: clean(c.text, 240) })),
    };
    if (j.e == null || j.sl == null || !j.market) throw new Error("Missing the trade's entry or stop.");
    await store.hset("teach", j.id, j);
    const all = Object.values((await store.hgetall("teach")) || {}).sort((x, y) => y.at - x.at);
    for (const old of all.slice(300)) await store.hdel("teach", old.id); // keep your last 300 examples
    return { example: j, count: Math.min(all.length, 300) };
  }
  if (a === "teachNote") {
    const id0 = String(body.id || ""), ex = id0.startsWith("teach:") ? await store.hget("teach", id0) : null;
    if (!ex) throw new Error("That example isn't saved any more.");
    ex.note = String(body.note || "").slice(0, 1000);
    await store.hset("teach", ex.id, ex);
    return { example: ex };
  }
  if (a === "teachList") {
    const all = Object.values((await store.hgetall("teach")) || {}).sort((x, y) => y.at - x.at);
    return { examples: all };
  }
  if (a === "chartSetup") {
    // the free chart reader saw the script's ENTER signal (the script only shows it when every A+ step is done)
    const market = marketOf(body.symbol || "") || (MARKETS[body.market] ? body.market : null);
    // the supply & demand script (what the chart reader reads) was tested on these three only
    if (!["gold", "crude", "natgas"].includes(market)) throw new Error("The supply & demand script is for gold, crude oil and natural gas — open one of those charts.");
    const dir = body.dir === "short" ? "short" : "long";
    const entry = num(body.entry), sl = num(body.sl);
    if (entry == null || sl == null || R.sign(dir) * (entry - sl) <= 0) throw new Error("Couldn't read a clean entry and stop — check the numbers.");
    const all = Object.values((await store.hgetall("setups")) || {});
    const same = all.find((x) => x && x.market === market && x.dir === dir && x.entry === entry && x.sl === sl && now - x.at < 4 * 3600e3);
    if (same) return { setupId: same.id, existing: true };
    // the script prints A+ (liquidity taken) or A (first visit to the zone, no sweep)
    const swept = body.grade !== "A";
    const r = await createSetup(store, market, { symbol: String(body.symbol || "").slice(0, 20), dir, entry, sl, trend4h: R.sign(dir), zoneFresh: true, bos15: true, close5: true, stopOk: true, sweep: swept, sweepName: swept ? "chart" : "" }, now, { source: "chart" });
    if (r.error) throw new Error(r.error);
    return { setupId: r.setup.id, grade: r.grade, takeable: r.takeable, why: r.why };
  }
  if (a === "chartPrice") {
    // the free chart reader's live price → the same trade manager the TradingView heartbeat uses
    const market = marketOf(body.symbol || "") || (MARKETS[body.market] ? body.market : null);
    const price = num(body.price);
    if (!market || price == null || price <= 0) throw new Error("Couldn't read the price.");
    // a misread digit must never close a trade: ignore prices far from your open trade
    const mine = Object.values((await store.hgetall("trades")) || {}).filter((t) => t.market === market);
    if (mine.some((t) => Math.abs(price / t.entry - 1) > 0.04)) throw new Error(`Read ${price} off the chart — too far from your trade, ignored. Make the EDGE line bigger or zoom the browser.`);
    const mark = { price, high: price, low: price, time: now, symbol: String(body.symbol || "").slice(0, 20), bos15: "", source: "screen" };
    await store.set(`price:${market}`, mark);
    const res = await syncTrades(store, broker, { now, market, mark, force: true });
    const s = mergeSettings(await store.get("settings"));
    const open = Object.values((await store.hgetall("trades")) || {}).filter((t) => t.market === market);
    return { market, price, closed: res.closed || 0, closedAll: !!res.closedAll, trades: open.map((t) => ({ id: t.id, dir: t.dir, entry: t.entry, grade: t.grade, beMoved: !!t.beMoved, ...guide(t, s, price) })) };
  }
  if (a === "tvSetup") return { secret: process.env.EDGE_HOOK_SECRET || null };
  if (a === "closeAll") return closeAll(store, broker, { now });
  if (a === "autoBias") return fundamentals.load(store, { force: true, now });
  if (a === "testAlert") {
    const ok = await notify(store, "👋 Edge is connected. Only A+ from here.", "info");
    return { ok, sent: ok };
  }
  if (a === "pushSubscribe") { await subscribe(store, body.subscription, body.label); return { ok: true }; }
  if (a === "pushUnsubscribe") { await unsubscribe(store, body.endpoint); return { ok: true }; }
  throw new Error(`Unknown action: ${a}`);
}

module.exports = { gamePlan, guide, createSetup, createPlan, handleHook, syncTrades, newsReminders, closeAll, closeOutCheck, state, action, take, context, gradeNow, stats };
