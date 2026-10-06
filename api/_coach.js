// Edge Coach: watches your chart (a screenshot every few seconds from the
// shared screen), reads it with Claude's vision, and tells you the one thing to
// do now — by YOUR rules. Works on TradingView, FX Replay, Tradovate, NinjaTrader…
//
// Claude reads the chart; the hard rules (break-even at 2R, exit at 3.2R, no
// target moving, A+ only, daily limits, news) are then applied here in code,
// so the final instruction never depends on the model being in a good mood.
//
// Needs ANTHROPIC_API_KEY. Each check is one Claude request at low effort.
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;
const { MARKETS } = require("./_config");
const R = require("./_rules");
const { dayKey } = require("./_time");
const { notify } = require("./_notify");

const STATUS = { type: "string", enum: ["pass", "fail", "unclear"] };
const CHECK = { type: "object", properties: { status: STATUS, note: { type: "string" } }, required: ["status", "note"], additionalProperties: false };
const NUM = { type: ["number", "null"] };

const SCHEMA = {
  type: "object",
  properties: {
    chartReadable: { type: "boolean" },
    platform: { type: "string" },
    symbol: { type: "string" },
    market: { type: "string", enum: ["gold", "crude", "natgas", "unknown"] },
    timeframe: { type: "string" },
    phase: { type: "string", enum: ["no_setup", "setup_forming", "entry_signal", "in_trade", "trade_closed"] },
    direction: { type: "string", enum: ["long", "short", "none"] },
    checklist: {
      type: "object",
      properties: { trend4h: CHECK, freshZone: CHECK, bos15: CHECK, close5: CHECK, room: CHECK, stop: CHECK },
      required: ["trend4h", "freshZone", "bos15", "close5", "room", "stop"],
      additionalProperties: false,
    },
    grade: { type: "string", enum: ["A+", "A", "B", "C", "none"] },
    position: {
      type: "object",
      properties: { open: { type: "boolean" }, dir: { type: "string", enum: ["long", "short", "none"] }, entry: NUM, stop: NUM, target: NUM, price: NUM },
      required: ["open", "dir", "entry", "stop", "target", "price"],
      additionalProperties: false,
    },
    instruction: { type: "string" },
    urgency: { type: "string", enum: ["info", "warn", "act_now"] },
    reasoning: { type: "string" },
    memory: { type: "string" },
  },
  required: ["chartReadable", "platform", "symbol", "market", "timeframe", "phase", "direction", "checklist", "grade", "position", "instruction", "urgency", "reasoning", "memory"],
  additionalProperties: false,
};

const CHECK_LABELS = {
  trend4h: "4H trend (break of structure)",
  freshZone: "Fresh 4H supply/demand zone reached",
  bos15: "15m break of structure, candle closed",
  close5: "5m entry candle closed",
  room: "Room to the target before the opposing zone",
  stop: "Stop beyond the reaction low/high",
};

function systemPrompt(s) {
  return `You are Edge Coach, a strict, calm trading coach. You see a live screenshot of the trader's chart and tell them the ONE thing to do right now, by their own rules.

The trader's history: greedy and impatient. They entered before confirmation, took setups that weren't A+, didn't move the stop to break-even, and gave profits back waiting for the target. You exist to stop that. Never encourage a trade that breaks a rule. Waiting is a valid and frequent instruction.

THE STRATEGY (supply & demand, trend following) — gold, crude oil, natural gas:
1. 4H trend: set by a break of structure — a candle CLOSE beyond the last swing high (uptrend) or swing low (downtrend).
2. Zone: the demand zone (uptrend) or supply zone (downtrend) is the base candle(s) where the impulsive move that broke structure started. Only a FRESH zone (first return) counts.
3. 15m: after price reaches the zone, a break of structure in the trend's direction on a CLOSED candle.
4. 5m: entry on the CLOSE of the 5m candle that breaks structure in the trend's direction. Never on an open candle.
5. Stop beyond the reaction low (long) / high (short) since the zone touch. There must be room to ${s.tpAtR}R before the opposing zone.
6. Management: stop to break-even at +${s.beAtR}R. Full exit at +${s.tpAtR}R. The target is never moved further away. The stop is never moved further away.
Grade A+ only when every checklist item passes. One failed item = A, two = B, more = C. "unclear" items: grade at most A and tell them which timeframe to check.

READING THE SCREEN
- It may be TradingView, FX Replay, Tradovate, NinjaTrader or similar. Read the symbol and timeframe from the chart header; map to market gold (XAU, GC, MGC), crude (CL, MCL, WTI, USOIL, Brent) or natgas (NG, QG, MNG, NATGAS).
- Usually only one timeframe is visible. Judge only what you can see; mark the rest "unclear" and say which timeframe to switch to.
- An open position appears as horizontal lines/labels for entry, stop (SL) and target (TP), often with P&L. Read prices from the right-hand price scale and the labels. The current price is usually highlighted on the scale.
- Never invent numbers. If you can't read a value, use null. If the chart isn't readable (wrong window, too small, a menu covering it), set chartReadable false and say what to show.

OUTPUT
- instruction: one short imperative sentence (max ~20 words) that will be SPOKEN ALOUD. Calm and firm. Examples: "No setup. Hands off — wait for price to reach the demand zone." / "Zone touched. Now wait for a 15-minute candle to close above the last high." / "Plus two R. Move your stop to break-even now."
- urgency: act_now only when they must do something this minute (enter a confirmed A+, move the stop, exit). warn for a rule risk. info otherwise.
- reasoning: 1–3 sentences on what you see.
- memory: one line to remember for the next screenshot (levels, zone, phase). Use the session memory you are given to stay consistent, but trust the current screenshot over memory.`;
}

