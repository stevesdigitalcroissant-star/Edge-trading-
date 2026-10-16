---
name: supply-demand
description: Steve's one strategy (Oct 2026): supply & demand, the Smart Risk model, as exact rules. Use for anything about his strategy — drawing zones, explaining, coding the Edge scanner or simulator, TradingView scripts, backtests in edge-data, alerts. Supersedes draw-zones and every earlier strategy.
---

# Supply & demand — the rules

**Always show him visually.** Every rule change, zone, structure, liquidity read, backtest example or app change goes
with a chart picture (real candles, rendered with Lightweight Charts / Playwright — see scratchpad viz/page.html pattern:
4H swing structure, BOS/MSS, $$$ liquidity, zones with body/wick parts) or an app screenshot. Text alone isn't enough.

Sells mirror buys.

1. **4H trend**: a 4H candle CLOSES past the last 4H swing high = bullish break of structure (BOS). Trade only when
   the last two BOS point the same way.
2. **4H zone**: at the latest BOS, find the origin of the impulse (lowest low since the broken swing). Demand =
   the last 1–3 down-close candles there: top = their highest body top, bottom = the lowest low of the move.
   Never more than 3 candles. A 4H close below the bottom kills it. Only the most recent zone, first return only.
3. **Return**: price comes back into the zone. Any touch arms it (the video's "wait for 30%" tested worse).
4. **15m shift (MSS)**: a 15m candle closes above the last 15m swing high made before the low.
5. **Entry**: buy limit at the top of the last fair value gap in the shift leg; if none, at the breaker block
   (leg swept a lower low) or mitigation block (higher low) = the up-close candles of the broken swing high.
6. **Stop** 2 ticks under the leg low. **Target** the nearest 15m swing high ≥ 1.5R away (cap 6R).
   Orders only 02:00–11:30 New York, cancelled after 4 hours unfilled, flat by 14:20.

## Results (Oct 2026, edge-data/research/sd.js, V='{"tp":"liq","depth":0}')

Gold, crude, silver, natural gas, 2019–Sep 2026, fees + 1 tick slippage: 202 trades, 45% won, +29.3R
(+11R 2019–22, +18R 2023–26), every market positive, worst dip −14.7R, 8 losses in a row at worst, ~26 trades a year.
Prop challenge at $425 (+$3k / −$2k), starts since 2023: 67% passed, 3% failed, median ~15 trades — never in a week.
Worse variants (keep out): 30% depth, fixed 3R, outside-high target, multi-day holds, any-BOS trend.

Report results honestly, losses included. The other 11 futures (ES NQ YM RTY HG 6E 6B 6J 6A ZN ZB) are untested
until their Databento data is downloaded.

## Live scanner: 1H zones · 5m confirmation (Steve's choice, Oct 13 2026)

Same rules with 1H in place of 4H and 5m in place of 15m. `pine/edge_sd_scanner.pine` runs on a 5m chart of
each of 15 markets (MGC MCL SIL MNG MES MNQ MYM M2K MHG 6E 6B 6J 6A ZN ZB) and posts
`{"type":"setup","strategy":"sd",...,"kind","zoneTop","zoneBot","mss","validMin":240}` to /api/hook.
Edge grades it with `gradeSD` (api/_rules.js: "S&D", or "C" under 1.5R / outside 02:00–11:30), shows `sdCard`
(app.js), and `take` sends it through `planTrade` with `sd:true` (1.5–6R allowed, no lock / break-even).

Backtest of 1H/5m (sd.js V='{"tp":"liq","depth":0,"htf":60,"ltf":5}', fees + slippage): ~90 trades a year,
−17.9R 2019–22, +15.9R 2023–26 — about break-even. By market: silver +20R, natgas +23R, gold 0, crude −45R.
Challenge since 2023: 47% pass, 44% fail (4H/15m: 67% / 3%). Tell him this whenever results come up.

Oct 13 2026, Steve's call: the scanner targets a fixed **1:3** and always alerts; the nearest 5m swing in the way
is sent as `liq` / `liqR` and shown on the card ("your call") — he decides if there is room. 1H/5m fixed 3R backtest:
~200 trades a year, 33% won, −0.4R 2019–22, +24.8R 2023–26; gold +33R, silver +18R, natgas +21R, crude −47R.
Challenge since 2023: 44% pass, 51% fail (crude included). Crude is OFF: Edge ignores S&D alerts from crude charts.
Risk on scanner trades for his $25k account: $160–$210, aim ~$190 (settings sdRiskMin / sdRiskTarget / sdRiskMax) — contracts closest to the aim, never over the max, flagged under the min.

Zone refinement (Oct 13, his call): an older opposite candle joins the zone only if its body sits inside the last
opposite candle's range (a base), not a step of the drop (sd.js "tight":1). 1H/5m 1:3: +27R total (gold +7, silver +38,
natgas +37, crude −55). Chart shows the newest zone with the trend, plus the one before it only if it doesn't overlap.

