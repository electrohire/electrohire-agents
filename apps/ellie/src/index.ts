/**
 * ElectroHire Ellie service — Phase E (2026-10-25).
 *
 * The beta's OWN Ellie service (route (b) for E-06: a native service
 * behind the beta surfaces; production Ellie is never touched and
 * production electrohire.com is never a registered origin here).
 *
 * Surfaces:
 *  - the production-style site-key loader contract (/loader.js +
 *    /api/widget-config) for the website chat bubble,
 *  - the anonymous website chat (site key + Origin + Turnstile, all
 *    verified server-side; signed-in sessions only via the internal
 *    path the app BFF uses, gated by ELLIE_INTERNAL_KEY),
 *  - the credential-gated analysis API (shared gate, scope
 *    action:ellie_session, audience = this resource, RFC 8707),
 *  - /panel + /panel-assets/* — the panel shell; the real panel UI
 *    ships as a static bundle in apps/ellie/assets (panel/index.html +
 *    panel-assets/*, copied from the website repo's
 *    specs/002-ellie-platform/panel bundle, Phase E E-06). The Worker
 *    serves /panel itself for the framing headers, reading the page
 *    from the ASSETS binding; the hardcoded stub below remains only
 *    as a fallback if the bundle is ever missing at runtime.
 *
 * Uploads: stored through the Ellie store — bytes in the platform R2
 * bucket (binding FILES → electrohire-uploads, keys ellie/<session>/
 * <upload>) since the R2 storage swap of 2026-10-25 (migration 0011);
 * the D1 BLOB path remains the store's no-bucket fallback. Upload
 * list/read/delete routes sit behind the same session authorization
 * as the chat POST routes.
 *
 * Model calls: OpenRouter only, through @electrohire/platform's Ellie
 * engine. With OPENROUTER_API_KEY absent, sessions answer with the
 * honest not-configured fallback — never a crash, never a fake reply.
 *
 * THE APP SEAM (the agreed contract with the platform app's BFF,
 * apps/app/functions/api/ellie in the website repo — pinned by
 * tests/bff-seam.test.mjs here and the BFF seam battery there):
 * the BFF calls THIS service's public route shapes (/api/chat/*,
 * /api/analyses/*) with header `x-ellie-internal: <ELLIE_INTERNAL_KEY>`
 * plus `x-ellie-account-id: <validated platform account id>` on every
 * call. Session creation takes the account in the JSON body
 * ({ accountId }). Messages take { text }. There are NO /internal/*
 * routes; anything unmatched falls through to 404 { error: "not_found" }.
 *
 * Keep ELLIE_VERSION in sync with this package's package.json version.
 */
import {
  RateLimiter, globalKillOn, disabledTools, logRequest, identityLabel,
  extractCredential, authorizeCredential, storeFromEnv, scopeForApiAction,
  protectedResourceMetadata, RESOURCES, timingSafeEqual, ellie,
  type GuardEnv, type KeysEnv,
} from "@electrohire/platform";

const ELLIE_VERSION = "0.10.0";
const PANEL_URL = "https://ellie-beta.electrohire.com/panel";

type Env = GuardEnv & KeysEnv & ellie.EllieEnv & {
  TURNSTILE_SECRET_KEY?: string;
  ELLIE_INTERNAL_KEY?: string;
  ELLIE_FRAME_ANCESTORS?: string;
  ASSETS?: { fetch(req: Request): Promise<Response> };
};

