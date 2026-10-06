// POST /api/hook — TradingView alerts (setups + the per-candle heartbeat).
const { getStore } = require("./_store");
const { getBroker } = require("./_broker");
const { handleHook } = require("./_core");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const r = await handleHook(getStore(), getBroker(), req.body);
    res.status(r.status).json(r.json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
