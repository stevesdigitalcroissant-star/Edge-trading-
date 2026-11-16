---
name: fx-playbook
description: Steve's ONLY strategy from 16 Nov 2026 — forex on MetaTrader 5 (prop firm Tradeify FX) with the INEVITRADE playbook moved up a level (4H/1H bias and zones, 15m entry), sent from Edge to MT5 through the EdgeBridge EA. Use for anything about his strategy, Edge's forex pairs, the MT5 bridge, the TradingView FX Playbook script, prop rules, backtests, David. Supersedes sr-simple, supply-demand, fib-strategy, draw-zones (all retired).
---

# FX Playbook (Steve, from 16 Nov 2026)

**Markets:** majors EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD + yen crosses GBPJPY, EURJPY (Edge ids
`eurusd` … `eurjpy`, `FX` in api/_config.js). TradingView watchlist: pine/fx_watchlist.txt (OANDA symbols, two sections).

**Prop firm:** Tradeify FX, 2-Step Classic 5K ($55): $500 static max loss (equity floor $4,500, checked on live equity
incl. open trades), $150 daily loss, no consistency rule, biweekly payouts. Funded: no opening/closing/changing trades
10 min either side of red-folder news. (The 1-Step "Daily" starts at 10K: $1,000 target, $400 static max loss.)

**Routine (from the strategy author's own routine video):** at the desk 8:45 NY · red-folder news first (let big
morning news settle) · mark points of interest on the 15m: previous day high/low, unmitigated 1H fair value gaps, the
9:30 NY open line · compare pairs for relative strength · only act after price reacts at a POI · journal the checklist
in real time · set alerts and walk away · post-session review in bar replay.

**Entry (15m):** POI reaction (sweep of PDL/PDH or tap of a 1H FVG) → displacement → 15m change of character (+ break of
the liquidity inflection level) → limit at the MIDPOINT of the 15m FVG the move left (50–61.8% of the move) → stop past
the move's low/high (below the order block) → target the next FVG or PDH/PDL, min 1:3 → break-even once the move's
high/low breaks. Bias: 4H + 1H EMA 9/21/50 lineup + weekly fundamental bias (Bias tab, edge_bias — FX factors in _config).

**Edge pieces:** pine/edge_fx_playbook.pine (15m chart; POIs, trend panel, setup lines; alert JSON `type:"fx"` → /api/hook
→ api/_fxsetup.js → Today "Setups from TradingView") · api/_mt5.js + api/mt5.js + mt5/EdgeBridge.mq5 (EA POSTs its report
to /api/mt5 every 5/20/60 s; the reply is the waiting orders, one per line `id|open|SYMBOL|buy|limit|entry|sl|tp|riskUSD`;
EA sizes lots from risk with tick value; acks + closed trades → journal `mt5:<position>` in R) · Today "📤 MetaTrader 5"
card + Send-to-MT5 form with the 8-point checklist · Settings → MetaTrader 5 (key, EA steps, prop rules).
Edge checks before queueing: MT5 connected, trades left today, risk ≤ daily room, risk < distance to the floor.
David: edge_mt5 (read-only); he can never trade.

**Backtest (honest):** rules-only version on EURUSD/GBPUSD/AUDUSD/USDJPY/GBPJPY/EURJPY rebuilt from CME currency futures
5m, 2019–2026, 1 pip majors / 2 pips crosses all-in: ~0.6–1.7 setups/day, 23–33% wins, about −0.10 to −0.14R per trade
after costs for every trend filter / target / break-even variant. Same model on crypto 1m/15m: also no edge after fees.
So the edge, if any, has to come from his discretion (clean POIs, real sweeps) — journal everything and judge by R.
