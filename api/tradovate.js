// GET /api/tradovate — where Tradovate's sign-in page sends you back (OAuth). Swaps the one-time code for an
// access token, saves it (sealed), then returns you to Edge's Settings.
const { getStore } = require("./_store");
const { oauthFinish } = require("./_broker");

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x"), go = (q) => { res.statusCode = 302; res.setHeader("Location", `/?${q}#rules`); res.setHeader("Cache-Control", "no-store"); res.end(); };
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) return go(`tv=err&msg=${encodeURIComponent(err).slice(0, 300)}`);
  try {
    const r = await oauthFinish(getStore(), { code: url.searchParams.get("code"), state: url.searchParams.get("state") });
    go(`tv=ok&acct=${encodeURIComponent((r.account && r.account.name) || "")}&env=${r.env}`);
  } catch (e) { go(`tv=err&msg=${encodeURIComponent(e.message).slice(0, 300)}`); }
};
