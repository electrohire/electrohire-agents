// WS-15 — Ellie on a free model: config, no silent paid fallback,
// per-user daily cap, plain-language limit messages.
// Local track only (scripted + fake-fetch clients, no network, no key).
// The frozen Phase E battery (tests/frozen/ellie.test.mjs) is
// unchanged by WS-15; this file pins the new behavior beside it.
import { test } from "node:test";
import assert from "node:assert/strict";

const ellie = await import("../packages/platform/src/ellie/index.ts");
const { createMemoryStore, createEngine, ScriptedModelClient, OpenRouterClient,
  DEFAULT_TEXT_MODELS, DEFAULT_VISION_MODELS, DEFAULT_PAID_TEXT_MODELS,
  isFreeModel, FREE_DAILY_CAP_MESSAGE, FREE_UNAVAILABLE_MESSAGE,
  DEFAULT_FREE_DAILY_USER_CAP } = ellie;

const okResponse = (model) => new Response(JSON.stringify({
  choices: [{ message: { content: "ok" } }], usage: { cost: 0 }, model,
}), { status: 200 });

test("defaults: active lists are all free; paid models are listed separately", () => {
  assert.ok(DEFAULT_TEXT_MODELS.length >= 2);
  assert.ok(DEFAULT_TEXT_MODELS.every(isFreeModel), JSON.stringify(DEFAULT_TEXT_MODELS));
  assert.ok(DEFAULT_VISION_MODELS.every(isFreeModel), JSON.stringify(DEFAULT_VISION_MODELS));
  assert.equal(DEFAULT_TEXT_MODELS[0], "google/gemma-4-31b-it:free");
  // The model Ellie ran on before WS-15 stays listed as paid config.
  assert.ok(DEFAULT_PAID_TEXT_MODELS.includes("meta-llama/llama-3.3-70b-instruct"));
  assert.ok(!DEFAULT_PAID_TEXT_MODELS.some(isFreeModel));
});

test("no silent paid fallback: free failures never reach a paid model", async () => {
  const seen = [];
  const failing = async (url, init) => { seen.push(JSON.parse(init.body).model); return new Response("busy", { status: 429 }); };
  const client = new OpenRouterClient({
    apiKey: "sk-or-test", textModels: ["a/model:free", "b/model:free"], visionModels: [],
    paidTextModels: ["paid/model"], fetchImpl: failing,
  });
  assert.equal(client.allowPaidFallback, false);
  await assert.rejects(() => client.chat({ messages: [{ role: "user", content: "hi" }] }), /model_unavailable|No configured model/);
  assert.deepEqual(seen, ["a/model:free", "b/model:free"], "only the free list was tried");
});

test("paid fallback happens only under the explicit opt-in", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const model = JSON.parse(init.body).model; seen.push(model);
    if (model.endsWith(":free")) return new Response("busy", { status: 503 });
    return okResponse(model);
  };
  const client = new OpenRouterClient({
    apiKey: "sk-or-test", textModels: ["a/model:free"], visionModels: [],
    paidTextModels: ["paid/model"], allowPaidFallback: true, fetchImpl,
  });
  const r = await client.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.model, "paid/model");
  assert.deepEqual(seen, ["a/model:free", "paid/model"]);
});

test("every body still pins data_collection deny on the free route (CMP-10)", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return okResponse("m"); };
  const client = new OpenRouterClient({ apiKey: "sk-or-test", textModels: DEFAULT_TEXT_MODELS, visionModels: DEFAULT_VISION_MODELS, fetchImpl });
  await client.chat({ messages: [{ role: "user", content: "hi" }] });
  await client.chat({ messages: [{ role: "user", content: "img" }], vision: true });
  assert.equal(bodies.length, 2);
  for (const b of bodies) assert.equal(b.provider?.data_collection, "deny");
  assert.ok(isFreeModel(bodies[0].model) && isFreeModel(bodies[1].model));
});

