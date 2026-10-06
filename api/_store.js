// Storage: Upstash Redis over its REST API when configured (Vercel → Storage →
// Upstash for Redis adds KV_REST_API_URL / KV_REST_API_TOKEN), otherwise JSON
// files in .data/ (local `node server.js`). Values are stored as JSON.
//
// Keys:  settings · bias            plain values
//        trades  · journal · setups hashes (one field per item, so two writers
//                                   never overwrite each other's items)
//        price:<market>             last heartbeat from TradingView
//        log                        list of recent events (newest first)
const fs = require("fs");
const path = require("path");

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PREFIX = "edge:";

const enc = (v) => JSON.stringify(v);
const dec = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };

function redis() {
  async function cmd(...args) {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Storage: ${j.error || r.status}`);
    return j.result;
  }
  return {
    kind: "redis",
    get: async (k) => dec(await cmd("GET", PREFIX + k)),
    set: async (k, v) => { await cmd("SET", PREFIX + k, enc(v)); },
    del: async (k) => { await cmd("DEL", PREFIX + k); },
    hget: async (k, f) => dec(await cmd("HGET", PREFIX + k, f)),
    hset: async (k, f, v) => { await cmd("HSET", PREFIX + k, f, enc(v)); },
    hdel: async (k, f) => { await cmd("HDEL", PREFIX + k, f); },
    hgetall: async (k) => {
      const flat = (await cmd("HGETALL", PREFIX + k)) || [];
      const o = {};
      for (let i = 0; i < flat.length; i += 2) o[flat[i]] = dec(flat[i + 1]);
      return o;
    },
    lpush: async (k, v, max = 200) => { await cmd("LPUSH", PREFIX + k, enc(v)); await cmd("LTRIM", PREFIX + k, 0, max - 1); },
    lrange: async (k, n = 50) => ((await cmd("LRANGE", PREFIX + k, 0, n - 1)) || []).map(dec),
  };
}

function files(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (k) => path.join(dir, k.replace(/[^a-z0-9_.-]/gi, "_") + ".json");
  const read = (k) => { try { return JSON.parse(fs.readFileSync(file(k), "utf8")); } catch { return null; } };
  const write = (k, v) => { const f = file(k); fs.writeFileSync(f + ".tmp", JSON.stringify(v, null, 1)); fs.renameSync(f + ".tmp", f); };
  return {
    kind: "files",
    get: async (k) => read(k),
    set: async (k, v) => write(k, v),
    del: async (k) => { try { fs.unlinkSync(file(k)); } catch {} },
    hget: async (k, f) => (read(k) || {})[f] ?? null,
    hset: async (k, f, v) => { const o = read(k) || {}; o[f] = v; write(k, o); },
    hdel: async (k, f) => { const o = read(k) || {}; delete o[f]; write(k, o); },
    hgetall: async (k) => read(k) || {},
    lpush: async (k, v, max = 200) => { const a = read(k) || []; a.unshift(v); write(k, a.slice(0, max)); },
    lrange: async (k, n = 50) => (read(k) || []).slice(0, n),
  };
}

function memory() {
  const m = new Map();
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  return {
    kind: "memory",
    get: async (k) => clone(m.get(k)),
    set: async (k, v) => { m.set(k, clone(v)); },
    del: async (k) => { m.delete(k); },
    hget: async (k, f) => clone((m.get(k) || {})[f]),
    hset: async (k, f, v) => { const o = m.get(k) || {}; o[f] = clone(v); m.set(k, o); },
    hdel: async (k, f) => { const o = m.get(k) || {}; delete o[f]; m.set(k, o); },
    hgetall: async (k) => clone(m.get(k) || {}),
    lpush: async (k, v, max = 200) => { const a = m.get(k) || []; a.unshift(clone(v)); m.set(k, a.slice(0, max)); },
    lrange: async (k, n = 50) => clone((m.get(k) || []).slice(0, n)),
  };
}

let store = null;
function getStore() {
  if (store) return store;
  if (URL_ && TOKEN) store = redis();
  else if (process.env.VERCEL) store = memory(); // nothing persists — the dashboard says so
  else store = files(process.env.EDGE_DATA_DIR || path.join(__dirname, "..", ".data"));
  return store;
}
function useStore(s) { store = s; } // tests

module.exports = { getStore, useStore, memory };
