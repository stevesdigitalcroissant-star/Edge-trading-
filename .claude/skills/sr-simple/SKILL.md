---
name: sr-simple
description: Steve's ONLY strategy from 30 Oct 2026 (he started over) — simple support & resistance he draws himself, Heikin Ashi + regular candles for the entry, 80 SMA for confirmation, alerts so he doesn't watch charts all day. Use for anything about his strategy, Edge rules, TradingView scripts (pine/edge_sr_watch.pine), alerts, backtests, videos. Supersedes supply-demand, fib-strategy, draw-zones (all retired).
---

# Simple support & resistance — Steve's rules (30 Oct 2026, starting over)

He asked to erase everything before this. Do not bring back supply/demand zones, Fib, CHoCH ladders, sweeps or the
big-picture ①②③ rules unless he asks. Keep it simple, visual, and in plain words.

1. **Levels are his.** He draws support and resistance himself; the script watches them (TradingView can't read
   drawings, so he types them into the script's box: `EXCHANGE:SYMBOL = level, level`).
2. **Touch, once.** Price comes to a level (within 0.25 × ATR) → one alert. The level then stays quiet until price has
   LEFT it (moved 1.5 × ATR away, either direction) — only then can it alert again.
3. **Entry (after a touch, within 12 candles, once):** the Heikin Ashi candle flips his way (red→green at support,
   green→red at resistance) + the regular candle closes back on the right side of the level + the 80 SMA agrees
   (buy above it, sell below it) → "BUY / SELL setup" alert. Each piece can be switched off in the inputs.
4. **All pairs at once:** up to 20 pairs × 8 levels in one indicator, one TradingView alert ("Any alert() function
   call", once per bar close). Closed candles only — no repainting. A table shows each pair: price, nearest level,
   distance in ATR, above/below the 80 SMA, HA colour.

**Timeframes (his words, 30 Oct):** watches levels on the **15m**, enters on the **5m**, and wants the **Daily / 4H /
1H trend** always in the top-right corner (script: price vs the 80 SMA + its slope → up / down / mixed). Script goes on
the 5m chart; touch zone + "must leave" distance use the 15m ATR. Up to 15 pairs (TradingView's 40-request limit).

**No training in Edge any more (his call, 30 Oct).** Test tab, drills, Teach Edge, quizzes removed. **David** (his voice
assistant, connected over Edge's MCP at /api/mcp with the key from Settings → David) guides him live, gives feedback, and
writes: journal entries / notes (edge_journal_write), what he learns about Steve (edge_style_write → shown in the
Journal as "What David learned about you"), and Steve's levels (edge_levels_set). Never trades.

**S/R Watch → Edge → David (30 Oct).** The Pine script's alert posts JSON to /api/hook (`type:"sr"`, secret filled in
by Edge's Copy button): `touch` / `entry` events (Edge pushes the notification, kind `sr`) and a `status` of every pair on
each bar close (price, nearest level, distance in 15m ATR, armed/touched/entry, HA, 80 SMA, D/4H/1H trend). api/_srwatch.js
stores it; David reads it with **edge_watch** (call it first for "what's going on?"), and Today shows "📍 Your levels now".

Open questions when relevant: stop/target rules, whether Edge should push the TradingView alerts too, and whether to
test these rules on the 2019–2026 data.

## What his 8 Teach Edge examples showed (pulled 30 Oct, edge-data labels/teach.json)
- Draws zones mostly on the 4H (5/8), from structure: "creates a CHoCH on the 4H / 1H", "hesitation candle", "big
  rejection candle", with the 4H trend. Says the best entry is the FIRST touch of a fresh zone, with a limit order.
- 4 trades: copper short −1R, NQ short +0.53R, 6A long +2.19R (target at the next level — his best), 6J long +2.22R open.
- Mistakes: stop INSIDE the zone in 3 of 4 (copper, NQ, 6J) — only 6A had it past the zone; copper entry was taken
  below the supply zone (outside it, early) → stopped; NQ limit sat ~6 hours before filling.
- Tension to resolve with him: first-touch limit entries vs the S/R Watch HA-flip confirmation entry.
