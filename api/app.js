// /api/app — the dashboard. Account actions work signed-out; everything else needs a session.
// GET → everything the page shows; POST {action, …} → do something.
const { getStore } = require("./_store");
const { getBroker } = require("./_broker");
const { state, action } = require("./_core");
const auth = require("./_auth");

const OPEN = {
  authStatus: (store) => auth.status(store),
  signup: (store, b) => auth.signup(store, b),
  login: (store, b) => auth.login(store, b),
  recover: (store, b) => auth.recover(store, b),
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = getStore();
    if (req.method === "POST" && OPEN[body.action]) return res.status(200).json(await OPEN[body.action](store, body));
    const acct = await auth.authorized(store, req.headers);
    if (!acct) return res.status(401).json({ error: "Sign in" });
    if (req.method === "GET") return res.status(200).json({ ...(await state(store, getBroker())), account: { email: acct.email, created: acct.created } });
    if (req.method === "POST" && body.action === "changePassword") return res.status(200).json(await auth.changePassword(store, acct, body));
    if (req.method === "POST" && body.action === "newRecoveryCode") return res.status(200).json(await auth.newRecoveryCode(store, acct));
    if (req.method === "POST") return res.status(200).json(await action(store, getBroker(), body));
    res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
