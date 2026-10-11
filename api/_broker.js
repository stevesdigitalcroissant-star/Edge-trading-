// Broker connection. OANDA (v20 REST API) is built in: it is one of the brokers
// you can trade from inside TradingView, and it offers XAU_USD, WTICO_USD,
// BCO_USD and NATGAS_USD. Without OANDA keys the app runs in "manual" mode: it
// shows you the exact numbers and tells you when to move your stop, and you
// click in TradingView yourself.
//
// Env: OANDA_TOKEN, OANDA_ACCOUNT_ID, OANDA_ENV = practice | live (default practice)

function oanda() {
  const host = process.env.OANDA_ENV === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
  const acct = process.env.OANDA_ACCOUNT_ID;
  const info = {};

  async function call(method, path, body) {
    const r = await fetch(`${host}/v3/accounts/${acct}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.OANDA_TOKEN}`, "Content-Type": "application/json", "Accept-Datetime-Format": "UNIX" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OANDA: ${j.errorMessage || r.status}`);
    return j;
  }

  async function instrument(name) {
    if (!info[name]) {
      const j = await call("GET", `/instruments?instruments=${name}`);
      const i = (j.instruments || [])[0];
      if (!i) throw new Error(`OANDA: ${name} isn't available on this account`);
      info[name] = { digits: i.displayPrecision, unitsDigits: i.tradeUnitsPrecision, minUnits: Number(i.minimumTradeSize) || 1 };
    }
    return info[name];
  }
  const fmt = (x, digits) => Number(x).toFixed(digits);

  const toTrade = (t) => ({
    brokerId: String(t.id),
    instrument: t.instrument,
    dir: Number(t.currentUnits || t.initialUnits) < 0 ? "short" : "long",
    units: Math.abs(Number(t.currentUnits || t.initialUnits)),
    entry: Number(t.price),
    currentSL: t.stopLossOrder ? Number(t.stopLossOrder.price) : null,
    tp: t.takeProfitOrder ? Number(t.takeProfitOrder.price) : null,
    openedAt: Math.round(Number(t.openTime) * 1000),
    state: t.state,
    exit: t.averageClosePrice != null ? Number(t.averageClosePrice) : null,
    pnl: t.realizedPL != null ? Number(t.realizedPL) : null,
    closedAt: t.closeTime ? Math.round(Number(t.closeTime) * 1000) : null,
  });

  return {
    kind: "oanda",
    label: `OANDA ${process.env.OANDA_ENV === "live" ? "live" : "practice"}`,
    async account() {
      const a = (await call("GET", "/summary")).account;
      return { balance: Number(a.balance), nav: Number(a.NAV), currency: a.currency };
    },
    // { XAU_USD: { bid, ask } }
    async prices(instruments) {
      if (!instruments.length) return {};
      const j = await call("GET", `/pricing?instruments=${[...new Set(instruments)].join(",")}`);
      const out = {};
      for (const p of j.prices || []) out[p.instrument] = { bid: Number(p.closeoutBid || p.bids[0].price), ask: Number(p.closeoutAsk || p.asks[0].price) };
      return out;
    },
    // Amount in account currency → USD.
    async toUSD(amount, currency) {
      if (currency === "USD") return amount;
      const p = await this.prices([`${currency}_USD`]).catch(() => ({}));
      if (p[`${currency}_USD`]) return amount * p[`${currency}_USD`].bid;
      const q = await this.prices([`USD_${currency}`]);
      return amount / q[`USD_${currency}`].ask;
    },
    async openTrades() {
      return ((await call("GET", "/openTrades")).trades || []).map(toTrade);
    },
    async trade(id) {
      return toTrade((await call("GET", `/trades/${id}`)).trade);
    },
    async marketOrder({ instrument: name, dir, units, sl, tp }) {
      const i = await instrument(name);
      const u = Math.floor(units * 10 ** i.unitsDigits) / 10 ** i.unitsDigits;
      if (u < i.minUnits) throw new Error(`Size too small for ${name} (${u} < ${i.minUnits} units). Use a bigger risk % or a tighter stop.`);
      const j = await call("POST", "/orders", {
        order: {
          type: "MARKET", instrument: name, units: String(dir === "short" ? -u : u), timeInForce: "FOK", positionFill: "DEFAULT",
          stopLossOnFill: { price: fmt(sl, i.digits), timeInForce: "GTC" },
          takeProfitOnFill: { price: fmt(tp, i.digits), timeInForce: "GTC" },
        },
      });
      const fill = j.orderFillTransaction;
      if (!fill || !fill.tradeOpened) throw new Error(`Order not filled: ${(j.orderCancelTransaction && j.orderCancelTransaction.reason) || "unknown reason"}`);
      return { brokerId: String(fill.tradeOpened.tradeID), price: Number(fill.tradeOpened.price || fill.price), units: Math.abs(Number(fill.tradeOpened.units)) };
    },
    async setOrders(id, instrumentName, { sl, tp }) {
      const i = await instrument(instrumentName);
      const body = {};
      if (sl != null) body.stopLoss = { price: fmt(sl, i.digits), timeInForce: "GTC" };
      if (tp != null) body.takeProfit = { price: fmt(tp, i.digits), timeInForce: "GTC" };
      await call("PUT", `/trades/${id}/orders`, body);
    },
    async close(id) {
      await call("PUT", `/trades/${id}/close`, { units: "ALL" });
    },
  };
}

