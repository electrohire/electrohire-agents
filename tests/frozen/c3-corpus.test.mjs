// C3 supplementary battery (LOCAL ONLY): the frozen C-15 injection corpus
// (tests/frozen/injection-corpus.json, written for C1) run against the
// C-13 ACTION tools' payload surface. Every attack string, carried in a
// ticket body or a subscribe payload, must be (a) flagged by layer-2
// screening, (b) stored byte-identical as DATA, and (c) execute nothing —
// the action store afterwards contains exactly the one artifact the
// caller filed, and no authorization is approved by any of it (layer 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const security = await import("../../packages/platform/src/security.ts");
const actions = await import("../../packages/platform/src/actions.ts");
const oauth = await import("../../packages/platform/src/oauth.ts");
const keys = await import("../../packages/platform/src/apikeys.ts");
const corpus = JSON.parse(readFileSync(new URL("./injection-corpus.json", import.meta.url), "utf8"));

const attackTexts = [
  ...corpus.attacks.filter((a) => a.text).map((a) => ({ id: a.id, text: a.text })),
];
// Multi-turn entries follow the corpus's own frozen semantics (C1 battery):
// the SEQUENCE is the attack — at least one turn must flag; the benign
// opening turn is stored as data like everything else.
const multiTurn = corpus.attacks.filter((a) => a.turns);

test("corpus attacks in ticket bodies: flagged, stored as data byte-identical, execute nothing", async () => {
  const store = actions.createActionStore();
  let filed = 0;
  for (const a of attackTexts) {
    const s = security.screenInput(a.text);
    assert.equal(s.flagged, true, `${a.id} must be flagged by layer-2 screening`);
    assert.equal(s.content, a.text, `${a.id}: screening never rewrites`);
    const t = store.createTicket({ requesterName: "Pat", requesterEmail: "pat@example.com", subject: "corpus", body: a.text, sourceRoute: "api-oauth" });
    filed++;
    assert.equal(t.body, a.text, `${a.id}: stored byte-identical as data`);
  }
  for (const a of multiTurn) {
    assert.ok(a.turns.some((t) => security.screenInput(t).flagged), `${a.id}: the sequence must flag at least once (frozen corpus semantics)`);
    for (const t of a.turns) {
      const tk = store.createTicket({ requesterName: "Pat", requesterEmail: "pat@example.com", subject: "corpus", body: t, sourceRoute: "api-oauth" });
      filed++;
      assert.equal(tk.body, t, `${a.id}: every turn stored byte-identical as data`);
    }
  }
  assert.equal(store.listTickets().length, filed, "exactly the filed tickets exist — no injection executed a second action");
  assert.deepEqual(store.buildSendList(), [], "no subscription was created or confirmed by any payload");
});

test("corpus attacks cannot reach the consent choke point (layer 4): approval still requires the human context", async () => {
  const store = keys.createKeyStore();
  const flow = oauth.createOAuthFlow({ keyStore: store });
  await flow.registerClient({ clientId: "c", name: "C", redirectUris: ["https://client.example/cb"], scopes: ["action:support_ticket"] });
  const { createHash } = await import("node:crypto");
  const challenge = createHash("sha256").update("verifier-corpus-0123456789-abcdefghij").digest("base64url");
  const req = await flow.beginAuthorization({ clientId: "c", redirectUri: "https://client.example/cb", responseType: "code", scope: ["action:support_ticket"], resource: oauth.RESOURCES.api, codeChallenge: challenge, codeChallengeMethod: "S256" });
  for (const a of [...attackTexts, ...multiTurn.flatMap((m) => m.turns.map((t, i) => ({ id: `${m.id}-turn${i + 1}`, text: t })))]) {
    await assert.rejects(() => flow.approveAuthorization(req.requestId, { accountId: a.text, turnstileVerified: a.text }), /consent|turnstile|human/i, `${a.id} as a consent context must be refused`);
  }
  const details = await flow.getConsentDetails(req.requestId);
  assert.equal(details.status, "pending", "the request remains undecided — no payload approved it");
});

test("benign corpus controls in ticket bodies are NOT flagged", async () => {
  for (const b of corpus.benign) {
    assert.equal(security.screenInput(b.text).flagged, false, `${b.id} must not flag`);
  }
});
