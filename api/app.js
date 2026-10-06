// /api/app — the dashboard. GET → everything the page shows; POST {action, …} → do something.
const { getStore } = require("./_store");
const { getBroker } = require("./_broker");
const { state, action, login, authorized } = require("./_core");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (req.method === "POST" && body.action === "login") return res.status(200).json({ token: login(body.password) });
    if (!authorized(req.headers)) return res.status(401).json({ error: "Sign in" });
    if (req.method === "GET") return res.status(200).json(await state(getStore(), getBroker()));
    if (req.method === "POST") return res.status(200).json(await action(getStore(), getBroker(), body));
    res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
