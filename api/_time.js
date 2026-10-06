// Time-zone helpers built on Intl (no dependencies).

function parts(ts, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return {
    y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, ss: +o.second,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday),
  };
}

// "2026-10-06" in the given zone — the trading day used for daily limits.
function dayKey(ts, tz) {
  const p = parts(ts, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function minutesOfDay(ts, tz) {
  const p = parts(ts, tz);
  return p.hh * 60 + p.mm;
}

const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };

// Epoch ms for a wall-clock time in a zone (handles daylight saving).
function zonedTime(y, m, d, hh, mm, tz) {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = parts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc;
  }
  return guess;
}

// Start of the next trading day in the zone.
function nextDayStart(ts, tz) {
  const p = parts(ts, tz);
  const t = Date.UTC(p.y, p.m - 1, p.d + 1);
  const n = new Date(t);
  return zonedTime(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, 0, tz);
}

function inWindow(ts, tz, [from, to]) {
  const m = minutesOfDay(ts, tz);
  const a = hm(from), b = hm(to);
  return a <= b ? m >= a && m < b : m >= a || m < b; // windows may wrap past midnight
}

module.exports = { parts, dayKey, minutesOfDay, zonedTime, nextDayStart, inWindow, hm };
