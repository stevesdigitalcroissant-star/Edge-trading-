// Edge ↔ MetaTrader 5. Steve's own EA ("EdgeBridge", mt5/EdgeBridge.mq5) runs in MT5 on his computer: every couple of
// seconds it asks Edge for orders (GET /api/mt5) and reports the account, open trades and closed trades back (POST).
// Edge never logs in to MT5 — the EA holds the connection; Edge only queues what he confirmed in the app.
// The EA authenticates with its own key (Settings → MetaTrader 5); only the key's sha256 is stored.
const crypto = require("crypto");
const { MARKETS, marketOf } = require("./_config");

const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
// Tradeify FX 2-Step Classic 5K by default: $500 static max loss (floor $4,500), $150 daily loss, 3 trades a day.
const DEFAULT_RULES = { size: 5000, floor: 4500, daily: 150, maxTrades: 3, firm: "Tradeify FX · Classic 5K" };

async function newKey(store) {
  const key = "edge_mt_" + crypto.randomBytes(24).toString("base64url");
  await store.set("mt5Key", { hash: sha(key), at: Date.now() });
  return { key };
}
async function revokeKey(store) { await store.set("mt5Key", null); return { ok: true }; }
async function keyOk(store, headers, query) {
  const tok = String((headers && (headers.authorization || headers["x-edge-key"])) || (query && query.get && query.get("key")) || "").replace(/^Bearer\s+/i, "").trim();
  const rec = await store.get("mt5Key");
  if (!tok.startsWith("edge_mt_") || !rec || !rec.hash) return false;
  return crypto.timingSafeEqual(Buffer.from(sha(tok)), Buffer.from(rec.hash));
}

const rulesOf = async (store) => ({ ...DEFAULT_RULES, ...((await store.get("mt5:rules")) || {}) });
async function setRules(store, b) {
  const cur = await rulesOf(store), out = { ...cur };
  for (const k of ["size", "floor", "daily", "maxTrades"]) if (num(b[k]) != null && num(b[k]) >= 0) out[k] = num(b[k]);
  if (b.firm != null) out.firm = String(b.firm).slice(0, 60);
  if (out.floor >= out.size) throw new Error("The max-loss floor has to be below the account size.");
  await store.set("mt5:rules", out);
  return out;
}

// What the prop firm still allows right now, from the EA's last report.
function room(rules, acct, tradesToday) {
  if (!acct) return null;
  const toFloor = acct.equity - rules.floor, dayLeft = rules.daily + Math.min(0, acct.dayPnl || 0);
  return { toFloor: Math.round(toFloor * 100) / 100, dayLeft: Math.round(dayLeft * 100) / 100, tradesLeft: Math.max(0, rules.maxTrades - tradesToday) };
}
const dayKey = (t) => new Date(t - 5 * 3600e3).toISOString().slice(0, 10); // trading day ≈ New York date

