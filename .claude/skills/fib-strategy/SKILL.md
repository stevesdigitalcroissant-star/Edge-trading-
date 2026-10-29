---
name: fib-strategy
description: Steve's main strategy from late Oct 2026 — three-Fib confluence (4H swing → 1H swing → POI leg) at a level that matters, 5m/1m CHoCH entry, 1:3. Use for anything about his strategy — explaining, coding the Edge playbook, scanner, simulator, Test tab, TradingView scripts, backtests in edge-data, alerts, videos. Supersedes supply-demand (zones are now one kind of POI inside this).
---

# Fib strategy — the rules (status: being backtested; the playbook says so)

**Show him visually** (charts, animated videos — he loved the step-by-step trade video). Less text.
Sells mirror buys.

1. **Big picture.** 4H line chart, look back 1 month → 1 year. Levels = closes that turned price, clustered within
   0.6×ATR4, a touch counts if ≥ 60 4H bars after the last one and price went ≥ 3×ATR4 away in between; ≥ 3 touches = major.
2. **4H Fib.** Latest *finished* 4H swing (pivot confirmed when price moves ≥ 3×ATR4 away; never the leg still forming).
   Trade in the swing's direction only once price is back in **0.5 – 0.79** (0 = the latest extreme). < 0.25 = chasing → skip.
3. **1H Fib.** Latest finished 1H swing your way inside that pullback; its OTE **0.62 – 0.79** overlaps the 4H area.
4. **POI + its Fib.** Supply / demand zone or a big-picture S/R level in that area; Fib on the leg that left it.
   4H, 1H and POI OTE areas within ~0.5×ATR1 of each other = **the box**. No overlap → no trade.
5. **Room.** No major level inside 3R from entry.
6. **Entry (Steve, 29 Oct: "15m CHoCH, then look for an entry on the 5 or 1 min").** In the box only: **15m** CHoCH
   = a 15m CLOSE past the **clear swing** — for a sell, the low
   that started the last push up into the box (for a buy, the high that started the last drop). Steve, 29 Oct:
   "small tiny swings would not hold" — never use a minor fractal inside that push. Then on the 5m / 1m: the pullback, its own CHoCH,
   limit in that break's FVG (else the retest). Dead if price takes out the 15m move's extreme first. (Silver 11 Mar 2025: tiny-swing CHoCH 07:00 → +2.9R; clear-swing CHoCH at 32.92,
   08:20 → filled 32.965, hit +2R, stopped −1R at 09:30. One trade — the backtest runs both definitions.)
7. **Stop** past the 5m / 1m pullback high (sell) / low (buy), skip if < ~$30 a micro, never inside the box. **Target 1:3** (−1.0 extension as a runner idea, ≤ 10R).
8. **Hours** 03:00–11:00 New York, 2 trades a day, one per group, no news ±30 min. Volume = info only.

## Evidence so far
- Research: a Fib level alone hits no more often than a random line (40k FX pullbacks; 6k USD/JPY swings); edge claims
  rest on confluence (Boroden: ≥ 3 Fib relationships in a tight range) and on real order clusters at old levels / round
  numbers (Osler, NY Fed SR125). Swings must be picked by a fixed rule (ATR-confirmed pivots) or backtests lie.
- His own 474 S&D trades (realistic costs) bucketed by the 3-week 1H swing retracement: 0.5 – 0.79 → n 80, 54% win,
  +0.57R/trade; chasing < 0.25 → n 252, 40%, +0.16R. Small sample — the full three-Fib backtest is pending
  (2019–2026, 9 markets, harsh costs, 5m vs 1m entry, 1:3 vs −1.0 target, split 2019–22 / 2023–26).

## Backtest 1 (29 Oct 2026, scratchpad fib.js — automated box, harsh costs, 9 mkts 2019–2026, portfolio 2/day)
- CHoCH on a tiny 5m swing: 238 trades, 23% win, −0.40R/trade. Clear 5m swing (2.5×ATR zigzag): 103, 30%, −0.15R.
  **15m CHoCH (Steve's idea)**: 60, 28%, −0.16R; without the $140 risk cap 95 trades, 37% win, **+0.03R** — best of the
  three but ≈ breakeven, and only ~12 trades a year. Supply/demand POIs ≈ 0R, big-level POIs lose (−0.5 to −0.9R, n<20).
- Clear swing ≫ tiny swing is solid. The full three-Fib box, as automated, has no edge yet → check the automation
  against Steve's own drawing (10 example charts) before judging the idea.

## Backtest 2 — 15m CHoCH, then a 5m / 1m entry (same engine, harsh costs; n is small, ~8–15 trades a year in total)
| entry after the 15m CHoCH | n | win | avg after costs | before costs |
|---|---|---|---|---|
| straight away (stop past the 15m move) | 97 | 37% | +0.06R | +0.14R |
| 5m pullback, its first small swing break | 80 | 35% | 0.00R | +0.19R |
| 5m pullback, clear swing (2.5×ATR) | 43 | 33% | −0.08R | +0.10R |
| 1m pullback, clear swing | 90 | 36% | 0.00R | +0.20R |
| 1m pullback, tiny swing | 112 | 25% | −0.40R | −0.03R (stops ~$27 — noise) |
With the old stop ≥ $30 rule: 5m small-swing entry 59 trades, 41% win, +0.20R (2019–22 −0.01, 2023–26 +0.44);
1m clear 60, 38%, +0.07R. Tighter LTF entries add edge before costs, costs take most of it back. Not proven.

## Backtest 3 — Steve's trend ladder (Daily BOS → 4H explosive move → 4H retracement → 15m CHoCH → 5m CHoCH entry)
scratchpad trend.js, 9 mkts 2019–2026, harsh costs, stop ≥ $30, flat 16:00 (or hold ≤ 5 days for big targets).
- Trade A (end of retracement, with trend), 5m clear-swing entry: 1,025 trades, 28% win, −0.19R (before costs −0.06R).
  1:5 → −0.16R, 1:7 → −0.04R (hold ≤ 5 days). Both halves negative. Tiny-swing 5m entry: 2,180 trades, −0.23R.
- Trade B (the retracement, 1:3): 172 trades, 32% win, −0.06R (2023–26 +0.05R).
- Retracement depth (incl. Fib 0.5–0.79), displacement candle, 2023+ volume spike: none separates winners.
- Lesson: timing ladders (CHoCH on CHoCH) ≈ random entries. The only edge found so far came from LOCATION filters
  on the S&D trades (mature zone, room, chop, big-picture ①②③: +0.51R on 134 trades).
