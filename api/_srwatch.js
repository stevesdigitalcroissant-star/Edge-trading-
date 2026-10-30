// Your TradingView "Edge · S/R Watch" talking to Edge: every touch / entry at one of your levels, and a status of all
// your pairs on each candle close. Edge keeps the latest status + the last 50 events (for David and the Today card)
// and sends you a clean notification for touches and entries (the status itself never buzzes you).
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const clip = (v, n) => String(v ?? "").slice(0, n);

async function srHook(store, msg, now = Date.now()) {
  const { notify } = require("./_notify");
  if (msg.event === "status") {
    const rows = (Array.isArray(msg.rows) ? msg.rows : []).slice(0, 20).map((r) => ({
      pair: clip(r.p, 24), price: num(r.px), level: num(r.lv), side: r.sd === "R" ? "resistance" : "support", distanceATR: num(r.d),
      state: ["armed", "touched", "entry"].includes(r.st) ? r.st : "armed", sma80: r.sma === "below" ? "below" : "above", heikinAshi: clip(r.ha, 16) }));
    const t = msg.trend || {}, dir = (v) => (Number(v) > 0 ? "up" : Number(v) < 0 ? "down" : "mixed");
    await store.set("sr:status", { at: now, chart: clip(msg.chart, 24), tf: clip(msg.tf, 6), trend: { daily: dir(t.d), h4: dir(t.h4), h1: dir(t.h1) }, rows });
    return { status: 200, json: { ok: true, rows: rows.length } };
  }
  if (msg.event === "touch" || msg.event === "entry") {
    const e = { at: now, event: msg.event, pair: clip(msg.pair, 24), level: num(msg.level), side: clip(msg.side, 12), price: num(msg.price), text: clip(msg.text, 300) };
    await store.lpush("sr:events", e, 50);
    const sup = e.side === "support" || e.side === "buy";
    await notify(store, e.event === "touch"
      ? `🔔 ${e.pair} is at your ${sup ? "support" : "resistance"} ${e.level}. Now wait for the 5m: Heikin Ashi turns ${sup ? "green" : "red"}, a candle closes back ${sup ? "above" : "below"} the level, price ${sup ? "above" : "below"} the 80 SMA.`
      : `✅ ${e.pair} ${e.side === "buy" ? "BUY" : "SELL"} setup at ${e.level} — ${e.text.split(" · ").slice(2).join(" · ") || "your entry lined up"}.`, "sr");
    return { status: 200, json: { ok: true, event: e.event } };
  }
  return { status: 400, json: { error: "Unknown S/R Watch event" } };
}

// In plain words, for David and the Today card: how close each pair is, and what you're waiting for.
function srRead(status, events, now = Date.now()) {
  if (!status) return { live: false, note: "S/R Watch hasn't reported yet — in TradingView, the alert needs Edge's webhook URL (Settings → S/R Watch)." };
  const ageMin = Math.round((now - status.at) / 60e3);
  const word = (d) => (d == null ? "unknown" : d <= 0.25 ? "AT the level" : d <= 1 ? "close" : d <= 3 ? "on its way" : "far");
  const pairs = status.rows.map((r) => {
    const sup = r.side === "support", wait = `Heikin Ashi turning ${sup ? "green" : "red"} + a 5m close back ${sup ? "above" : "below"} ${r.level} + price ${sup ? "above" : "below"} the 80 SMA`;
    const smaOk = sup ? r.sma80 === "above" : r.sma80 === "below", haOk = sup ? /green/.test(r.heikinAshi) : /red/.test(r.heikinAshi);
    const say = r.state === "entry" ? `${sup ? "BUY" : "SELL"} setup already signalled at ${r.level}.`
      : r.state === "touched" ? `Touched your ${r.side} ${r.level} — waiting for ${wait}. Right now: Heikin Ashi ${r.heikinAshi}, ${r.sma80} the 80 SMA${smaOk && haOk ? " — nearly there" : ""}.`
      : r.distanceATR != null && r.distanceATR <= 1 ? `${r.distanceATR} × ATR from your ${r.side} ${r.level} — close, get ready.`
      : `${r.distanceATR ?? "?"} × ATR from your nearest level (${r.side} ${r.level}) — ${word(r.distanceATR)}, nothing to do yet.`;
    return { ...r, closeness: word(r.distanceATR), say };
  }).sort((a, b) => (a.state !== "armed" ? -1 : 0) - (b.state !== "armed" ? -1 : 0) || (a.distanceATR ?? 99) - (b.distanceATR ?? 99));
  return { live: ageMin <= 20, updatedMinAgo: ageMin, chart: status.chart, timeframe: status.tf, trend: status.trend,
    ...(ageMin > 20 ? { warning: `Last report ${ageMin} min ago — TradingView may be closed for the weekend, or the alert is off.` } : {}),
    pairs, recent: (events || []).filter((e) => now - e.at < 24 * 3600e3).slice(0, 15) };
}
module.exports = { srHook, srRead };
