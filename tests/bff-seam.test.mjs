// Ellie app-seam battery (2026-10-26, BFF seam fix — NOT frozen).
// Pins the contract between the platform app's BFF (website repo,
// apps/app/functions/api/ellie) and THIS service's served routes.
//
// Why this exists: the BFF was written against an invented /internal/*
// contract (POST /internal/sessions, header x-ellie-internal-key, body
// {siteKey}) that exists nowhere in this service, so every signed-in
// "New Ellie session" click on app-beta returned this service's
// fallthrough 404 body — the bare text "not_found" — and no session
// was ever created. The panel contract drift (2026-10-25) was the same
// class of defect. This battery drives the EXACT requests the BFF
// emits (the website repo's platform/tests/ellie-bff-seam.test.mjs
// asserts the BFF emits exactly these) and the refusal cases that
// prove the seam's shape: header name, account context, body fields.
//
// The agreed contract (also written in apps/ellie/src/index.ts):
//   header  x-ellie-internal: <ELLIE_INTERNAL_KEY>   (exact name)
//   header  x-ellie-account-id: <validated account id> on every call
//   create  POST /api/chat/sessions            body { accountId }
//   list    GET  /api/chat/sessions?accountId=…        (internal only)
//   read    GET  /api/chat/sessions/:id/messages       (session auth)
//   send    POST /api/chat/sessions/:id/messages body { text }
//   finish  POST /api/chat/sessions/:id/finalize
//   plans   GET  /api/analyses                         (analysis gate)
//   plan    GET  /api/analyses/:id
//   edit    POST /api/analyses/:id/edit     body { section, content }
//   approve POST /api/analyses/:id/approve  body { section, version, payloadHash }
//
// Run: NODE_OPTIONS=--experimental-transform-types node --test tests/bff-seam.test.mjs
// OPENROUTER_API_KEY is a dummy here: global fetch is stubbed for the
// OpenRouter leg so message turns and section generation are
// deterministic and offline. No DB in env → the in-memory store.
import { test } from "node:test";
import assert from "node:assert/strict";

const worker = (await import("../apps/ellie/src/index.ts")).default;

const INTERNAL_KEY = "seam-test-internal-key";
const ACCT_A = "acct-seam-a";
const ACCT_B = "acct-seam-b";

// Stub ONLY the OpenRouter leg; anything else fetching is a bug here.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("openrouter.ai")) {
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Stub model section text for the seam battery." } }],
      usage: { cost: 0 },
      model: "stub/seam-model",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`bff-seam battery: unexpected fetch to ${u}`);
};

const env = {
  ELLIE_INTERNAL_KEY: INTERNAL_KEY,
  ELLIE_SITE_KEYS_JSON: "[]",
  OPENROUTER_API_KEY: "seam-test-openrouter-key",
};
const BASE = "https://ellie-beta.electrohire.com";
const call = (method, path, { account, headers = {}, body } = {}) =>
  worker.fetch(new Request(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(account ? { "x-ellie-internal": INTERNAL_KEY, "x-ellie-account-id": account } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);

let sessionId;
let analysisId;

test("create: the BFF's exact call returns 201 with a session id", async () => {
  const res = await call("POST", "/api/chat/sessions", { account: ACCT_A, body: { accountId: ACCT_A } });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(typeof data.sessionId, "string");
  assert.ok(data.sessionId.length > 0);
  assert.ok(String(data.disclosure).includes("AI"), "create returns the SG-2 disclosure");
  sessionId = data.sessionId;
});

test("create refusals pin the header name and the account body field", async () => {
  // The old BFF's header NAME (x-ellie-internal-key) must NOT be
  // treated as internal: the call falls into the site-key path and is
  // refused — this is the exact drift that produced "not_found".
  const wrongName = await call("POST", "/api/chat/sessions", {
    headers: { "x-ellie-internal-key": INTERNAL_KEY },
    body: { accountId: ACCT_A },
  });
  assert.equal(wrongName.status, 403);
  assert.equal((await wrongName.json()).error, "site_key_refused");
  // No internal header at all: same refusal.
  const noHeader = await call("POST", "/api/chat/sessions", { body: { accountId: ACCT_A } });
  assert.equal(noHeader.status, 403);
  assert.equal((await noHeader.json()).error, "site_key_refused");
  // Internal key but no accountId in the body: account_required.
  const noAccount = await call("POST", "/api/chat/sessions", {
    headers: { "x-ellie-internal": INTERNAL_KEY },
    body: {},
  });
  assert.equal(noAccount.status, 400);
  assert.equal((await noAccount.json()).error, "account_required");
  // The old BFF's invented path does not exist: fallthrough 404.
  const invented = await call("POST", "/internal/sessions", {
    headers: { "x-ellie-internal-key": INTERNAL_KEY },
    body: { siteKey: "pk_live_whatever" },
  });
  assert.equal(invented.status, 404);
  assert.equal((await invented.json()).error, "not_found");
});

test("list: internal-only, scoped to the account", async () => {
  const res = await call("GET", `/api/chat/sessions?accountId=${ACCT_A}`, { account: ACCT_A });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.sessions.some((s) => s.id === sessionId), "list contains the created session");
  const mine = data.sessions.find((s) => s.id === sessionId);
  assert.equal(mine.hasAnalysis, false);
  const other = await call("GET", `/api/chat/sessions?accountId=${ACCT_B}`, { account: ACCT_B });
  assert.equal((await other.json()).sessions.length, 0);
  const anon = await worker.fetch(new Request(`${BASE}/api/chat/sessions?accountId=${ACCT_A}`), env);
  assert.equal(anon.status, 403);
  assert.equal((await anon.json()).error, "internal_required");
});

test("history: first stored message is the disclosure; account context is enforced", async () => {
  const res = await call("GET", `/api/chat/sessions/${sessionId}/messages`, { account: ACCT_A });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].role, "assistant");
  assert.ok(data.messages[0].content.includes("AI"), "first message is the disclosure");
  // Another account's context header must not read this session.
  const cross = await call("GET", `/api/chat/sessions/${sessionId}/messages`, { account: ACCT_B });
  assert.equal(cross.status, 403);
});

