// FROZEN C2 HTTP battery (LOCAL ONLY). Written before the C2 build.
// Run against locally served Workers (wrangler dev / miniflare) seeded with
// local test keys through the EH_LOCAL_KEYS_JSON stand-in (hash-on-ingest):
//   API_URL=http://127.0.0.1:8787 MCP_URL=http://127.0.0.1:8788 \
//     node --test tests/frozen/c2-http.test.mjs
// Seed keys (minted by tests/frozen/c2-seed.mjs, referenced by prefix only
// outside this file): READ_KEY (read:content + read:tools), ACTION_ONLY_KEY
// (action:support_ticket only), QUOTA_KEY (quotaPerDay 2), REVOKED_KEY,
// EXPIRED_KEY. Assertions are frozen: never weaken one to pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const API = process.env.API_URL || "http://127.0.0.1:8787";
const MCP = process.env.MCP_URL || "http://127.0.0.1:8788";
const seed = JSON.parse(readFileSync(new URL("./c2-seed.json", import.meta.url), "utf8"));
const K = Object.fromEntries(seed.keys.map((k) => [k.name, k.secret]));

const j = async (base, path, init) => {
  const r = await fetch(base + path, init);
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers, text: "" };
};
const auth = (secret) => ({ authorization: `Bearer ${secret}` });

test("C1 regression: public reads still serve without a key", async () => {
  const { status, body } = await j(API, "/v1/health");
  assert.equal(status, 200); assert.equal(body.status, "ok");
  const content = await j(API, "/v1/content");
  assert.equal(content.status, 200);
});

test("C-10 a valid read key is admitted to read endpoints and read tools (API)", async () => {
  const content = await j(API, "/v1/content", { headers: auth(K.READ_KEY) });
  assert.equal(content.status, 200);
  const tool = await j(API, "/v1/tools/scoping-checklist", {
    method: "POST", headers: { "content-type": "application/json", ...auth(K.READ_KEY) },
    body: JSON.stringify({ needs: ["pcb"] }),
  });
  assert.equal(tool.status, 200, "read:tools scope admits the checklist tool");
});

test("C-10 an action-only key is refused a read tool by scope (API)", async () => {
  const tool = await j(API, "/v1/tools/scoping-checklist", {
    method: "POST", headers: { "content-type": "application/json", ...auth(K.ACTION_ONLY_KEY) },
    body: JSON.stringify({ needs: ["pcb"] }),
  });
  assert.equal(tool.status, 403);
  assert.match(JSON.stringify(tool.body), /scope/i);
});

test("C-08/T041 a key in a URL is rejected even when the key is valid", async () => {
  const { status, body } = await j(API, `/v1/content?api_key=${encodeURIComponent(K.READ_KEY)}`);
  assert.equal(status, 400);
  assert.match(JSON.stringify(body), /url/i);
});

test("C-09/T041 revoked and expired keys are refused (401) on their next request", async () => {
  const revoked = await j(API, "/v1/content", { headers: auth(K.REVOKED_KEY) });
  assert.equal(revoked.status, 401); assert.match(JSON.stringify(revoked.body), /revoked/i);
  const expired = await j(API, "/v1/content", { headers: auth(K.EXPIRED_KEY) });
  assert.equal(expired.status, 401); assert.match(JSON.stringify(expired.body), /expired/i);
  const bogus = await j(API, "/v1/content", { headers: auth("ehk_live_" + "f".repeat(48)) });
  assert.equal(bogus.status, 401, "an unknown key is refused, never silently treated as anonymous");
});

test("C-11 per-key quota trips over HTTP while another key still serves; usage header counts admitted requests", async () => {
  const first = await j(API, "/v1/content", { headers: auth(K.QUOTA_KEY) });
  assert.equal(first.status, 200); assert.equal(first.headers.get("x-eh-key-usage"), "1");
  const second = await j(API, "/v1/content", { headers: auth(K.QUOTA_KEY) });
  assert.equal(second.status, 200); assert.equal(second.headers.get("x-eh-key-usage"), "2");
  const third = await j(API, "/v1/content", { headers: auth(K.QUOTA_KEY) });
  assert.equal(third.status, 429); assert.match(JSON.stringify(third.body), /quota/i);
  const other = await j(API, "/v1/content", { headers: auth(K.READ_KEY) });
  assert.equal(other.status, 200, "another key still serves while the tripped key is refused");
});

test("C-10 MCP: a valid read key calls a read tool; an action-only key is refused by scope", async () => {
  const rpc = (secret, name, args) => fetch(MCP + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(secret ? auth(secret) : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const ok = await rpc(K.READ_KEY, "electrohire_get_pricing", {});
  assert.equal(ok.status, 200);
  assert.ok(!ok.text.includes(K.READ_KEY), "the response never echoes the key");
  const refused = await rpc(K.ACTION_ONLY_KEY, "electrohire_get_pricing", {});
  assert.match(refused.text, /scope/i, "action-only key refused a read tool by scope");
  const inUrl = await fetch(`${MCP}/mcp?api_key=${encodeURIComponent(K.READ_KEY)}`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(inUrl.status, 400, "a key in the MCP URL is rejected");
});
