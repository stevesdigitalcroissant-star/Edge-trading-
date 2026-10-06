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

function getBroker() {
  if (process.env.OANDA_TOKEN && process.env.OANDA_ACCOUNT_ID) return oanda();
  return { kind: "manual", label: "Manual (no broker connected)" };
}

module.exports = { getBroker };
