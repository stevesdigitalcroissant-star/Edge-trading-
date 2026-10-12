// The trend on the 4H and the 15m, read the same way everywhere (home chart, simulator, the server's trend board,
// the TradingView script): structure on candle BODIES. A body swing high / low = a body higher / lower than the
// 2 bodies each side. The trend turns UP when a body closes above the last swing high, DOWN when one closes below
// the last swing low, and stays until the other happens. Both agree → trade that way only; they disagree → wait.
(function (root) {
  const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const nyMin = (t) => { const p = Object.fromEntries(nyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return (+p.hour % 24) * 60 + +p.minute; };
  // candles [t,o,h,l,c] (or {t,o,h,l,c}) → tf-minute candles; 4H starts at 18:00 New York like the CME day
  function roll(bars, tf) {
    const out = [], ms = tf * 60e3;
    for (const b of bars) {
      const [t, o, h, l, c] = Array.isArray(b) ? b : [b.t, b.o, b.h, b.l, b.c];
      const k = tf >= 240 ? t - (((nyMin(t) - 1080 + 1440) % tf) * 60e3) - (t % 60e3) : Math.floor(t / ms) * ms;
      const g = out[out.length - 1];
      if (g && g.t === k) { g.h = Math.max(g.h, h); g.l = Math.min(g.l, l); g.c = c; }
      else out.push({ t: k, o, h, l, c });
    }
    return out;
  }
  // the trend of a list of candles + the two levels that would flip it
  function read(B, len = 2) {
    let hi = null, lo = null, dir = 0, since = null;
    const top = (b) => Math.max(b.o, b.c), bot = (b) => Math.min(b.o, b.c);
    for (let i = 0; i < B.length; i++) {
      const j = i - len;
      if (j >= len) {
        let H = true, L = true;
        for (let k = 1; k <= len; k++) {
          if (!(top(B[j]) > top(B[j - k]) && top(B[j]) >= top(B[j + k]))) H = false;
          if (!(bot(B[j]) < bot(B[j - k]) && bot(B[j]) <= bot(B[j + k]))) L = false;
        }
        if (H) hi = top(B[j]);
        if (L) lo = bot(B[j]);
      }
      const c = B[i].c;
      if (hi != null && c > hi && dir !== 1) { dir = 1; since = B[i].t; }
      else if (lo != null && c < lo && dir !== -1) { dir = -1; since = B[i].t; }
    }
    return { dir, hi, lo, since, n: B.length };
  }
  // base candles (5m, 15m or 1H; `baseMin` says which) → the 4H and 15m trend and what to do
  function both(bars, baseMin = 5) {
    const h4 = bars.length ? read(roll(bars, 240)) : { dir: 0 };
    const m15 = baseMin <= 15 && bars.length ? read(roll(bars, 15)) : null;
    return { h4, m15, verdict: verdict(h4, m15) };
  }
  // one short line: what you may do now
  function verdict(h4, m15) {
    if (!h4 || !h4.dir) return { dir: 0, cls: "wait", text: "No 4H trend · sit out", hint: "" };
    const up = h4.dir > 0;
    if (!m15) return { dir: 0, cls: "wait", text: up ? "4H up · look for buys" : "4H down · look for sells", hint: "" };
    if (m15.dir === h4.dir) return { dir: h4.dir, cls: up ? "buy" : "sell", text: up ? "Buys only" : "Sells only", hint: "" };
    const lvl = up ? m15.hi : m15.lo;
    return { dir: 0, cls: "wait", text: up ? "Wait · 15m pulling back" : "Wait · 15m bouncing", hint: lvl != null ? `${up ? "Buys" : "Sells"} when a 15m body closes ${up ? "above" : "below"} ${fmt(lvl)}` : "" };
  }
  const fmt = (x) => (x == null ? "—" : Math.abs(x) >= 1000 ? x.toFixed(1) : Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 10 ? x.toFixed(3) : x.toFixed(4).replace(/0$/, ""));
  const arrow = (d) => (d > 0 ? "▲ Up" : d < 0 ? "▼ Down" : "– None");
  const cls = (d) => (d > 0 ? "up" : d < 0 ? "dn" : "flat");
  // the little badge: [4H ▲ Up] [15m ▼ Down] → Wait · 15m pulling back
  function badge(r, { hint = true } = {}) {
    if (!r) return "";
    const pill = (tf, t) => `<span class="tr-pill ${cls(t ? t.dir : 0)}"><small>${tf}</small>${t ? arrow(t.dir) : "–"}</span>`;
    return `<span class="tr-badge">${pill("4H", r.h4)}${pill("15m", r.m15)}<span class="tr-v ${r.verdict.cls}">${r.verdict.text}</span>${hint && r.verdict.hint ? `<span class="tr-hint">${r.verdict.hint}</span>` : ""}</span>`;
  }
  const api = { roll, read, both, verdict, badge, arrow };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EdgeTrend = api;
})(typeof window !== "undefined" ? window : globalThis);