// TradersPost: Edge sends the order (and the break-even move, and exits) to your
// Tradovate account through a TradersPost webhook — used by prop firms that allow
// it (check your firm's rules). It's one-way: Edge can't read the account, so it
// follows the trade from the TradingView price heartbeat.
// Env: TRADERSPOST_WEBHOOK_URL (the strategy's webhook URL from TradersPost).
function traderspost() {
  async function send(payload) {
    const r = await fetch(process.env.TRADERSPOST_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`TradersPost refused the order: ${j.message || j.error || r.status}`);
    return j;
  }
  const side = (dir) => (dir === "short" ? "sell" : "buy");
  return {
    kind: "traderspost",
    label: "TradersPost → your Tradovate account",
    send,
    // market order with the stop and the target attached (they live on the broker's servers)
    order: ({ ticker, dir, qty, sl, tp, price, ref, type = "market" }) => send({
      ticker, action: side(dir), orderType: type, ...(type === "limit" ? { limitPrice: price } : {}), quantityType: "fixed_quantity", quantity: qty, signalPrice: price,
      stopLoss: { type: "stop", stopPrice: sl }, takeProfit: { limitPrice: tp }, time: new Date().toISOString(), extras: { source: "edge", ref },
    }),
    breakeven: (ticker) => send({ ticker, action: "breakeven", orderType: "stop", time: new Date().toISOString() }),
    exit: (ticker) => send({ ticker, action: "exit", cancel: true, time: new Date().toISOString() }),
  };
}

// Tradovate, direct (its REST API — https://api.tradovate.com): Edge signs in to your account and places the order
// itself, as a bracket (entry + stop + target, OSO) — and it can read it back: when the limit fills, when the stop or
// target is hit, and it moves the stop on the platform when you lock in profit. Needs API access on the Tradovate
// account (Tradovate → Application Settings → API Access → generate a key: that gives the CID and secret).
// Env: TRADOVATE_USERNAME, TRADOVATE_PASSWORD, TRADOVATE_CID, TRADOVATE_SECRET, TRADOVATE_ENV = demo | live (default demo),
//      TRADOVATE_ACCOUNT (the account name, if you have several), TRADOVATE_CONTRACTS ("MGC=MGCZ6,MCL=MCLF7" to pin a month).
// Or connect it from the app (Settings → Connect Tradovate): the same details, saved encrypted in Edge's storage.
const TVS = {}; // per login, kept while the server instance lives: { token, exp, acct, contracts }
const fromEnv = () => ({ username: process.env.TRADOVATE_USERNAME, password: process.env.TRADOVATE_PASSWORD, cid: process.env.TRADOVATE_CID, secret: process.env.TRADOVATE_SECRET,
  env: process.env.TRADOVATE_ENV, account: process.env.TRADOVATE_ACCOUNT, contracts: process.env.TRADOVATE_CONTRACTS });
