// A trade you took, from a screenshot (TradingView chart / Trading Panel, Tradovate, the MFF dashboard): Claude reads
// what's on the screen — market, buy/sell, entry, stop, target, contracts, and the exit or P&L if it's already closed.
// Whatever isn't visible comes back null and the app asks you for it. Nothing is saved until you check it.
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;
const { marketOf, futuresSpec } = require("./_config");

const N = { type: ["number", "null"] };
const SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    symbol: { type: "string" },
    dir: { type: "string", enum: ["long", "short", "unknown"] },
    entry: N, stop: N, target: N, contracts: N,
    status: { type: "string", enum: ["open", "closed", "unknown"] },
    exit: N, pnlUSD: N,
    notes: { type: "string" },
  },
  required: ["readable", "symbol", "dir", "entry", "stop", "target", "contracts", "status", "exit", "pnlUSD", "notes"],
  additionalProperties: false,
};

const SYSTEM = `You read screenshots of a futures trade (TradingView chart with a long/short position tool or order lines, the Trading Panel, Tradovate, or a prop-firm dashboard) and return the trade's numbers exactly as shown.
- symbol: the ticker as shown (e.g. "MNQ1!", "MGCZ2026", "M6E1!"). "" if not visible.
- dir: "long" for buy / long position tool, "short" for sell, "unknown" if you can't tell.
- entry = average fill / entry price; stop = stop loss price; target = take-profit price. A long/short position tool: entry is the line between the red and green boxes, stop the far edge of the red box, target the far edge of the green box.
- contracts: the position size (quantity). null if not shown.
- status: "closed" if the screenshot shows the trade finished (closed position, filled exit, realized P&L, trade history row); "open" if it shows a live position; otherwise "unknown".
- exit: the exit price if closed and shown. pnlUSD: the dollar P&L shown for this trade (negative for a loss), realized if closed. null if not shown.
- Never guess a number that isn't on the screen: use null. readable = false if there's no trade on the screenshot. notes: one short sentence if anything is unclear.`;

async function readTradeShot(image, client = null) {
  const m = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(String(image || ""));
  if (!m) throw new Error("Send a screenshot (JPG or PNG).");
  if (!process.env.ANTHROPIC_API_KEY && !client) throw new Error("Reading screenshots needs ANTHROPIC_API_KEY in Vercel.");
  client = client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } },
        { type: "text", text: "Read the trade on this screenshot." },
      ] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The ANTHROPIC_API_KEY isn't valid.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is busy — try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude couldn't read the screenshot (${e.status}${e.status === 400 && e.message ? `: ${String(e.message).slice(0, 160)}` : ""}). You can enter the trade by hand below.`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined this screenshot.");
  const block = response.content.find((c) => c.type === "text");
  let out; try { out = JSON.parse(block && block.text); } catch { throw new Error("Couldn't read the trade — try a clearer screenshot."); }
  if (!out.readable) throw new Error("No trade on that screenshot. Upload your chart with the position, or the Trading Panel.");
  return out;
}

// what Claude read → the fields of Edge's trade form, plus the list of what you still have to fill in
function shotFields(r) {
  const market = marketOf(r.symbol || ""), spec = futuresSpec(r.symbol || "");
  const f = { market, symbol: r.symbol || null, contract: spec ? spec.root : null, dir: r.dir === "long" || r.dir === "short" ? r.dir : null, entry: r.entry, sl: r.stop, tp: r.target, units: r.contracts, status: r.status, exit: r.exit, pnlUSD: r.pnlUSD, notes: r.notes || "" };
  const missing = [["market", "market"], ["dir", "buy or sell"], ["entry", "entry"], ["sl", "stop loss"], ["tp", "target"], ["units", "contracts"]].filter(([k]) => f[k] == null).map(([, label]) => label);
  return { fields: f, missing };
}

module.exports = { readTradeShot, shotFields, SCHEMA };