test("send: { text } advances the intake; history grows", async () => {
  const answers = [
    "A battery-powered air-quality sensor node for warehouses.",
    "Measure particulates, CO2, temperature and humidity.",
    "Warehouses across the US Midwest.",
    "Battery life of at least one year.",
    "A working prototype.",
    "Certifications are part of the plan.",
    "About forty thousand dollars.",
    "Launch within nine months.",
    "A small founding team.",
    "No export-controlled work.",
    "Sensors off the shelf are fine.",
    "LoRaWAN connectivity.",
    "Monthly reporting to customers.",
    "Standard commercial terms.",
    "Nothing else to add.",
    "Proceed.",
    "Proceed.",
    "Proceed.",
    "Proceed.",
    "Proceed.",
  ];
  let completed = false;
  for (const text of answers) {
    const res = await call("POST", `/api/chat/sessions/${sessionId}/messages`, { account: ACCT_A, body: { text } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.reply, "string");
    if (String(data.reply).includes("completes the intake")) { completed = true; break; }
  }
  assert.ok(completed, "the intake state machine reached completion");
  const hist = await (await call("GET", `/api/chat/sessions/${sessionId}/messages`, { account: ACCT_A })).json();
  assert.ok(hist.messages.length >= 3, "history holds disclosure + turns");
  assert.ok(hist.messages.some((m) => m.role === "user"));
  // The page's field name ({ content }) is NOT the contract: with no
  // text the engine receives an empty turn — the BFF must translate.
  // (Pinned here as shape documentation, not as a refusal.)
});

test("finalize + analyses list + analysis read, all through the internal gate", async () => {
  const fin = await call("POST", `/api/chat/sessions/${sessionId}/finalize`, { account: ACCT_A });
  assert.equal(fin.status, 201);
  analysisId = (await fin.json()).analysisId;
  assert.ok(analysisId);

  const list = await call("GET", "/api/analyses", { account: ACCT_A });
  assert.equal(list.status, 200);
  assert.ok((await list.json()).analyses.some((a) => a.id === analysisId));

  // Each read advances one generation step; read until complete.
  let plan;
  for (let i = 0; i < 10; i++) {
    const res = await call("GET", `/api/analyses/${analysisId}`, { account: ACCT_A });
    assert.equal(res.status, 200);
    plan = await res.json();
    if (plan.status === "complete") break;
  }
  assert.equal(plan.status, "complete");
  assert.equal(plan.sections.length, 6);
  for (const s of plan.sections) assert.ok(s.payloadHash, `section ${s.section} carries a payload hash`);

  // Another account cannot read the analysis through the seam.
  const cross = await call("GET", `/api/analyses/${analysisId}`, { account: ACCT_B });
  assert.equal(cross.status, 403);
});

test("edit works through the seam; approve still enforces the staff rule in the engine", async () => {
  const before = await (await call("GET", `/api/analyses/${analysisId}`, { account: ACCT_A })).json();
  const reqSection = before.sections.find((s) => s.section === "requirements");
  const edited = await call("POST", `/api/analyses/${analysisId}/edit`, {
    account: ACCT_A,
    body: { section: "requirements", content: "Edited by the seam battery." },
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).version, reqSection.version + 1);

  const after = await (await call("GET", `/api/analyses/${analysisId}`, { account: ACCT_A })).json();
  const now = after.sections.find((s) => s.section === "requirements");
  const approve = await call("POST", `/api/analyses/${analysisId}/approve`, {
    account: ACCT_A,
    body: { section: "requirements", version: now.version, payloadHash: now.payloadHash },
  });
  // ACCT_A is not staff in the store: the internal gate establishes
  // WHO is acting, the engine's staff check still refuses. (Positive
  // approval is covered by the Phase E pilot record.)
  assert.equal(approve.status, 403);
  assert.equal((await approve.json()).error, "not_staff");
});

test("cleanup: restore global fetch", async () => {
  globalThis.fetch = realFetch;
});
