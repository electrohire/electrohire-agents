// Ellie R2 storage battery (2026-10-25, R2 wiring run — NOT frozen).
// The D1 Ellie store against the REAL ellie_uploads schema (website
// migration 0008 verbatim + the 0011 r2_key ALTER) behind the repo's
// D1-shaped node:sqlite shim, with a Map-backed stand-in for the R2
// bucket. Covers: R2 round-trip (bytes in the bucket, key on the row,
// empty data BLOB), legacy BLOB rows still reading, the no-bucket D1
// fallback unchanged, delete semantics in both stores, and the engine
// round-trip (registerUpload → getUpload → removeUpload) incl. the
// session-state note dropping on removal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const ellie = await import("../packages/platform/src/ellie/index.ts");
const { createD1Store, createEngine, ScriptedModelClient } = ellie;

const SCHEMA = `
CREATE TABLE ellie_uploads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  data BLOB NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
ALTER TABLE ellie_uploads ADD COLUMN r2_key TEXT;
CREATE TABLE ellie_sessions (
  id TEXT PRIMARY KEY, account_id TEXT, site_key TEXT NOT NULL,
  cui_flag INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'intake',
  question_set_version TEXT NOT NULL, session_token_hash TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE ellie_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, flags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
);
CREATE TABLE ellie_site_keys (
  key TEXT PRIMARY KEY, origins TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
`;

function d1Shim() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF;");
  raw.exec(SCHEMA);
  const db = {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...p) { params = p; return stmt; },
        async first() { const row = raw.prepare(sql).get(...params); return row === undefined ? null : row; },
        async all() { return { results: raw.prepare(sql).all(...params) }; },
        async run() { raw.prepare(sql).run(...params); return { success: true }; },
      };
      return stmt;
    },
    _raw: raw,
  };
  return db;
}

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, _opts) { objects.set(key, new Uint8Array(value)); },
    async get(key) { const v = objects.get(key); return v ? { arrayBuffer: async () => v.slice().buffer } : null; },
    async delete(key) { objects.delete(key); },
  };
}

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
let seq = 0;
function uploadRow(bytes, over = {}) {
  seq += 1;
  return {
    id: `up-${seq}`, sessionId: "sess-1", r2Key: null, filename: "notes.txt", mime: "text/plain",
    size: bytes.length, extractedText: dec(bytes), hasData: true, createdAt: 1000 + seq, data: bytes, ...over,
  };
}

test("R2-bound store: bytes land in the bucket, the row carries the key, data stays empty", async () => {
  const db = d1Shim();
  const files = fakeBucket();
  const store = createD1Store(db, files);
  const row = uploadRow(enc("hello r2"));
  await store.createUpload(row);
  const key = `ellie/sess-1/${row.id}`;
  // The engine returns the row object it passed to createUpload, so
  // the row itself must report the key after the call — the served
  // upload response reads it from there. (Pinned after the first
  // served round-trip returned r2Key null in the response while the
  // database row was correct.)
  assert.equal(row.r2Key, key);
  assert.equal(dec(files.objects.get(key)), "hello r2");
  const rawRow = db._raw.prepare("SELECT r2_key, length(data) AS dl FROM ellie_uploads WHERE id = ?").get(row.id);
  assert.equal(rawRow.r2_key, key);
  assert.equal(rawRow.dl, 0);
  const listed = await store.listUploads("sess-1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].r2Key, key);
  assert.equal(listed[0].hasData, true);
  const got = await store.getUploadData(row.id);
  assert.equal(dec(got.data), "hello r2");
  assert.equal(got.row.r2Key, key);
});

test("R2-bound store: delete removes the object and the row together", async () => {
  const db = d1Shim();
  const files = fakeBucket();
  const store = createD1Store(db, files);
  const row = uploadRow(enc("delete me"));
  await store.createUpload(row);
  assert.equal(await store.deleteUpload(row.id), true);
  assert.equal(files.objects.has(`ellie/sess-1/${row.id}`), false);
  assert.equal(await store.getUploadData(row.id), null);
  assert.deepEqual(await store.listUploads("sess-1"), []);
  assert.equal(await store.deleteUpload(row.id), false);
});

test("legacy D1 BLOB rows (r2_key NULL) still read and delete with a bucket bound", async () => {
  const db = d1Shim();
  const files = fakeBucket();
  const store = createD1Store(db, files);
  db._raw.prepare("INSERT INTO ellie_uploads (id, session_id, data, filename, mime, size, extracted_text, r2_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("legacy-1", "sess-1", enc("old bytes"), "old.txt", "text/plain", 9, "old bytes", null, 500);
  const listed = await store.listUploads("sess-1");
  assert.equal(listed[0].r2Key, null);
  assert.equal(listed[0].hasData, true);
  const got = await store.getUploadData("legacy-1");
  assert.equal(dec(got.data), "old bytes");
  assert.equal(await store.deleteUpload("legacy-1"), true);
  assert.equal(await store.getUploadData("legacy-1"), null);
});

test("no bucket bound: the D1 BLOB behavior is unchanged (fallback intact)", async () => {
  const db = d1Shim();
  const store = createD1Store(db);
  const row = uploadRow(enc("still in d1"));
  await store.createUpload(row);
  const rawRow = db._raw.prepare("SELECT r2_key, length(data) AS dl FROM ellie_uploads WHERE id = ?").get(row.id);
  assert.equal(rawRow.r2_key, null);
  assert.equal(rawRow.dl, row.size);
  const got = await store.getUploadData(row.id);
  assert.equal(dec(got.data), "still in d1");
  assert.equal(await store.deleteUpload(row.id), true);
});

test("engine round-trip over the R2 store: register → get → remove, state note drops", async () => {
  const db = d1Shim();
  const files = fakeBucket();
  const store = createD1Store(db, files);
  const engine = createEngine({ store, modelClient: new ScriptedModelClient(["ok"]), dailySpendCapUsd: 5 });
  const { session } = await engine.createSession({ accountId: "acct-r2-test" });
  const up = await engine.registerUpload(session.id, { filename: "spec.txt", mime: "text/plain", size: 8, bytes: enc("spec v1!"), extractedText: "spec v1!" });
  assert.equal(files.objects.has(`ellie/${session.id}/${up.id}`), true);
  // another session cannot see it (ownership by construction)
  const other = await engine.createSession({ accountId: "acct-other" });
  assert.equal(await engine.getUpload(other.session.id, up.id), null);
  assert.equal(await engine.removeUpload(other.session.id, up.id), false);
  const got = await engine.getUpload(session.id, up.id);
  assert.equal(dec(got.data), "spec v1!");
  assert.equal(await engine.removeUpload(session.id, up.id), true);
  assert.equal(files.objects.has(`ellie/${session.id}/${up.id}`), false);
  assert.equal(await engine.getUpload(session.id, up.id), null);
  const state = JSON.parse(db._raw.prepare("SELECT state FROM ellie_sessions WHERE id = ?").get(session.id).state);
  assert.equal((state.uploads ?? []).length, 0);
});