// Rules applied in code after the model has read the chart.
function applyRules(out, session, ctx) {
  const s = ctx.settings;
  const res = { ...out, rules: [] };
  const p = out.position || {};
  const say = (instruction, urgency, rule) => { res.instruction = instruction; res.urgency = urgency; if (rule) res.rules.push(rule); };

  if (!out.chartReadable) return res;

  // a position is open: manage it with the fixed numbers
  if (p.open && p.entry != null) {
    const sameTrade = session.trade && Math.abs(session.trade.entry - p.entry) <= Math.abs(p.entry) * 0.0005 && session.trade.dir === p.dir;
    const initialSL = sameTrade ? session.trade.initialSL : p.stop;
    if (initialSL != null && R.sign(p.dir) * (p.entry - initialSL) > 0) {
      const t = { dir: p.dir, entry: p.entry, initialSL, currentSL: p.stop, tp: p.target, maxR: sameTrade ? session.trade.maxR : 0 };
      const ev = p.price != null ? R.evaluateTrade(t, { price: p.price }, s) : null;
      const plan = R.plan(t, s);
      res.trade = { dir: p.dir, entry: p.entry, initialSL, stop: p.stop, target: p.target, price: p.price, r: ev ? ev.r : null, maxR: ev ? ev.maxR : t.maxR, plan };
      if (ev) {
        const fxp = (x) => (Math.abs(x) >= 100 ? x.toFixed(2) : x.toFixed(3));
        const be = ev.actions.find((a) => a.type === "moveSL");
        const tp = ev.actions.find((a) => a.type === "setTP");
        const widened = ev.actions.find((a) => a.code === "widened");
        const nostop = ev.actions.find((a) => a.code === "nostop");
        if (nostop) say("Your stop loss is gone. Put it back in now.", "act_now", "no-stop");
        else if (widened) say(`Your stop is further away than where you started. Put it back to ${fxp(initialSL)} now.`, "act_now", "stop-widened");
        else if (ev.r >= s.tpAtR) say(`${s.tpAtR} R reached. Take the profit now.`, "act_now", "target");
        else if (be) say(`Plus ${s.beAtR} R reached. Move your stop to break-even, ${fxp(plan.beStop)}, now.`, "act_now", "break-even");
        else if (tp && tp.ruleBreak) say(`Your target is past ${s.tpAtR} R. Move it back to ${fxp(plan.tp)}. Greed gave profits back before.`, "act_now", "target-moved");
        else if (p.target == null) say(`No target on the chart. Set it at ${fxp(plan.tp)}, that's ${s.tpAtR} R.`, "warn", "no-target");
      }
    } else if (p.stop == null) {
      say("You're in a trade with no stop loss visible. Put the stop in now.", "act_now", "no-stop");
    }
    return res;
  }

  // entry signal: only A+ (and only when the guardrails allow it in live mode)
  if (out.phase === "entry_signal") {
    if (ctx.mode === "live" && ctx.block) say(`Not now: ${ctx.block}`, "warn", "locked");
    else if (out.grade !== "A+") say(`That's a grade ${out.grade}, not A plus. Skip it. Wait for your setup.`, "warn", "not-a-plus");
  }
  return res;
}

