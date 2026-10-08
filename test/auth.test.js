// Your account: email + password, setup code, lockout, recovery code, password change.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.EDGE_SETUP_CODE = "let-me-in";
delete process.env.EDGE_PASSWORD;
const { memory } = require("../api/_store");
const auth = require("../api/_auth");
const bearer = (t) => ({ authorization: `Bearer ${t}` });

test("create the account once, with the setup code", async () => {
  const store = memory();
  assert.deepEqual(await auth.status(store), { hasAccount: false, needsSetupCode: true, storageReady: true });
  await assert.rejects(auth.signup(store, { email: "me@x.com", password: "longenough", code: "wrong" }), /setup code/);
  await assert.rejects(auth.signup(store, { email: "not-an-email", password: "longenough", code: "let-me-in" }), /valid email/);
  await assert.rejects(auth.signup(store, { email: "me@x.com", password: "short", code: "let-me-in" }), /8 characters/);
  const r = await auth.signup(store, { email: " Me@X.com ", password: "longenough", code: "let-me-in" });
  assert.equal(r.email, "me@x.com");
  assert.match(r.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await auth.authorized(store, bearer(r.token))).email, "me@x.com");
  await assert.rejects(auth.signup(store, { email: "thief@x.com", password: "longenough", code: "let-me-in" }), /already exists/);
  const saved = await store.get("account");
  assert.ok(!JSON.stringify(saved).includes("longenough"), "the password itself is never stored");
});

test("sign in with email + password; forged and expired tokens are refused", async () => {
  const store = memory();
  await auth.signup(store, { email: "me@x.com", password: "longenough", code: "let-me-in" });
  await assert.rejects(auth.login(store, { email: "me@x.com", password: "nope-nope" }), /Wrong email or password/);
  await assert.rejects(auth.login(store, { email: "you@x.com", password: "longenough" }), /Wrong email or password/);
  const { token } = await auth.login(store, { email: "ME@x.com", password: "longenough" });
  assert.ok(await auth.authorized(store, bearer(token)));
  const [p, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), x: Date.now() + 1e12 })).toString("base64url");
  assert.equal(await auth.authorized(store, bearer(`${forged}.${sig}`)), null);
  assert.equal(await auth.authorized(store, bearer(token), Date.now() + 31 * 864e5), null, "expires after 30 days");
  assert.equal(await auth.authorized(store, {}), null);
});

test("too many wrong passwords pause sign-in", async () => {
  const store = memory();
  await auth.signup(store, { email: "me@x.com", password: "longenough", code: "let-me-in" });
  const now = Date.now();
  for (let i = 0; i < 8; i++) await assert.rejects(auth.login(store, { email: "me@x.com", password: "guess" + i }, now + i));
  await assert.rejects(auth.login(store, { email: "me@x.com", password: "longenough" }, now + 10), /Too many wrong attempts/);
  assert.ok(await auth.login(store, { email: "me@x.com", password: "longenough" }, now + 16 * 60e3));
});

test("forgot password: the recovery code sets a new one, once", async () => {
  const store = memory();
  const { recoveryCode, token: old } = await auth.signup(store, { email: "me@x.com", password: "longenough", code: "let-me-in" });
  await assert.rejects(auth.recover(store, { email: "me@x.com", code: "AAAA-BBBB-CCCC-DDDD", password: "brandnewpw" }), /don't match/);
  const r = await auth.recover(store, { email: "me@x.com", code: recoveryCode.toLowerCase(), password: "brandnewpw" });
  assert.notEqual(r.recoveryCode, recoveryCode);
  assert.equal(await auth.authorized(store, bearer(old)), null, "old sessions are signed out");
  assert.ok(await auth.login(store, { email: "me@x.com", password: "brandnewpw" }));
  await assert.rejects(auth.recover(store, { email: "me@x.com", code: recoveryCode, password: "another-one" }), /don't match/, "a used code no longer works");
});

test("change password signs out other devices", async () => {
  const store = memory();
  const { token: phone } = await auth.signup(store, { email: "me@x.com", password: "longenough", code: "let-me-in" });
  const acct = await auth.authorized(store, bearer(phone));
  await assert.rejects(auth.changePassword(store, acct, { current: "wrong", next: "evenlonger" }), /current password/);
  const { token: laptop } = await auth.changePassword(store, acct, { current: "longenough", next: "evenlonger" });
  assert.equal(await auth.authorized(store, bearer(phone)), null);
  assert.ok(await auth.authorized(store, bearer(laptop)));
});