Chart (TradingView scanner + Edge home chart, sdchart.js): 1H zones (demand blue, supply orange) and 4H zones by the same
rules on 4H candles (demand green, supply pink, context only — alerts come from the 1H zone); an older zone is shown only
when it doesn't overlap; last 3 BOS + last MSS on the 1H; panel: 4H trend, 1H trend, 1H zone, 4H zone, what to wait for.
Entry on the 5m: FVG first, else breaker (leg swept a lower low) or mitigation block (higher low).

Zones are drawn WICK TO WICK (his rule): the 1–3 opposite candles at the origin of the impulse leg, from their wick to the
extreme of the move. The wick part (body edge → wick edge) is drawn lighter; alerts arm only when price reaches the body
part — wick-to-wick arming tested far worse (sd.js "wick":1: +1R vs +55R at $190, 2019–26; 2023–26 −2R vs +31R).

Portfolio + judgement research (Oct 14, sd.js ctx, 13 markets, trades fitting $190):
- Robust in BOTH 2019–22 and 2023–26: MSS 07:00–11:30 NY only, stop ≥ 0.5×1H ATR, skip fills 08:15–08:45 (US data).
  Core 6 markets (6j natgas 6e nq silver ym) with these: ~100 tr/yr, 40% won, +75R, maxDD −21R, challenge $190 ±$1,500: 71% pass / 17% fail.
- Judgement calls measured: displacement ≥1 ATR/bar slightly better in both periods; liquidity sweep (too rare), base length,
  premium/discount — no consistent edge. 4H trend / daily trend / inside-4H-zone filters: no edge.
- Edge rules in place: one trade per group (indices es nq ym rty · metals gold silver · currencies 6e 6b 6a 6j · bonds zn zb),
  waiting limits count, 2 trades/day, 2 open; big USD news blocks all 15 markets, big EUR/GBP/JPY/AUD news blocks that currency.
  These cut the worst day (−3.2R → −2.3R) more than they change the total.
- The confirm screen records his 4 judgement ticks (trade.judge); the Journal's "Your eye vs the scanner" card scores them.

## His reading (Oct 14) — to implement precisely
- 4H gives direction and context (swing structure: impulse → retracement → BOS … until the MSS; sdchart.swing).
  Trades are taken on 1H zones with a 5m confirmation, London + New York.
- After every BOS / MSS a retracement is expected. A trend is fuelled by MULTIPLE S&D zones (every base that created
  a move), not only the one at the last BOS — until fatigue / a higher-timeframe (daily, weekly) pullback.
- FRESH zones are best. A touch spends orders, depending on how DEEP price went into the zone.
- Liquidity is fuel: buys need sell-side taken, sells need buy-side taken (sdchart.liquidity: major BSL/SSL, swept vs run,
  resting pools, bias from the side swept last).
- Close vs wick: a break CONFIRMED by a candle CLOSE past the level means it may really go that way; a wick only past it
  = possible fake-out / liquidity grab.