// Steve tapped "Send to MT5" (or a TradingView setup): check it against the prop rules, then queue it for the EA.
async function queue(store, b, now = Date.now()) {
  const market = MARKETS[b.market] ? b.market : marketOf(b.symbol);
  if (!market || !MARKETS[market].fx) throw new Error("Pick one of your forex pairs.");
  const side = b.side === "sell" || b.dir === "short" ? "sell" : "buy", type = b.type === "market" ? "market" : "limit";
  const entry = num(b.entry), sl = num(b.sl), tp = num(b.tp), risk = num(b.riskUSD);
  if (sl == null || tp == null || !(risk > 0)) throw new Error("Entry, stop, target and risk are needed.");
  if (type === "limit" && entry == null) throw new Error("A limit order needs its entry price.");
  const ref = entry ?? null;
  if (ref != null && (side === "buy" ? !(sl < ref && tp > ref) : !(sl > ref && tp < ref))) throw new Error(side === "buy" ? "On a buy: stop below the entry, target above." : "On a sell: stop above the entry, target below.");
  const [rules, live, sent] = await Promise.all([rulesOf(store), store.get("mt5:live"), store.hgetall("mt5:cmd")]);
  const acct = live && live.account;
  const today = Object.values(sent || {}).filter((c) => c.type === "open" && c.status !== "error" && c.status !== "cancelled" && dayKey(c.at) === dayKey(now)).length;
  const r = room(rules, acct, today);
  if (!acct || now - acct.at > 120e3) throw new Error("MT5 isn't connected — open MetaTrader 5 with the EdgeBridge EA on a chart (Settings → MetaTrader 5).");
  if (r.tradesLeft <= 0) throw new Error(`That's ${rules.maxTrades} trades today — your limit. Done for the day.`);
  if (risk > r.dayLeft) throw new Error(`Only $${r.dayLeft} left before the $${rules.daily} daily loss limit — this trade risks $${risk}.`);
  if (risk > r.toFloor - 10) throw new Error(`Equity is $${r.toFloor} above the max-loss floor ($${rules.floor}) — risking $${risk} could breach the account.`);
  const id = now.toString(36) + Math.random().toString(36).slice(2, 6);
  const symbol = (acct.prefix || "") + MARKETS[market].mt5 + (acct.suffix || "");
  const cmd = { id, type: "open", market, symbol, side, order: type, entry: ref, sl, tp, riskUSD: risk, at: now, status: "pending", note: String(b.note || "").slice(0, 200) };
  await store.hset("mt5:cmd", id, cmd);
  return { queued: cmd, room: r };
}
async function closeTicket(store, ticket, kind = "close", now = Date.now()) {
  const id = now.toString(36) + Math.random().toString(36).slice(2, 6);
  const cmd = { id, type: kind === "cancel" ? "cancel" : "close", ticket: String(ticket).replace(/\D/g, ""), at: now, status: "pending" };
  if (!cmd.ticket) throw new Error("Which trade?");
  await store.hset("mt5:cmd", id, cmd);
  return { queued: cmd };
}

// The EA's report (POST) is answered with the orders waiting for it; GET returns only the orders.
// One command per line, fields split by "|" (MQL5 has no JSON parser).
//   id|open|SYMBOL|buy|limit|entry|sl|tp|riskUSD      id|close|ticket      id|cancel|ticket
async function poll(store, now = Date.now()) {
  const all = Object.values((await store.hgetall("mt5:cmd")) || {}).filter((c) => c.status === "pending" || (c.status === "sent" && now - c.sentAt > 60e3 && (c.tries || 0) < 3));
  const lines = [];
  for (const c of all.sort((a, b) => a.at - b.at)) {
    if (c.type === "open" && now - c.at > 10 * 60e3) { await store.hset("mt5:cmd", c.id, { ...c, status: "cancelled", error: "MT5 didn't pick it up within 10 minutes" }); continue; }
    lines.push(c.type === "open" ? [c.id, "open", c.symbol, c.side, c.order, c.entry ?? 0, c.sl, c.tp, c.riskUSD].join("|") : [c.id, c.type, c.ticket].join("|"));
    await store.hset("mt5:cmd", c.id, { ...c, status: "sent", sentAt: now, tries: (c.tries || 0) + 1 });
  }
  return lines.join("\n");
}

