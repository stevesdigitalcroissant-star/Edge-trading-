// Setups from TradingView's "Edge · FX Playbook" (15m): kept for 8 hours so he can send one to MT5 from the app with one tap.
const { MARKETS, marketOf } = require("./_config");
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const arrow = (v) => (Number(v) > 0 ? "▲" : Number(v) < 0 ? "▼" : "◆");

async function fxHook(store, msg, now = Date.now()) {
  const { notify, toDavid } = require("./_notify");
  const market = marketOf(msg.tv || msg.pair);
  if (!market || !MARKETS[market].fx) return { status: 200, json: { ignored: `Not one of your forex pairs: ${msg.pair}` } };
  const side = msg.side === "sell" ? "sell" : "buy", entry = num(msg.entry), sl = num(msg.sl), tp = num(msg.tp);
  if (entry == null || sl == null || tp == null || (side === "buy" ? !(sl < entry && tp > entry) : !(sl > entry && tp < entry))) return { status: 400, json: { error: "Setup needs entry, stop and target on the right sides" } };
  const rr = Math.round((Math.abs(tp - entry) / Math.abs(entry - sl)) * 10) / 10, t = msg.trend || {};
  const s = { id: now.toString(36) + Math.random().toString(36).slice(2, 5), at: now, market, side, entry, sl, tp, rr, tf: String(msg.tf || "15").slice(0, 4), trend: { d: num(t.d), h4: num(t.h4), h1: num(t.h1) }, why: String(msg.why || "").slice(0, 200) };
  await store.lpush("fx:setups", s, 30);
  const text = `📣 ${MARKETS[market].name} ${side.toUpperCase()} setup (${s.tf}m): limit ${entry} · stop ${sl} · target ${tp} (1:${rr}). Trend D${arrow(t.d)} 4H${arrow(t.h4)} 1H${arrow(t.h1)}. Check it on the chart, then Edge → Send to MT5.`;
  await notify(store, text, "setup");
  await toDavid(store, { kind: "setup", source: "tradingview", ...s, text }).catch(() => {});
  return { status: 200, json: { ok: true, setup: s.id } };
}
async function fxRead(store, now = Date.now()) {
  return ((await store.lrange("fx:setups", 30)) || []).filter((s) => now - s.at < 8 * 3600e3);
}
module.exports = { fxHook, fxRead };
