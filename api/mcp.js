// /api/mcp — a read-only door into Edge for David, the voice assistant (an MCP server, JSON over HTTP).
// David sends the key made in Settings → David as a Bearer token. Every tool here only READS:
// nothing can place, change or close a trade, move a stop, or touch the broker or the rules.
const { getStore } = require("./_store");
const { brokerFor } = require("./_broker");
const { state } = require("./_core");
const auth = require("./_auth");

const PROTOCOL = "2025-06-18";
const none = { type: "object", properties: {} };
const TOOLS = [
  { name: "edge_today", description: "Today in Edge: the live plans (orders, stop, target, break-even, contracts), the game plan, open trades, guardrails (trades left today, daily loss limit, cool-downs), big news coming up, the weekly bias per market, last prices and the close-out time.", inputSchema: none },
  { name: "edge_setups", description: "The latest setups Edge found, with their grade (A+/A/B/C), why, whether they can be taken now and their status.", inputSchema: none },
  { name: "edge_journal", description: "The trade journal: each trade's market, direction, grade, emotion before the trade, result in R and notes, plus stats (win rate, total R by grade, emotion, market) and missed A+ setups. practice: true reads the FX Replay practice log instead.", inputSchema: { type: "object", properties: { practice: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } } } },
  { name: "edge_coach", description: "What Edge's chart coach last saw and said in the current screen-watching session (live or FX Replay practice).", inputSchema: none },
  { name: "edge_rules", description: "Edge's rules and settings: risk, daily limits, sessions, break-even and exit levels, and the strategies it trades.", inputSchema: none },
];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
async function run(name, args, s) {
  const now = s.now;
  switch (name) {
    case "edge_today": return {
      now: new Date(now).toISOString(), plans: s.plans, gameplan: s.gameplan, open: s.open, guard: s.guard, prop: s.prop, closeOut: s.closeOut,
      news: (s.news.events || []).filter((e) => e.time < now + 24 * 3600e3), newsOk: s.news.ok, bias: s.bias, prices: s.prices,
      broker: s.broker && { kind: s.broker.kind, label: s.broker.label },
    };
    case "edge_setups": return s.setups.map((x) => pick(x, ["id", "at", "market", "symbol", "strategy", "kind", "dir", "grade", "g", "status", "entry", "sl", "tp", "size", "story"]));
    case "edge_journal": {
      const n = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      return args.practice ? { trades: s.practice.slice(0, n), stats: s.practiceStats } : { trades: s.journal.slice(0, n), stats: s.stats, missed: s.missed, aPlusShare: s.share };
    }
    case "edge_coach": return s.coach && s.coach.session ? s.coach.session : { note: "No coach session yet." };
    case "edge_rules": return { settings: s.settings, strategies: s.strategies, markets: s.markets };
  }
  throw new Error("Unknown tool");
}

const reply = (res, id, result) => res.status(200).json({ jsonrpc: "2.0", id, result });
const fail = (res, id, code, message) => res.status(200).json({ jsonrpc: "2.0", id, error: { code, message } });

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const store = getStore();
  if (!(await auth.davidAuthorized(store, req.headers).catch(() => false))) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="edge", error="invalid_token"');
    return res.status(401).json({ error: "Make a David key in Edge → Settings → David." });
  }
  let msg;
  try { msg = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; } catch { return fail(res, null, -32700, "Parse error"); }
  if (Array.isArray(msg)) return fail(res, null, -32600, "Batches aren't supported");
  const { id = null, method, params = {} } = msg;
  if (id === null || id === undefined) return res.status(202).end(); // notifications need no answer
  try {
    if (method === "initialize") return reply(res, id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "edge", version: "1.0.0" }, instructions: "Edge is the owner's trading co-pilot. These tools only read it." });
    if (method === "ping") return reply(res, id, {});
    if (method === "tools/list") return reply(res, id, { tools: TOOLS });
    if (method === "tools/call") {
      if (!TOOLS.some((t) => t.name === params.name)) return fail(res, id, -32602, "Unknown tool");
      const s = await state(store, await brokerFor(store));
      const text = JSON.stringify(await run(params.name, params.arguments || {}, s));
      return reply(res, id, { content: [{ type: "text", text: text.length > 60000 ? text.slice(0, 60000) + " …(cut)" : text }] });
    }
    return fail(res, id, -32601, "Method not found");
  } catch (e) {
    return reply(res, id, { content: [{ type: "text", text: "Edge error: " + e.message }], isError: true });
  }
};

module.exports.TOOLS = TOOLS;