- A losing trade isn't a bad setup if everything was there. Odds, not certainty.
- 30% fill (his rule, soft): on a fresh zone price usually fills ~30% of it before it turns; a 5m MSS before that may
  go deeper and stop you out (you become the liquidity). Not required — he decides. Measured on the drawn zone (wick
  edge → far edge) at the deepest point of the leg before the 5m MSS. Backtest 1H/5m 1:3, 12 markets 2019–Sep 2026:
  under 30% −139R / 1,922 trades (30% win), 30%+ +80R / 3,184 (35% win); body-zone measure: −28R vs +175R. Holds in
  both 2019–22 and 2023–26. Built in: Pine dotted 30% line + "zone filled X%" in panel and alerts (JSON `fill`), phone
  card chip + "Your eye" item `fill` (pre-ticked at 30%+), home chart 30% line + fill in the status.
- Zones (sdchart.swingZones): BOS/MSS bases + "fuel" bases (a displacement ≥1 ATR out of a base at a turn that takes
  the last 10 candles' high/low, with the trend); tall bases refined on the lower timeframe; touches + depth; `liq` =
  minor swings in front of the zone taken on the way to its first touch.
- Oct 14 decisions: CLEAN TradingView chart by default (live 1H zone + 30% line; latest setup only: $$$ taken,
  MSS 5m line, FVG, limit/stop + 1:3 boxes, HIGHEST target = the 1H high/low the move came from, ≥ 1:3, ≤ 10R).
  4H zone, older zone, 1H BOS/MSS labels off (inputs). Risk $100–140 a trade (aim $120; settings riskV3 migration).
  30% as a HARD rule tested: win rate unchanged on the drawn zone (36% → 36%), fewer trades, core5 152R → 124R → kept
  as a warning only. Highest target (ext3, cap 10R) ≈ fixed 1:3 in total (core5 150R vs 152R) — offered as a choice.
  ZN −3.6R, ZB −35.5R (2019–Sep 2026) → off.
- Mitigation block (his video, "2nd entry model"): in the zone, L1 → H (top of the first rally, highest high since
  L1) → higher low (2-candle swing, > L1) → strong close (body ≥ ½ range) above H. Block = last 1–3 up-close candles
  of the rally into H, wick to wick; limit at its top, stop 2 ticks under the higher low (sells mirrored). Tested
  (sd.js mb:1, 9 mkts, $140, 1:3): MB alone 658 tr 33% +24R (2023–26 −5R); as the zone's only entry it cuts the total
  177R → 146R. So in Pine it is a SEPARATE alert ("MB") that doesn't use up the zone; he picks. He liked the 6E Sep 11
  example.
- "Too far past the zone": overshoot past the far edge (5m, no 1H close) of 0.1–1 × 1H ATR did BETTER (liquidity
  grabs); > 1 ATR ≈ 22 trades, flat. Rule in Pine: no setup if > maxPast (1.0) × 1H ATR past the far edge.
- Oct 14 tests of his asks (9 mkts, $140, 1:3; core5 = 6J natgas 6E NQ YM; baseline core5 1630 tr +152R, all9 +177R):
  entry IN the zone only (nearATR 0): core5 387 tr +2R; ≤0.25 ATR: +74R; ≤0.5 ATR: +103R → winners mostly enter just
  above the zone (the FVG forms on the move away) → not a rule. MB with ≥2 candles: MB-only +20 → +29R (core5) → rule.
  Price "volume" proxy (break candle ≥1–2× 5m ATR, body ≥60%, fast leg): all worse (+48–78R core5, win 34%) → not a
  rule. Archive has NO volume (tools/candles.js stores OHLC only) — real volume is shown in Pine (×20-bar average on
  the break candle, alert `vol`, phone chip) but untested until the data is re-fetched with volume.
- Breaker block (video "3rd entry model"): L1 swing low → swing high (the one broken) → LOWER low (took L1) → quick
  (≤12 candles) close above the swing high. Breaker = last 2–3 up-close candles between L1 and the swing high, wick to
  wick; limit at its top; stop under the lower low (the video's tighter stop under the last pullback low tested worse).
  Replaces the FVG entry when present: 9 mkts +177R → +199R (sd.js bb:1, bbMin:2).
- NO RANGING (his rule): no setup if the 24 five-minute candles before the break moved < 1× the 1H ATR (rng24).
  Tested with the breaker: 2,874 tr 36% +199R → 2,299 tr 38% +254R (2023–26 +114R → +174R). Ranging setups won 27%.
  Low choppiness (ci24 ≤ 45, trending) won 46%. In Pine: minMove input, panel "price RANGING: no trade".
- Oct 14: he trades ALL 14 (crude off). Re-test with breaker + no-ranging ($140, 1:3, 2019–Sep 2026): 6J +49 · natgas +53
  · 6E +32 · NQ +47 · YM 0 · silver +22 · copper +15 · 6A +16 · gold +22 · ES −37 · RTY −3 (2023–26 −14) · 6B −8 ·
  ZN +1 (2023–26 −25) · ZB 6 trades (a contract is too big for $140). All 14: 3,324 tr 37% +214R (9 good ones +254R).
  Phone card shows a red "lost money in the tests — be picky" chip for ES, RTY, 6B, ZN, ZB (SD_WEAK in app.js).
- Hours (Oct 14, his ask "London session to New York session"): orders 03:00–14:00 New York (was 02:00–11:30), trades
  run to the 16:40 close-out. 9 good mkts, all rules: 02:00–11:30 & close 14:20 +254R → 03:00–14:00 & close 16:50 +313R
  (2023–26 +176R, 39% win). 02:00–03:00 fills −24R; 14:00–16:00 fills −10R since 2023 → left out.
- Hours, final (Oct 14, "only the high-volume hours, less time on the chart"): orders 03:00–11:00 New York. By alert
  (MSS) window, 9 good mkts, all rules, close-out 16:40: 03–14 +310R (325/yr) · 03–11 +293R (276/yr, 2023–26 +156R)
  · 03–07+08–11 +254R · 03–06+08:30–11 +199R · 03–05+08:30–10:30 +141R (2023–26 +24R). By fill hour: 03–07 +167R,
  08–11 +99R, 12–16 ≈ 0. Research option `win: [[from,to],…]` (minutes NY) in sd.js.
- A+ setups (Oct 14, "only the most profitable, I can't take every setup"): ci24 (choppiness of the 24 five-minute
  candles before the break) ≤ 45 OR ciX (24 candles ending at the extreme in the zone) ≤ 40 = price trended / came in
  fast. 03–11 NY, 9 mkts: all 2,071 tr 38% +0.14R/tr (22.5/mo) · A+ 692 tr 44% +0.31R/tr (7.5/mo; 2023–26 47%,
  +0.39R). Pine input onlyAPlus (default ON), "A+" on plan / alert (`aplus`) / phone chip.
  Challenge ($1,000 DD / $1,500 target, 2/day, one per group): 1–2 weeks is a coin flip at best ($300–375: ~45% pass,
  ~40–45% fail). No time limit: all $120 75% (trailing 50%) ~27 trading days · A+ $200 80% (65%) ~29 days · A+ $250
  72% (61%) ~21 days · A+ $120 91% (82%) ~60 days. Recommended to him: A+ only at $200–250.
- Target vs win rate (A+, $200, 03–11 NY): 1:1.5 50% win (2023–26 54%) pass 68%/52% · 1:2 47% (51%) 76%/58% ~37d ·
  1:2.5 45% 79%/58% · 1:3 44% (47%) 80%/65% ~29d (pass odds fixed/trailing DD). Strict A+ (ci≤40|ciX≤35) 48–54% at
  1:3 but ~3/month. HIS CHOICE (Oct 14): A+ only, target 1:2 (~50% win), risk $200–250 (aim $225; riskV4 migration).
- FINAL (Oct 14): target back to 1:3 (his call), risk $150–250 aim $200 (riskV5). The account has a 7-DAY INACTIVITY
  rule: A+ only leaves ≥7-day gaps 152/666 times (longest 34 days). So Pine sends every setup with `aplus`; Edge
  (radarSetup) alerts A+ always and non-A+ only after fallbackAfterDays (4) without a trade (else a quiet "skip" log);
  the London/NY brief warns from day 5 (inactivityDays 7). Backtest of that: 924 tr 10/mo 41% +207R, gaps ≥7 days
  still 65 times (no setups anywhere) → he must place a small trade by day 6 then. Pass odds $150 85%/73% (~40 trading
  days) · $200 77%/63% (~27) · $250 71%/49% (~17) fixed/trailing.
- 1:2 vs 1:3 by situation (03–11 NY, all rules): 1:3 has higher R/trade in EVERY group (A+ 0.29 vs 0.22; non-A+ 0.05
  vs 0.03; room to the 1H high <2R 0.11 vs 0.08, ≥3R 0.24 vs 0.12; with/against 4H ≈ equal). So 1:3 is the default;
  1:2 only when 2R × risk already reaches the challenge target (phone card preselects it and says so).
- HIS ACCOUNT (Oct 14): MyFundedFutures $25K Builder — target $1,500, max DD $1,000 EOD (trailing), daily loss $600,
  max 2 contracts (micro 10:1 = 20 micros), no eval consistency, inactivity 7 calendar days; funded: consistency 50%,
  payouts after 2 days, min $250, max $1,000, 80%, buffer $1,100. Preset firms.js mffu.builder25.
- Rules from a screenshot: Prop dialog → "Upload screenshot" (example img/rules-example.jpg) → action propRead →
  api/_rulesread.js (Claude vision, json_schema) → planFromRules: risk aim = 20% of DD (trailing) / 25% (static),
  range 15–25%, capped so 2 losers fit the daily loss; contracts = maxContracts × microRatio; inactivity → settings.
- HIS FINAL MARKETS (Oct 14): 6J, natgas, 6E, NQ, YM, silver, copper, 6A, gold (9). Removed ES/MES (A+ plan: 74 tr
  18% win −41R, also blocks NQ/YM via the index group), RTY, 6B, ZN, ZB, crude. Plan on these 9, EOD trailing $1,000:
  10 tr/mo 41% +0.22R/tr; pass $150 73% (~7.5 wks) · $200 63% (~4 wks) · $250 49% (~2.5 wks).
- MFF SAFETY (Oct 14, his rule "be safe, never lose the account on a rule"): MFF auto-closes at 16:10 NY (not on half
  days) and forbids open trades / working orders 2 min before → 2 min after a T1 release. Edge: flatBy 15:55 (flatV2
  migration, autoFlat on, settings capped at 16:00), half days (EARLY_CLOSE in _config) out by 12:45, newsFlatMin 10:
  cancel waiting limits + close trades in the affected markets 10 min before (newsFlatCheck). /api/tick (Vercel cron
  every minute) runs news, close-out, briefs even with no TradingView webhook.

## 1:4 tested (Oct 14, funded account)
9 markets, A+ only, 2019–Sep 2026, same filters as the final plan (scratchpad v14/ev14):
- 1:3 always: 7.3 trades/mo, 44% win, +0.31R/trade, 206R. At $100 on the funded $1,000 EOD drawdown: 82% reach the $1,100 payout buffer first (typical 3.4 months), 18% lose the account.
- 1:4 always: 41% win, +0.26R/trade, 178R, worst dip 19.7R (vs 14.1R) → 75% / 25%. Worse.
- 1:4 only when the highest target (1H origin) is ≥4R, else 1:3: 43% win, +0.30R, 202R → 81% / 19% — same as 1:3.
- Decision: 1:3 stays the default; the take dialog offers a 1:4 button only when the highest target is ≥4R (user's choice), and still shows the highest.
- Funded: risk $100 (sdRisk 70/100/100), one-tap switch from the passed evaluation (action propFunded).
