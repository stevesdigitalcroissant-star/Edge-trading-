# Edge — trading co-pilot (Gold · Crude oil · Natural gas)

Edge is a separate project from the Illume site. It shares no code with it and is
deployed on its own.

Edge is built for one job: **take only A+ setups, and keep the profit.**
It takes the emotional decisions away from you:

| The old problem | What Edge does |
|---|---|
| Taking setups that weren't really your setup | Every setup is graded A+ / A / B / C on a fixed checklist. B and C can't be taken. A is allowed only while at least 90% of your last 20 trades are A+ |
| Impatience: entering early, chasing | The entry only comes on a **closed** 5m candle. A setup expires after 15 min, and the entry is refused if price already ran 0.3R past it |
| Greed: waiting for TP, giving profit back | At **+2R the stop goes to break-even** (by itself if the broker is connected). The exit is fixed at **3.2R**. If you move the target further away, Edge puts it back |
| Not putting the stop at break-even | Same as above: it's automatic, or you get a phone alert to do it right now |
| Revenge / FOMO / boredom trades | Before every trade you say how you feel. FOMO, revenge or boredom blocks the trade and starts a 15-min break. There's also a cool-down after a loss, a max of 2 trades a day, and a stop for the day at −2R |
| Getting hit by news | No new trades 30 min before or after big news for your market (CPI, NFP, FOMC, EIA crude Wed, EIA gas storage Thu, API Tue, OPEC). If you're in a trade and the stop isn't at break-even yet, you get a warning |
| Ignoring fundamentals | A weekly bias checklist for each market (dollar, yields, Fed, COT, inventories, OPEC, weather, storage, LNG…). A trade against your bias loses its A+ |

## You don't do the analysis — each setup comes with a picture

