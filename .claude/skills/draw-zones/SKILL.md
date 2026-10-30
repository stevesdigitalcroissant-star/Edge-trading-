---
name: draw-zones
description: RETIRED 30 Oct 2026 — Steve started over with simple support & resistance (see sr-simple). Old zone drawing notes kept only as history; never use them to build, explain or alert.
---

# Drawing zones the way Steve does

Always start from the **big picture**. Never draw a zone from a few days of candles.

## The rules

1. **Chart:** the **4H line chart** (closes only), not candlesticks. Wicks are noise; the line shows where price actually settled.
   Candles (15m) are only for the entry signal.
2. **History:** look back **at least 3–4 months, ideally 6 months** of 4H price action before drawing anything.
3. **Touches:** a zone needs **3 or more distinct touches** — turns of the line (highs or lows; old resistance that became support counts).
   - A **group of candles sitting at the level is ONE touch**, however many candles it has.
   - Touches that are **too close to each other count as one**. The next touch only counts after price clearly **left the zone**
     (a 4H close at least about 3× the 4H ATR away — about three normal 4H candles) and came back, and at least about 2 weeks (60 four-hour candles) after the previous touch. Touches closer together than that are one group = one touch.
4. **Thickness:** keep the zone thin — about half to three quarters of a normal 4H candle (0.5–0.75× the 4H ATR).
   Draw it through where the line turned, not the extreme wicks.
5. **Side:** in an uptrend buy at support below price; in a downtrend sell at resistance above price. Price must come
   INTO the zone from the trade's side (falling to support, rising to resistance); a break and retest counts. Price rallying
   up into old resistance is not "support", and a zone price has crossed again and again lately is the middle of a range. The trend is the
   4H and the 15m read on candle bodies (Edge's `trend.js`): both must agree.
6. **Then** drop to 15m candles and wait for a closed **engulfing or morning/evening star** at the zone. No hammers or shooting stars (removed Oct 13 2026: one wick with little volume behind it).

## In code

- Research: `edge-data/research/aoi.js` with `zones: "line4h"` (`zoneATR4`, `awayATR`, `gapF`, `lookF` = 760 four-hour candles ≈ 6 months).
  Load at least 7 months before the first test day (`WARM=7` in `aoiday.js`).
- Trend everywhere: `trend.js` (home badge, simulator badge, `/api/candles?trend=1`, `pine/edge_trend.pine`).
- Edge's home screen has the TradingView pair: **line chart (zones)** next to or above **candles (entries)**.

## Be honest about results

Last check (Oct 2026), gold/crude/silver/natgas, 4H+15m trend, these zones (approach side + 3× ATR and 2 weeks between touches, no hammers):
Oct 2025 – Sep 2026 8 trades, −0.1R; 2019–2022 +13.4R (58% won), 2023–2026 −6.6R (about 8 trades a year). Report test results as they are, with losses shown, before recommending live use.
