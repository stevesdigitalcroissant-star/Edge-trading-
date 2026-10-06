// Push notifications: devices subscribe, alerts are delivered, dead devices are removed, news reminders fire once.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const crypto = require("crypto");
const { memory } = require("../api/_store");
const { notify, subscribe, vapid } = require("../api/_notify");
const core = require("../api/_core");
const { zonedTime } = require("../api/_time");

// stand-in push service: builds the real encrypted, VAPID-signed request (web-push's own code), records it, answers with `status`
const webpush = require("web-push");
function pushService(status = 201) {
  const got = [];
  webpush.sendNotification = async (sub, payload, opts) => {
    const req = webpush.generateRequestDetails(sub, payload, opts);
    got.push({ url: req.endpoint, auth: req.headers.Authorization, urgency: req.headers.Urgency, bytes: req.body.length });
    if (status >= 400) { const e = new Error("gone"); e.statusCode = status; throw e; }
    return { statusCode: status };
  };
  return { got, url: "https://push.example.com", srv: { close() {} } };
}
// a real browser-style subscription key pair
function deviceKeys() {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
}

test("alerts reach subscribed devices, signed with the saved VAPID keys", async () => {
  const store = memory();
  const svc = pushService();
  await subscribe(store, { endpoint: `${svc.url}/dev1`, keys: deviceKeys() }, "iPhone");
  const k1 = await vapid(store), k2 = await vapid(store);
  assert.equal(k1.publicKey, k2.publicKey, "keys are made once and reused");
  assert.equal(await notify(store, "⚡ Move your stop to break-even", "action"), true);
  assert.equal(svc.got.length, 1);
  assert.match(svc.got[0].auth, /^vapid t=/);
  assert.equal(svc.got[0].urgency, "high");
  assert.ok(svc.got[0].bytes > 50, "payload is encrypted and sent");
  // turned-off kinds aren't pushed (but stay in the log)
  await store.set("settings", { notify: { skip: false } });
  await notify(store, "⛔ Grade B", "skip");
  assert.equal(svc.got.length, 1);
  assert.equal((await store.lrange("log", 5)).length, 2);
  svc.srv.close();
});

test("a device that unsubscribed (410) is removed", async () => {
  const store = memory();
  const svc = pushService(410);
  await subscribe(store, { endpoint: `${svc.url}/gone`, keys: deviceKeys() }, "old iPad");
  await notify(store, "hello", "info");
  assert.deepEqual(await store.hgetall("push"), {});
  svc.srv.close();
});

test("news reminder is sent once, before the no-trade window", async () => {
  const store = memory();
  global.fetch = async () => { throw new Error("offline"); };
  const now = zonedTime(2026, 10, 7, 9, 50, "America/New_York"); // Wed, EIA crude at 10:30
  const ctx = await core.context(store, now);
  await core.newsReminders(store, ctx);
  await core.newsReminders(store, ctx);
  const log = (await store.lrange("log", 10)).filter((l) => l.kind === "news");
  assert.equal(log.length, 1);
  assert.match(log[0].text, /EIA crude oil inventories at 10:30 \(in 40 min\)\. No new Crude oil trades from 10:00 to 11:00/);
});
