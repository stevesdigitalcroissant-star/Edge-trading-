// Your Edge account: one owner, signed in with email + password.
//
// - Passwords are never stored: only a salted scrypt hash.
// - Creating the account needs the setup code (EDGE_SETUP_CODE, or EDGE_PASSWORD from
//   older setups) when one is set, so nobody who finds your app's address can claim it first.
// - Sessions are signed tokens (HMAC) that last 30 days; changing the password signs
//   every other device out.
// - Forgot your password? The recovery code shown once when you create the account
//   (or after a reset) lets you set a new one. No email service needed.
// - 8 wrong passwords in 15 minutes → sign-in pauses for 15 minutes.
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60e3;
const b64u = (b) => Buffer.from(b).toString("base64url");
const norm = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function hash(password, salt = crypto.randomBytes(16)) {
  const key = await scrypt(String(password), salt, 64);
  return { salt: salt.toString("hex"), hash: key.toString("hex") };
}
async function verify(password, rec) {
  if (!rec) return false;
  const key = await scrypt(String(password), Buffer.from(rec.salt, "hex"), 64);
  const want = Buffer.from(rec.hash, "hex");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
const setupCode = () => process.env.EDGE_SETUP_CODE || process.env.EDGE_PASSWORD || "";
const sameText = (a, b) => { const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

async function secret(store) {
  if (process.env.EDGE_SESSION_SECRET) return process.env.EDGE_SESSION_SECRET;
  let s = await store.get("authSecret");
  if (!s) { s = crypto.randomBytes(32).toString("hex"); await store.set("authSecret", s); }
  return s;
}
async function issue(store, acct, now = Date.now()) {
  const payload = b64u(JSON.stringify({ e: acct.email, v: acct.ver, x: now + SESSION_DAYS * 864e5 }));
  const sig = crypto.createHmac("sha256", await secret(store)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function recoveryCode() {
  const raw = crypto.randomBytes(10).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(16, "7").slice(0, 16);
  return raw.match(/.{4}/g).join("-");
}
function checkPassword(p) {
  if (String(p || "").length < 8) throw new Error("Use at least 8 characters for your password.");
}

async function guard(store, now) {
  const f = (await store.get("authFails")) || { n: 0, since: now };
  if (f.until && now < f.until) throw new Error(`Too many wrong attempts. Try again in ${Math.ceil((f.until - now) / 60e3)} min.`);
  return f;
}
async function fail(store, f, now) {
  const n = now - f.since > LOCK_MS ? 1 : f.n + 1;
  await store.set("authFails", { n, since: n === 1 ? now : f.since, until: n >= MAX_FAILS ? now + LOCK_MS : 0 });
}

async function status(store) {
  const acct = await store.get("account");
  return { hasAccount: !!acct, needsSetupCode: !acct && !!setupCode(), storageReady: !(store.kind === "memory" && process.env.VERCEL) };
}

async function signup(store, { email, password, code }, now = Date.now()) {
  if (store.kind === "memory" && process.env.VERCEL) throw new Error("Storage isn't connected yet — your account would be lost. Add the Upstash settings in Vercel first, then come back.");
  if (await store.get("account")) throw new Error("An account already exists. Sign in instead.");
  const f = await guard(store, now);
  if (setupCode() && !sameText(code || "", setupCode())) { await fail(store, f, now); throw new Error("Wrong setup code (it's the EDGE_SETUP_CODE you set in Vercel)."); }
  const e = norm(email);
  if (!validEmail(e)) throw new Error("Enter a valid email.");
  checkPassword(password);
  const rc = recoveryCode();
  const acct = { email: e, pw: await hash(password), rc: await hash(rc), ver: 1, created: now };
  await store.set("account", acct);
  return { token: await issue(store, acct, now), recoveryCode: rc, email: e };
}

async function login(store, { email, password }, now = Date.now()) {
  const f = await guard(store, now);
  const acct = await store.get("account");
  if (!acct) throw new Error("No account yet — create one first.");
  const pwOk = await verify(password, acct.pw); // always checked, so a wrong email takes as long as a wrong password
  const ok = norm(email) === acct.email && pwOk;
  if (!ok) { await fail(store, f, now); throw new Error("Wrong email or password."); }
  await store.set("authFails", null);
  return { token: await issue(store, acct, now), email: acct.email };
}

async function recover(store, { email, code, password }, now = Date.now()) {
  const f = await guard(store, now);
  const acct = await store.get("account");
  const codeOk = acct ? await verify(String(code || "").trim().toUpperCase(), acct.rc) : false;
  const ok = acct && norm(email) === acct.email && codeOk;
  if (!ok) { await fail(store, f, now); throw new Error("That email and recovery code don't match."); }
  checkPassword(password);
  const rc = recoveryCode();
  Object.assign(acct, { pw: await hash(password), rc: await hash(rc), ver: acct.ver + 1 });
  await store.set("account", acct);
  await store.set("authFails", null);
  return { token: await issue(store, acct, now), recoveryCode: rc, email: acct.email };
}

async function changePassword(store, acct, { current, next }, now = Date.now()) {
  if (!(await verify(current, acct.pw))) throw new Error("Your current password isn't right.");
  checkPassword(next);
  acct.pw = await hash(next);
  acct.ver += 1; // signs out every other device
  await store.set("account", acct);
  return { token: await issue(store, acct, now) };
}

async function newRecoveryCode(store, acct) {
  const rc = recoveryCode();
  acct.rc = await hash(rc);
  await store.set("account", acct);
  return { recoveryCode: rc };
}

// → the account, or null when the token is missing, forged, expired or from before a password change
async function authorized(store, headers, now = Date.now()) {
  const tok = String((headers && headers.authorization) || "").replace(/^Bearer\s+/i, "");
  const [payload, sig] = tok.split(".");
  if (!payload || !sig) return null;
  const want = crypto.createHmac("sha256", await secret(store)).update(payload).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  const acct = await store.get("account");
  if (!acct || p.e !== acct.email || p.v !== acct.ver || !(p.x > now)) return null;
  return acct;
}

module.exports = { status, signup, login, recover, changePassword, newRecoveryCode, authorized };
