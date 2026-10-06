// Alerts go to three places:
//  1. the event log the dashboard shows (always)
//  2. push notifications on every phone / iPad / computer where you turned
//     them on (Rules → Notifications). On iPhone & iPad: add Edge to the Home
//     Screen first (iOS 16.4+). The keys that sign the pushes (VAPID) are made
//     on first use and saved in storage — nothing to configure.
//  3. Telegram, if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set (optional)
// APP_URL (optional) is added as a link to Telegram alerts.
const crypto = require("crypto");
const { mergeSettings } = require("./_config");

let webpush = null;
try { webpush = require("web-push"); } catch {}

// kind → notification title, and whether it should stay on screen until tapped
const KINDS = {
  setup: { title: "✅ A+ setup", sticky: true, url: "/#setups" },
  action: { title: "⚡ Act now", sticky: true, url: "/#now" },
  warn: { title: "⚠️ Rule check", sticky: false, url: "/#now" },
  closed: { title: "📒 Trade closed", sticky: false, url: "/#journal" },
  news: { title: "📰 News coming", sticky: false, url: "/#now" },
  locked: { title: "🔒 Done for today", sticky: false, url: "/#now" },
  skip: { title: "⛔ Not your setup", sticky: false, url: "/#setups" },
  info: { title: "Edge", sticky: false, url: "/#now" },
};

async function vapid(store) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  if (!webpush) return null;
  let k = await store.get("vapid");
  if (!k) { k = webpush.generateVAPIDKeys(); await store.set("vapid", k); }
  return k;
}

const subId = (endpoint) => crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 24);

async function subscribe(store, sub, label = "") {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error("That device didn't give a valid subscription.");
  const id = subId(sub.endpoint);
  await store.hset("push", id, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, label: String(label).slice(0, 80), added: Date.now() });
  return id;
}
async function unsubscribe(store, endpoint) { await store.hdel("push", subId(endpoint)); }

async function push(store, { title, body, url, sticky, tag }) {
  if (!webpush) return 0;
  const subs = await store.hgetall("push");
  const ids = Object.keys(subs);
  if (!ids.length) return 0;
  const k = await vapid(store);
  const payload = JSON.stringify({ title, body, url, sticky, tag });
  const opts = { TTL: 3600, urgency: sticky ? "high" : "normal", vapidDetails: { subject: process.env.VAPID_SUBJECT || "mailto:edge@example.com", publicKey: k.publicKey, privateKey: k.privateKey } };
  let sent = 0;
  await Promise.all(ids.map(async (id) => {
    try { await webpush.sendNotification(subs[id], payload, opts); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await store.hdel("push", id); } // device unsubscribed
  }));
  return sent;
}

async function telegram(text) {
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

async function notify(store, text, kind = "info") {
  const entry = { at: Date.now(), kind, text };
  await store.lpush("log", entry, 200).catch(() => {});
  const s = mergeSettings(await store.get("settings").catch(() => null));
  if (s.notify && s.notify[kind] === false) return false;
  const k = KINDS[kind] || KINDS.info;
  const body = String(text).replace(/^\p{Extended_Pictographic}️?\s*/u, "");
  const [pushed, tg] = await Promise.all([
    push(store, { title: k.title, body, url: k.url, sticky: k.sticky, tag: kind === "action" || kind === "setup" ? `${kind}-${entry.at}` : kind }).catch(() => 0),
    telegram(text),
  ]);
  return pushed > 0 || tg;
}

module.exports = { notify, push, subscribe, unsubscribe, vapid, KINDS };
