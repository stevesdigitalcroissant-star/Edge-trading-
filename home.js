// The home chart: your markets, with the S&D picture (1H zones, BOS / MSS, 1H + 4H trend), the radar's setups, your waiting limits and open trades drawn on it.
// It lives outside the Today cards, so the 15-second refresh never rebuilds it. Prices are Yahoo's (≈10 min behind):
// your TradingView alerts watch the market live — this is where you see the picture at a glance.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const MKTS = [["nq", "NQ", "MNQ1!", "CME_MINI"], ["es", "ES", "MES1!", "CME_MINI"], ["ym", "YM", "MYM1!", "CBOT_MINI"], ["gold", "Gold", "MGC1!", "COMEX"], ["silver", "Silver", "SIL1!", "COMEX"], ["crude", "Crude", "MCL1!", "NYMEX"], ["copper", "Copper", "MHG1!", "COMEX"], ["natgas", "Gas", "MNG1!", "NYMEX"], ["rty", "Russell", "M2K1!", "CME_MINI"], ["6e", "Euro", "6E1!", "CME"], ["6b", "Pound", "6B1!", "CME"], ["6j", "Yen", "6J1!", "CME"], ["6a", "Aussie", "6A1!", "CME"], ["zn", "10Y", "ZN1!", "CBOT"], ["zb", "30Y", "ZB1!", "CBOT"]];
  const TFS = [[5, "5m"], [15, "15m"], [60, "1H"], [240, "4H"]];
  // TradingView charts: the futures contract, or a CFD that follows it (embedded charts may not show CME futures)
  const TV_INT = [["15", "15m"], ["60", "1H"], ["240", "4H"], ["D", "D"]];
  const CFD = { gold: "OANDA:XAUUSD", silver: "OANDA:XAGUSD", crude: "TVC:USOIL", natgas: "CAPITALCOM:NATURALGAS", es: "OANDA:SPX500USD", nq: "OANDA:NAS100USD", ym: "OANDA:US30USD", copper: "CAPITALCOM:COPPER" };
  const pref = (k, d) => { try { return localStorage.getItem(`edge.home.${k}`) || d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(`edge.home.${k}`, v); } catch {} };
  const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const nyInfo = (t) => { const p = Object.fromEntries(nyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); const min = Number(p.hour) * 60 + Number(p.minute), day = Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5; return { min, cme: min >= 18 * 60 ? day + 1 : day }; };
  const fx = (x) => (x == null ? "—" : Number(x) >= 100 ? Number(x).toFixed(2) : Number(x).toFixed(Number(x) < 10 ? 4 : 3));

  const H = { m: pref("m", ""), tf: Number(pref("tf", "15")), bars: {}, sd: {}, at: {}, chart: null, series: null, lines: [], S: null, busy: false, err: "", fit: true };

  function shell() {
    const el = $("#home"); if (!el || el.dataset.ready) return el;
    el.dataset.ready = "1";
    el.innerHTML = `<div class="hm-top"><div class="hm-mk" id="hmMk"></div></div>
      <div class="hm-bar"><div class="hm-px" id="hmPx"></div><div class="seg hm-tf" id="hmTf">${TFS.map(([v, l]) => `<button type="button" data-tf="${v}">${l}</button>`).join("")}</div></div>
      <div class="hm-trend" id="hmTrend"></div>
      <div class="hm-chart" id="hmChart"><div class="hm-ov" id="hmOv"></div><div class="hm-msg" id="hmMsg">Loading prices…</div></div>
      <div class="hm-foot"><span id="hmNote" class="muted"></span><span class="hm-act"><button type="button" class="link" id="hmPractice">Practise this market</button><a class="link" id="hmTv" target="_blank" rel="noopener">TradingView ↗</a></span></div>
      <section class="hm-tvp" id="hmTvp"><div class="hm-tvbar"><b>TradingView</b><span class="seg" id="hmTvLay"><button type="button" data-tvlay="row">Side by side</button><button type="button" data-tvlay="col">Stacked</button></span><span class="seg" id="hmTvFeed"><button type="button" data-tvfeed="fut" title="The futures contract itself">Futures</button><button type="button" data-tvfeed="cfd" title="Use this if a chart says the symbol is only available on TradingView">CFD</button></span></div>
        <div class="hm-tvgrid" id="hmTvGrid">
          <div class="hm-tvc"><div class="hm-tvh"><b>Line</b> <span class="muted">zones</span><span class="seg" data-tvint="line">${TV_INT.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join("")}</span></div><iframe id="hmTvLine" title="TradingView line chart" loading="lazy" allowfullscreen></iframe></div>
          <div class="hm-tvc"><div class="hm-tvh"><b>Candles</b> <span class="muted">entries</span><span class="seg" data-tvint="candle">${TV_INT.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join("")}</span></div><iframe id="hmTvCandle" title="TradingView candle chart" loading="lazy" allowfullscreen></iframe></div>
        </div>
        <p class="muted hm-tvnote">Live TradingView charts. Draw your zones on the line chart (the drawing tools are on the left). TradingView doesn't keep drawings made in an embedded chart, so draw the ones you want to keep in TradingView itself.</p></section>
      <details class="hm-board" id="hmBoard"><summary>Trend board · every market</summary><div id="hmBoardBody" class="muted">Loading…</div></details>`;
    el.addEventListener("click", (e) => {
      const ly = e.target.closest("[data-tvlay]"); if (ly) { save("tvlay", ly.dataset.tvlay); tvPair(); return; }
      const fd = e.target.closest("[data-tvfeed]"); if (fd) { save("tvfeed", fd.dataset.tvfeed); tvPair(); return; }
      const iv = e.target.closest("[data-tvint] [data-v]"); if (iv) { save(`tv_${iv.parentElement.dataset.tvint}`, iv.dataset.v); tvPair(); return; }
      const b = e.target.closest("[data-hm]"); if (b) { H.m = b.dataset.hm; save("m", H.m); H.fit = true; draw(); load(); return; }
      const t = e.target.closest("[data-tf]"); if (t) { H.tf = Number(t.dataset.tf); save("tf", H.tf); H.fit = true; draw(); return; }
    });
    $("#hmPractice").addEventListener("click", () => window.EdgeSim && window.EdgeSim.open(H.m));
    return el;
  }

  // ---------- data: 60 days once (cached 30 min at the edge), then the last day every minute
  async function getJSON(u) { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `prices ${r.status}`); return j; }
  async function load(force = false) {
    const m = H.m; if (!m || H.busy) return;
    if (!force && H.bars[m] && Date.now() - (H.at[m] || 0) < 55e3) return;
    H.busy = true;
    try {
      if (!H.bars[m]) H.bars[m] = (await getJSON(`/api/candles?m=${m}&i=5m`)).bars || [];
      const tail = (await getJSON(`/api/candles?m=${m}&tail=1`).catch(() => ({ bars: [] }))).bars || [];
      const by = new Map(H.bars[m].map((b) => [b[0], b])); for (const b of tail) by.set(b[0], b);
      H.bars[m] = [...by.values()].sort((a, b) => a[0] - b[0]);
      H.at[m] = Date.now(); H.err = "";
      zones(m);
    } catch (e) { H.err = e.message; }
    finally { H.busy = false; if (m === H.m) draw(); }
  }
  // your supply & demand picture — 1H zones, 1H BOS / MSS, 1H and 4H trend — same rules as the TradingView scanner
  function zones(m) {
    const E = window.EdgeSD, raw = H.bars[m]; if (!E || !raw || raw.length < 300) return;
    const last = raw[raw.length - 1]; if (H.sd[m] && H.sd[m].last === last[0]) return;
    const toB = (a) => a.map((b) => ({ t: b.time * 1000, o: b.open, h: b.high, l: b.low, c: b.close }));
    try { H.sd[m] = { last: last[0], st: E.read(toB(agg(raw, 60)), toB(agg(raw, 240)), last[4], nyInfo(Date.now()).min) }; } catch { H.sd[m] = { last: last[0], st: null }; }
  }
  function agg(raw, tf) {
    if (tf === 5) return raw.map(([t, o, h, l, c]) => ({ time: t / 1000, open: o, high: h, low: l, close: c }));
    const out = [], ms = tf * 60e3;
    for (const [t, o, h, l, c] of raw) {
      // 4H candles start at 18:00 New York like the CME day; the rest on the clock
      const { min } = nyInfo(t), k = tf === 240 ? t - (((min - 1080 + 1440) % 240) * 60e3) - (t % 60e3) : Math.floor(t / ms) * ms;
      const b = out[out.length - 1];
      if (b && b.time === k / 1000) { b.high = Math.max(b.high, h); b.low = Math.min(b.low, l); b.close = c; }
      else out.push({ time: k / 1000, open: o, high: h, low: l, close: c });
    }
    return out;
  }

  // ---------- the chart
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function theme() {
    return { layout: { background: { type: "solid", color: "transparent" }, textColor: css("--muted"), fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line2") }, timeScale: { borderColor: css("--line2"), timeVisible: true, secondsVisible: false, rightOffset: 26 } };
  }
  function build() {
    const LW = window.LightweightCharts, box = $("#hmChart"); if (!LW || !box || H.chart) return;
    H.chart = LW.createChart(box, { autoSize: true, ...theme(), crosshair: { mode: 0 }, handleScale: { axisPressedMouseMove: true }, localization: { locale: (navigator.language || "en-US").split("@")[0], timeFormatter: (t) => new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) } });
    H.series = H.chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350", priceLineVisible: true });
    H.chart.timeScale().subscribeVisibleLogicalRangeChange(() => overlay());
    new ResizeObserver(() => overlay()).observe(box);
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => H.chart && H.chart.applyOptions(theme()));
    new MutationObserver(() => H.chart && (H.chart.applyOptions(theme()), overlay())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  function pickDefault(S) {
    if (H.m) return;
    const live = (S.open || []).map((t) => t.market).concat((S.setups || []).filter((x) => x.status === "open").map((x) => x.market), (S.orders || []).map((o) => o.market));
    H.m = live.find((m) => MKTS.some((x) => x[0] === m)) || "gold";
  }
  function marks(S) { // the prices that matter on this market: open trades, waiting limits, radar setups
    const L = [], m = H.m;
    for (const t of (S.open || []).filter((t) => t.market === m)) {
      L.push([t.entry, "#c9d1d9", `${t.dir === "long" ? "Long" : "Short"} entry`, 0], [t.currentSL ?? t.initialSL, "#ef5350", "Stop", 0], [t.tp, "#26a69a", "Target", 0]);
      if (t.trailSuggest != null) L.push([t.trailSuggest, "#f0a94b", "Trail stop here", 2]);
    }
    for (const o of (S.orders || []).filter((o) => o.market === m)) L.push([o.entry, "#6aa8ff", `Limit ${o.dir === "long" ? "buy" : "sell"}`, 2], [o.sl, "#ef5350", "Stop", 2], [o.tp, "#26a69a", "Target", 2]);
    for (const x of (S.setups || []).filter((x) => x.market === m && x.status === "open" && !(x.expires && S.now > x.expires))) {
      const g = x.g && x.g.grade ? x.g.grade : "";
      L.push([x.entry, "#d9b46c", `${x.strategy === "sd" ? "S&D" : g} setup ${x.dir === "long" ? "buy" : "sell"}`, 2], [x.sl, "#ef5350", "Setup stop", 3], [x.tp, "#26a69a", "Setup target", 3]);
      if (x.strategy === "sd") L.push([x.zoneTop, "#5aa9e6", `1H ${x.dir === "long" ? "demand" : "supply"} top`, 1], [x.zoneBot, "#5aa9e6", `1H ${x.dir === "long" ? "demand" : "supply"} bottom`, 1]);
    }
    return L.filter((l) => l[0] != null && Number.isFinite(Number(l[0])));
  }
  function draw() {
    const S = H.S, el = shell(); if (!S || !el) return;
    pickDefault(S); build();
    const busyMk = new Set([...(S.open || []).map((t) => t.market), ...(S.orders || []).map((o) => o.market), ...(S.setups || []).filter((x) => x.status === "open" && !(x.expires && S.now > x.expires)).map((x) => x.market)]);
    const bv = (k) => { const r = H.board && H.board.rows.find((x) => x.k === k); return r && !r.error ? r.v : ""; };
    $("#hmMk").innerHTML = MKTS.map(([k, n]) => { const v = bv(k); return `<button type="button" data-hm="${k}" class="${k === H.m ? "on" : ""}">${n}${v === "buy" ? '<b class="tr-a up">▲</b>' : v === "sell" ? '<b class="tr-a dn">▼</b>' : ""}${busyMk.has(k) ? "<i></i>" : ""}</button>`; }).join("");
    $("#hmTf").querySelectorAll("[data-tf]").forEach((b) => b.classList.toggle("on", Number(b.dataset.tf) === H.tf));
    const mk = MKTS.find((x) => x[0] === H.m) || MKTS[3];
    $("#hmTv").href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${mk[3]}:${mk[2]}`)}`;
    tvPair();
    const raw = H.bars[H.m], msg = $("#hmMsg");
    if (!raw || !raw.length) { msg.hidden = false; msg.textContent = H.err ? `Couldn't load prices: ${H.err}` : "Loading prices…"; if (H.series) H.series.setData([]); overlay(); return; }
    msg.hidden = true;
    if (!H.series) return;
    const data = agg(raw, H.tf);
    H.series.setData(data); H.times = data.map((d) => d.time);
    const tick = { gold: 0.1, silver: 0.005, crude: 0.01, natgas: 0.001, es: 0.25, nq: 0.25, ym: 1, copper: 0.0005, rty: 0.1, "6e": 0.00005, "6b": 0.0001, "6j": 0.0000005, "6a": 0.00005, zn: 0.015625, zb: 0.03125 }[H.m] || 0.01;
    H.prec = (tick.toFixed(10).replace(/0+$/, "").split(".")[1] || "").length; // .25 → 2, .0005 → 4, 5e-7 → 7
    H.series.applyOptions({ priceFormat: { type: "price", minMove: tick, precision: H.prec } });
    for (const pl of H.lines) H.series.removePriceLine(pl);
    H.lines = marks(S).map(([price, color, title, style]) => H.series.createPriceLine({ price: Number(price), color, lineWidth: style === 0 ? 2 : 1, lineStyle: style, axisLabelVisible: true, title }));
    if (H.fit) { const n = { 5: 140, 15: 120, 60: 110, 240: 90 }[H.tf] || 120; H.chart.timeScale().setVisibleLogicalRange({ from: data.length - n, to: data.length + 26 }); H.fit = false; }
    // price, change on the day, where it is against your zones
    const last = raw[raw.length - 1], day = nyInfo(last[0]).cme, open = (raw.find((b) => nyInfo(b[0]).cme === day) || last)[1], ch = last[4] - open;
    const sd = H.sd[H.m] && H.sd[H.m].st, fp = (v) => Number(v).toFixed(H.prec ?? 2);
    const pill = (tf, d, extra = "") => `<span class="tr-pill ${d > 0 ? "up" : d < 0 ? "dn" : ""}"><small>${tf}</small>${d > 0 ? "▲ Bullish" : d < 0 ? "▼ Bearish" : "– none yet"}${extra}</span>`;
    $("#hmTrend").innerHTML = sd ? `<span class="tr-badge">${pill("4H", sd.t4)}${pill("1H", sd.trend, sd.trend ? ` · ${sd.cnt >= 2 ? `${sd.cnt} BOS` : "1 break"}` : "")}
      ${sd.zone ? `<span class="tr-pill ${sd.zone.d > 0 ? "up" : "dn"}"><small>1H zone</small>${sd.zone.d > 0 ? "Demand" : "Supply"} ${fp(sd.zone.bot)}–${fp(sd.zone.top)}${sd.with4h === false ? " · against 4H" : ""}</span>` : ""}
      ${sd.zone4 ? `<span class="tr-pill ${sd.zone4.d > 0 ? "up" : "dn"}"><small>4H zone</small>${sd.zone4.d > 0 ? "Demand" : "Supply"} ${fp(sd.zone4.bot)}–${fp(sd.zone4.top)}</span>` : ""}
      <span class="tr-v ${sd.inZone ? "go" : ""}">${esc(sd.status)}</span><span class="tr-hint">Orders ${sd.ordersOpen ? "open" : "closed"} · 02:00–11:30 NY</span></span>` : "";
    $("#hmPx").innerHTML = `<b class="num">${last[4].toFixed(H.prec ?? 2)}</b><span class="${ch >= 0 ? "pos" : "neg"}">${ch >= 0 ? "+" : ""}${ch.toFixed(H.prec ?? 2)} (${((ch / open) * 100).toFixed(2)}%)</span>
      ${sd && sd.inZone ? `<span class="hm-chip zone">In the 1H ${sd.zone.d > 0 ? "demand" : "supply"} zone</span>` : ""}${sd && sd.inZone4 ? `<span class="hm-chip zone">In the 4H ${sd.zone4.d > 0 ? "demand" : "supply"} zone</span>` : ""}`;
    const age = Math.round((Date.now() - last[0]) / 60e3);
    $("#hmNote").textContent = `Prices ~10 min behind · last candle ${age < 90 ? `${age} min ago` : new Date(last[0]).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Your TradingView alerts watch it live.`;
    overlay();
  }
  // the S&D picture: the 1H zone(s) from where they formed to the right edge, the last 3 BOS and the last MSS
  function overlay() {
    const ov = $("#hmOv"); if (!ov) return;
    const sd = H.sd[H.m] && H.sd[H.m].st;
    if (!H.series || !sd || !H.bars[H.m]) { ov.innerHTML = ""; return; }
    const ts = H.chart.timeScale(), W = ov.clientWidth, Hh = ov.clientHeight, fp = (v) => Number(v).toFixed(H.prec ?? 2);
    const T = H.times || [], xAt = (t) => { if (t == null || !T.length) return 0; let lo = 0, hi = T.length - 1; const s = t / 1000; while (lo < hi) { const md = (lo + hi) >> 1; if (T[md] < s) lo = md + 1; else hi = md; } const x = ts.logicalToCoordinate(T[lo] > s && lo > 0 ? lo - 1 : lo); return x == null ? 0 : x; };
    const col = (d, tf) => (tf === "4H" ? (d > 0 ? "38,166,154" : "214,69,120") : d > 0 ? "90,169,230" : "240,138,75"); // 1H: demand blue, supply orange · 4H: demand green, supply pink — like the TradingView script
    let out = ""; const used = [];
    const ovl = (a, b) => a && b && a.bot <= b.top && a.top >= b.bot;
    const box = (z, older, tf = "1H") => {
      const y1 = H.series.priceToCoordinate(z.top), y2 = H.series.priceToCoordinate(z.bot); if (y1 == null || y2 == null) return;
      const top = Math.min(y1, y2), h = Math.max(2, Math.abs(y2 - y1)); if (top > Hh || top + h < 0) return;
      const x = Math.max(0, Math.min(W - 60, xAt(z.t))), c = col(z.d, tf);
      out += `<div class="hm-z big" style="left:${x}px;top:${top}px;height:${h}px;background:rgba(${c},${older ? 0.07 : 0.16});border-color:rgba(${c},${older ? 0.35 : 0.75})"></div>`;
      let ly = z.d > 0 ? top + h + 2 : top - 14; while (used.some((u) => Math.abs(u - ly) < 12)) ly += z.d > 0 ? 12 : -12; used.push(ly);
      out += `<span class="hm-zl" style="left:${Math.max(0, (ts.logicalToCoordinate((H.times || []).length + 1) ?? W - 200))}px;top:${ly}px;color:rgb(${c});opacity:${older ? 0.7 : 1}">${tf} ${z.d > 0 ? "DEMAND" : "SUPPLY"}${older ? " (older)" : ""}</span>`;
    };
    if (sd.older4) box(sd.older4, true, "4H");
    if (sd.zone4) box(sd.zone4, false, "4H");
    if (sd.older && !ovl(sd.older, sd.zone4)) box(sd.older, true); // an older 1H zone inside the 4H zone adds nothing
    if (sd.zone) box(sd.zone, false);
    for (const b of sd.breaks || []) {
      const y = H.series.priceToCoordinate(b.lvl); if (y == null || y < 0 || y > Hh) continue;
      const x0 = xAt(b.t0), x1 = xAt(b.t1); if (x1 <= 0) continue;
      const c = b.mss ? "240,201,75" : col(b.d), l = Math.max(0, x0), w = Math.max(6, x1 - l);
      out += `<div class="hm-bos" style="left:${l}px;top:${y}px;width:${w}px;border-color:rgb(${c})"></div>`;
      out += `<span class="hm-zl" style="left:${l + w / 2 - 20}px;top:${b.d > 0 ? y - 13 : y + 2}px;color:rgb(${c})">${b.mss ? "MSS" : "BOS"} 1H</span>`;
    }
    ov.innerHTML = out;
  }

  // two TradingView charts of the same market: a LINE chart (closes — where you draw zones) and CANDLES (entries)
  function tvPair() {
    const grid = $("#hmTvGrid"); if (!grid || !H.m) return;
    const mk = MKTS.find((x) => x[0] === H.m) || MKTS[3], feed = pref("tvfeed", "fut"), lay = pref("tvlay", innerWidth >= 900 ? "row" : "col");
    const sym = feed === "cfd" && CFD[H.m] ? CFD[H.m] : `${mk[3]}:${mk[2]}`;
    const dark = (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")) !== "light";
    grid.className = `hm-tvgrid ${lay}`;
    $("#hmTvLay").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tvlay === lay));
    $("#hmTvFeed").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tvfeed === feed));
    for (const [id, kind, style, def] of [["hmTvLine", "line", 2, "240"], ["hmTvCandle", "candle", 1, "15"]]) {
      const iv = pref(`tv_${kind}`, def);
      grid.querySelector(`[data-tvint="${kind}"]`).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === iv));
      const q = new URLSearchParams({ frameElementId: id, symbol: sym, interval: iv, style: String(style), theme: dark ? "dark" : "light", timezone: "America/New_York", hide_side_toolbar: "0", allow_symbol_change: "1", withdateranges: "1", saveimage: "0", hideideas: "1", locale: "en" });
      const src = `https://s.tradingview.com/widgetembed/?${q}`, f = $(`#${id}`);
      if (f && f.dataset.src !== src) { f.dataset.src = src; f.src = src; }
    }
  }

  // the trend board: 4H + 15m on every busy futures market, one line each (refreshed every 5 minutes)
  async function board(force = false) {
    if (!force && H.board && Date.now() - H.board.got < 290e3) return;
    try { const j = await getJSON("/api/candles?trend=1"); H.board = { ...j, got: Date.now() }; } catch (e) { if (!H.board) { const b = $("#hmBoardBody"); if (b) b.textContent = `Couldn't load the trend board: ${e.message}`; } return; }
    paintBoard(); draw();
  }
  function paintBoard() {
    const el = $("#hmBoardBody"), sum = $("#hmBoard summary"); if (!el || !H.board) return;
    const rows = H.board.rows.filter((r) => !r.error), n = (v) => rows.filter((r) => r.v === v).length, T = window.EdgeTrend;
    sum.innerHTML = `Trend board · <span class="pos">${n("buy")} buys</span> · <span class="neg">${n("sell")} sells</span> · ${n("wait")} wait`;
    const ord = { buy: 0, sell: 1, wait: 2 };
    el.innerHTML = `<table class="tr-table">${[...rows].sort((a, b) => ord[a.v] - ord[b.v]).map((r) => `<tr><td><b>${esc(r.code)}</b> <span class="muted">${esc(r.name)}</span></td><td class="${r.h4 > 0 ? "pos" : r.h4 < 0 ? "neg" : "muted"}">4H ${T ? T.arrow(r.h4) : r.h4}</td><td class="${r.m15 > 0 ? "pos" : r.m15 < 0 ? "neg" : "muted"}">15m ${T ? T.arrow(r.m15) : r.m15}</td><td><span class="tr-v ${r.v}">${esc(r.text)}</span>${r.hint ? `<div class="tr-hint">${esc(r.hint)}</div>` : ""}</td></tr>`).join("")}</table>
      <p class="muted" style="margin:6px 0 0;font-size:12px">Trend = candle bodies closing past the last swing. Prices ~10 min behind (Yahoo). Updated ${new Date(H.board.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>`;
  }

  // called by app.js after every state refresh, and when you switch tabs
  function update(S, show) {
    H.S = S;
    const el = $("#home"); if (!el) return;
    el.hidden = !show;
    if (!show) return;
    shell(); draw(); load(); board();
  }
  setInterval(() => { if (!document.hidden && H.S && $("#home") && !$("#home").hidden && !document.body.classList.contains("sim-on")) { load(); board(); } }, 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && $("#home") && !$("#home").hidden) load(); });
  window.EdgeHome = { update, _h: H };
  if (window.Edge && window.Edge.state && window.Edge.state()) window.Edge.homeSync && window.Edge.homeSync();
})();
