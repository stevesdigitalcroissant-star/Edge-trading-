// A TradingView alert handed to Edge by hand — when webhooks aren't available (no two-factor on TradingView), the
// scanner's alerts go to the TradingView app as plain text. Paste that text (or upload a screenshot of it) and Edge
// turns it into the same setup a webhook would have sent: card, Confirm, sizing, order.
//
// The text is the scanner's plain-text alert, e.g.
//   "A+ MNQ1! BUY limit 29187.50 · SL 29159.00 · TP 29273.00 (3.0R, FVG) · 1H demand 29132.75–29200.75 · 5m MSS at
//    29187.50 · with the 4H trend · highest target 29380.00 (6.8R) · zone filled 42% · volume 2.1× average"
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;

const NUM = "(-?\\d[\\d,]*\\.?\\d*)";
const n = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));

function parseAlert(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const head = new RegExp(`(A\\+ )?([A-Z0-9]{1,8}1!|[A-Z0-9]{2,8}[FGHJKMNQUVXZ]\\d{2,4}) (BUY|SELL) limit ${NUM} · SL ${NUM} · TP ${NUM} \\(([^,]+), ([^)]+)\\)`).exec(t);
  if (!head) throw new Error("That doesn't look like an Edge S&D alert. Copy the whole alert text (it starts with the market, e.g. \"MNQ1! BUY limit …\").");
  const [, aplus, symbol, side, e, sl, tp, rrTxt, kindTxt] = head;
  const dir = side === "BUY" ? "long" : "short", k = dir === "long" ? 1 : -1;
  const entry = n(e), stop = n(sl), target = n(tp), r = Math.abs(entry - stop);
  const zone = new RegExp(`1H (?:demand|supply) ${NUM}[–-]${NUM}`).exec(t);
  const mss = new RegExp(`5m MSS at ${NUM}`).exec(t);
  const hi = new RegExp(`highest target ${NUM} \\(${NUM}R\\)`).exec(t);
  const fill = /zone filled (\d+)%/.exec(t), past = /wicked past the zone's far edge/.test(t);
  const vol = new RegExp(`volume ${NUM}× average`).exec(t);
  const swing = new RegExp(`5m swing at ${NUM}R`).exec(t);
  const zs = /zone score ([+-]?\d)[^(]*(?:\(([^)]*)\))?/.exec(t);
  const kind = /MITIGATION BLOCK/i.test(kindTxt) ? "MB" : /breaker/i.test(kindTxt) ? "breaker" : /FVG/i.test(kindTxt) ? "FVG" : kindTxt.trim().slice(0, 20);
  return {
    type: "setup", strategy: "sd", symbol, dir, entry, sl: stop, tp: target, rr: r > 0 ? +(Math.abs(target - entry) / r).toFixed(2) : n(rrTxt),
    kind, zoneBot: zone ? Math.min(n(zone[1]), n(zone[2])) : null, zoneTop: zone ? Math.max(n(zone[1]), n(zone[2])) : null, mss: mss ? n(mss[1]) : null,
    trend4h: /with the 4H trend/.test(t) ? k : /AGAINST the 4H trend/.test(t) ? -k : 0,
    tpMax: hi ? n(hi[1]) : null, rrMax: hi ? n(hi[2]) : null, fill: past ? 1.2 : fill ? n(fill[1]) / 100 : null, vol: vol ? n(vol[1]) : null,
    liqR: swing ? n(swing[1]) : null, liq: swing && r > 0 ? +(entry + k * n(swing[1]) * r).toFixed(6) : null, aplus: !!aplus, go: /✅\s*TAKE/.test(t) ? true : /⛔\s*SKIP/.test(t) ? false : null, score: zs ? Number(zs[1]) : null, scoreWhy: zs && zs[2] ? zs[2] : null, validMin: 240,
  };
}

// a screenshot of the alert (TradingView app notification or alert log): Claude copies the alert text, then it's parsed
async function readAlertImage(image, client = null) {
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
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { found: { type: "boolean" }, text: { type: "string" } }, required: ["found", "text"], additionalProperties: false } } },
      system: "The screenshot shows a TradingView alert from the \"Edge S&D\" script. Copy the newest alert's message text exactly, character for character, on one line (keep ·, –, ×, % and every number). found = false if there's no such alert.",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } }, { type: "text", text: "Copy the alert text." }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("The ANTHROPIC_API_KEY isn't valid.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is busy — try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude couldn't read the screenshot (${e.status}).`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined this screenshot.");
  const block = response.content.find((c) => c.type === "text");
  let out; try { out = JSON.parse(block && block.text); } catch { throw new Error("Couldn't read the alert — paste the text instead."); }
  if (!out.found) throw new Error("No Edge S&D alert on that screenshot.");
  return out.text;
}

module.exports = { parseAlert, readAlertImage };
