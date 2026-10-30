// Edge's 3D pictures: little animated scenes for "what to do right now" and glossy 3D icons for the home tiles.
// Pure CSS 3D + SVG (no downloads, works offline). Motion stops for people who turn on "reduce motion".
(function () {
  // a solid box standing on the floor of a scene: x, y on the floor, w × d footprint, h tall, lifted z
  function box(x, y, w, d, h, color, extra = "", z = 0, delay = 0) {
    return `<div class="b3 ${extra}" style="left:${x}px;top:${y}px;width:${w}px;height:${d}px;--h:${h}px;--z:${z}px;--c:${color}${delay ? `;animation-delay:${delay}ms` : ""}">
      <i class="t"></i><i class="n"></i><i class="s"></i><i class="e"></i><i class="w"></i></div>`;
  }
  // a candle: body box + a thin wick, green up / red down
  function candle(x, y, z, body, up) {
    const c = up ? "#26a69a" : "#ef5350";
    return box(x + 4, y + 4, 2, 2, body + 16, "#9aa3ad", "wick", z - 8) + box(x, y, 10, 10, body, c, "", z);
  }
  const ball = (cls, color = "#e8c27a") => `<div class="ball3 ${cls}"><div class="bb" style="--c:${color}"></div></div>`;
  const floor = `<div class="floor3"></div>`;

  // one scene per state of the day
  const SCENES = {
    // the market is open: price falls into the demand zone and bounces — "look for your setup"
    session: () => `${floor}${box(30, 70, 150, 50, 26, "rgba(38,166,154,.55)", "zone glass")}
      ${candle(40, 30, 78, 22, false)}${candle(70, 30, 62, 20, false)}${candle(100, 30, 46, 18, false)}
      ${ball("bounce")}`,
    // a setup is ready: the zone glows and a gold arrow lifts off it
    setup: () => `${floor}${box(30, 70, 150, 50, 26, "rgba(38,166,154,.6)", "zone glass pulse")}
      <div class="arrow3 rise"><svg viewBox="0 0 60 80"><defs><linearGradient id="a3g" x1="0" x2="1"><stop offset="0" stop-color="#f6dc9c"/><stop offset=".55" stop-color="#d9a648"/><stop offset="1" stop-color="#8a6022"/></linearGradient></defs><path d="M30 2 58 36H40v42H20V36H2z" fill="url(#a3g)" stroke="#6b4a18" stroke-width="2"/></svg></div>`,
    // in a trade: the stop below, the target flag above, price climbing between them — hands off
    trade: () => `${floor}${box(20, 120, 170, 8, 4, "rgba(239,83,80,.8)", "glass")}
      ${box(20, 20, 170, 8, 4, "rgba(232,194,122,.9)", "glass", 60)}
      <div class="flag3"><svg viewBox="0 0 40 50"><path d="M4 2v46" stroke="#cfd5dc" stroke-width="3"/><path d="M6 4h28l-7 9 7 9H6z" fill="#e8c27a"/></svg></div>
      ${ball("climb")}`,
    // a limit is waiting: the line sits on the zone, price hovers above it
    order: () => `${floor}${box(30, 70, 150, 50, 26, "rgba(38,166,154,.5)", "zone glass")}
      ${box(20, 60, 170, 4, 2, "rgba(106,168,255,.95)", "", 26)}${ball("hover", "#6aa8ff")}`,
    // locked for the day: a padlock
    locked: () => `${floor}<div class="lock3"><svg viewBox="0 0 80 96"><defs><linearGradient id="l3g" x1="0" x2="1"><stop offset="0" stop-color="#ffb3b3"/><stop offset=".5" stop-color="#ef5350"/><stop offset="1" stop-color="#9c2b2b"/></linearGradient></defs>
      <path d="M20 44V28a20 20 0 0 1 40 0v16" fill="none" stroke="#cfd5dc" stroke-width="9" stroke-linecap="round"/><rect x="8" y="42" width="64" height="50" rx="12" fill="url(#l3g)"/><rect x="12" y="46" width="22" height="8" rx="4" fill="#fff" opacity=".35"/><circle cx="40" cy="64" r="7" fill="#5c1a1a"/><rect x="37" y="66" width="6" height="14" rx="3" fill="#5c1a1a"/></svg></div>`,
    // quiet: candles asleep, a moon floating over them
    quiet: () => `${floor}${candle(50, 60, 0, 18, true)}${candle(80, 60, 0, 26, false)}${candle(110, 60, 0, 14, true)}${candle(140, 60, 0, 22, true)}
      <div class="moon3"><svg viewBox="0 0 60 60"><defs><radialGradient id="m3g" cx=".35" cy=".3"><stop offset="0" stop-color="#fff6dc"/><stop offset=".6" stop-color="#e8c27a"/><stop offset="1" stop-color="#9c7432"/></radialGradient></defs><path d="M40 6a26 26 0 1 0 14 40A22 22 0 0 1 40 6z" fill="url(#m3g)"/></svg><b>z</b><b>z</b></div>`,
  };
  // Coach: a podium with a gold trophy floating over first place
  SCENES.coach = () => `${floor}${box(40, 60, 40, 40, 30, "#9aa3ad")}${box(85, 55, 40, 45, 48, "#d9a648")}${box(130, 60, 40, 40, 20, "#b07a44")}
    <div class="lock3 trophy3"><svg viewBox="0 0 64 64">${ICONS.prop}</svg></div>`;
  // Journal: your last trades as 3D bars — green winners, red losers (ghost bars until you have some)
  function bars(rs) {
    const ghost = !rs.length, v = ghost ? [1.2, -1, 3, -1, 2, 3.4, -1, 1.5] : rs.slice(-12);
    const step = Math.min(18, 170 / v.length), x0 = (210 - step * v.length) / 2;
    const out = v.map((r, i) => box(x0 + i * step, 62, step * 0.7, 26, Math.max(4, Math.min(70, Math.abs(r) * 16)), ghost ? "rgba(154,163,173,.35)" : r > 0 ? "#26a69a" : r < 0 ? "#ef5350" : "#9aa3ad", ghost ? "glass" : "")).join("");
    return `<div class="scene3" aria-hidden="true"><div class="w3">${floor}${out}</div></div>`;
  }
  // Journal: your growth in 3D — your running total (R) week by week as a rising skyline, a gold ball climbing it,
  // a flag on your best week. Built from your closed trades (oldest → newest).
  let gid = 0;
  function growth(trades) {
    const T = trades.filter((t) => t.resultR != null && t.closedAt).sort((a, b) => a.closedAt - b.closedAt);
    if (!T.length) return `<div class="scene3 grow3" aria-hidden="true"><div class="w3">${floor}${[1.2, 2, 1.6, 2.8, 3.4, 3, 4.2, 5].map((v, i) => box(16 + i * 34, 120, 22, 22, v * 16, "rgba(154,163,173,.3)", "glass")).join("")}</div></div>`;
    const wk = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };
    const pts = []; let cum = 0, cur = null;
    for (const t of T) { cum += t.resultR; const k = T.length > 16 ? wk(t.closedAt) : t.closedAt; if (cur && cur.k === k) cur.v = cum; else { cur = { k, v: cum }; pts.push(cur); } }
    const P = pts.slice(-14), lo = Math.min(0, ...P.map((p) => p.v)), hi = Math.max(...P.map((p) => p.v), lo + 1), n = P.length;
    const step = Math.min(34, 276 / n), w = Math.max(10, step * 0.66), x0 = (300 - step * n) / 2, H = (v) => 6 + ((v - lo) / (hi - lo)) * 84;
    let best = 0; P.forEach((p, i) => { if (p.v >= P[best].v) best = i; });
    const col = (p, i) => (p.v < 0 ? "#ff4d7d" : i === best ? "#ffd36e" : `hsl(${190 - (i / Math.max(1, n - 1)) * 40}, 85%, ${52 + (i / Math.max(1, n - 1)) * 8}%)`);
    // bars stand along a gentle diagonal so the climb reads in 3D
    const pos = P.map((p, i) => ({ x: x0 + i * step, y: 140 - i * (70 / Math.max(1, n)), h: H(p.v) }));
    const bars = P.map((p, i) => box(pos[i].x, pos[i].y, w, w, pos[i].h, col(p, i), `gro${i === best ? " pulse" : ""}`, 0, i * 70 + 1)).join("");
    const id = `climb${++gid}`, kf = pos.map((q, i) => `${Math.round((i / Math.max(1, n - 1)) * 100)}% { transform: translate3d(${(q.x + w / 2).toFixed(1)}px, ${(q.y + w / 2).toFixed(1)}px, ${(q.h + 2).toFixed(1)}px); }`).join(" ");
    const flag = `<div class="flag3 gflag" style="transform: translate3d(${(pos[best].x + w / 2).toFixed(1)}px, ${(pos[best].y + w / 2).toFixed(1)}px, ${(pos[best].h).toFixed(1)}px)"><svg viewBox="0 0 40 50"><path d="M4 2v46" stroke="#cfd5dc" stroke-width="3"/><path d="M6 4h28l-7 9 7 9H6z" fill="#ffd36e"/></svg></div>`;
    return `<style>@keyframes ${id} { ${kf} }</style><div class="scene3 grow3" aria-hidden="true"><div class="w3"><div class="floor3"></div>${bars}${flag}
      <div class="climb3" style="animation: ${id} ${Math.max(4, n * 0.55)}s ease-in-out ${n * 70 + 300}ms infinite alternate"><div class="bb"></div></div></div></div>`;
  }
  function scene(kind) { return `<div class="scene3" aria-hidden="true"><div class="w3">${(SCENES[kind] || SCENES.quiet)()}</div></div>`; }

  // glossy 3D icons (64×64 SVG) for the home tiles
  const G = (id, a, b, c) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  const SHINE = `<ellipse cx="24" cy="16" rx="12" ry="5" fill="#fff" opacity=".35"/>`;
  const ICONS = {
    paste: `<defs>${G("ip1", "#c99a5b", "#9a6a32", "#5e3d17")}${G("ip2", "#ffffff", "#eef1f5", "#c9d0d8")}</defs>
      <rect x="10" y="8" width="44" height="52" rx="7" fill="url(#ip1)"/><rect x="16" y="14" width="32" height="40" rx="3" fill="url(#ip2)"/>
      <rect x="22" y="4" width="20" height="10" rx="4" fill="#cfd5dc" stroke="#7d868f" stroke-width="1.5"/>
      <path d="M21 26h22M21 33h22M21 40h14" stroke="#26a69a" stroke-width="3.5" stroke-linecap="round"/>`,
    shot: `<defs>${G("is1", "#4b5563", "#1f2937", "#0b0f15")}<radialGradient id="is2" cx=".35" cy=".3"><stop offset="0" stop-color="#9fd3ff"/><stop offset=".45" stop-color="#2a6fd6"/><stop offset="1" stop-color="#0a1f44"/></radialGradient></defs>
      <rect x="22" y="10" width="20" height="10" rx="3" fill="#374151"/><rect x="6" y="16" width="52" height="38" rx="9" fill="url(#is1)"/>
      <circle cx="32" cy="35" r="14" fill="#111827" stroke="#9aa3ad" stroke-width="2"/><circle cx="32" cy="35" r="10" fill="url(#is2)"/><circle cx="28" cy="31" r="3" fill="#fff" opacity=".8"/>
      <circle cx="49" cy="24" r="3" fill="#e8c27a"/>${SHINE}`,
    coach: `<defs>${G("ic1", "#f6dc9c", "#d9a648", "#8a6022")}${G("ic2", "#e5e7eb", "#9ca3af", "#4b5563")}</defs>
      <rect x="22" y="4" width="20" height="34" rx="10" fill="url(#ic1)"/><path d="M26 14h12M26 20h12M26 26h12" stroke="#6b4a18" stroke-width="2" opacity=".6"/>
      <path d="M14 28a18 18 0 0 0 36 0" fill="none" stroke="url(#ic2)" stroke-width="4" stroke-linecap="round"/><rect x="30" y="46" width="4" height="8" fill="#9ca3af"/><rect x="20" y="54" width="24" height="5" rx="2.5" fill="url(#ic2)"/>
      <ellipse cx="28" cy="10" rx="3" ry="5" fill="#fff" opacity=".45"/>`,
    plan: `<defs><radialGradient id="ipl" cx=".38" cy=".32"><stop offset="0" stop-color="#ffd0d0"/><stop offset=".55" stop-color="#ef5350"/><stop offset="1" stop-color="#8f2424"/></radialGradient></defs>
      <circle cx="32" cy="34" r="26" fill="url(#ipl)"/><circle cx="32" cy="34" r="18" fill="#f8fafc"/><circle cx="32" cy="34" r="11" fill="url(#ipl)"/><circle cx="32" cy="34" r="4.5" fill="#f8fafc"/>
      <path d="M33 33 56 8" stroke="#e8c27a" stroke-width="3.5" stroke-linecap="round"/><path d="M52 6l8-2-2 8z" fill="#3ccf91"/>${SHINE}`,
    prop: `<defs>${G("ipr", "#fff1c9", "#e8b84e", "#8a6022")}</defs>
      <path d="M18 8h28v16a14 14 0 0 1-28 0z" fill="url(#ipr)"/><path d="M18 12H8a10 10 0 0 0 12 14M46 12h10a10 10 0 0 1-12 14" fill="none" stroke="#c9963f" stroke-width="4"/>
      <rect x="28" y="38" width="8" height="10" fill="#b98a3f"/><rect x="18" y="48" width="28" height="9" rx="3" fill="url(#ipr)"/>
      <path d="M32 14l2.4 5 5.4.6-4 3.6 1.1 5.3L32 25.8l-4.9 2.7 1.1-5.3-4-3.6 5.4-.6z" fill="#fff" opacity=".85"/>`,
    push: `<defs>${G("ipu", "#fff1c9", "#e8b84e", "#8a6022")}</defs>
      <path d="M32 6c-11 0-18 8-18 19v12l-6 9h48l-6-9V25c0-11-7-19-18-19z" fill="url(#ipu)"/><rect x="6" y="44" width="52" height="6" rx="3" fill="#b98a3f"/>
      <circle cx="32" cy="55" r="6" fill="#8a6022"/><circle cx="50" cy="12" r="8" fill="#ef5350" stroke="#fff" stroke-width="2"/>
      <ellipse cx="24" cy="18" rx="5" ry="8" fill="#fff" opacity=".4"/>`,
  };
  const icon = (name) => `<span class="i3d" aria-hidden="true"><svg viewBox="0 0 64 64">${ICONS[name] || ""}</svg><i class="sh"></i></span>`;

  window.EdgeArt = { scene, icon, bars, growth };
})();