When a setup is A+, the phone alert says it in one line ("Uptrend · fresh 4H demand · 15m + 5m broke up. Buy
2652.40 · SL 2644.40 · TP 2678.00"). Tap it, and the setup shows a **trade map** with one colour per timeframe:

- **Purple = 4H**: the demand/supply zone and the break of structure that set the trend
- **Blue = 15m**: the confirmation break of structure
- **Yellow = 5m**: the entry break of structure
- Entry, stop (red), break-even (orange) and target (green) with prices, and the path price took ① → ④

Below it are four short lines (one per step) and the plan in one sentence. The checklist is folded away, so open it
only if you want to. The TradingView chart uses the **same colours** (zone boxes, a BOS line per timeframe, the plan
lines), so what you see on the phone matches the chart.

## End of the session: "Close everything"

- Rules → **Session close-out**: the time you must be out of every trade (default 16:40 New York time; set it a few
  minutes before your prop firm's close-out).
- **No new trades** in the last 30 minutes before it.
- **15 minutes before**, your phone gets "⏰ 15 min to the close-out". The Now tab shows a red banner with one big
  **⛔ Close everything** button. The button is always there while you're in a trade.
- Close everything sends the exit for trades Edge placed (TradersPost/OANDA) and logs every trade in the journal. For
  trades you placed by hand in TradingView, it reminds you to close them there too (Trading Panel → Positions).
- At the close-out time itself, Edge warns you loudly. Or, if you switch it on, it closes Edge-placed trades by itself.

## Weekly fundamentals from free data

Bias → **↻ Fill from free data**. Edge reads free official sources and suggests an answer for each line it can measure,
showing the numbers (📊). You check the rest (Fed tone, OPEC, weather, LNG, news) and tap Save.

| Line | Source (free) | Rule |
|---|---|---|
| US dollar | FRED, broad dollar index (no key) | −0.5% or more in 4 weeks → bullish gold/oil; +0.5% → bearish |
| Real yields | FRED, 10-year TIPS yield (no key) | −10 bp in 4 weeks → bullish gold; +10 bp → bearish |
| COT big speculators | CFTC public API (no key) | net position up/down by 3%+ of open interest in 4 weeks |
| Crude inventories | EIA (free key) | last week's change vs the usual for that week (5-year) ±1M bbl |
| Gas storage | EIA (free key) | level vs 5-year average ±3%, and last injection vs usual ±5 Bcf |

For inventories and storage, get a free key at eia.gov/opendata and add it as `EIA_API_KEY`. Everything else needs nothing.

## Liquidity: no sweep, no A+

Before the entry, price must **take liquidity**: trade beyond a level where stops sit, then come back. For a buy that
means a sweep of a low; for a sell, a sweep of a high. The script checks, in this order:

1. the **previous day** low/high
2. the **Asian session** low/high (18:00–02:00 New York, adjustable)
3. the last **15m swing** low/high from before price reached the zone

If one was swept between the zone touch and the entry, the setup says which one ("Asian low 2645.90 taken"). The
picture shows it as a white dashed **$$$** line, and the TradingView chart marks it the same way. With no sweep yet, the
setup is graded A (not A+), because price often comes back for those stops. The backtest uses the same rule
(setting *Only after liquidity is taken*).

## Taking the trade from the app (TradersPost, optional)

Instead of typing the order in TradingView, Edge can send it for you:

1. Make a TradersPost account, connect your prop firm's **Tradovate** account, create a strategy, and copy its
   **webhook URL**.
2. Add it to Vercel as `TRADERSPOST_WEBHOOK_URL` and redeploy.
3. Now **"Take it — send the order"** sends a market order with the stop and the target attached, for the exact
   contracts Edge worked out. At +2R, Edge sends the **break-even** move by itself. *Close trade* sends an exit.

Check your prop firm's rules first. Tradeify allows automation through TradersPost. Phidias isn't listed by
TradersPost, and its rules call for actively monitoring trades that use semi-automated tools, so ask them before using
it there. Test on a demo/evaluation account first. TradersPost maps continuous symbols like `MGC1!` to the front-month
contract. Watch the roll dates.

## Placing trades in TradingView (prop firm via Tradovate)

1. In TradingView, open the **Trading Panel** (bottom) → **Tradovate** → log in with the login your prop firm gave you.
2. Charts: `COMEX:MGC1!` (micro gold), `NYMEX:MCL1!` (micro crude), `NYMEX:QG1!` or `NYMEX:MNG1!` (small natural gas), 5-minute,
   with the Edge script and one alert each. Make sure the chart shows **real-time** data (CME/COMEX/NYMEX data add-on
   if TradingView shows it delayed).
3. In Edge → Rules, set **Account size** to your prop account (e.g. 50000) and **Risk per trade** (e.g. 0.5%).
4. When an A+ alert arrives, Edge's setup card shows the **Order for TradingView**: side, number of contracts (whole
   contracts, never above your risk), stop loss and take profit. Type those into the order panel with **Take profit** and
   **Stop loss** ticked, place it, then tap **I'm taking it** in Edge.
5. At +2R, Edge tells you to drag the stop line on the chart to your entry (break-even). Edge's price comes from the
   chart heartbeat, so you get the alert even with TradingView closed.

## Your account

The first time you open Edge, you **create your account**: your email, a password (8+ characters) and the
`EDGE_SETUP_CODE`. Edge then shows a **recovery code** once. Save it in your password manager or notes, because it's
how you get back in if you forget your password ("Forgot password?" on the sign-in screen).

- Passwords are stored only as a salted scrypt hash. Sign-ins last 30 days per device.
- **Rules → Account**: change your password (this signs out your other devices), get a new recovery code, sign out.
- After 8 wrong passwords in 15 minutes, sign-in pauses for 15 minutes.

## Edge on your iPhone / iPad (with notifications)

1. Open your Edge address in **Safari**, then tap **Share → Add to Home Screen → Add**.
2. Open **Edge from the new icon** (it opens full-screen, like an app) and sign in.
3. Tap **Turn on** (Now tab, or Rules → Notifications) → **Allow**. You'll get a test alert.
4. Repeat on each device you want alerts on (iPhone, iPad, computer). Needs iOS / iPadOS 16.4 or newer.

What you get, even when the app is closed (you can switch each one off in Rules → Notifications):

| Notification | When |
|---|---|
| ✅ A+ setup | The TradingView script found a setup that passed every rule. Tap to open it (it's valid 15 min) |
| ⚡ Act now (stays on screen until tapped) | +2R → move your stop to break-even · take profit · Coach "act now" alerts |
| ⚠️ Rule check | Stop moved further away, stop missing, target pushed out, 15m structure broke against you |
| 📰 News coming | ~45 min before CPI / NFP / FOMC / EIA etc. — with the exact no-trade window |
| 📒 Trade closed | Result in R, and how it ended (target, break-even, stop, early) |
| 🔒 Done for today | Max trades or daily loss limit hit |
| ⛔ Not your setup | *Off by default* — setups that weren't A+, if you want to see what you skipped |

Nothing to configure on the server: the keys that sign notifications are created on first use and saved
in storage. (To use your own, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.) Alerts and
news reminders are checked on every 5-minute TradingView heartbeat, so keep the TradingView alert running.
The Coach (screen watching) needs a computer, because iPhone and iPad browsers can't share a screen. Its
"act now" alerts still arrive on your phone.

## Replay — Edge finds the setups for you (free)

**Coach → Replay (Edge finds it).** Real past 5-minute candles for gold, crude
or natural gas (free futures data: GC, CL, NG — the last ~60 days) play back on
a chart in Edge. `engine.js` runs the same rules as the TradingView script on
them — 4H zones and trend, fresh touch, liquidity sweep, 15m break, 5m close —
and only on closed candles, so it never peeks ahead. When every step is done it
stops, says **A+ LONG/SHORT — enter at …** out loud, and you choose Take or Skip.
Once taken, it says when to move the stop to break-even, closes at the target,
the stop or the 16:40 close-out, and logs the result to Journal → Practice by
itself. Skipped setups show you how they would have ended. "Next A+ setup"
jumps to three hours before the next one so you watch it form; "Take every A+
automatically" just lets you watch the rules play out.

For FX Replay itself, the **AI coach** reads your screen and does the same
(needs `ANTHROPIC_API_KEY`, paid per check); the **FX Replay checklist** is the
manual, free version.

## Practice on FX Replay (free)

FX Replay can't run TradingView scripts, so the practice screen (**Coach →
Practice (FX Replay)**) makes you find the five steps yourself and tick them:
4H trend → fresh zone touched → liquidity taken (which one) → 15m break → 5m
close. **I entered** only unlocks at 5/5. Type entry and stop and Edge gives the
take-profit (3.2R) and the break-even price (2R) to set in FX Replay; type the
replay price as you go and it tells you what to do. Log how it ended (target,
break-even, stop, or your exit) — skipped steps and early exits are recorded as
rule breaks. Practice results live in Journal → Practice and never touch your
real stats. Works on the iPad and phone too.

## Free chart reader — no webhook, no AI key (TradingView free plan)

The script does the analysis on your chart and shows every step in its panel
(top-right): 4H trend → fresh zone touched → liquidity taken → 15m break → 5m
close. Only when all five are done does it print **▲ ENTER LONG — A+** (or
SHORT) with the entry, stop, break-even and target drawn. A trigger that misses
a step gets a grey "skip: no liquidity taken" (or whichever step is missing).
While the trade runs, the panel's "do now" line and the chart labels tell you
when to move the stop to break-even and when to close.

The first line of the panel is the **EDGE code**, e.g.
`EDGE MGC1! LONG E 4207.8 SL 4195.2 PX 4210.1`. On your computer, open Edge →
**Coach → Chart reader (free)** → **Start reading my chart** and share the
TradingView window. Edge reads that line off the screen (OCR, in your browser):

- a new ENTER signal → it speaks, and **Take it in Edge** turns it into a setup
  (your limits, news, mood check still apply) — no typing;
- the live price → Edge's trade manager: what to do now, out loud, in the
  **⧉ Float over my chart** window, and as phone notifications (+2R → stop to
  break-even, target, session end).

It acts only on two identical reads in a row and ignores any price more than 4%
from your open trade, so a misread can never close anything.

## Coach — Edge watches your chart with you

Open Edge **on your computer** (Chrome or Edge) → **Coach** tab → *Start watching my chart*. Then pick the
window with your chart: TradingView, **FX Replay**, Tradovate or NinjaTrader. Nothing to type.

- Every 60 s while you wait, and every 20 s while in a trade, Edge takes a screenshot of that window (only if
  the chart changed). Claude reads the symbol, timeframe, zones, structure and your position lines, then
  Edge **says out loud** the one thing to do now: *"No setup, hands off"*,
  *"Zone touched — wait for the 15-minute candle to close"*, *"Plus 2 R. Move your stop to break-even, now."*
- Claude only reads the chart. The hard rules are applied in code afterwards: break-even at 2R, exit at 3.2R,
  target moved back, stop widened, no stop, A+ only, daily limits and news. A good mood or a bad read can't
  talk you out of your plan.
- **⧉ Float over my chart** keeps a small always-on-top window with the instruction over your platform.
- **Practice (FX Replay) mode** ignores the real clock and news. Trades it sees open and close are logged
  automatically as *practice*, kept apart from your real stats. Practise there until the A+ trades prove themselves.
- **Live mode** also sends the urgent instructions to your phone (Telegram).
- Needs `ANTHROPIC_API_KEY` (console.anthropic.com → API keys). Each check is one Claude request (Claude Opus 5.5,
  low effort), roughly a cent or two. A 3-hour session is typically a few dollars. There's a daily cap in Rules.
  Only the shared window is sent, never the rest of your screen.

## The strategy, as rules

All of it is in `pine/edge_supply_demand.pine` (TradingView, Pine Script v6). You use it on a **5-minute chart**:

1. **4H trend.** The trend is set by a break of structure (a candle closing beyond the last swing). The candle where the move started becomes the **demand zone** (uptrend) or **supply zone** (downtrend).
2. **Zone touch.** Price comes back into the zone. The first touch counts as fresh.
3. **15m confirmation.** A break of structure in the trend's direction, on a closed candle.
4. **5m entry.** On the close of the next 5m break of structure. You can switch this to "the first 5m close after the 15m break".
5. **Stop.** Beyond the lowest low (for a long) or highest high (for a short) since the zone touch, plus a small buffer.
6. **Exits.** Break-even at +2R, target at +3.2R.

The script is a *strategy*, so **TradingView's Strategy Tester shows how these exact rules
did on past data**, with the same break-even and target. Backtest each market before
putting money behind it.

## How it fits together

```
TradingView (5m chart + Edge script)
   │  alert → webhook (JSON)
   ▼
Edge app  ── grades the setup, checks news, bias, limits ──► Telegram alert on your phone
   │                                                           "✅ A+ LONG Gold … open Edge"
   ▼
You open Edge → say how you feel → Confirm
   │
   ├─ OANDA connected: Edge places the order (stop + 3.2R target, size from your risk %)
   │                   and moves the stop to break-even at +2R by itself
   └─ any other broker: Edge shows the exact numbers. You place the order in TradingView,
                        and Edge tells you the moment you need to move your stop
```

## Set it up (about 30 minutes)

### 1. Deploy the app (free)
1. Go to vercel.com → **Add New → Project** → this repository. Set **Root Directory** to `edge`. Leave Framework as "Other".
2. In the project, go to **Storage → Upstash for Redis** (free plan) and connect it. This is where your trades and journal are saved.
3. Under **Settings → Environment Variables**, add:

| Variable | What it is |
|---|---|
| `EDGE_SETUP_CODE` | Any secret word. You type it once when you create your account (email + password), so nobody who finds your app's address can claim it first |
| `EDGE_HOOK_SECRET` | Any long random word. The TradingView script must use the same one |
| `APP_URL` | Your app's address, e.g. `https://edge-xyz.vercel.app` (it's added to phone alerts) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | *Optional, recommended.* Phone alerts. In Telegram, message **@BotFather** → `/newbot` → copy the token. Send your bot a message, then open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id` |
| `EIA_API_KEY` | *Optional, free.* Oil inventories and gas storage for the weekly fundamentals (eia.gov/opendata) |
| `TRADERSPOST_WEBHOOK_URL` | *Optional.* Lets "Take it" send the order (and the break-even move) to your Tradovate account through TradersPost |
| `ANTHROPIC_API_KEY` | Turns on the Coach (the screen-watching mode). From console.anthropic.com |
| `OANDA_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENV` | *Optional.* Lets Edge place orders and move your stop by itself. OANDA → Manage API Access → generate a token. Start with `OANDA_ENV=practice` (demo), and switch to `live` only after a few weeks of clean demo trading |

4. Redeploy. Open the app on your phone → Share → **Add to Home Screen**.

### 2. TradingView
1. Open a 5m chart of `OANDA:XAUUSD`, `OANDA:WTICOUSD` or `OANDA:NATGASUSD` (other symbols for gold, oil and gas work too).
2. Go to **Pine Editor**, delete the starter code that is already there (Ctrl+A, Delete), then paste in `pine/edge_supply_demand.pine` → **Add to chart**.
3. In the script's settings: under **Webhook secret**, enter the same word as `EDGE_HOOK_SECRET`. Set the session to `0300-1200` for gold and `0800-1430` for oil and gas.
4. Create an **alert**. Condition: *Edge S&D* → **"alert() function calls only"**. Under Notifications, tick **Webhook URL** and enter `https://<your-app>/api/hook`.
5. Repeat for each market (one chart and one alert each).

