// What Edge learned about you — plain sentences from your own closed trades.
// Works in the browser (window.EdgeInsights) and in Node (require) so it can be tested.
(function (root) {
  const MIN = 5; // never speak about a group with fewer trades than this
  const MARKET = { gold: "Gold", crude: "Crude oil", natgas: "Natural gas", silver: "Silver", es: "S&P 500" };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const r2 = (x) => Math.round(x * 100) / 100;
  const rs = (x) => `${x > 0 ? "+" : ""}${r2(x).toFixed(2)}R`;

  function group(trades, key) {
    const g = {};
    for (const t of trades) { const k = key(t); if (k == null) continue; (g[k] = g[k] || []).push(t); }
    return Object.entries(g).map(([k, a]) => {
      const tot = a.reduce((x, t) => x + t.resultR, 0);
      return { k, n: a.length, avg: tot / a.length, tot, win: Math.round((a.filter((t) => t.resultR > 0.1).length / a.length) * 100) };
    });
  }

  // tz: an IANA zone for hours and weekdays (default: this device's)
  function insights(journal, { tz } = {}) {
    const done = (journal || []).filter((t) => t && t.resultR != null && Number.isFinite(t.resultR));
    if (done.length < MIN) return { ready: false, n: done.length, need: MIN, items: [] };
    const all = done.reduce((x, t) => x + t.resultR, 0) / done.length;
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "long" });
    const when = (t) => { const p = fmt.formatToParts(new Date(t.openedAt || t.closedAt)); return { h: Number(p.find((x) => x.type === "hour").value), d: p.find((x) => x.type === "weekday").value }; };
    const items = [];
    const add = (score, icon, kind, title, text) => items.push({ score, icon, kind, title, text });
    const best = (gs) => gs.filter((x) => x.n >= MIN).sort((a, b) => b.avg - a.avg);
    const weight = (x) => Math.abs(x.avg - all) * Math.sqrt(x.n);

    // markets
    const mk = best(group(done, (t) => t.market));
    if (mk.length >= 2) {
      const [top, bot] = [mk[0], mk[mk.length - 1]];
      add(weight(top), "🏆", "good", `Your best market: ${MARKET[top.k] || top.k}`, `${rs(top.avg)} a trade over ${top.n} trades (${top.win}% won). You average ${rs(all)}.`);
      if (bot.avg < 0) add(weight(bot), "⚠️", "bad", `${MARKET[bot.k] || bot.k} is costing you`, `${rs(bot.avg)} a trade over ${bot.n} trades. Replay it more, or trade it smaller for now.`);
    }
    // time of day (2-hour blocks, your time)
    const hb = best(group(done, (t) => { const h = when(t).h; return Math.floor(h / 2) * 2; }));
    if (hb.length >= 2) {
      const lbl = (k) => `${String(k).padStart(2, "0")}:00–${String((Number(k) + 2) % 24).padStart(2, "0")}:00`;
      const [top, bot] = [hb[0], hb[hb.length - 1]];
      add(weight(top), "⏰", "good", `You trade best ${lbl(top.k)} your time`, `${top.win}% won, ${rs(top.avg)} a trade (${top.n} trades).`);
      if (bot.avg < 0) add(weight(bot), "🌙", "bad", `Your weakest time: ${lbl(bot.k)}`, `${rs(bot.avg)} a trade (${bot.n} trades). Tired, rushed, or just a slow market? Consider skipping it.`);
    }
    // weekdays
    const wd = best(group(done, (t) => when(t).d));
    if (wd.length >= 2 && wd[0].avg - wd[wd.length - 1].avg > 0.3) {
      add(weight(wd[0]) * 0.8, "📅", "info", `${wd[0].k}s are your best day`, `${rs(wd[0].avg)} a trade. ${wd[wd.length - 1].k}s: ${rs(wd[wd.length - 1].avg)}.`);
    }
    // mood
    const bad = done.filter((t) => ["fomo", "revenge", "bored"].includes(t.emotion)), calm = done.filter((t) => ["calm", "focused"].includes(t.emotion));
    if (bad.length >= 3 && calm.length >= MIN) {
      const b = bad.reduce((x, t) => x + t.resultR, 0) / bad.length, c = calm.reduce((x, t) => x + t.resultR, 0) / calm.length;
      add(Math.abs(c - b) * Math.sqrt(bad.length) + 0.5, "🧘", c > b ? "bad" : "info", c > b ? "Your mood shows in your results" : "Mood isn't hurting you", `Calm or focused: ${rs(c)} a trade. FOMO, revenge or bored: ${rs(b)} (${bad.length} trades).`);
    }
    // rule breaks
    const broke = done.filter((t) => (t.ruleBreaks || []).length), kept = done.filter((t) => !(t.ruleBreaks || []).length);
    if (broke.length >= 2 && kept.length >= 3) {
      const b = broke.reduce((x, t) => x + t.resultR, 0) / broke.length, k = kept.reduce((x, t) => x + t.resultR, 0) / kept.length;
      add(Math.abs(k - b) * Math.sqrt(broke.length) + 0.6, "📏", k > b ? "bad" : "info", `Breaking a rule costs you ${rs(k - b).replace("+", "")} a trade`, `Rules kept: ${rs(k)} a trade. Broken (${broke.length} times — most often “${topRule(broke)}”): ${rs(b)}.`);
    }
    // closing early
    const early = done.filter((t) => /closed early \(profit\)/.test(t.exitReason || ""));
    if (early.length >= 3) add(0.5 * Math.sqrt(early.length), "✂️", "bad", `You closed ${early.length} winners early`, `Average ${rs(early.reduce((x, t) => x + t.resultR, 0) / early.length)}. Your targets are 2–3R — the tests did worse every time trades were cut short.`);
    // right after a loss
    const sorted = [...done].sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0));
    const after = sorted.filter((t, i) => i && sorted[i - 1].resultR < -0.1 && (t.openedAt || 0) - (sorted[i - 1].closedAt || 0) < 2 * 3600e3);
    if (after.length >= 3) {
      const a = after.reduce((x, t) => x + t.resultR, 0) / after.length;
      if (a < all) add((all - a) * Math.sqrt(after.length), "🔁", "bad", "Trades right after a loss go worse", `${rs(a)} a trade when taken within 2 hours of a loss (${after.length} trades). Take the cool-down seriously.`);
    }
    // direction
    const dir = best(group(done, (t) => t.dir));
    if (dir.length === 2 && dir[0].avg - dir[1].avg > 0.4) add(weight(dir[0]) * 0.6, "↕️", "info", `You do better on ${dir[0].k === "long" ? "buys" : "sells"}`, `${rs(dir[0].avg)} a trade vs ${rs(dir[1].avg)} on ${dir[1].k === "long" ? "buys" : "sells"}.`);

    items.sort((a, b) => b.score - a.score);
    return { ready: true, n: done.length, avg: r2(all), items: items.slice(0, 6) };
  }

  function topRule(trades) {
    const c = {};
    for (const t of trades) for (const r of t.ruleBreaks || []) c[r] = (c[r] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }

  const api = { insights, MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EdgeInsights = api;
})(typeof window !== "undefined" ? window : globalThis);
