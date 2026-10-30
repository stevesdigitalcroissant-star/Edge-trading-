// Level watch — Steve's S/R rules run by Edge itself, so he hears about his levels with the app closed and no
// TradingView alert set up. Runs from the 1-minute tick, does real work every 5 minutes, closed candles only.
//  · Touch: a closed 15m candle comes within 0.25 × 15m ATR of one of HIS levels → one alert. That level then stays
//    quiet until a 15m close is 1.5 × ATR away (it has LEFT), then it can alert again.
//  · Entry (once, within 12 five-minute candles of the touch): the 5m Heikin Ashi flips his way + the 5m candle closes
//    back on the right side of the level + the 5m 80 SMA agrees → "BUY / SELL setup". Edge never trades: it tells him.
// Yahoo futures candles, a few minutes behind. Alerts go to his phones (push), Telegram, and David when linked.
const { notify, toDavid } = require("./_notify");

const EVERY = 5 * 60e3, TOUCH = 0.25, LEAVE = 1.5, ENTRY_BARS = 12;
const fx = (v) => +Number(v).toPrecision(6);
const word = (t) => (t === "up" ? "up" : t === "down" ? "down" : t === "mixed" ? "mixed" : "?");

async function levelWatch(store, now = Date.now(), deps = {}) {
  const last = (await store.get("lw:at")) || 0;
  if (now - last < EVERY - 30e3) return { skipped: true };
  await store.set("lw:at", now);
  const mcp = deps.mcp || require("./mcp");
  const load = deps.load || require("./candles").load;
  const levels = (await store.get("levels")) || {};
  const st = (await store.get("lw:state")) || {};
  const events = [];
  await Promise.all(Object.entries(levels).filter(([m, v]) => Array.isArray(v) && v.length && mcp.ALL_MARKETS.includes(m)).map(async ([m, lv]) => {
    let raw;
    try { raw = await load(m, 5, "5m"); } catch { return; }
    raw = (raw || []).filter((b) => b[0] + 5 * 60e3 <= now); // closed candles only
    if (raw.length < 100) return;
    const m5 = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
    const m15 = mcp.agg(raw, 15).filter((b) => b.t + 15 * 60e3 <= now);
    const atr = mcp.atrOf(m15.slice(-120));
    if (!atr || m15.length < 3) return;
    const ha5 = mcp.heikin(m5), closes5 = m5.map((b) => b.c);
    const S = (st[m] = st[m] || { last15: m15[m15.length - 2].t, lv: {} });
    for (const k of Object.keys(S.lv)) if (!lv.map(String).includes(k)) delete S.lv[k]; // a level he removed
    for (const bar of m15.filter((b) => b.t > S.last15)) {
      for (const L of lv) {
        const k = String(L), x = (S.lv[k] = S.lv[k] || { armed: true });
        if (!x.armed && Math.abs(bar.c - L) >= LEAVE * atr) x.armed = true;
        if (x.armed && bar.l - TOUCH * atr <= L && L <= bar.h + TOUCH * atr) {
          const side = bar.o >= L ? "support" : "resistance";
          Object.assign(x, { armed: false, touch: bar.t + 15 * 60e3, side, setup: false });
          events.push({ kind: "level", market: m, level: L, side, price: bar.c, at: bar.t });
        }
      }
      S.last15 = bar.t;
    }
    for (const L of lv) { // entry check on the 5m after a touch
      const x = S.lv[String(L)];
      if (!x || !x.touch || x.setup) continue;
      const after = m5.map((b, i) => [b, i]).filter(([b]) => b.t + 5 * 60e3 > x.touch - 15 * 60e3 && b.t > (x.seen5 || 0));
      for (const [b, i] of after) {
        x.seen5 = b.t;
        if (b.t >= x.touch + ENTRY_BARS * 5 * 60e3) { x.setup = true; break; } // too late: wait for the next touch
        const prev = ha5[i - 1], cur = ha5[i], sma = closes5.length > 80 ? mcp.sma(closes5.slice(0, i + 1), 80) : null;
        if (!prev || sma == null) continue;
        const buy = x.side === "support" && !prev.green && cur.green && b.c > L && b.c > sma;
        const sell = x.side === "resistance" && prev.green && !cur.green && b.c < L && b.c < sma;
        if (buy || sell) { x.setup = true; events.push({ kind: "setup", market: m, level: L, side: x.side, dir: buy ? "long" : "short", price: b.c, at: b.t }); break; }
      }
    }
  }));
  await store.set("lw:state", st);
  for (const e of events) await tell(store, e, mcp).catch(() => {});
  if (events.length) await store.lpush("lw:events", { ...events[0], all: events.length, ran: now }, 50).catch(() => {});
  return { events };
}

async function tell(store, e, mcp) {
  const name = e.market.toUpperCase();
  let ctx = "";
  try {
    const r = await mcp.readOne(e.market, [e.level]);
    ctx = ` Trend: Daily ${word(r.trends.daily)} · 4H ${word(r.trends.h4)} · 1H ${word(r.trends.h1)}. 15m ${r.sma15 || "?"} the 80 SMA, 5m Heikin Ashi ${r.ha5 || "?"}.`;
    e.trend = r.trends; e.sma15 = r.sma15; e.ha5 = r.ha5;
  } catch {}
  const text = e.kind === "setup"
    ? `${e.dir === "long" ? "🟢" : "🔴"} ${name} ${e.dir === "long" ? "BUY" : "SELL"} setup at your ${e.side} ${fx(e.level)}: the 5m Heikin Ashi flipped your way, closed back ${e.dir === "long" ? "above" : "below"} the level and ${e.dir === "long" ? "above" : "below"} the 80 SMA (${fx(e.price)}).${ctx} Your call — check it on the chart.`
    : `📍 ${name} is at your ${e.side} ${fx(e.level)} (${fx(e.price)}).${ctx} Wait for the 5m Heikin Ashi to turn ${e.side === "support" ? "green and a close back above" : "red and a close back below"} it.`;
  await notify(store, text, e.kind === "setup" ? "setup" : "level");
  await toDavid(store, { ...e, text });
}

module.exports = { levelWatch };
