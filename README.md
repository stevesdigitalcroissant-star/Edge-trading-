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
| `EDGE_PASSWORD` | Your password for the dashboard |
| `EDGE_HOOK_SECRET` | Any long random word. The TradingView script must use the same one |
| `APP_URL` | Your app's address, e.g. `https://edge-xyz.vercel.app` (it's added to phone alerts) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | *Optional, recommended.* Phone alerts. In Telegram, message **@BotFather** → `/newbot` → copy the token. Send your bot a message, then open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id` |
| `ANTHROPIC_API_KEY` | Turns on the Coach (the screen-watching mode). From console.anthropic.com |
| `OANDA_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENV` | *Optional.* Lets Edge place orders and move your stop by itself. OANDA → Manage API Access → generate a token. Start with `OANDA_ENV=practice` (demo), and switch to `live` only after a few weeks of clean demo trading |

4. Redeploy. Open the app on your phone → Share → **Add to Home Screen**.

### 2. TradingView
1. Open a 5m chart of `OANDA:XAUUSD`, `OANDA:WTICOUSD` or `OANDA:NATGASUSD` (other symbols for gold, oil and gas work too).
2. Go to **Pine Editor**, paste in `pine/edge_supply_demand.pine` → **Add to chart**.
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
| `api/_news.js` | Economic calendar plus the weekly EIA / API / Baker Hughes schedule |
| `api/_broker.js` | OANDA connection (manual mode without it) |
| `index.html`, `app.js`, `app.css` | The dashboard (works on a phone) |
| `server.js` | Runs everything locally |

## Honest notes
- Edge enforces *your* rules. It can't make a losing strategy profitable. Backtest first, then paper-trade, then go live small.
- The calendar comes from the free ForexFactory weekly feed. If that's down, Edge still knows the weekly energy reports, but check the calendar for CPI, NFP and FOMC yourself.
- The Pine script tracks the latest 4H demand and supply zone. Older zones further away aren't drawn.
- Not financial advice. Trading CFDs and futures can lose more than you expect. Keep risk at 1% or less per trade.