test("per-user daily cap: the user who hits it gets the plain-language limit message", async () => {
  const store = createMemoryStore();
  const engine = createEngine({ store, modelClient: new ScriptedModelClient(["noted"]), freeDailyUserCap: 3 });
  const a = await engine.createSession({ accountId: "acct-a" });
  let last;
  for (let i = 0; i < 3; i++) last = await engine.handleMessage(a.session.id, `answer ${i}`, { accountId: "acct-a" });
  assert.notEqual(last.reply, FREE_DAILY_CAP_MESSAGE);
  const capped = await engine.handleMessage(a.session.id, "one more", { accountId: "acct-a" });
  assert.equal(capped.reply, FREE_DAILY_CAP_MESSAGE);
  assert.equal(capped.freeLimitReached, true);
  assert.match(capped.reply, /free/i);
  assert.match(capped.reply, /midnight UTC/i);
  assert.match(capped.reply, /human/i);
  // A different user is not capped by the first user's usage.
  const b = await engine.createSession({ accountId: "acct-b" });
  const other = await engine.handleMessage(b.session.id, "hello", { accountId: "acct-b" });
  assert.notEqual(other.reply, FREE_DAILY_CAP_MESSAGE);
});

test("cap of 0 disables the per-user cap", async () => {
  const store = createMemoryStore();
  const engine = createEngine({ store, modelClient: new ScriptedModelClient(["noted"]), freeDailyUserCap: 0 });
  const s = await engine.createSession({ accountId: "acct-a" });
  for (let i = 0; i < DEFAULT_FREE_DAILY_USER_CAP + 5; i++) {
    const t = await engine.handleMessage(s.session.id, `answer ${i}`, { accountId: "acct-a" });
    assert.notEqual(t.reply, FREE_DAILY_CAP_MESSAGE);
  }
});

test("all free routes down: chat answers with the free-unavailable message, not an error", async () => {
  const failing = async () => new Response("busy", { status: 429 });
  const client = new OpenRouterClient({ apiKey: "sk-or-test", textModels: ["a/model:free"], visionModels: ["a/model:free"], fetchImpl: failing });
  const store = createMemoryStore();
  const engine = createEngine({ store, modelClient: client });
  const { session, sessionToken } = await engine.createSession({});
  const turn = await engine.handleMessage(session.id, "I want a sensor board", { sessionToken });
  assert.equal(turn.reply, FREE_UNAVAILABLE_MESSAGE);
  assert.equal(turn.freeUnavailable, true);
  assert.match(turn.reply, /free/i);
  assert.match(turn.reply, /midnight UTC/i);
});

test("generation paused by the cap stays resumable (status stays generating)", async () => {
  const store = createMemoryStore();
  const engine = createEngine({ store, modelClient: new ScriptedModelClient(Array(40).fill("Draft body.")), freeDailyUserCap: 16 });
  const s = await engine.createSession({ accountId: "acct-a" });
  // 15 intake answers = 15 counted calls; the cap (16) allows the
  // first section draft, then refuses the next advance.
  const { QUESTION_SET } = ellie;
  for (const f of QUESTION_SET) await engine.handleMessage(s.session.id, `answer for ${f.id}`, { accountId: "acct-a" });
  const fin = await engine.finalize(s.session.id, { accountId: "acct-a" });
  const first = await engine.advanceAnalysis(fin.analysisId, { accountId: "acct-a" });
  assert.equal(first.sections.length, 1);
  await assert.rejects(
    () => engine.advanceAnalysis(fin.analysisId, { accountId: "acct-a" }),
    (e) => e.code === "free_daily_cap_exceeded" && /midnight UTC/.test(e.message),
  );
  const view = await engine.getAnalysis(fin.analysisId, { accountId: "acct-a" });
  assert.equal(view.status, "generating", "paused, not blocked — resumes after the reset");
});
