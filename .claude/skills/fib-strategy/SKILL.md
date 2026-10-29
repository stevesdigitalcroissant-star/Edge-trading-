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
6. **Entry.** In the box only: 5m (or 1m) CHoCH, limit on the pullback into its FVG / retest.
7. **Stop** past the swing of the CHoCH move, never inside the box. **Target 1:3** (−1.0 extension as a runner idea, ≤ 10R).
8. **Hours** 03:00–11:00 New York, 2 trades a day, one per group, no news ±30 min. Volume = info only.

## Evidence so far
- Research: a Fib level alone hits no more often than a random line (40k FX pullbacks; 6k USD/JPY swings); edge claims
  rest on confluence (Boroden: ≥ 3 Fib relationships in a tight range) and on real order clusters at old levels / round
  numbers (Osler, NY Fed SR125). Swings must be picked by a fixed rule (ATR-confirmed pivots) or backtests lie.
- His own 474 S&D trades (realistic costs) bucketed by the 3-week 1H swing retracement: 0.5 – 0.79 → n 80, 54% win,
  +0.57R/trade; chasing < 0.25 → n 252, 40%, +0.16R. Small sample — the full three-Fib backtest is pending
  (2019–2026, 9 markets, harsh costs, 5m vs 1m entry, 1:3 vs −1.0 target, split 2019–22 / 2023–26).
