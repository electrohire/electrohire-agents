// FROZEN C3 HTTP battery (LOCAL ONLY). Written alongside the C3 build plan,
// before the HTTP wiring. Run against locally served Workers (wrangler dev)
// seeded with local keys (c2-seed) + audience-bound OAuth tokens (c3-seed):
//   API_URL=http://127.0.0.1:8787 MCP_URL=http://127.0.0.1:8788 \
//     node --test tests/frozen/c3-http.test.mjs
// Assertions are frozen: never weaken one to pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const API = process.env.API_URL || "http://127.0.0.1:8787";
const MCP = process.env.MCP_URL || "http://127.0.0.1:8788";
const seed = JSON.parse(readFileSync(new URL("./c3-seed.json", import.meta.url), "utf8"));
const T = Object.fromEntries(seed.tokens.map((t) => [t.name, t.token]));
const auth = (v) => ({ authorization: `Bearer ${v}` });
const j = async (base, path, init) => {
  const r = await fetch(base + path, init);
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
const post = (base, path, body, headers = {}) => j(base, path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("C-13 RFC 9728: protected-resource metadata serves on both resources; headers-only; no Ellie scope", async () => {
  const api = await j(API, "/.well-known/oauth-protected-resource");
  assert.equal(api.status, 200);
  assert.equal(api.body.resource, "https://api-beta.electrohire.com");
  assert.deepEqual(api.body.bearer_methods_supported, ["header"]);
  assert.ok(api.body.scopes_supported.includes("action:newsletter_subscribe"));
  assert.ok(!api.body.scopes_supported.includes("action:ellie_session"));
  const mcp = await j(MCP, "/.well-known/oauth-protected-resource");
  assert.equal(mcp.status, 200);
  assert.equal(mcp.body.resource, "https://mcp-beta.electrohire.com");
});

test("C-13/C-15L3 API actions: no credential is refused 401; wrong-audience token refused; right token admitted; response is the neutral double opt-in response", async () => {
  const anon = await post(API, "/v1/actions/newsletter-subscribe", { email: "person@example.com" });
  assert.equal(anon.status, 401);
  const wrongAud = await post(API, "/v1/actions/newsletter-subscribe", { email: "person@example.com" }, auth(T.MCP_TOKEN));
  assert.equal(wrongAud.status, 403, "MCP-audience token refused at the API resource");
  assert.match(JSON.stringify(wrongAud.body), /audience/i);
  const ok = await post(API, "/v1/actions/newsletter-subscribe", { email: "person@example.com" }, auth(T.API_TOKEN));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "pending_confirmation");
  const again = await post(API, "/v1/actions/newsletter-subscribe", { email: "person@example.com" }, auth(T.API_TOKEN));
  assert.deepEqual(again.body, ok.body, "repeat subscribe response identical — never reveals state");
  const readOnly = await post(API, "/v1/actions/newsletter-subscribe", { email: "x@example.com" }, auth(T.API_READ_TOKEN));
  assert.equal(readOnly.status, 403, "read-scope token refused the action by scope, before execution");
});

test("C-13 API ticket action + headers-only: ticket files with the right token; an OAuth token in a URL is rejected 400", async () => {
  const ok = await post(API, "/v1/actions/support-ticket", { subject: "Help", body: "Body" }, auth(T.API_TOKEN));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "open");
  assert.ok(ok.body.id);
  const inUrl = await post(API, `/v1/actions/support-ticket?access_token=${T.API_TOKEN}`, { subject: "x", body: "y" });
  assert.equal(inUrl.status, 400);
  const ellie = await post(API, "/v1/actions/ellie-session", {}, auth(T.API_TOKEN));
  assert.equal(ellie.status, 404, "no Ellie action route exists (Phase E gated)");
});

test("C-13/C-15L3 MCP action tools: listed (no Ellie tool), credential required, audience enforced, scope enforced, admitted with the MCP token", async () => {
  const rpc = (secret, name, args) => fetch(MCP + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(secret ? auth(secret) : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const list = await fetch(MCP + "/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }).then((r) => r.text());
  assert.ok(list.includes("electrohire_newsletter_subscribe") && list.includes("electrohire_support_ticket"), "action tools are listed");
  const toolNames = [...list.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(!toolNames.some((n) => /ellie/i.test(n)), "no Ellie tool is offered");
  const anon = await rpc(null, "electrohire_newsletter_subscribe", { email: "p@example.com" });
  assert.match(anon.text, /credential_required/i, "anonymous action call refused before execution");
  const wrongAud = await rpc(T.API_TOKEN, "electrohire_newsletter_subscribe", { email: "p@example.com" });
  assert.match(wrongAud.text, /audience/i, "API-audience token refused at the MCP resource");
  const ok = await rpc(T.MCP_TOKEN, "electrohire_newsletter_subscribe", { email: "p@example.com" });
  assert.match(ok.text, /pending_confirmation/, "MCP-audience token admitted; neutral double opt-in response");
  assert.ok(!ok.text.includes(T.MCP_TOKEN), "the response never echoes the token");
  const ticket = await rpc(T.MCP_TOKEN, "electrohire_support_ticket", { subject: "Help", body: "via mcp" });
  assert.match(ticket.text, /open/, "ticket filed via MCP action tool");
});
