// Ellie panel battery (2026-10-25, panel-bundle fix — NOT frozen).
// Pins the SERVED CONTENT of /panel, not just its status: the route
// shipped a 548-byte hardcoded stub for a full day because the only
// check on file verified HTTP 200. These assertions fail on the stub
// (no #messages, no #composer, no panel-assets) and pass only on the
// real bundle (apps/ellie/assets, copied from the website repo's
// specs/002-ellie-platform/panel — byte-identical source).
//
// Run: NODE_OPTIONS=--experimental-transform-types node --test tests/panel.test.mjs
// (transform mode is needed to import the Worker entry, which pulls the
// full @electrohire/platform index; the frozen engine battery imports
// the ellie subpath only and runs in strip mode.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const worker = (await import("../apps/ellie/src/index.ts")).default;
const ASSETS_DIR = new URL("../apps/ellie/assets/", import.meta.url);

const WEB_KEY = "pk_live_paneltest_fixture";
const env = {
  ELLIE_SITE_KEYS_JSON: JSON.stringify([
    { key: WEB_KEY, origins: ["https://beta.electrohire.com"], enabled: true },
  ]),
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname.replace(/^\//, "");
      try {
        const body = await readFile(join(ASSETS_DIR.pathname, path));
        return new Response(body, { status: 200 });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
const get = (path, headers = {}) =>
  worker.fetch(new Request(`https://ellie-beta.electrohire.com${path}`, { headers }), env);

test("GET /panel serves the real panel bundle, not the stub", async () => {
  const res = await get("/panel");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.length > 3000, `panel page should be the full bundle (got ${html.length} bytes)`);
  for (const marker of ['id="messages"', 'id="composer"', 'id="input"', 'id="starters"', 'id="plan"', 'id="outline"', "/panel-assets/panel.js", "/panel-assets/panel.css"]) {
    assert.ok(html.includes(marker), `panel HTML is missing ${marker}`);
  }
  assert.ok(!html.includes("this stub keeps the route"), "stub text must never be served when the bundle is present");
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors/);
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("GET /panel-assets/* resolves the bundle files", async () => {
  for (const [path, marker] of [
    ["/panel-assets/panel.js", "/api/chat/sessions"],
    ["/panel-assets/panel.css", ".ep-"],
    ["/panel-assets/ellie.css", ".ellie-"],
    ["/panel-assets/ellie-aurora.css", ".ellie-"],
  ]) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} should resolve`);
    const body = await res.text();
    assert.ok(body.length > 1000, `${path} should be the real file (got ${body.length} bytes)`);
    assert.ok(body.includes(marker), `${path} is missing its marker ${marker}`);
  }
  const missing = await get("/panel-assets/does-not-exist.js");
  assert.equal(missing.status, 404);
});

test("widget-config hands the panel its site key in panelUrl", async () => {
  const res = await get(`/api/widget-config?siteKey=${WEB_KEY}`, { origin: "https://beta.electrohire.com" });
  assert.equal(res.status, 200);
  const cfg = await res.json();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.panelUrl, `https://ellie-beta.electrohire.com/panel?siteKey=${WEB_KEY}`);
  const unknown = await get("/api/widget-config?siteKey=pk_live_unknown");
  assert.equal((await unknown.json()).enabled, false);
});

// --- The panel's served contract (the 2026-10-25 reconciliation) ---
// The bundle was first written against the spec's contract (no
// Turnstile token, { content } messages, /upload, /api/analyses) that
// the service never implemented, so the served panel could not start
// a session. These tests pin the REAL anonymous-panel protocol end to
// end at the Worker layer: first-party origin + Turnstile-gated
// creation, session-token message round-trip, session analysis read.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://challenges.cloudflare.com/turnstile")) {
    return new Response(JSON.stringify({ success: true }), { headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
const envTs = { ...env, TURNSTILE_SECRET_KEY: "test-secret-value" };
const post = (path, body, headers = {}) =>
  worker.fetch(new Request(`https://ellie-beta.electrohire.com${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }), envTs);

test("panel protocol: session creation from the panel's own origin, with a Turnstile token", async () => {
  const res = await post("/api/chat/sessions",
    { siteKey: WEB_KEY, turnstileToken: "tok" },
    { origin: "https://ellie-beta.electrohire.com" });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.sessionId && typeof body.sessionToken === "string" && body.sessionToken.length > 10);
  assert.match(body.disclosure, /AI/);
  assert.ok(Array.isArray(body.outline?.intake) && body.outline.intake.length > 0);
});

test("panel protocol: registered embedding origin still creates; unregistered origin is refused", async () => {
  const ok = await post("/api/chat/sessions",
    { siteKey: WEB_KEY, turnstileToken: "tok" },
    { origin: "https://beta.electrohire.com" });
  assert.equal(ok.status, 201);
  const no = await post("/api/chat/sessions",
    { siteKey: WEB_KEY, turnstileToken: "tok" },
    { origin: "https://evil.example" });
  assert.equal(no.status, 403);
  assert.equal((await no.json()).error, "origin_refused");
});

test("panel protocol: creation without a Turnstile token is refused as token-missing", async () => {
  const res = await post("/api/chat/sessions", { siteKey: WEB_KEY }, { origin: "https://ellie-beta.electrohire.com" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "turnstile_token_missing");
});

test("panel protocol: message round-trip on the session token; analysis read is an honest 404 before finalize", async () => {
  const created = await (await post("/api/chat/sessions",
    { siteKey: WEB_KEY, turnstileToken: "tok" },
    { origin: "https://ellie-beta.electrohire.com" })).json();
  const sid = created.sessionId;
  const tok = { "x-ellie-session-token": created.sessionToken };
  const msg = await post(`/api/chat/sessions/${sid}/messages`, { text: "A battery-powered sensor node" }, tok);
  assert.equal(msg.status, 200);
  const msgBody = await msg.json();
  assert.ok(typeof msgBody.reply === "string" && msgBody.reply.length > 0);
  assert.equal(msgBody.modelConfigured, false); // no OPENROUTER_API_KEY in this env: honest fallback, not a fake
  const bad = await post(`/api/chat/sessions/${sid}/messages`, { text: "hi" }, { "x-ellie-session-token": "ehsess_wrong" });
  assert.equal(bad.status, 401);
  const noAnalysis = await worker.fetch(new Request(`https://ellie-beta.electrohire.com/api/chat/sessions/${sid}/analysis`, { headers: tok }), envTs);
  assert.equal(noAnalysis.status, 404);
  assert.equal((await noAnalysis.json()).error, "analysis_not_ready");
  const badRead = await worker.fetch(new Request(`https://ellie-beta.electrohire.com/api/chat/sessions/${sid}/analysis`, { headers: { "x-ellie-session-token": "ehsess_wrong" } }), envTs);
  assert.equal(badRead.status, 401);
});

test("the shipped bundle speaks the served contract (static pins)", async () => {
  const js = await readFile(new URL("../apps/ellie/assets/panel-assets/panel.js", import.meta.url), "utf8");
  for (const pin of ["x-ellie-session-token", "turnstileToken", "/uploads", "/analysis", "data.reply", "body: JSON.stringify({ text: text })"]) {
    assert.ok(js.includes(pin), `panel.js is missing the contract pin: ${pin}`);
  }
  const html = await readFile(new URL("../apps/ellie/assets/panel/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("challenges.cloudflare.com/turnstile"), "panel page must load the Turnstile script");
  assert.ok(html.includes('id="turnstile"'), "panel page must carry the Turnstile container");
});

test("GET /panel falls back to the stub only when the bundle is missing", async () => {
  const bare = { ...env, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const res = await worker.fetch(new Request("https://ellie-beta.electrohire.com/panel"), bare);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("not a person"), "fallback keeps the disclosure-first stub, never a blank or a fake panel");
});