async function check(store, { image, mode = "live", question = "" }, ctx, client = null, now = Date.now()) {
  if (!process.env.ANTHROPIC_API_KEY && !client) throw new Error("Set ANTHROPIC_API_KEY in the environment to turn on the Coach.");
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(image || ""));
  if (!m) throw new Error("No screenshot received");
  const s = ctx.settings;

  const day = dayKey(now, s.tz);
  const used = (await store.get(`coachCount:${day}`)) || 0;
  if (used >= (s.coachDailyChecks || 600)) throw new Error(`Daily Coach limit reached (${used} checks). Raise it in Rules if you need more.`);
  await store.set(`coachCount:${day}`, used + 1);

  const session = (await store.get("coach")) || {};
  if (session.mode !== mode) { session.mode = mode; session.trade = null; session.memory = []; }

  const contextText = [
    `Mode: ${mode === "replay" ? "PRACTICE on a replay (historical chart, e.g. FX Replay): ignore the real clock, sessions and news; coach purely on the chart." : "LIVE (prop-firm account). Real money rules apply."}`,
    `Session memory (oldest first): ${(session.memory || []).slice(-6).join(" | ") || "none yet"}`,
    session.trade ? `Open trade remembered: ${JSON.stringify({ dir: session.trade.dir, entry: session.trade.entry, initialStop: session.trade.initialSL, bestR: session.trade.maxR })}` : "No open trade remembered.",
    mode === "live" ? `Weekly fundamentals bias: ${Object.entries(ctx.bias || {}).map(([k, b]) => `${k} ${b.dir}`).join(", ") || "not set"}.` : "",
    mode === "live" && ctx.block ? `New trades are BLOCKED right now: ${ctx.block}` : "",
    question ? `The trader asks: "${String(question).slice(0, 300)}"` : "",
  ].filter(Boolean).join("\n");

  client = client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a request is declined, the API retries it on its recommended fallback model
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: systemPrompt(s), cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } },
          { type: "text", text: contextText },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The ANTHROPIC_API_KEY isn't valid.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is busy — the next check will retry.");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude couldn't read the chart (${e.status}).`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined this screenshot. Make sure only the chart is shared.");
  if (response.stop_reason === "max_tokens") throw new Error("The read came back incomplete — trying again next check.");
  const block = response.content.find((c) => c.type === "text");
  let out;
  try { out = JSON.parse(block && block.text); } catch { throw new Error("Couldn't read Claude's answer — trying again next check."); }

  const res = applyRules(out, session, ctx);
  const market = MARKETS[out.market] ? out.market : null;

  // remember the trade across screenshots; journal it when it closes
  const prev = session.trade;
  if (res.trade) {
    session.trade = {
      dir: res.trade.dir, entry: res.trade.entry, initialSL: res.trade.initialSL, market: market || (prev && prev.market),
      maxR: Math.max(res.trade.maxR || 0, prev && prev.entry === res.trade.entry ? prev.maxR || 0 : 0),
      lastPrice: res.trade.price ?? (prev && prev.lastPrice), stop: res.trade.stop, target: res.trade.target,
      openedAt: prev && prev.entry === res.trade.entry ? prev.openedAt : now, grade: prev && prev.entry === res.trade.entry ? prev.grade : session.lastGrade || "unplanned",
      beMoved: res.trade.stop != null && R.sign(res.trade.dir) * (res.trade.stop - res.trade.entry) >= 0,
    };
  } else if (prev && !(out.position && out.position.open) && out.chartReadable) {
    const exit = (out.position && out.position.price) ?? prev.lastPrice;
    if (exit != null && prev.initialSL != null) {
      const t = { ...prev, id: `coach:${now}`, source: `coach-${mode}`, practice: mode === "replay", currentSL: prev.stop, tp: prev.target, closedAt: now, exit };
      t.resultR = R.round(R.rAt(t, exit));
      t.exitReason = R.exitReason(t, exit, s) + " (read from screen — tap to correct)";
      t.ruleBreaks = [];
      await store.hset("journal", t.id, t);
      await notify(store, `${mode === "replay" ? "🎮 Practice" : "📊"} ${MARKETS[t.market] ? MARKETS[t.market].name : "Trade"} ${t.dir} closed: ${t.resultR > 0 ? "+" : ""}${t.resultR}R (${t.exitReason}).`, "closed");
    }
    session.trade = null;
  }
  if (out.phase === "entry_signal") session.lastGrade = out.grade;
  if (out.memory) session.memory = [...(session.memory || []), out.memory].slice(-8);
  session.last = { at: now, phase: out.phase, instruction: res.instruction, urgency: res.urgency };
  await store.set("coach", session);

  if (mode === "live" && res.urgency === "act_now" && session.lastAlert !== res.instruction) {
    session.lastAlert = res.instruction;
    await store.set("coach", session);
    await notify(store, `🎙️ ${res.instruction}`, "action");
  }

  return {
    ...res,
    checklist: Object.entries(out.checklist || {}).map(([k, v]) => ({ id: k, label: CHECK_LABELS[k] || k, ...v })),
    usage: response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens, cached: response.usage.cache_read_input_tokens } : null,
    checksToday: used + 1,
  };
}

async function reset(store) { await store.del("coach"); }

module.exports = { check, applyRules, reset, SCHEMA, systemPrompt };
