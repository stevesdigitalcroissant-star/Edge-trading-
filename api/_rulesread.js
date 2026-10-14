// Your prop firm's rules from a screenshot: Claude reads the rules page (vision, structured JSON), then Edge builds
// the plan around them in code — risk per trade, daily stop, contracts, inactivity, payout — from the tested numbers.
//
// Needs ANTHROPIC_API_KEY. One Claude request per screenshot.
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;

const N = { type: ["number", "null"] };
const DD = { type: "string", enum: ["eod", "intraday", "static", "unknown"] };
const PHASE = (extra = {}) => ({
  type: "object",
  properties: { dd: N, ddType: DD, dailyLoss: N, maxContracts: N, microRatio: N, consistencyPct: N, ...extra },
  required: ["dd", "ddType", "dailyLoss", "maxContracts", "microRatio", "consistencyPct", ...Object.keys(extra)],
  additionalProperties: false,
});
const SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    firm: { type: "string" },
    plan: { type: "string" },
    size: N,
    eval: PHASE({ target: N, minDays: N, inactivityDays: N }),
    funded: PHASE({
      payout: {
        type: "object",
        properties: { minDays: N, minPayout: N, cap: N, splitPct: N, buffer: N, minProfitPerDay: N },
        required: ["minDays", "minPayout", "cap", "splitPct", "buffer", "minProfitPerDay"],
        additionalProperties: false,
      },
    }),
    notes: { type: "string" },
  },
  required: ["readable", "firm", "plan", "size", "eval", "funded", "notes"],
  additionalProperties: false,
};

const SYSTEM = `You read screenshots of futures prop-firm rule pages (evaluation / funded / payout rules) and return the numbers exactly as shown.
- Dollar amounts as plain numbers: "$1.5K" = 1500, "$1K" = 1000, "$600" = 600.
- "Max Position 2 Contracts" = maxContracts 2 (full-size contracts). "Micro Scaling 10:1" = microRatio 10.
- Drawdown mode: "EOD" / "end of day" = eod; "intraday" / "real-time" / "trailing live" = intraday; "static" / "fixed" = static; otherwise unknown.
- A rule shown with an ✗ / "none" / "N/A" means it doesn't apply: use null. Consistency "50%" = 50.
- "Inactivity Rule 7 calendar days" = inactivityDays 7. Profit split "80%" = splitPct 80.
- Account size from the plan name ("$25K Builder Plan" = 25000). Never guess a number that isn't on the screen: use null.
- readable = false if the image isn't a rules page. Put anything important that doesn't fit the fields in notes (one or two short sentences).`;

