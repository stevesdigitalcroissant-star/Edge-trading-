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
node server.js          # http://localhost:3000  (Node 18+, nothing to install)
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
| `api/_news.js` | Economic calendar plus the weekly EIA / API / Baker Hughes schedule |
| `api/_broker.js` | OANDA connection (manual mode without it) |
| `index.html`, `app.js`, `app.css` | The dashboard (works on a phone) |
| `server.js` | Runs everything locally |

## Honest notes
- Edge enforces *your* rules. It can't make a losing strategy profitable. Backtest first, then paper-trade, then go live small.
- The calendar comes from the free ForexFactory weekly feed. If that's down, Edge still knows the weekly energy reports, but check the calendar for CPI, NFP and FOMC yourself.
- The Pine script tracks the latest 4H demand and supply zone. Older zones further away aren't drawn.
- Not financial advice. Trading CFDs and futures can lose more than you expect. Keep risk at 1% or less per trade.