function tradovate(cfg = fromEnv()) {
  const env = cfg.env === "live" ? "live" : "demo";
  const base = env === "live" ? "https://live.tradovateapi.com/v1" : "https://demo.tradovateapi.com/v1";
  const TV = (TVS[`${env}:${cfg.username}`] = TVS[`${env}:${cfg.username}`] || { token: null, exp: 0, acct: null, contracts: {} });
  async function auth(force = false) {
    if (!force && TV.token && Date.now() < TV.exp - 120e3) return TV.token;
    const r = await net(`${base}/auth/accesstokenrequest`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ name: cfg.username, password: cfg.password, appId: "Edge", appVersion: "1.0",
        cid: Number(cfg.cid) || cfg.cid, sec: cfg.secret, deviceId: process.env.TRADOVATE_DEVICE_ID || "edge-trading-copilot" }),
    });
    const j = await r.json().catch(() => ({}));
    if (j["p-ticket"]) throw new Error(`Tradovate asked to wait ${j["p-time"] || "a few"} seconds before signing in again — try again shortly.`);
    if (!j.accessToken) throw new Error(`Tradovate sign-in failed: ${j.errorText || r.status}`);
    TV.token = j.accessToken; TV.exp = Date.parse(j.expirationTime) || Date.now() + 60 * 60e3;
    return TV.token;
  }
  const net = (url, opts) => fetch(url, opts).catch(() => { throw new Error(`Couldn't reach Tradovate (${env}) — check the connection and try again.`); });
  async function call(method, path, body, retry = true) {
    const r = await net(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${await auth()}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
    if (r.status === 401 && retry) { await auth(true); return call(method, path, body, false); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Tradovate: ${j.errorText || j.failureText || r.status}`);
    if (j && (j.errorText || j.failureReason) && !j.orderId && !Array.isArray(j)) throw new Error(`Tradovate refused it: ${j.failureText || j.errorText || j.failureReason}`);
    return j;
  }
  async function acct() {
    if (TV.acct) return TV.acct;
    const list = await call("GET", "/account/list");
    const want = cfg.account;
    const a = (list || []).find((x) => (want ? x.name === want : x.active !== false && !x.archived));
    if (!a) throw new Error(want ? `Tradovate: no account called ${want}` : "Tradovate: no active account");
    return (TV.acct = { id: a.id, name: a.name });
  }
  // "MGC1!" → the contract to trade now, e.g. "MGCZ6" (Tradovate's front month, unless you pinned one)
  async function contract(ticker) {
    const root = String(ticker || "").replace(/^[A-Z_]+:/i, "").toUpperCase().replace(/(\d!|[FGHJKMNQUVXZ]\d{1,2})$/, "");
    const pinned = Object.fromEntries(String(cfg.contracts || "").split(",").map((x) => x.split("=").map((y) => y.trim().toUpperCase())).filter((x) => x[1]));
    if (pinned[root]) return pinned[root];
    const hit = TV.contracts[root];
    if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.name;
    const list = (await call("GET", `/contract/suggest?t=${encodeURIComponent(root)}&l=12`)) || [];
    const mine = list.filter((c) => new RegExp(`^${root}[FGHJKMNQUVXZ]\\d{1,2}$`).test(c.name));
    if (!mine.length) throw new Error(`Tradovate: couldn't find a ${root} contract`);
    let pick = mine[0];
    const ids = [...new Set(mine.map((c) => c.contractMaturityId).filter(Boolean))];
    if (ids.length) {
      const mats = (await call("GET", `/contractMaturity/items?ids=${ids.join(",")}`).catch(() => [])) || [];
      const front = mats.find((m) => m.isFront);
      const soon = mats.filter((m) => Date.parse(m.expirationDate) > Date.now() + 2 * 864e5).sort((a, b) => Date.parse(a.expirationDate) - Date.parse(b.expirationDate))[0];
      const m = front || soon;
      if (m) pick = mine.find((c) => c.contractMaturityId === m.id) || pick;
    }
    TV.contracts[root] = { name: pick.name, at: Date.now() };
    return pick.name;
  }
  const side = (dir) => (dir === "short" ? "Sell" : "Buy"), other = (dir) => (dir === "short" ? "Buy" : "Sell");
  const fills = async (orderId) => { const f = (await call("GET", `/fill/deps?masterid=${orderId}`).catch(() => [])) || []; const q = f.reduce((a, x) => a + x.qty, 0); return q ? f.reduce((a, x) => a + x.price * x.qty, 0) / q : null; };
  return {
    kind: "tradovate", label: `Tradovate (${env === "live" ? "live" : "demo"} — direct)`, env,
    async account() { const a = await acct(); const c = await call("POST", "/cashBalance/getcashbalancesnapshot", { accountId: a.id }).catch(() => null); return { name: a.name, currency: "USD", balance: c ? c.totalCashValue : null }; },
    // entry (limit or market) with the stop and the target attached on Tradovate's servers
    async order({ ticker, dir, qty, sl, tp, price, type = "market" }) {
      const a = await acct(), symbol = await contract(ticker);
      const r = await call("POST", "/order/placeOSO", {
        accountSpec: a.name, accountId: a.id, action: side(dir), symbol, orderQty: qty, orderType: type === "limit" ? "Limit" : "Market", ...(type === "limit" ? { price } : {}), isAutomated: true,
        bracket1: { action: other(dir), orderType: "Stop", stopPrice: sl },
        bracket2: { action: other(dir), orderType: "Limit", price: tp },
      });
      if (!r.orderId) throw new Error(`Tradovate refused the order: ${r.failureText || r.errorText || "no order id"}`);
      return { orderId: r.orderId, stopId: r.oso1Id, tpId: r.oso2Id, symbol, accountId: a.id };
    },
    async status(orderId) { const o = await call("GET", `/order/item?id=${orderId}`); return { status: o.ordStatus, price: /Filled/.test(o.ordStatus) ? await fills(orderId) : null }; },
    async moveStop(t, stopPrice) { const tv = t.tv || {}; if (!tv.stopId) throw new Error("no stop order on Tradovate"); await call("POST", "/order/modifyorder", { orderId: tv.stopId, orderQty: t.units, orderType: "Stop", stopPrice, isAutomated: true }); },
    async cancel(orderId) { await call("POST", "/order/cancelorder", { orderId, isAutomated: true }); },
    breakeven: async () => { throw new Error("use moveStop"); },
    // close: cancel what's still working (entry / stop / target), then flatten the position
    async exit(ticker, t) {
      const tv = (t && t.tv) || {}, a = await acct();
      for (const id of [tv.orderId, tv.stopId, tv.tpId].filter(Boolean)) await call("POST", "/order/cancelorder", { orderId: id, isAutomated: true }).catch(() => {});
      const name = tv.symbol || (await contract(ticker));
      const c = await call("GET", `/contract/find?name=${encodeURIComponent(name)}`).catch(() => null);
      if (c && c.id) await call("POST", "/order/liquidatePosition", { accountId: a.id, contractId: c.id, admin: false }).catch((e) => { if (!/no position|not found/i.test(e.message)) throw e; });
    },
  };
}

function getBroker() {
  if (process.env.OANDA_TOKEN && process.env.OANDA_ACCOUNT_ID) return oanda();
  if (process.env.TRADOVATE_USERNAME && process.env.TRADOVATE_PASSWORD && process.env.TRADOVATE_CID && process.env.TRADOVATE_SECRET) return tradovate(fromEnv());
  if (process.env.TRADERSPOST_WEBHOOK_URL) return traderspost();
  return { kind: "manual", label: "Manual (no broker connected)" };
}

// ---------- Tradovate connected from the app: the details are encrypted (AES-256-GCM) before they're stored,
// and never sent back to the browser.
const crypto = require("crypto");
async function vaultKey(store) {
  let k = await store.get("vaultKey");
  if (!k) { k = crypto.randomBytes(32).toString("hex"); await store.set("vaultKey", k); }
  return crypto.createHash("sha256").update(`${process.env.EDGE_SECRET_KEY || ""}:${k}`).digest();
}
async function seal(store, obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", await vaultKey(store), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
async function unseal(store, box) {
  const d = crypto.createDecipheriv("aes-256-gcm", await vaultKey(store), Buffer.from(box.iv, "base64"));
  d.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, "base64")), d.final()]).toString("utf8"));
}
// the broker to use for this request: one set in Vercel wins; otherwise the Tradovate account you connected in the app
async function brokerFor(store) {
  const b = getBroker();
  if (b.kind !== "manual" || !store) return b;
  const box = await store.get("tradovateConn").catch(() => null);
  if (!box) return b;
  try { return tradovate(await unseal(store, box)); } catch { return b; }
}
// Settings → Connect Tradovate: sign in once to check the details, then save them (sealed)
async function connectTradovate(store, body) {
  const cfg = { username: String(body.username || "").trim(), password: String(body.password || ""), cid: String(body.cid || "").trim(), secret: String(body.secret || "").trim(),
    env: body.env === "live" ? "live" : "demo", account: String(body.account || "").trim() || undefined };
  if (!cfg.username || !cfg.password || !cfg.cid || !cfg.secret) throw new Error("Fill in all four: username, password, API key ID and secret.");
  delete TVS[`${cfg.env}:${cfg.username}`];
  const a = await tradovate(cfg).account(); // throws with Tradovate's own message if anything's wrong
  await store.set("tradovateConn", await seal(store, cfg));
  return { ok: true, account: a };
}
async function disconnectTradovate(store) { await store.del("tradovateConn"); return { ok: true }; }

module.exports = { getBroker, brokerFor, connectTradovate, disconnectTradovate };
