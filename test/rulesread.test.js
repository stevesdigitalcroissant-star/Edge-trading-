const test = require("node:test");
const assert = require("node:assert/strict");
const RR = require("../api/_rulesread");

// what Claude returns for the MyFundedFutures $25K Builder rules page
const MFF = { readable: true, firm: "MyFundedFutures", plan: "$25K Builder Plan", size: 25000,
  eval: { dd: 1000, ddType: "eod", dailyLoss: 600, maxContracts: 2, microRatio: 10, consistencyPct: null, target: 1500, minDays: null, inactivityDays: 7 },
  funded: { dd: 1000, ddType: "eod", dailyLoss: 600, maxContracts: 2, microRatio: 10, consistencyPct: 50, payout: { minDays: 2, minPayout: 250, cap: 1000, splitPct: 80, buffer: 1100, minProfitPerDay: 0 } }, notes: "" };

test("rules screenshot → plan: risk from the drawdown, daily limit and contracts respected", () => {
  const p = RR.planFromRules(MFF);
  assert.deepEqual(p.risk, { min: 150, aim: 200, max: 250 }); // $1,000 EOD drawdown → 5 losses at the aim; 2 losers < $600
  assert.equal(p.cfg.maxMicros, 20); // 2 contracts × 10:1
  assert.equal(p.cfg.ddType, "eod");
  assert.equal(p.cfg.inactivityDays, 7);
  assert.equal(p.cfg.funded.payout.split, "80/20");
  assert.ok(p.lines.some((l) => /every 7 days/.test(l)));
  // a tight daily limit caps the risk
  const tight = RR.planFromRules({ ...MFF, eval: { ...MFF.eval, dailyLoss: 300 } });
  assert.equal(tight.risk.max, 150);
});

test("rules screenshot is read with Claude (structured JSON) and rejects non-rules images", async () => {
  const fake = (out) => ({ beta: { messages: { create: async (req) => {
    assert.equal(req.model, "claude-opus-5-5");
    assert.equal(req.output_config.format.type, "json_schema");
    assert.equal(req.messages[0].content[0].type, "image");
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] };
  } } } });
  const img = "data:image/jpeg;base64,AAAA";
  assert.equal((await RR.readRules(img, fake(MFF))).eval.target, 1500);
  await assert.rejects(RR.readRules(img, fake({ ...MFF, readable: false })), /doesn't look like a rules page/);
  await assert.rejects(RR.readRules("not an image", fake(MFF)), /screenshot/);
});
