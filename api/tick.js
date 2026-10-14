// /api/tick — Edge's own clock. An outside scheduler (cron-job.org, free) calls it every minute so the safety rules run on time even when no
// TradingView alert reaches Edge and the app is closed: news (flat 10 min before a big release), the daily close-out
// (out by 15:55 New York, 12:45 on half days), the London / New York briefs and the inactivity warning.
// It only does what the clock says is due, so calling it more often changes nothing.
const { getStore } = require("./_store");
const { brokerFor } = require("./_broker");
const { tick } = require("./_core");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const store = getStore();
    res.status(200).json(await tick(store, await brokerFor(store), Date.now()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
