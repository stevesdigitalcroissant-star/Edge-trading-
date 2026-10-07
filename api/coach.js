// POST /api/coach — the screen-watching Coach. {action:"check", image, mode, question} or {action:"reset"}.
const { getStore } = require("./_store");
const { context } = require("./_core");
const auth = require("./_auth");
const { blockingEvent } = require("./_news");
const R = require("./_rules");
const coach = require("./_coach");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const store = getStore();
    if (!(await auth.authorized(store, req.headers))) return res.status(401).json({ error: "Sign in" });
    if (body.action === "reset") { await coach.reset(store); return res.status(200).json({ ok: true }); }
    const ctx = await context(store);
    const guard = R.guardrails(ctx);
    const session = (await store.get("coach")) || {};
    const markets = session.trade && session.trade.market ? [session.trade.market] : ["gold", "crude", "natgas"];
    const ev = markets.map((m) => blockingEvent(ctx.events, m, ctx.now, ctx.settings)).find(Boolean);
    const block = !guard.ok ? guard.reasons[0] : ev ? `${ev.title} is close — no new trades ${ctx.settings.newsBeforeMin} min before / ${ctx.settings.newsAfterMin} min after.` : "";
    const out = await coach.check(store, { image: body.image, mode: body.mode === "replay" ? "replay" : "live", question: body.question }, { ...ctx, mode: body.mode, block });
    res.status(200).json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
