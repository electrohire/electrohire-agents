// FROZEN C2 gate battery (LOCAL ONLY). Written before the C2 build.
// Unit/integration tests of the shared authorization gate in
// @electrohire/platform (apikeys.ts): the ONE gate both credential kinds
// pass (C-10), key hashing/storage hygiene (C-08, T041/T042), per-key
// quotas (C-11), and the CUI provider-policy check (C-12, CMP-10).
// Assertions are frozen: never weaken one to pass — log a draft defect.
import { test } from "node:test";
import assert from "node:assert/strict";

const keys = await import("../../packages/platform/src/apikeys.ts");

const READ = ["read:content", "read:tools"];
const ACTION = ["action:support_ticket"];

function freshStore(opts = {}) {
  return keys.createKeyStore({ quotaPerDay: opts.quotaPerDay ?? 600, ratePerMinute: opts.ratePerMinute ?? 120, now: opts.now });
}

test("C-08 keys are minted in the ehk_live_ format and stored as hashes only", async () => {
  const store = freshStore();
  const { record, secret } = await store.mint({ creatorId: "acct-1", name: "k", scopes: READ });
  assert.match(secret, /^ehk_live_[0-9a-f]{32,}$/);
  assert.equal(record.display, `ehk_live_…${secret.slice(-4)}`);
  const dump = JSON.stringify(store.dump());
  assert.ok(!dump.includes(secret), "store dump must never contain a full secret");
  const row = store.dump().find((r) => r.id === record.id);
  assert.ok(row.secretHash && row.secretHash !== secret && !String(row.secretHash).includes(secret.slice(8)), "stored value is a one-way hash");
});

test("C-08 a wrong secret of the same length is refused (constant-time compare path)", async () => {
  const store = freshStore();
  const { secret } = await store.mint({ creatorId: "acct-1", name: "k", scopes: READ });
  const wrong = secret.slice(0, -1) + (secret.endsWith("0") ? "1" : "0");
  const r = await keys.authorizeCredential(store, { kind: "api_key", secret: wrong }, { scope: "read:content" });
  assert.equal(r.allowed, false);
  const ok = await keys.authorizeCredential(store, { kind: "api_key", secret }, { scope: "read:content" });
  assert.equal(ok.allowed, true);
});

test("C-08/T041 a key in a URL is rejected — headers only", async () => {
  const { secret } = await freshStore().mint({ creatorId: "a", name: "k", scopes: READ });
  assert.equal(keys.extractCredential({ headers: {}, url: `https://api.example/v1/content?api_key=${secret}` }).error, "credential_in_url");
  assert.equal(keys.extractCredential({ headers: {}, url: `https://mcp.example/mcp?access_token=${secret}` }).error, "credential_in_url");
  assert.equal(keys.extractCredential({ headers: {}, url: `https://api.example/v1/${secret}` }).error, "credential_in_url");
  const ok = keys.extractCredential({ headers: { authorization: `Bearer ${secret}` }, url: "https://api.example/v1/content" });
  assert.equal(ok.secret, secret);
});

test("C-09/T041 revoked and expired keys are refused on the very next request", async () => {
  let clock = Date.now();
  const store = freshStore({ now: () => clock });
  const a = await store.mint({ creatorId: "acct-1", name: "a", scopes: READ, expiresAt: clock + 30 * 86400000 });
  assert.equal((await keys.authorizeCredential(store, { kind: "api_key", secret: a.secret }, { scope: "read:content" })).allowed, true);
  await store.revoke(a.record.id);
  assert.equal((await keys.authorizeCredential(store, { kind: "api_key", secret: a.secret }, { scope: "read:content" })).allowed, false, "revoked: next request refused");
  const b = await store.mint({ creatorId: "acct-1", name: "b", scopes: READ, expiresAt: clock + 1000 });
  clock += 2000;
  assert.equal((await keys.authorizeCredential(store, { kind: "api_key", secret: b.secret }, { scope: "read:content" })).allowed, false, "expired: refused");
});

