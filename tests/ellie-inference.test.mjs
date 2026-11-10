// Ellie on the self-hosted inference node (owner directive
// 2026-11-10): configured base URL + key route, no silent route
// crossing, OpenRouter default unchanged.
// Local track only (fake-fetch clients, no network, no real key).
// The frozen Phase E battery (tests/frozen/ellie.test.mjs) is
// unchanged by this work; this file pins the new behavior beside it.
import { test } from "node:test";
import assert from "node:assert/strict";

const ellie = await import("../packages/platform/src/ellie/index.ts");
const { OpenRouterClient, OPENROUTER_BASE, createMemoryStore, ellieEngineFromEnv } = ellie;
const { allowedEgress } = await import("../packages/platform/src/security.ts");

const GATEWAY = "https://gateway.example.test/v1";
const okResponse = (model, text = "ok") => new Response(JSON.stringify({
  choices: [{ message: { content: text } }], usage: { cost: 0 }, model,
}), { status: 200 });

test("self-hosted route: posts to the configured base URL with its key, no provider pin", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return okResponse("NInfer", "from the node"); };
  const client = new OpenRouterClient({
    apiKey: "gw-key", baseUrl: GATEWAY,
    textModels: ["NInfer", "gpt-oss-20b"], visionModels: ["NInfer"], fetchImpl,
  });
  assert.equal(client.baseUrl, GATEWAY);
  assert.equal(client.providerPin, false);
  const r = await client.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.text, "from the node");
  assert.equal(r.model, "NInfer", "the answering model is reported from the response");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${GATEWAY}/chat/completions`);
  assert.equal(seen[0].init.headers.authorization, "Bearer gw-key");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "NInfer");
  assert.equal(body.provider, undefined, "no OpenRouter routing object on the self-hosted route");
  assert.equal(body.allow_fallbacks, undefined);
});

test("self-hosted route: ordered fallback stays on the node (primary 5xx, companion answers)", async () => {
  const tried = [];
  const fetchImpl = async (url, init) => {
    const model = JSON.parse(init.body).model;
    tried.push(model);
    if (model === "NInfer") return new Response("engine busy", { status: 503 });
    return okResponse("gpt-oss-20b", "companion answered");
  };
  const client = new OpenRouterClient({
    apiKey: "gw-key", baseUrl: GATEWAY,
    textModels: ["NInfer", "gpt-oss-20b"], visionModels: [], fetchImpl,
  });
  const r = await client.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.text, "companion answered");
  assert.equal(r.model, "gpt-oss-20b");
  assert.deepEqual(tried, ["NInfer", "gpt-oss-20b"]);
});

test("self-hosted route: total failure is a typed refusal, never a silent OpenRouter crossing", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return new Response("down", { status: 502 }); };
  const client = new OpenRouterClient({
    apiKey: "gw-key", baseUrl: GATEWAY,
    textModels: ["NInfer"], visionModels: [], fetchImpl,
  });
  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    (e) => e.code === "model_unavailable",
  );
  assert.ok(urls.every((u) => u.startsWith(GATEWAY)), "every attempt stayed on the configured route");
});

test("self-hosted CUI: refuses with cui_no_endpoint when the endpoint does not answer", async () => {
  const fetchImpl = async () => new Response("down", { status: 500 });
  const client = new OpenRouterClient({
    apiKey: "gw-key", baseUrl: GATEWAY,
    textModels: ["NInfer"], visionModels: [], fetchImpl,
  });
  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "cui" }], cui: true }),
    (e) => e.code === "cui_no_endpoint" && /self-hosted endpoint/.test(e.message),
  );
});

test("default route unchanged: OpenRouter URL, CMP-10 pin on every body", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return okResponse("m1"); };
  const client = new OpenRouterClient({ apiKey: "sk-or-test", textModels: ["m1"], visionModels: ["v1"], fetchImpl });
  assert.equal(client.baseUrl, OPENROUTER_BASE);
  assert.equal(client.providerPin, true);
  await client.chat({ messages: [{ role: "user", content: "hi" }] });
  await client.chat({ messages: [{ role: "user", content: "hi" }], cui: true });
  assert.equal(seen[0].url, `${OPENROUTER_BASE}/chat/completions`);
  for (const s of seen) assert.equal(s.body.provider?.data_collection, "deny");
  assert.equal(seen[1].body.provider?.allow_fallbacks, false);
});

test("egress: the static allowlist is unchanged; an operator-named host is admitted exactly", () => {
  assert.equal(allowedEgress("https://openrouter.ai/api/v1/chat/completions").allowed, true);
  assert.equal(allowedEgress("https://gateway.example.test/v1/chat/completions").allowed, false);
  assert.equal(allowedEgress("https://gateway.example.test/v1/chat/completions", ["gateway.example.test"]).allowed, true);
  assert.equal(allowedEgress("https://other.example.test/v1/chat/completions", ["gateway.example.test"]).allowed, false);
  assert.equal(allowedEgress("https://gateway.example.test.evil.example/v1", ["gateway.example.test"]).allowed, false);
});

test("factory: ELLIE_MODEL_BASE_URL with no route key keeps the honest not-configured fallback", async () => {
  const engine = ellieEngineFromEnv(
    { ELLIE_MODEL_BASE_URL: GATEWAY, ELLIE_MODELS_TEXT: "NInfer" },
    createMemoryStore(),
  );
  const { session, sessionToken } = await engine.createSession({});
  const turn = await engine.handleMessage(session.id, "I want a sensor board", { sessionToken });
  assert.equal(turn.modelConfigured, false);
});
