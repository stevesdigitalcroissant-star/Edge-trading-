// Phone alerts through a Telegram bot (free). Optional:
//   TELEGRAM_BOT_TOKEN — from @BotFather
//   TELEGRAM_CHAT_ID   — your chat id (message the bot, then open
//                        https://api.telegram.org/bot<token>/getUpdates)
//   APP_URL            — this app's address, added as a link to every alert
// Every alert is also written to the event log the dashboard shows.

async function notify(store, text, kind = "info") {
  const entry = { at: Date.now(), kind, text };
  await store.lpush("log", entry, 200).catch(() => {});
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const link = process.env.APP_URL ? `\n${process.env.APP_URL}` : "";
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text + link, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

module.exports = { notify };
