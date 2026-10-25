// FROZEN D1 store battery (follow-up 2026-10-24). Written BEFORE the D1
// wiring, fail-first: the enforcement gate (packages/platform apikeys.ts)
// must honor dashboard-issued keys from the platform D1 store — the same
// tables the website repo's D1-backed gate reads (migrations 0004/0005) —
// so a dashboard mint works on the Workers and a dashboard revocation
// refuses the very next request.
// The D1 database is stood in by a node:sqlite database behind a
// D1-shaped prepare/bind/first/all/run shim, with the REAL 0004/0005
// schema for the tables the store touches applied verbatim. Assertions
// are frozen: never weaken one to pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

const keys = await import("../../packages/platform/src/apikeys.ts");

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const secret = (prefix, hex) => `${prefix}_${hex.repeat(48).slice(0, 48)}`;

// --- the real schema (website repo platform/migrations/0004 + 0005,
// the tables the enforcement store reads/writes, verbatim) ---
const SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  cui_flagged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  creator_account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'ehk_live',
  last4 TEXT NOT NULL,
  display TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  team_id TEXT REFERENCES teams(id),
  project_id TEXT REFERENCES projects(id),
  cui_bound INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  no_expiry_warning_shown INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  rotated_from_id TEXT,
  quota_per_day INTEGER NOT NULL DEFAULT 600,
  usage_count INTEGER NOT NULL DEFAULT 0,
  usage_day TEXT NOT NULL DEFAULT '',
  rate_window_start INTEGER NOT NULL DEFAULT 0,
  rate_window_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_api_keys_hash ON api_keys(secret_hash);