const limiters = new Map<string, RateLimiter>();
const limiterFor = (env: Env) => {
  const key = env.RATE_LIMIT_PER_MINUTE ?? "120";
  if (!limiters.has(key)) limiters.set(key, RateLimiter.fromEnv(env));
  return limiters.get(key)!;
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const errBody = (e: unknown): { status: number; body: { error: string; detail: string } } => {
  if (e instanceof ellie.EllieError) {
    const status = e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : e.code === "not_staff" ? 403
      : e.code === "payload_hash_mismatch" ? 409 : e.code === "spend_cap_exceeded" ? 429
      : e.code === "unsupported_upload_type" || e.code === "upload_too_large" ? 400
      : e.code === "model_not_configured" || e.code === "cui_no_endpoint" || e.code === "model_unavailable" ? 503 : 400;
    return { status, body: { error: e.code, detail: e.message } };
  }
  return { status: 500, body: { error: "internal", detail: String((e as Error)?.message ?? e) } };
};

function seededSiteKeys(env: Env): ellie.SiteKeyRow[] {
  if (!env.ELLIE_SITE_KEYS_JSON) return [];
  try {
    return (JSON.parse(env.ELLIE_SITE_KEYS_JSON) as { key: string; origins?: string[]; enabled?: boolean }[])
      .map((k) => ({ key: k.key, origins: k.origins ?? [], enabled: k.enabled !== false, createdAt: 0 }));
  } catch { return []; }
}
async function lookupSiteKey(env: Env, key: string): Promise<ellie.SiteKeyRow | null> {
  const store = ellie.ellieStoreFromEnv(env);
  const fromStore = await store.getSiteKey(key).catch(() => null);
  if (fromStore) return fromStore;
  return seededSiteKeys(env).find((k) => k.key === key) ?? null;
}
async function frameAncestors(env: Env): Promise<string> {
  if (env.ELLIE_FRAME_ANCESTORS) return env.ELLIE_FRAME_ANCESTORS;
  const origins = new Set<string>();
  for (const k of seededSiteKeys(env)) for (const o of k.origins) origins.add(o);
  // The beta website origin is the built-in registered origin. The
  // production origin (electrohire.com itself) is NEVER registered.
  origins.add("https://beta.electrohire.com");
  return [...origins].join(" ");
}

const LOADER_JS = `(function () {
  var script = document.currentScript;
  var siteKey = script && script.dataset ? script.dataset.siteKey : null;
  if (!siteKey) return;
  var base = script.src ? new URL(script.src).origin : "";
  fetch(base + "/api/widget-config?siteKey=" + encodeURIComponent(siteKey), { headers: {} })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return; // unknown/disabled key: hide quietly
      var panel = document.createElement("iframe");
      panel.src = cfg.panelUrl;
      panel.title = "Ellie — ElectroHire AI technical analyst";
      panel.style.cssText = "position:fixed;right:16px;bottom:84px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 110px);border:0;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;z-index:2147483000;background:#fff";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Chat with Ellie";
      btn.setAttribute("aria-label", "Chat with Ellie, ElectroHire's AI technical analyst");
      btn.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;padding:12px 18px;border-radius:999px;border:0;cursor:pointer;font:600 14px system-ui;background:#0b5fff;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25)";
      window.EllieWidget = {
        open: function () { panel.style.display = "block"; },
        close: function () { panel.style.display = "none"; },
      };
      btn.addEventListener("click", function () {
        if (panel.style.display === "none") window.EllieWidget.open(); else window.EllieWidget.close();
      });
      document.body.appendChild(panel);
      document.body.appendChild(btn);
    })
    .catch(function () { /* loader hides quietly on any failure */ });
})();
`;

const PANEL_STUB = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ellie — ElectroHire AI technical analyst</title></head>
<body><main><h1>Ellie</h1>
<p>Hi, I'm Ellie — I'm an AI technical analyst at ElectroHire, not a person. The full chat panel ships with the website-side panel bundle into this app's assets; this stub keeps the route and its framing posture live in the meantime. You can talk to a human at any time through ElectroHire support.</p>
</main></body></html>
`;

/** Minimal Workers-compatible text extraction (no new dependency):
 * text formats decode directly; PDF text is pulled from the content
 * streams' string-showing operators on a best-effort basis; images are
 * NOT OCR'd — they are marked for the vision model at analysis time. */
function extractText(filename: string, bytes: Uint8Array): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "txt" || ext === "md" || ext === "csv") return new TextDecoder().decode(bytes).slice(0, 20000);
  if (ext === "pdf") {
    const raw = new TextDecoder("latin1").decode(bytes);
    const parts: string[] = [];
    for (const m of raw.matchAll(/\((?:\\.|[^\\()]){1,}\)\s*Tj/g)) parts.push(m[0].replace(/\)\s*Tj$/, "").slice(1).replace(/\\([()\\])/g, "$1"));
    for (const m of raw.matchAll(/\[([^\]]{1,2000})\]\s*TJ/g)) {
      for (const s of m[1].matchAll(/\((?:\\.|[^\\()]){1,}\)/g)) parts.push(s[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
    }
    return parts.join(" ").slice(0, 20000);
  }
  return ""; // images: no OCR (vision at analysis time)
}

async function verifyTurnstile(env: Env, token: string, ip: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, error: "turnstile_not_configured", status: 503 };
  }
  if (!token) return { ok: false, error: "turnstile_token_missing", status: 400 };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }).toString(),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success ? { ok: true } : { ok: false, error: "turnstile_failed", status: 403 };
  } catch {
    return { ok: false, error: "turnstile_unreachable", status: 502 };
  }
}

function isInternal(env: Env, req: Request): boolean {
  const presented = req.headers.get("x-ellie-internal");
  if (!presented || !env.ELLIE_INTERNAL_KEY) return false;
  return timingSafeEqual(presented, env.ELLIE_INTERNAL_KEY);
}

/** Session authorization for the chat routes: the per-session bearer
 * token, the internal path, or a credential whose account owns the
 * session. Returns the actor account id when resolved. */
async function authorizeSession(env: Env, req: Request, sessionId: string): Promise<{ ok: boolean; accountId?: string; status?: number }> {
  if (isInternal(env, req)) {
    // BFF calls carry the validated account in x-ellie-account-id; when
    // it is present the session must exist and belong to that account —
    // the internal key alone never widens access to another account's
    // session. Without the header the trusted-server behavior stands
    // (the panel-adjacent internal callers rely on it).
    const accountId = req.headers.get("x-ellie-account-id") ?? undefined;
    if (!accountId) return { ok: true };
    const store = ellie.ellieStoreFromEnv(env);
    const session = await store.getSession(sessionId).catch(() => null);
    if (!session) return { ok: false, status: 404 };
    if (session.accountId !== accountId) return { ok: false, status: 403 };
    return { ok: true, accountId };
  }
  const engine = ellie.ellieEngineFromEnv(env);
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const sessionToken = req.headers.get("x-ellie-session-token") ?? (bearer.startsWith("ehsess_") ? bearer : "");
  if (sessionToken) {
    return (await engine.verifySessionToken(sessionId, sessionToken)) ? { ok: true } : { ok: false, status: 401 };
  }
  if (bearer) {
    const store = ellie.ellieStoreFromEnv(env);
    const session = await store.getSession(sessionId).catch(() => null);
    if (!session) return { ok: false, status: 404 };
    if (!session.accountId) return { ok: false, status: 401 };
    const extracted = extractCredential({ headers: { authorization: auth }, url: req.url });
    if (extracted.error) return { ok: false, status: 400 };
    const credArg = extracted.secret ? { kind: "api_key", secret: extracted.secret }
      : extracted.oauthToken ? { kind: "oauth_token", token: extracted.oauthToken }
      : { kind: "oauth_double", token: extracted.token };
    const keyStore = await storeFromEnv(env as KeysEnv);
    const gate = await authorizeCredential(keyStore, credArg, { scope: "action:ellie_session", audience: RESOURCES.ellie });
    if (!gate.allowed || gate.accountId !== session.accountId) return { ok: false, status: 403 };
    return { ok: true, accountId: gate.accountId };
  }
  return { ok: false, status: 401 };
}

/** The shared gate for the analysis API: credential REQUIRED, scope
 * action:ellie_session, audience = the Ellie resource. */
async function gateAnalysis(env: Env, req: Request): Promise<{ ok: boolean; accountId?: string; status?: number; detail?: string }> {
  // The app-BFF path (see THE APP SEAM in the header): the internal key
  // plus the validated account context establishes WHO is acting; the
  // engine still enforces ownership, staff status, and payload hashes
  // on every analysis operation, exactly as for credential callers.
  if (isInternal(env, req)) {
    const accountId = req.headers.get("x-ellie-account-id");
    if (accountId) return { ok: true, accountId };
  }
  const extracted = extractCredential({ headers: { authorization: req.headers.get("authorization") ?? undefined }, url: req.url });
  if (extracted.error) return { ok: false, status: 400, detail: "Credentials are accepted in headers only." };
  const presented = extracted.secret ?? extracted.token ?? extracted.oauthToken;
  if (!presented) return { ok: false, status: 401, detail: "The analysis API requires an OAuth token or API key in the Authorization header holding action:ellie_session." };
  const credArg = extracted.secret ? { kind: "api_key", secret: extracted.secret }
    : extracted.oauthToken ? { kind: "oauth_token", token: extracted.oauthToken }
    : { kind: "oauth_double", token: extracted.token };
  const store = await storeFromEnv(env as KeysEnv);
  const gate = await authorizeCredential(store, credArg, { scope: scopeForApiAction(new URL(req.url).pathname) ?? "action:ellie_session", audience: RESOURCES.ellie });
  if (!gate.allowed) return { ok: false, status: /quota|rate limit/i.test(gate.reason) ? 429 : /unknown|revoked|expired/i.test(gate.reason) ? 401 : 403, detail: gate.reason };
  return { ok: true, accountId: gate.accountId };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const identity = await identityLabel(req);
    try {
      if (path === "/health") return json({ status: "ok", version: ELLIE_VERSION });
      if (globalKillOn(env)) return json({ error: "service_disabled", detail: "Ellie is switched off (global kill switch)." }, 503);
      if (!limiterFor(env).check(ip).allowed) return json({ error: "rate_limited", detail: "Per-IP rate limit reached. Slow down and retry shortly." }, 429);
      if (disabledTools(env).has("ellie")) return json({ error: "service_disabled", detail: "Ellie is switched off." }, 503);

      if (path === "/loader.js" && req.method === "GET") {
        return new Response(LOADER_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "content-security-policy": `frame-ancestors ${await frameAncestors(env)}` } });
      }
      if (path === "/panel" && req.method === "GET") {
        // The real panel bundle (apps/ellie/assets/panel/index.html) is
        // the served page; the Worker wraps it in the framing headers.
        // PANEL_STUB is only a fallback if the bundle is missing.
        let html = PANEL_STUB;
        if (env.ASSETS) {
          const asset = await env.ASSETS.fetch(new Request(new URL("/panel/index.html", url.origin))).catch(() => null);
          if (asset && asset.status === 200) html = await asset.text();
        }
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-ancestors ${await frameAncestors(env)}`, "x-frame-options": "SAMEORIGIN" } });
      }
      if (path.startsWith("/panel-assets/") && req.method === "GET") {
        if (env.ASSETS) {
          const res = await env.ASSETS.fetch(req);
          if (res.status !== 404) return res;
        }
        return new Response("Not found", { status: 404 });
      }

      if (path === "/api/widget-config" && req.method === "GET") {
        const siteKey = url.searchParams.get("siteKey") ?? "";
        const origin = req.headers.get("origin") ?? "";
        const record = siteKey ? await lookupSiteKey(env, siteKey) : null;
        if (!record || !record.enabled) return json({ enabled: false, panelUrl: PANEL_URL, origins: [], allowedOrigins: [] });
        const headers: Record<string, string> = {};
        if (origin && record.origins.includes(origin)) headers["access-control-allow-origin"] = origin;
        // The production panel contract's shape (copy audit §1.2:
        // enabled, allowedOrigins, surface, starterChips,
        // starterChipsLoggedIn, turnstileSiteKey, signupButtonEnabled,
        // expectedReplyCopy, privacyHref), served with BETA values:
        // expectedReplyCopy promises NO email reply and NO response
        // time (audit C-15: the beta's ticket email leg is its own;
        // owner decision 2026-10-25: no response-time promise).
        // `origins` + `panelUrl` are kept from the original loader
        // contract alongside the panel-contract names.
        const chips = ellie.starterPromptsFor().map((s) => ({ label: s.label, prompt: s.prompt }));
        return json({
          enabled: true,
          // The panel reads its site key from its own URL (the site-key
          // protocol the panel bundle implements), so the URL handed to
          // the loader carries the key it was configured with.
          panelUrl: `${PANEL_URL}?siteKey=${encodeURIComponent(siteKey)}`,
          origins: record.origins,
          allowedOrigins: record.origins,
          surface: "beta",
          starterChips: chips,
          starterChipsLoggedIn: chips,
          turnstileSiteKey: (env as { ELLIE_TURNSTILE_SITE_KEY?: string }).ELLIE_TURNSTILE_SITE_KEY ?? "",
          signupButtonEnabled: false,
          expectedReplyCopy: "Your message is filed with the ElectroHire team in the support inbox, with this conversation attached.",
          privacyHref: "/privacy",
        }, 200, headers);
      }

      const engine = ellie.ellieEngineFromEnv(env);

      // List the caller's sessions (the app seam; internal only — the
      // BFF validates the signed-in account and passes it as context).
      if (path === "/api/chat/sessions" && req.method === "GET") {
        if (!isInternal(env, req)) return json({ error: "internal_required", detail: "Listing sessions is an internal (app BFF) operation." }, 403);
        const accountId = url.searchParams.get("accountId") ?? req.headers.get("x-ellie-account-id") ?? "";
        if (!accountId) return json({ error: "account_required", detail: "accountId is required to list sessions." }, 400);
        const store = ellie.ellieStoreFromEnv(env);
        const rows = await store.listSessionsByAccount(accountId);
        const sessions = [];
        for (const s of rows) {
          const state = (s.state ?? {}) as { currentIndex?: number; answers?: Record<string, unknown> };
          const analysis = await store.getAnalysisBySession(s.id).catch(() => null);
          sessions.push({
            id: s.id, accountId: s.accountId, createdAt: s.createdAt, updatedAt: s.updatedAt,
            currentIndex: state.currentIndex ?? 0, answerCount: Object.keys(state.answers ?? {}).length,
            hasAnalysis: !!analysis,
          });
        }
        return json({ sessions });
      }

      if (path === "/api/chat/sessions" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        if (isInternal(env, req)) {
          const accountId = typeof body.accountId === "string" ? body.accountId : undefined;
          if (!accountId) return json({ error: "account_required", detail: "The internal session path requires an account context ({accountId})." }, 400);
          const created = await engine.createSession({ accountId, cuiFlag: !!body.cuiFlag, projectType: typeof body.projectType === "string" ? body.projectType : undefined });
          return json({ sessionId: created.session.id, disclosure: created.disclosure, starterPrompts: created.starterPrompts, outline: created.outline }, 201);
        }
        const siteKey = typeof body.siteKey === "string" ? body.siteKey : "";
        const record = siteKey ? await lookupSiteKey(env, siteKey) : null;
        if (!record || !record.enabled) return json({ error: "site_key_refused", detail: "This site key is unknown or disabled." }, 403);
        const origin = req.headers.get("origin") ?? "";
        // Registered embedding origins are allowed; so is this
        // service's OWN origin — the panel served from here is a
        // first-party page, and its calls carry the panel origin, not
        // the embedding site's. The site key + Turnstile still gate
        // creation either way.
        const firstParty = origin !== "" && origin === url.origin;
        if (record.origins.length && !firstParty && !record.origins.includes(origin)) {
          return json({ error: "origin_refused", detail: "This site key is not registered for that origin." }, 403);
        }
        const ts = await verifyTurnstile(env, typeof body.turnstileToken === "string" ? body.turnstileToken : "", ip);
        if (!ts.ok) {
          return json({ error: ts.error, detail: ts.error === "turnstile_not_configured"
            ? "Anonymous chat is not available yet: Turnstile verification is not configured on this service, so sessions cannot be created anonymously. Signed-in sessions are unaffected."
            : "Turnstile verification failed, so the session was not created." }, ts.status ?? 403);
        }
        const created = await engine.createSession({ siteKey, cuiFlag: !!body.cuiFlag, projectType: typeof body.projectType === "string" ? body.projectType : undefined });
        const headers: Record<string, string> = {};
        if (origin && record.origins.includes(origin)) headers["access-control-allow-origin"] = origin;
        return json({ sessionId: created.session.id, sessionToken: created.sessionToken, disclosure: created.disclosure, starterPrompts: created.starterPrompts, outline: created.outline }, 201, headers);
      }

      // The panel's plan read: the session's own latest analysis,
      // session-authorized (the credential-gated /api/analyses routes
      // remain the API path). Each read advances one generation step
      // while the analysis is generating, like getAnalysisAdvancing.
      const analysisReadMatch = path.match(/^\/api\/chat\/sessions\/([^/]+)\/analysis$/);
      if (analysisReadMatch && req.method === "GET") {
        const [, sessionId] = analysisReadMatch;
        const authz = await authorizeSession(env, req, sessionId);
        if (!authz.ok) return json({ error: "session_refused", detail: "This session token or credential does not own that session." }, authz.status ?? 401);
        try {
          const analysis = await engine.getAnalysisBySession(sessionId, { accountId: authz.accountId });
          return json({ analysis });
        } catch (e) {
          if (e instanceof ellie.EllieError && e.code === "not_found") {
            return json({ error: "analysis_not_ready", detail: "No analysis has been drafted for this session yet." }, 404);
          }
          throw e;
        }
      }

      // Read a session's message history (the app seam read; the BFF
      // re-reads after posting so the page renders from stored history).
      const messagesMatch = path.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
      if (messagesMatch && req.method === "GET") {
        const [, sessionId] = messagesMatch;
        const authz = await authorizeSession(env, req, sessionId);
        if (!authz.ok) return json({ error: "session_refused", detail: "This session token or credential does not own that session." }, authz.status ?? 401);
        const store = ellie.ellieStoreFromEnv(env);
        const session = await store.getSession(sessionId).catch(() => null);
        if (!session) return json({ error: "not_found", detail: "No such session." }, 404);
        const messages = await store.listMessages(sessionId);
        return json({ messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, flags: m.flags, createdAt: m.createdAt })) });
      }

      const chatMatch = path.match(/^\/api\/chat\/sessions\/([^/]+)\/(messages|uploads|finalize|escalate)$/);
      if (chatMatch && req.method === "POST") {
        const [, sessionId, action] = chatMatch;
        const authz = await authorizeSession(env, req, sessionId);
        if (!authz.ok) return json({ error: "session_refused", detail: "This session token or credential does not own that session." }, authz.status ?? 401);
        if (action === "messages") {
          const body = (await req.json().catch(() => ({}))) as { text?: string };
          const turn = await engine.handleMessage(sessionId, String(body.text ?? ""), { accountId: authz.accountId });
          return json({ reply: turn.reply, modelConfigured: turn.modelConfigured, outline: turn.outline, flagged: turn.flagged });
        }
        if (action === "uploads") {
          const form = await req.formData().catch(() => null);
          const file = form?.get("file");
          if (!(file instanceof File)) return json({ error: "file_required", detail: "Send the file as multipart form field 'file'." }, 400);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const extractedText = extractText(file.name, bytes);
          const upload = await engine.registerUpload(sessionId, { filename: file.name, mime: file.type || "application/octet-stream", size: file.size, bytes, extractedText });
          return json({ upload, extractedChars: extractedText.length, needsVision: ellie.IMAGE_TYPES.has((file.name.split(".").pop() ?? "").toLowerCase()) }, 201);
        }
        if (action === "finalize") {
          const fin = await engine.finalize(sessionId, { accountId: authz.accountId });
          return json({ analysisId: fin.analysisId, status: fin.status }, 201);
        }
        if (action === "escalate") {
          const body = (await req.json().catch(() => ({}))) as { note?: string };
          const r = await engine.escalate(sessionId, { note: body.note });
          return json({ ok: true, ticketId: r.ticketId });
        }
      }

      // Upload read-back + removal (R2 storage swap, 2026-10-25): the
      // same session authorization as the chat POST routes — a caller
      // can only ever see or remove its own session's uploads.
      const uploadsMatch = path.match(/^\/api\/chat\/sessions\/([^/]+)\/uploads(?:\/([^/]+))?$/);
      if (uploadsMatch && (req.method === "GET" || req.method === "DELETE")) {
        const [, sessionId, uploadId] = uploadsMatch;
        const authz = await authorizeSession(env, req, sessionId);
        if (!authz.ok) return json({ error: "session_refused", detail: "This session token or credential does not own that session." }, authz.status ?? 401);
        if (req.method === "GET" && !uploadId) {
          const store = ellie.ellieStoreFromEnv(env);
          const session = await store.getSession(sessionId).catch(() => null);
          if (!session) return json({ error: "not_found", detail: "No such session." }, 404);
          return json({ uploads: await store.listUploads(sessionId) });
        }
        if (req.method === "GET" && uploadId) {
          const got = await engine.getUpload(sessionId, uploadId);
          if (!got) return json({ error: "not_found", detail: "No such upload in this session." }, 404);
          return new Response(got.data as BodyInit, {
            headers: {
              "content-type": got.row.mime || "application/octet-stream",
              "content-disposition": `inline; filename="${got.row.filename.replace(/"/g, "")}"`,
              "cache-control": "private, no-store",
            },
          });
        }
        if (req.method === "DELETE" && uploadId) {
          const gone = await engine.removeUpload(sessionId, uploadId, { accountId: authz.accountId });
          if (!gone) return json({ error: "not_found", detail: "No such upload in this session." }, 404);
          return json({ ok: true, deleted: uploadId });
        }
      }

      // List the caller's analyses (the app seam read; same gate as
      // the analysis item routes below).
      if (path === "/api/analyses" && req.method === "GET") {
        const gate = await gateAnalysis(env, req);
        if (!gate.ok) return json({ error: "credential_refused", detail: gate.detail }, gate.status ?? 403);
        const store = ellie.ellieStoreFromEnv(env);
        const rows = await store.listAnalysesByAccount(gate.accountId!);
        return json({ analyses: rows.map((a) => ({ id: a.id, sessionId: a.sessionId, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt })) });
      }

      if (path === "/api/analyses" && req.method === "POST") {
        const gate = await gateAnalysis(env, req);
        if (!gate.ok) return json({ error: "credential_refused", detail: gate.detail }, gate.status ?? 403);
        const body = (await req.json().catch(() => ({}))) as { sessionId?: string; brief?: string };
        const handle = await engine.startAnalysis({ sessionId: body.sessionId, brief: body.brief }, { accountId: gate.accountId });
        return json({ analysisId: handle.analysisId, status: handle.status }, 201);
      }
      const analysisMatch = path.match(/^\/api\/analyses\/([^/]+)(\/(approve|edit))?$/);
      if (analysisMatch) {
        const [, analysisId, , sub] = analysisMatch;
        const gate = await gateAnalysis(env, req);
        if (!gate.ok) return json({ error: "credential_refused", detail: gate.detail }, gate.status ?? 403);
        if (req.method === "GET" && !sub) {
          const a = await engine.getAnalysisAdvancing(analysisId, { accountId: gate.accountId });
          return json(a);
        }
        if (req.method === "POST" && sub === "approve") {
          const body = (await req.json().catch(() => ({}))) as { section: string; version: number; payloadHash: string };
          // The approver is the credential's account — the engine checks
          // staff status and the payload hash of the exact version.
          await engine.getAnalysis(analysisId, { accountId: gate.accountId }).catch(() => null);
          const approved = await engine.approveOutput(analysisId, { section: body.section, version: body.version, payloadHash: body.payloadHash, approverAccountId: gate.accountId! });
          return json(approved);
        }
        if (req.method === "POST" && sub === "edit") {
          const body = (await req.json().catch(() => ({}))) as { section: string; content: unknown };
          await engine.getAnalysis(analysisId, { accountId: gate.accountId });
          const edited = await engine.editOutput(analysisId, { section: body.section, content: body.content });
          return json(edited);
        }
      }

      if (path === "/.well-known/oauth-protected-resource") {
        return json(protectedResourceMetadata(RESOURCES.ellie, "https://auth-beta.electrohire.com"));
      }
      logRequest({ identity, endpoint: path, status: 404 });
      return json({ error: "not_found", detail: `No route ${path}.` }, 404);
    } catch (e) {
      const { status, body } = errBody(e);
      logRequest({ identity, endpoint: path, status });
      return json(body, status);
    }
  },
};