> Webhooks need a paid TradingView plan (Essential or higher).

### 3. Every week
Sunday: open **Bias** and answer the checklist for each market. Use the COT report
(Friday), EIA numbers, the dollar, yields, and the weather for gas. It takes 10 minutes.
A bias older than 7 days stops counting.

## Run it on your own computer instead
```bash
cd edge
cp .env.example .env    # fill it in
npm install             # one dependency: the Anthropic SDK (for the Coach)
node server.js          # http://localhost:3000  (Node 18+)
```
Running it yourself, Edge checks open trades **every 10 seconds** on its own. On Vercel,
it checks on every 5m candle (the TradingView heartbeat) and whenever the dashboard is open.
For a webhook to reach your computer, you need a public address (e.g. a tunnel like `cloudflared`).

## Tests
```bash
cd edge && npm test
```
The tests cover grading, the 90% rule, guardrails, news blackout, break-even at 2R, the 3.2R target, the greed check
(target moved back), and a complete trade from alert → break-even → target. They use a fake broker for the automatic mode.

## Files
| File | What it is |
|---|---|
| `pine/edge_supply_demand.pine` | TradingView strategy: 4H trend + zones, 15m confirmation, 5m entry. Includes the backtest and the alerts |
| `api/hook.js` | Receives TradingView alerts |
| `api/app.js` | The dashboard's API (password-protected) |
| `api/_rules.js` | The rules: grade, guardrails, the 90% rule, trade management. Pure functions, all tested |
| `api/_core.js` | Webhook handling, trade manager, journal |
| `api/_coach.js`, `api/coach.js`, `coach.js` | The Coach: screen sharing in the browser, the chart read by Claude, the rules applied after it |
| `sw.js`, `api/_notify.js` | Notifications: phone/iPad/computer push (Web Push), Telegram, and the event log |
| `api/_fundamentals.js` | Weekly fundamentals from free data: CFTC COT, FRED dollar and real yields, EIA inventories and storage |
| `api/_news.js` | Economic calendar plus the weekly EIA / API / Baker Hughes schedule |
| `api/_broker.js` | OANDA connection (manual mode without it) |
| `index.html`, `app.js`, `app.css` | The dashboard (works on a phone) |
| `server.js` | Runs everything locally |

## Honest notes
- Edge enforces *your* rules. It can't make a losing strategy profitable. Backtest first, then paper-trade, then go live small.
- The calendar comes from the free ForexFactory weekly feed. If that's down, Edge still knows the weekly energy reports, but check the calendar for CPI, NFP and FOMC yourself.
- The Pine script tracks the latest 4H demand and supply zone. Older zones further away aren't drawn.
- Not financial advice. Trading CFDs and futures can lose more than you expect. Keep risk at 1% or less per trade.