CREATE TABLE api_key_requests (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL DEFAULT 'api_key',
  ts INTEGER NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE oauth_test_doubles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL,
  display TEXT NOT NULL DEFAULT 'oauth_double',
  scopes TEXT NOT NULL DEFAULT '[]',
  team_id TEXT,
  project_id TEXT,
  cui_bound INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL,
  display TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  audience TEXT NOT NULL,
  team_id TEXT,
  project_id TEXT,
  cui_bound INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_tokens_hash ON oauth_tokens(token_hash);
`;

// --- D1-shaped shim over node:sqlite ---
function d1Shim() {
  const raw = new DatabaseSync(":memory:");
  // Harness scaffolding only: the real D1 carries full accounts/teams
  // tables from migration 0001; the store never reads them, so id-only
  // stubs stand in and FK enforcement stays off (fixture creator ids
  // are labels here, exactly as in the served fixture inserts).
  raw.exec("PRAGMA foreign_keys = OFF; CREATE TABLE accounts (id TEXT PRIMARY KEY); CREATE TABLE teams (id TEXT PRIMARY KEY);");
  raw.exec(SCHEMA);
  const db = {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...p) { params = p; return stmt; },
        async first() {
          const row = raw.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() { return { results: raw.prepare(sql).all(...params) }; },
        async run() { raw.prepare(sql).run(...params); return { success: true }; },
      };
      return stmt;
    },
    _raw: raw,
  };
  return db;
}

function d1Store(db, opts = {}) {
  assert.equal(typeof keys.createD1KeyStore, "function", "createD1KeyStore must exist on the platform apikeys module");
  return keys.createD1KeyStore(db, opts);
}

// Insert an api_keys row in the dashboard package's exact shape
// (packages/apikeys insertKey: every column, hash-only secret).
function insertKeyRow(raw, { name = "D1 TEST KEY", secretValue, scopes = ["read:content"], quotaPerDay = 600, revokedAt = null, expiresAt = null, creator = "acct-d1-test" }) {
  const t = Date.now();
  const id = randomUUID();
  raw.prepare(`INSERT INTO api_keys (id, creator_account_id, name, prefix, last4, display, secret_hash, scopes, team_id, project_id, cui_bound, expires_at, no_expiry_warning_shown, revoked_at, rotated_from_id, quota_per_day, usage_count, usage_day, rate_window_start, rate_window_count, last_used_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, creator, name, "ehk_live", secretValue.slice(-4), `ehk_live_…${secretValue.slice(-4)}`, sha256hex(secretValue), JSON.stringify(scopes), null, null, 0, expiresAt, 0, revokedAt, null, quotaPerDay, 0, new Date(t).toISOString().slice(0, 10), t, 0, null, t);
  return id;
}
function insertTokenRow(raw, { tokenValue, scopes = ["read:content"], audience = "https://api-beta.electrohire.com", account = "acct-d1-test" }) {
  const t = Date.now();
  const id = randomUUID();
  raw.prepare(`INSERT INTO oauth_tokens (id, account_id, token_hash, display, scopes, audience, team_id, project_id, cui_bound, expires_at, revoked_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, account, sha256hex(tokenValue), `eho_live_…${tokenValue.slice(-4)}`, JSON.stringify(scopes), audience, null, null, 0, null, null, t);
  return id;
}

const READ_SECRET = secret("ehk_live", "a1");
const REVOKED_SECRET = secret("ehk_live", "b2");
const EXPIRED_SECRET = secret("ehk_live", "c3");
const QUOTA_SECRET = secret("ehk_live", "d4");
const API_TOKEN = secret("eho_live", "e5");

test("D1: a dashboard-shaped key row is admitted and its scopes are enforced", async () => {
  const db = d1Shim();
  insertKeyRow(db._raw, { secretValue: READ_SECRET, scopes: ["read:content", "read:tools"] });
  const store = d1Store(db);
  const ok = await keys.authorizeCredential(store, { kind: "api_key", secret: READ_SECRET }, { scope: "read:content" });
  assert.equal(ok.allowed, true, ok.reason);
  assert.equal(ok.usageCount, 1);
  const refused = await keys.authorizeCredential(store, { kind: "api_key", secret: READ_SECRET }, { scope: "action:support_ticket" });
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /scope/i);
  const unknown = await keys.authorizeCredential(store, { kind: "api_key", secret: secret("ehk_live", "ff") }, { scope: "read:content" });
  assert.equal(unknown.allowed, false);
  assert.match(unknown.reason, /unknown/i);
});

test("D1: a revoked row is refused and an expired row is refused", async () => {
  const db = d1Shim();
  const t = Date.now();
  insertKeyRow(db._raw, { name: "REVOKED", secretValue: REVOKED_SECRET, revokedAt: t });
  insertKeyRow(db._raw, { name: "EXPIRED", secretValue: EXPIRED_SECRET, expiresAt: t - 1000 });
  const store = d1Store(db);
  const revoked = await keys.authorizeCredential(store, { kind: "api_key", secret: REVOKED_SECRET }, { scope: "read:content" });
  assert.equal(revoked.allowed, false);
  assert.match(revoked.reason, /revoked/i);
  const expired = await keys.authorizeCredential(store, { kind: "api_key", secret: EXPIRED_SECRET }, { scope: "read:content" });
  assert.equal(expired.allowed, false);
  assert.match(expired.reason, /expired/i);
});

test("D1: quota counts persist in the table across fresh store instances", async () => {
  const db = d1Shim();
  const id = insertKeyRow(db._raw, { name: "QUOTA", secretValue: QUOTA_SECRET, quotaPerDay: 2 });
  // Fresh store per request — the served pattern (no module cache on D1).
  for (let i = 0; i < 2; i++) {
    const r = await keys.authorizeCredential(d1Store(db), { kind: "api_key", secret: QUOTA_SECRET }, { scope: "read:content" });
    assert.equal(r.allowed, true, `request ${i + 1}: ${r.reason}`);
  }
  const row = db._raw.prepare("SELECT usage_count FROM api_keys WHERE id = ?").get(id);
  assert.equal(row.usage_count, 2, "usage_count in the table increments across store instances");
  const third = await keys.authorizeCredential(d1Store(db), { kind: "api_key", secret: QUOTA_SECRET }, { scope: "read:content" });
  assert.equal(third.allowed, false);
  assert.match(third.reason, /quota/i);
});

test("D1: admitted requests write api_key_requests metadata rows (website shape)", async () => {
  const db = d1Shim();
  const keyId = insertKeyRow(db._raw, { secretValue: READ_SECRET });
  const store = d1Store(db);
  await keys.authorizeCredential(store, { kind: "api_key", secret: READ_SECRET }, { scope: "read:content" });
  const rows = db._raw.prepare("SELECT * FROM api_key_requests WHERE key_id = ?").all(keyId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].identity_kind, "api_key");
  assert.equal(rows[0].status, 200);
  assert.equal(rows[0].endpoint, "read:content");
  assert.ok(rows[0].id && rows[0].ts > 0);
});

test("D1: an oauth_tokens row is admitted at its audience and refused at the wrong resource", async () => {
  const db = d1Shim();
  const tokenId = insertTokenRow(db._raw, { tokenValue: API_TOKEN, scopes: ["read:content"], audience: "https://api-beta.electrohire.com" });
  const store = d1Store(db);
  const ok = await keys.authorizeCredential(store, { kind: "oauth_token", token: API_TOKEN }, { scope: "read:content", audience: "https://api-beta.electrohire.com" });
  assert.equal(ok.allowed, true, ok.reason);
  const wrong = await keys.authorizeCredential(store, { kind: "oauth_token", token: API_TOKEN }, { scope: "read:content", audience: "https://mcp-beta.electrohire.com" });
  assert.equal(wrong.allowed, false);
  assert.match(wrong.reason, /audience/i);
  const meta = db._raw.prepare("SELECT * FROM api_key_requests WHERE key_id = ?").all(tokenId);
  assert.equal(meta.length, 1, "oauth admissions write metadata too");
  assert.equal(meta[0].identity_kind, "oauth_token");
});

test("D1: storeFromEnv with DB present resolves ONLY from D1 (seed vars inert)", async () => {
  const db = d1Shim();
  insertKeyRow(db._raw, { secretValue: READ_SECRET });
  const seedOnly = secret("ehk_live", "99");
  const seedJson = JSON.stringify([{ name: "SEED_ONLY", secret: seedOnly, scopes: ["read:content"], creatorId: "local-seed-user" }]);
  const env = {
    DB: db,
    EH_LOCAL_KEYS_JSON_B64: Buffer.from(seedJson, "utf8").toString("base64"),
    EH_LOCAL_OAUTH_JSON_B64: Buffer.from("[]", "utf8").toString("base64"),
  };
  const store = await keys.storeFromEnv(env);
  const fromD1 = await keys.authorizeCredential(store, { kind: "api_key", secret: READ_SECRET }, { scope: "read:content" });
  assert.equal(fromD1.allowed, true, `D1 key must be admitted when DB is bound: ${fromD1.reason}`);
  const fromSeed = await keys.authorizeCredential(store, { kind: "api_key", secret: seedOnly }, { scope: "read:content" });
  assert.equal(fromSeed.allowed, false, "a seed-only key must be refused when DB is bound (D1 takes precedence)");
});

test("D1: the enforcement store never mints — lifecycle writers throw a clear error", async () => {
  const db = d1Shim();
  const store = d1Store(db);
  await assert.rejects(() => store.mint({ creatorId: "a", name: "k", scopes: ["read:content"] }), /not supported on the D1 enforcement store/);
  await assert.rejects(() => store.revoke("whatever"), /not supported on the D1 enforcement store/);
  await assert.rejects(() => store.registerOAuthToken({ accountId: "a", scopes: [], audience: "x" }), /not supported on the D1 enforcement store/);
  await assert.rejects(() => store.seedFromJson("[]"), /not supported on the D1 enforcement store/);
});
