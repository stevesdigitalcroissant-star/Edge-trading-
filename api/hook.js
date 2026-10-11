// POST /api/hook — TradingView alerts (setups + the per-candle heartbeat).
const { getStore } = require("./_store");
const { brokerFor } = require("./_broker");
const { handleHook } = require("./_core");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const store = getStore();
    const r = await handleHook(store, await brokerFor(store), req.body);
    res.status(r.status).json(r.json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