// POST from the EA: account, open positions, pending orders, closed trades (last 3 days) and acks of commands.
async function report(store, b, now = Date.now()) {
  const { notify } = require("./_notify");
  const acct = { at: now, login: String(b.login || ""), server: String(b.server || "").slice(0, 60), currency: String(b.currency || "USD").slice(0, 6),
    balance: num(b.balance), equity: num(b.equity), dayPnl: num(b.dayPnl) ?? 0, prefix: String(b.prefix || "").slice(0, 10), suffix: String(b.suffix || "").slice(0, 10) };
  const pos = (Array.isArray(b.positions) ? b.positions : []).slice(0, 50).map((p) => ({ ticket: String(p.ticket), symbol: String(p.symbol), market: marketOf(p.symbol), dir: p.type === "sell" ? "short" : "long", volume: num(p.volume), open: num(p.open), sl: num(p.sl), tp: num(p.tp), profit: num(p.profit), time: num(p.time) * 1000 || null, edge: String(p.comment || "").startsWith("edge:") ? String(p.comment).slice(5) : null }));
  const ord = (Array.isArray(b.orders) ? b.orders : []).slice(0, 50).map((o) => ({ ticket: String(o.ticket), symbol: String(o.symbol), market: marketOf(o.symbol), dir: /sell/.test(o.type) ? "short" : "long", volume: num(o.volume), price: num(o.price), sl: num(o.sl), tp: num(o.tp), edge: String(o.comment || "").startsWith("edge:") ? String(o.comment).slice(5) : null }));
  await store.set("mt5:live", { account: acct, positions: pos, orders: ord });
  for (const a of Array.isArray(b.acks) ? b.acks.slice(0, 20) : []) {
    const c = await store.hget("mt5:cmd", String(a.id)); if (!c) continue;
    const ok = a.ok === true || a.ok === "true" || a.ok === 1;
    await store.hset("mt5:cmd", c.id, { ...c, status: ok ? "done" : "error", ticket: a.ticket ? String(a.ticket) : c.ticket, volume: num(a.volume), error: ok ? null : String(a.err || "MT5 refused it").slice(0, 200), doneAt: now });
    if (c.type === "open") await notify(store, ok ? `📤 ${MARKETS[c.market].name} ${c.side.toUpperCase()} ${c.order} sent to MT5: ${num(a.volume) ?? "?"} lots, stop ${c.sl}, target ${c.tp} (risk $${c.riskUSD}).` : `⚠️ MT5 refused the ${MARKETS[c.market].name} ${c.side} order: ${String(a.err || "").slice(0, 120)}`, ok ? "info" : "warn");
  }
  // closed trades → the journal, once each (R from the risk Edge sent, else from the stop distance)
  let added = 0;
  for (const d of (Array.isArray(b.closed) ? b.closed : []).slice(0, 100)) {
    const id = `mt5:${String(d.position).replace(/\D/g, "")}`; if (id === "mt5:" || await store.hget("journal", id)) continue;
    const market = marketOf(d.symbol); if (!market) continue;
    const cmdId = String(d.comment || "").startsWith("edge:") ? String(d.comment).slice(5) : null, c = cmdId ? await store.hget("mt5:cmd", cmdId) : null;
    const dir = d.type === "sell" ? "short" : "long", entry = num(d.open), exit = num(d.close), pnl = num(d.profit), sl = num(d.sl) ?? (c && c.sl);
    const riskUSD = c ? c.riskUSD : null, R = riskUSD ? Math.round((pnl / riskUSD) * 100) / 100 : sl != null && entry != null && sl !== entry ? Math.round((((dir === "long" ? 1 : -1) * (exit - entry)) / Math.abs(entry - sl)) * 100) / 100 : null;
    const t = { id, source: "mt5", market, dir, entry, initialSL: sl ?? null, currentSL: sl ?? null, tp: num(d.tp) ?? (c && c.tp), exit, resultR: R, pnl, volume: num(d.volume),
      openedAt: num(d.openTime) * 1000 || now, closedAt: num(d.closeTime) * 1000 || now, viaEdge: !!c, emotion: null, followedRules: null, grade: c ? "A+" : "unplanned", ruleBreaks: c ? [] : ["placed outside Edge"], tags: c ? [] : ["outside Edge"], note: "", maxR: null };
    await store.hset("journal", id, t); added++;
    if (now - t.closedAt < 30 * 60e3) await notify(store, `${pnl >= 0 ? "💰" : "🩹"} ${MARKETS[market].name} ${dir} closed: ${pnl >= 0 ? "+" : ""}$${pnl?.toFixed(2)}${R != null ? ` (${R > 0 ? "+" : ""}${R}R)` : ""}. Tell David how it went — he'll write it up.`, "closed");
  }
  return { ok: true, positions: pos.length, orders: ord.length, journaled: added };
}

// For the app and David.
async function read(store, now = Date.now()) {
  const [live, cmds, rules] = await Promise.all([store.get("mt5:live"), store.hgetall("mt5:cmd"), rulesOf(store)]);
  const acct = live && live.account, pos = live && live.positions, ord = live && live.orders;
  const list = Object.values(cmds || {}).sort((a, b) => b.at - a.at);
  const today = list.filter((c) => c.type === "open" && c.status !== "error" && c.status !== "cancelled" && dayKey(c.at) === dayKey(now)).length;
  return { connected: !!(acct && now - acct.at < 120e3), lastSeenSec: acct ? Math.round((now - acct.at) / 1000) : null, account: acct, rules, room: room(rules, acct, today), positions: pos || [], orders: ord || [], recent: list.slice(0, 10), keySet: !!(await store.get("mt5Key")) };
}

module.exports = { newKey, revokeKey, keyOk, setRules, rulesOf, queue, closeTicket, poll, report, read, room, DEFAULT_RULES };