async function readRules(image, client = null) {
  const m = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(String(image || ""));
  if (!m) throw new Error("Send a screenshot (JPG or PNG).");
  if (!process.env.ANTHROPIC_API_KEY && !client) throw new Error("Reading screenshots needs ANTHROPIC_API_KEY in Vercel (the same key as the Coach).");
  client = client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a request is declined, the API retries it on its recommended fallback model
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } },
        { type: "text", text: "Read the rules on this screenshot." },
      ] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The ANTHROPIC_API_KEY isn't valid.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is busy — try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude couldn't read the screenshot (${e.status}).`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined this screenshot. Upload only the rules page.");
  if (response.stop_reason === "max_tokens") throw new Error("The read came back incomplete — try again.");
  const block = response.content.find((c) => c.type === "text");
  let out;
  try { out = JSON.parse(block && block.text); } catch { throw new Error("Couldn't read Claude's answer — try again."); }
  if (!out.readable) throw new Error("That doesn't look like a rules page. Upload the screenshot of your plan's trading rules.");
  return out;
}

const r10 = (x) => Math.max(10, Math.round(x / 10) * 10);
const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;

// The plan, in code: sized from the drawdown (a losing streak must not end the account), checked against the
// daily loss limit (2 trades a day) and the contract limit, paced by the tested strategy (A+ at 1:3, ~10 trades a
// month, 41% wins, +0.22R a trade on the 9 markets that made money, 2019–Sep 2026).
function planFromRules(r) {
  const e = r.eval || {}, f = r.funded || {}, dd = e.dd || f.dd, trailing = (e.ddType || f.ddType) !== "static";
  if (!(dd > 0)) throw new Error("No drawdown found on the screenshot — type it in the form below.");
  // 5–7 losses in a row before the drawdown at the aim / the low end (trailing: smaller)
  let aim = r10(dd * (trailing ? 0.2 : 0.25)), lo = r10(dd * (trailing ? 0.15 : 0.18)), hi = r10(dd * (trailing ? 0.25 : 0.3));
  const dl = e.dailyLoss || f.dailyLoss;
  if (dl > 0) { const cap = r10(Math.floor(dl / 2 / 10) * 10); hi = Math.min(hi, cap); aim = Math.min(aim, hi); lo = Math.min(lo, aim); } // 2 losers a day must fit
  const maxMicros = e.maxContracts ? e.maxContracts * (e.microRatio || 10) : f.maxContracts ? f.maxContracts * (f.microRatio || 10) : null;
  const perMonthR = 10 * 0.22, months = e.target ? Math.max(1, Math.round((e.target / (perMonthR * aim)) * 2) / 2) : null;
  const lines = [
    `Risk ${usd(lo)}–${usd(hi)} a trade, aim ${usd(aim)}: ${Math.floor(dd / aim)} losses in a row before the ${usd(dd)} drawdown${trailing ? " (it trails, so size stays modest)" : ""}.`,
    dl > 0 ? `Daily loss limit ${usd(dl)}: 2 trades a day max, so even 2 losers (${usd(2 * aim)}) stay under it.` : "2 trades a day max.",
    maxMicros ? `Max ${e.maxContracts || f.maxContracts} contracts = ${maxMicros} micros — Edge never sizes above that.` : "",
    e.target ? `Target ${usd(e.target)}: the tested average with A+ setups at 1:3 is ≈ +${perMonthR.toFixed(1)}R a month (≈ ${usd(perMonthR * aim)} at ${usd(aim)}), so plan for about ${months} month${months === 1 ? "" : "s"} — good streaks get there sooner. Rushing with bigger risk turns it into a coin flip.` : "",
    e.inactivityDays ? `Inactivity: a trade at least every ${e.inactivityDays} days — Edge alerts every valid setup from day 4 without a trade and warns from day ${Math.max(1, e.inactivityDays - 2)}.` : "",
    f.consistencyPct ? `Funded: consistency ${f.consistencyPct}% — no single day can be more than ${f.consistencyPct}% of your profit, so keep the same size every day.` : "",
    f.payout && (f.payout.minPayout || f.payout.buffer) ? `Payouts: ${[f.payout.buffer ? `${usd(f.payout.buffer)} buffer first` : "", f.payout.minPayout ? `min ${usd(f.payout.minPayout)}` : "", f.payout.cap ? `max ${usd(f.payout.cap)}` : "", f.payout.splitPct ? `${f.payout.splitPct}% to you` : "", f.payout.minDays ? `after ${f.payout.minDays} days` : ""].filter(Boolean).join(" · ")}.` : "",
  ].filter(Boolean);
  const ddType = (t) => (["eod", "intraday", "static"].includes(t) ? t : "eod");
  const cfg = {
    firm: "custom", plan: [r.firm, r.plan].filter(Boolean).join(" · ").slice(0, 40), phase: "eval", size: r.size, target: e.target, dd: e.dd ?? f.dd, ddType: ddType(e.ddType),
    dailyLoss: e.dailyLoss, consistencyPct: e.consistencyPct, minDays: e.minDays, maxMicros, baseRisk: aim, inactivityDays: e.inactivityDays,
    funded: { dd: f.dd, ddType: ddType(f.ddType), dailyLoss: f.dailyLoss, consistencyPct: f.consistencyPct, maxMicros: f.maxContracts ? f.maxContracts * (f.microRatio || 10) : null,
      payout: f.payout ? { minDays: f.payout.minDays, buffer: f.payout.buffer, cap: f.payout.cap, minPayout: f.payout.minPayout, split: f.payout.splitPct ? `${f.payout.splitPct}/${100 - f.payout.splitPct}` : "" } : {} },
  };
  return { cfg, risk: { min: lo, aim, max: hi }, inactivityDays: e.inactivityDays || null, lines, notes: r.notes || "" };
}

module.exports = { readRules, planFromRules, SCHEMA };
