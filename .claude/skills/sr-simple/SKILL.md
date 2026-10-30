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

Open questions to ask him when relevant: timeframe he trades, stop/target, whether Edge should also get the alerts
(webhook → push), and whether to test these rules on the 2019–2026 data.
