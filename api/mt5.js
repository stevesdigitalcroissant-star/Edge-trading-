// /api/mt5 — the EdgeBridge EA in MetaTrader 5. GET → orders to place (text, one per line); POST → account, trades, acks.
// Authenticated with the MT5 key from Settings (header "Authorization: Bearer edge_mt_…").
const { getStore } = require("./_store");
const M = require("./_mt5");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const store = getStore(), url = new URL(req.url || "/", "http://x");
    if (!(await M.keyOk(store, req.headers, url.searchParams))) return res.status(401).json({ error: "Wrong or missing MT5 key — make a new one in Edge → Settings → MetaTrader 5" });
    if (req.method === "GET") { res.setHeader("Content-Type", "text/plain"); return res.status(200).end(await M.poll(store)); }
    if (req.method === "POST") {
      let body = req.body; if (typeof body === "string") body = JSON.parse(body.replace(/\0+$/, "") || "{}"); // MQL5 can leave a trailing NUL
      await M.report(store, body || {});
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).end(await M.poll(store)); // the reply carries the orders waiting for the EA: one request per cycle
    }
    res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