test("C-10 cross-method matrix: key and OAuth test-double admitted/refused identically", async () => {
  const store = freshStore();
  const cases = [
    { label: "read admitted to read tool", scopes: READ, req: { scope: "read:tools" }, want: true },
    { label: "read-only refused action tool by scope", scopes: READ, req: { scope: "action:support_ticket" }, want: false },
    { label: "action grant admitted to its action tool", scopes: [...READ, ...ACTION], req: { scope: "action:support_ticket" }, want: true },
    { label: "action-only refused a read tool it lacks", scopes: ACTION, req: { scope: "read:content" }, want: false },
    { label: "bound admitted inside its team", scopes: [...READ, ...ACTION], binding: { teamId: "team-1" }, req: { scope: "action:support_ticket", teamId: "team-1" }, want: true },
    { label: "bound refused outside its team", scopes: [...READ, ...ACTION], binding: { teamId: "team-1" }, req: { scope: "action:support_ticket", teamId: "team-2" }, want: false },
    { label: "bound action refused with no binding context", scopes: [...READ, ...ACTION], binding: { teamId: "team-1" }, req: { scope: "action:support_ticket" }, want: false },
  ];
  for (const c of cases) {
    const k = await store.mint({ creatorId: "acct-1", name: "k", scopes: c.scopes, ...(c.binding ?? {}) });
    const t = await store.registerOAuthDouble({ accountId: "acct-1", scopes: c.scopes, ...(c.binding ?? {}) });
    const byKey = await keys.authorizeCredential(store, { kind: "api_key", secret: k.secret }, c.req);
    const byTok = await keys.authorizeCredential(store, { kind: "oauth_double", token: t.token }, c.req);
    assert.equal(byKey.allowed, c.want, `key: ${c.label}`);
    assert.equal(byTok.allowed, c.want, `token-double: ${c.label}`);
    assert.equal(byKey.allowed, byTok.allowed, `identical: ${c.label}`);
  }
});

test("C-11 per-key quota trips while other keys serve; usage + last-used come from request metadata", async () => {
  const store = freshStore({ quotaPerDay: 3 });
  const a = await store.mint({ creatorId: "acct-1", name: "a", scopes: READ });
  const b = await store.mint({ creatorId: "acct-1", name: "b", scopes: READ });
  for (let i = 0; i < 3; i++) assert.equal((await keys.authorizeCredential(store, { kind: "api_key", secret: a.secret }, { scope: "read:content" })).allowed, true);
  const tripped = await keys.authorizeCredential(store, { kind: "api_key", secret: a.secret }, { scope: "read:content" });
  assert.equal(tripped.allowed, false); assert.match(tripped.reason, /quota/i);
  assert.equal((await keys.authorizeCredential(store, { kind: "api_key", secret: b.secret }, { scope: "read:content" })).allowed, true, "other keys still serve");
  const recA = store.dump().find((r) => r.id === a.record.id);
  assert.equal(recA.usageCount, 3);
  assert.ok(recA.lastUsedAt, "last-used maintained");
  assert.equal(store.requestLog().filter((r) => r.keyId === a.record.id).length, 3, "metadata log count matches usage count");
  assert.ok(!JSON.stringify(store.requestLog()).includes(a.secret), "request metadata never contains the full key");
});

test("C-12/CMP-10 provider policy as data + CUI-bound key refused at a non-allowlisted endpoint", async () => {
  const policy = keys.PROVIDER_POLICY;
  assert.equal(policy.gateway, "openrouter");
  assert.equal(policy.routing.data_collection, "deny");
  assert.ok(policy.eligibleEndpoints.length >= 1);
  for (const e of policy.eligibleEndpoints) {
    assert.equal(e.usHosted, true, `${e.id} US-hosted`);
    assert.equal(e.retainsData, false, `${e.id} keeps no data`);
    assert.equal(e.coveredCountryOperator, false, `${e.id} not covered-country operated`);
  }
  const store = freshStore();
  const cui = await store.mint({ creatorId: "acct-1", name: "cui", scopes: READ, projectId: "proj-cui", projectCuiFlagged: true });
  const good = policy.eligibleEndpoints[0].id;
  assert.equal((await keys.authorizeCredential(store, { kind: "api_key", secret: cui.secret }, { scope: "read:content", projectId: "proj-cui", endpointId: good })).allowed, true, "allowlisted endpoint admitted");
  const bad = await keys.authorizeCredential(store, { kind: "api_key", secret: cui.secret }, { scope: "read:content", projectId: "proj-cui", endpointId: "direct-openai-api" });
  assert.equal(bad.allowed, false, "non-allowlisted endpoint refused");
  assert.match(bad.reason, /provider policy|allowlist|eligible/i);
});

test("KEY-4 key lifecycle events reach the audit sink with prefix + last 4 and ID only", async () => {
  const events = [];
  const store = freshStore();
  store.setAuditSink({ append: async (ev) => events.push(ev) });
  const { record, secret } = await store.mint({ creatorId: "acct-1", name: "audited", scopes: READ });
  await store.revoke(record.id);
  const actions = events.map((e) => e.action);
  assert.ok(actions.includes("api_key.create") && actions.includes("api_key.revoke"), `audit actions: ${actions.join(", ")}`);
  assert.ok(!JSON.stringify(events).includes(secret), "audit events never contain the full secret");
  const create = events.find((e) => e.action === "api_key.create");
  assert.equal(create.detail.keyId, record.id);
  assert.equal(create.detail.display, record.display);
});
