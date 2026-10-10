// News that moves gold, silver, crude, natural gas and the S&P 500.
//
// Source 1: the ForexFactory weekly calendar feed (free JSON, this week only),
//           cached for an hour.
// Source 2: the fixed weekly energy reports (API, EIA crude, EIA natural gas
//           storage, Baker Hughes) — added from a built-in schedule so the
//           blackout still works if the feed is down. Dropped when the feed
//           already lists the same report (so holiday-shifted dates win).
const { zonedTime, parts } = require("./_time");

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CACHE_MS = 60 * 60 * 1000;
const ET = "America/New_York";

// Weekly reports, New York time. block: true → no new trades around it.
const RECURRING = [
  { title: "API weekly crude stocks", dow: 2, at: [16, 30], markets: ["crude"], impact: "Medium", block: true, same: /API|American Petroleum/i },
  { title: "EIA crude oil inventories", dow: 3, at: [10, 30], markets: ["crude"], impact: "High", block: true, same: /Crude Oil Inventor/i },
  { title: "EIA natural gas storage", dow: 4, at: [10, 30], markets: ["natgas"], impact: "High", block: true, same: /Natural Gas Storage/i },
  { title: "Baker Hughes rig count", dow: 5, at: [13, 0], markets: ["crude", "natgas"], impact: "Low", block: false, same: /Rig Count/i },
];

// Which of our markets a calendar line matters to, and whether it blocks entries.
function classify(ev) {
  const t = ev.title || "";
  const usd = ev.country === "USD";
  const high = ev.impact === "High";
  const markets = new Set();
  let block = false;
  if (usd && high) { for (const m of ["gold", "crude", "natgas", "silver", "es"]) markets.add(m); block = true; }
  if (/crude|oil|opec|API Weekly|petroleum/i.test(t) && ev.impact !== "Low") { markets.add("crude"); block = true; }
  if (/natural gas/i.test(t)) { markets.add("natgas"); block = true; }
  if (/rig count/i.test(t)) { markets.add("crude"); markets.add("natgas"); }
  return { markets: [...markets], block };
}

function recurringForWeek(now, feedTitles) {
  const p = parts(now, ET);
  const out = [];
  for (const r of RECURRING) {
    // this week's occurrence (Sunday-based week, like the feed)
    const base = new Date(Date.UTC(p.y, p.m - 1, p.d + (r.dow - p.dow)));
    const t = zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), r.at[0], r.at[1], ET);
    if (feedTitles.some((x) => r.same.test(x.title) && Math.abs(x.time - t) < 3 * 864e5)) continue;
    out.push({ id: `rec:${r.title}:${t}`, title: r.title, country: "USD", impact: r.impact, time: t, markets: r.markets, block: r.block, source: "schedule" });
  }
  return out;
}

async function loadFeed(store, now = Date.now()) {
  const cached = await store.get("news");
  if (cached && now - cached.fetched < CACHE_MS) return cached;
  try {
    const r = await fetch(FEED, { headers: { "User-Agent": "edge-copilot/1.0" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`calendar feed ${r.status}`);
    const raw = await r.json();
    const events = (Array.isArray(raw) ? raw : [])
      .map((e) => ({ title: e.title, country: e.country, impact: e.impact, time: Date.parse(e.date), forecast: e.forecast || "", previous: e.previous || "" }))
      .filter((e) => Number.isFinite(e.time));
    const doc = { fetched: now, ok: true, events };
    await store.set("news", doc);
    return doc;
  } catch (err) {
    const doc = { fetched: now, ok: false, error: String(err.message || err), events: (cached && cached.events) || [] };
    await store.set("news", { ...doc, fetched: now - CACHE_MS + 10 * 60 * 1000 }); // retry in 10 min
    return doc;
  }
}

// All relevant events for the week, sorted, each tagged with markets + block.
function relevantEvents(feedDoc, now) {
  const feed = (feedDoc.events || []).map((e) => ({ ...e, id: `ff:${e.title}:${e.time}`, ...classify(e), source: "calendar" }))
    .filter((e) => e.markets.length);
  return [...feed, ...recurringForWeek(now, feed)].sort((a, b) => a.time - b.time);
}

// The event (if any) that blocks a new trade in `market` right now.
function blockingEvent(events, market, now, s) {
  const before = (s.newsBeforeMin || 0) * 60e3, after = (s.newsAfterMin || 0) * 60e3;
  return events.find((e) => e.block && e.markets.includes(market) && now >= e.time - before && now <= e.time + after) || null;
}

module.exports = { loadFeed, relevantEvents, blockingEvent, classify, recurringForWeek };
