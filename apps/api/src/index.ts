import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  loadContent, loadBlogPosts, loadBlogPost, loadEvents, estimateCost, scopingChecklist, timelineCalculator,
  EstimateResponse, RateLimiter, globalKillOn, disabledTools, logRequest,
  identityLabel, screenInput, screenOutput, LocalAuditSink,
  extractCredential, authorizeCredential, storeFromEnv, scopeForApiPath,
  protectedResourceMetadata, RESOURCES, scopeForApiAction, createActionStore, ellie,
  type ContentEnv, type PublicContentEnv, type GuardEnv, type KeysEnv,
} from "@electrohire/platform";

/**
 * ElectroHire public API — Phase C1 (read API + tools), LOCAL TRACK build.
 *
 * Content is mirrored from the website's generated /content/v1.json (C-01):
 * no content fact is maintained in this repo. Blog and events endpoints
 * (WS-5, 2026-10-26) mirror the website's published-only public JSON
 * (/api/public/blog, /api/public/events) — the blog data spec 004 waited
 * for exists since Phase B / PB-4. Agent paths carry no challenge machinery (C-04 local half): no
 * Turnstile, no bot challenge anywhere in this Worker; protection is the
 * in-Worker rate limit + kill switches (C-05).
 *
 * Keep API_VERSION in sync with this package's package.json version.
 */
const API_VERSION = "0.7.0";

type Env = ContentEnv & PublicContentEnv & GuardEnv & KeysEnv & ellie.EllieEnv;
const AUTH_ISSUER = "https://auth-beta.electrohire.com";
/** C-13 action store (LOCAL stand-in for the website data layer's B-02/B-05
 * records + D-04 double opt-in — same behavior, in-memory home). */
const actionStore = createActionStore();
const app = new OpenAPIHono<{ Bindings: Env }>();
const limiter = new Map<string, RateLimiter>();
const audit = new LocalAuditSink(); // INTERIM sink — A-08 substrate wiring is in @electrohire/platform (guard.ts)
const limiterFor = (env: Env) => {
  const key = env.RATE_LIMIT_PER_MINUTE ?? "120";
  if (!limiter.has(key)) limiter.set(key, RateLimiter.fromEnv(env));
  return limiter.get(key)!;
};

function clientIp(c: any): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** C-15 layer 2 + C-05: screening + metadata logging around every request. */
app.use("*", async (c, next) => {
  const env = c.env as Env;
  const ip = clientIp(c);
  if (globalKillOn(env)) {
    logRequest({ identity: await identityLabel(c.req.raw), endpoint: c.req.path, status: 503 });
    return c.json({ error: "service_disabled", detail: "The API is switched off (global kill switch)." }, 503);
  }
  const rl = limiterFor(env).check(ip);
  if (!rl.allowed) {
    logRequest({ identity: await identityLabel(c.req.raw), endpoint: c.req.path, status: 429 });
    return c.json({ error: "rate_limited", detail: "Per-IP rate limit reached. Slow down and retry shortly." }, 429);
  }
  // C-08/C-10 (Phase C2): credentials travel in headers only — a key in a
  // URL is rejected before anything else reads it. A presented credential
  // (API key or OAuth test-double standing in for C3) passes the shared
  // authorization gate for the route's scope; no credential keeps C1's
  // public-read behavior.
  const extracted = extractCredential({ headers: { authorization: c.req.header("authorization") }, url: c.req.url });
  if (extracted.error) {
    logRequest({ identity: "credential-in-url", endpoint: c.req.path, status: 400 });
    return c.json({ error: "credential_in_url", detail: "Credentials are accepted in headers only — a key or token in a URL is rejected." }, 400);
  }
  const presented = extracted.secret ?? extracted.token ?? extracted.oauthToken;
  const credArg = extracted.secret ? { kind: "api_key", secret: extracted.secret }
    : extracted.oauthToken ? { kind: "oauth_token", token: extracted.oauthToken }
    : { kind: "oauth_double", token: extracted.token };
  // C-13/C-10 completion: EVERY scoped route passes the one shared gate —
  // read routes (when a credential is presented) and action routes (a
  // credential is REQUIRED; binding actions are never anonymous). The gate
  // call always names this resource as the audience, so an OAuth token
  // minted for another resource is refused here (RFC 8707).
  const actionScope = scopeForApiAction(c.req.path);
  if (actionScope && !presented) {
    logRequest({ identity: "anonymous", endpoint: c.req.path, status: 401 });
    c.header("WWW-Authenticate", `Bearer resource_metadata="${AUTH_ISSUER}/.well-known/oauth-protected-resource"`);
    return c.json({ error: "credential_required", detail: "Action endpoints require an OAuth token or API key in the Authorization header, holding the action scope. See the protected-resource metadata (RFC 9728)." }, 401);
  }
  if (presented) {
    const scope = actionScope ?? scopeForApiPath(c.req.path);
    if (scope) {
      const store = await storeFromEnv(env);
      const gate = await authorizeCredential(store, credArg, { scope, audience: RESOURCES.api });
      if (!gate.allowed) {
        const status = /quota|rate limit/i.test(gate.reason) ? 429 : /unknown|revoked|expired/i.test(gate.reason) ? 401 : 403;
        const slug = status === 429 ? "quota_exceeded" : status === 401 ? "credential_refused" : "scope_refused";
        logRequest({ identity: await identityLabel(c.req.raw), endpoint: c.req.path, status });
        return c.json({ error: slug, detail: gate.reason }, status as never);
      }
      (c as any).set("keyUsage", gate.usageCount);
      (c as any).set("gate", gate);
    }
  }
  // Input screening (layer 2): flag + log + raise scrutiny; never rewrite.
  let flagged: string[] = [];
  const probe = c.req.method === "POST" ? await c.req.raw.clone().text().catch(() => "") : new URL(c.req.url).search;
  if (probe) {
    const s = screenInput(probe);
    if (s.flagged) {
      flagged = s.reasons;
      await audit.append({ eventType: "security.screening", action: "input_flagged", ip, surface: "api", detail: { endpoint: c.req.path, reasons: s.reasons, payload: probe.slice(0, 2000) } });
    }
  }
  await next();
  if (flagged.length) c.header("x-scrutiny", "raised");
  const keyUsage = (c as any).get("keyUsage");
  if (typeof keyUsage === "number") c.header("x-eh-key-usage", String(keyUsage));
  logRequest({ identity: await identityLabel(c.req.raw), endpoint: c.req.path, status: c.res.status, ...(flagged.length ? { flagged } : {}) });
});

/** Per-tool kill switch + output screening (layer 5) for tool routes. */
const TOOL_PATHS: Record<string, string> = {
  "/v1/tools/cost-estimator": "cost-estimator",
  "/v1/tools/scoping-checklist": "scoping-checklist",
  "/v1/tools/timeline-calculator": "timeline-calculator",
};
app.use("/v1/tools/*", async (c, next) => {
  const name = TOOL_PATHS[c.req.path];
  if (name && disabledTools(c.env as Env).has(name)) {
    return c.json({ error: "tool_disabled", detail: `Tool ${name} is switched off.` }, 503);
  }
  await next();
  if (c.res.status === 200) {
    const body = await c.res.clone().text();
    const out = screenOutput(body);
    if (out.blocked) {
      console.log(JSON.stringify({ log: "eh-output-blocked", endpoint: c.req.path, reasons: out.reasons }));
      return c.json({ error: "output_blocked", detail: "Response withheld by output screening." }, 502);
    }
  }
});

const json = (schema: any, description: string) => ({ description, content: { "application/json": { schema } } });
const ErrorResponse = z.object({ error: z.string(), detail: z.string().optional() }).openapi("ErrorResponse");
const err = (description: string) => json(ErrorResponse, description);

const HealthResponse = z.object({ status: z.literal("ok"), version: z.string() }).openapi("HealthResponse");
app.openapi(createRoute({ method: "get", path: "/v1/health", tags: ["System"], summary: "Service health",
  responses: { 200: json(HealthResponse, "The API is up.") } }),
  (c) => c.json({ status: "ok" as const, version: API_VERSION }, 200));

const ContentResponse = z.object({
  contentVersion: z.number(), source: z.string(), site: z.any(), fees: z.any(), entities: z.array(z.any()), orgSameAs: z.array(z.string()),
}).openapi("SiteContentResponse");
app.openapi(createRoute({ method: "get", path: "/v1/content", tags: ["Content"], summary: "Site content (fees, entity facts, categories)",
  responses: { 200: json(ContentResponse, "Mirrored website content."), 502: err("Content source unavailable.") } }),
  async (c) => {
    const doc = await loadContent(c.env as Env);
    return c.json({ contentVersion: doc.schemaVersion, source: doc.source, site: doc.site, fees: doc.fees, entities: doc.entities, orgSameAs: doc.orgSameAs }, 200);
  });

const ServicesResponse = z.object({ categories: z.array(z.any()), pages: z.array(z.any()) }).openapi("ServicesResponse");
app.openapi(createRoute({ method: "get", path: "/v1/content/services", tags: ["Content"], summary: "Service categories and pages",
  responses: { 200: json(ServicesResponse, "Service categories and pages.") } }),
  async (c) => {
    const doc = await loadContent(c.env as Env);
    return c.json({ categories: doc.services.categories, pages: doc.services.pages }, 200);
  });

const FaqResponse = z.object({ total: z.number(), faqs: z.array(z.object({ page: z.string(), q: z.string(), a: z.string() })) }).openapi("FaqResponse");
app.openapi(createRoute({ method: "get", path: "/v1/faq", tags: ["Content"], summary: "FAQ (optionally ?page=<slug>)",
  request: { query: z.object({ page: z.string().optional() }) },
  responses: { 200: json(FaqResponse, "FAQ entries from the website source."), 404: err("Unknown FAQ page.") } }),
  async (c) => {
    const doc = await loadContent(c.env as Env);
    const page = c.req.query("page");
    if (page) {
      const items = doc.faqs[page];
      if (!items) return c.json({ error: "unknown_page", detail: `No FAQ page named ${page}.` }, 404);
      return c.json({ total: items.length, faqs: items.map((f) => ({ page, ...f })) }, 200);
    }
    const all = Object.entries(doc.faqs).flatMap(([p, items]) => items.map((f) => ({ page: p, ...f })));
    return c.json({ total: all.length, faqs: all }, 200);
  });

const PricingResponse = z.object({ fees: z.any(), pods: z.any(), ukHub: z.any() }).openapi("PricingResponse");
app.openapi(createRoute({ method: "get", path: "/v1/pricing", tags: ["Content"], summary: "Pricing: marketplace fees, pod presentation (no pod price — deliberately absent, as on the site), UK Hub tiers",
  responses: { 200: json(PricingResponse, "Pricing facts mirrored from the website.") } }),
  async (c) => {
    const doc = await loadContent(c.env as Env);
    return c.json({ fees: doc.fees, pods: doc.pods, ukHub: doc.ukHub }, 200);
  });

const EstimatorBody = z.object({
  needs: z.array(z.string()).min(1), productType: z.string().optional(), stage: z.string().optional(), units: z.string().optional(),
}).openapi("EstimatorRequest");
const EstimateResp = EstimateResponse.openapi("EstimateResponse");
app.openapi(createRoute({ method: "post", path: "/v1/tools/cost-estimator", tags: ["Tools"], summary: "Cost estimator — range + assumptions, never a bare number",
  request: { body: { content: { "application/json": { schema: EstimatorBody } }, required: true } },
  responses: { 200: json(EstimateResp, "Planning estimate."), 400: err("Invalid input."), 503: err("Tool disabled.") } }),
  async (c) => {
    const doc = await loadContent(c.env as Env);
    try { return c.json(estimateCost(doc, await c.req.json()), 200); }
    catch (e: any) { return c.json({ error: "invalid_input", detail: String(e?.message ?? e) }, 400); }
  });

const ScopingBody = z.object({ productType: z.string().optional(), needs: z.array(z.string()).min(1) }).openapi("ScopingRequest");
const ScopingResponse = z.object({ productType: z.string(), groups: z.array(z.any()), assumptions: z.array(z.string()).min(1) }).openapi("ScopingResponse");
app.openapi(createRoute({ method: "post", path: "/v1/tools/scoping-checklist", tags: ["Tools"], summary: "Scoping checklist generator",
  request: { body: { content: { "application/json": { schema: ScopingBody } }, required: true } },
  responses: { 200: json(ScopingResponse, "Checklist."), 400: err("Invalid input."), 503: err("Tool disabled.") } }),
  async (c) => {
    try { return c.json(scopingChecklist(await c.req.json()), 200); }
    catch (e: any) { return c.json({ error: "invalid_input", detail: String(e?.message ?? e) }, 400); }
  });

const TimelineBody = z.object({ needs: z.array(z.string()).min(1), stage: z.string().optional() }).openapi("TimelineRequest");
const TimelineResponse = z.object({ stages: z.array(z.any()), totalWeeks: z.object({ low: z.number(), high: z.number() }), assumptions: z.array(z.string()).min(1) }).openapi("TimelineResponse");
app.openapi(createRoute({ method: "post", path: "/v1/tools/timeline-calculator", tags: ["Tools"], summary: "Timeline calculator — stage ranges with waiting time counted",
  request: { body: { content: { "application/json": { schema: TimelineBody } }, required: true } },
  responses: { 200: json(TimelineResponse, "Timeline."), 400: err("Invalid input."), 503: err("Tool disabled.") } }),
  async (c) => {
    const doc = await loadContent(c.env as Env);
    try { return c.json(timelineCalculator(doc, await c.req.json()), 200); }
    catch (e: any) { return c.json({ error: "invalid_input", detail: String(e?.message ?? e) }, 400); }
  });

// RFC 9728 protected-resource metadata for this API resource (C-13).
app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(RESOURCES.api, AUTH_ISSUER)));

const SubscribeBody = z.object({ email: z.string() }).openapi("NewsletterSubscribeRequest");
const SubscribeResponse = z.object({ ok: z.boolean(), status: z.string(), message: z.string() }).openapi("NewsletterSubscribeResponse");
app.openapi(createRoute({ method: "post", path: "/v1/actions/newsletter-subscribe", tags: ["Actions"], summary: "Newsletter subscribe (OAuth action) — double opt-in: the address stays pending until the person clicks the confirmation email link; the response never reveals whether the address was already subscribed",
  request: { body: { content: { "application/json": { schema: SubscribeBody } }, required: true } },
  responses: { 200: json(SubscribeResponse, "Neutral subscribe response."), 401: err("Credential required or refused."), 403: err("Scope or audience refused.") } }),
  async (c) => {
    const gate = (c as any).get("gate");
    const body = await c.req.json();
    // C-15 layer 2 already screened + logged this payload in middleware;
    // the address is stored as DATA by the action store, never executed.
    const r = actionStore.subscribe({ email: String(body.email ?? ""), source: "api-oauth" });
    // The confirmation token travels ONLY in the confirmation email
    // (D-04) — it is never returned to the calling agent.
    void gate;
    return c.json(r.response, 200);
  });

const TicketBody = z.object({ subject: z.string(), body: z.string(), context: z.string().optional(), isDataRequest: z.boolean().optional() }).openapi("SupportTicketRequest");
const TicketResponse = z.object({ id: z.string(), status: z.string(), subject: z.string() }).openapi("SupportTicketResponse");
app.openapi(createRoute({ method: "post", path: "/v1/actions/support-ticket", tags: ["Actions"], summary: "Open a support ticket (OAuth action) — files into the same inbox, with the same fields, as the site contact form (B-05); the requester is the token's owner",
  request: { body: { content: { "application/json": { schema: TicketBody } }, required: true } },
  responses: { 200: json(TicketResponse, "The filed ticket."), 401: err("Credential required or refused."), 403: err("Scope or audience refused.") } }),
  async (c) => {
    const gate = (c as any).get("gate");
    const body = await c.req.json();
    const t = actionStore.createTicket({
      requesterName: gate?.accountId ?? "oauth-user", requesterEmail: gate?.accountId ?? "oauth-user",
      subject: String(body.subject ?? ""), body: String(body.body ?? ""), context: String(body.context ?? ""),
      isDataRequest: !!body.isDataRequest, sourceRoute: "api-oauth",
    });
    return c.json({ id: t.id, status: t.status, subject: t.subject }, 200);
  });

// Phase E (2026-10-25): the Ellie backend exists (packages/platform
// ellie engine + apps/ellie), so the C-13 Ellie actions ship here —
// the asynchronous pattern: starting an analysis returns a handle, the
// status route collects the result (advancing generation one section
// per read); no API call waits on Ellie thinking. Both routes pass the
// shared gate in middleware with scope action:ellie_session (see
// scopeForApiAction); the handlers add the cross-user check (E-08): a
// credential reaches only its own account's analyses.
const EllieSessionBody = z.object({ sessionId: z.string().optional(), brief: z.string().optional() }).openapi("EllieSessionRequest");
const EllieSessionResponse = z.object({ analysisId: z.string(), status: z.string() }).openapi("EllieSessionResponse");
app.openapi(createRoute({ method: "post", path: "/v1/actions/ellie-session", tags: ["Actions"], summary: "Start an Ellie analysis (action — requires action:ellie_session) from a brief or an existing Ellie session id; returns a handle immediately (C-13 async pattern)",
  request: { body: { content: { "application/json": { schema: EllieSessionBody } }, required: true } },
  responses: { 200: json(EllieSessionResponse, "The analysis handle."), 401: err("Credential required or refused."), 403: err("Scope, audience, or cross-user refused.") } }),
  async (c) => {
    const gate = (c as any).get("gate");
    const body = await c.req.json().catch(() => ({}));
    try {
      const engine = ellie.ellieEngineFromEnv(c.env as Env);
      const handle = await engine.startAnalysis({ sessionId: body.sessionId, brief: body.brief }, { accountId: gate?.accountId });
      return c.json({ analysisId: handle.analysisId, status: handle.status }, 200);
    } catch (e: any) {
      const status = e instanceof ellie.EllieError && e.code === "forbidden" ? 403 : e instanceof ellie.EllieError && e.code === "not_found" ? 404 : 400;
      return c.json({ error: e instanceof ellie.EllieError ? e.code : "ellie_failed", detail: String(e?.message ?? e) }, status as never);
    }
  });

const EllieAnalysisResponse = z.object({ id: z.string(), sessionId: z.string().nullable(), status: z.string(), currentStep: z.number(), sections: z.array(z.any()) }).openapi("EllieAnalysisResponse");
app.openapi(createRoute({ method: "get", path: "/v1/ellie/analyses/{id}", tags: ["Actions"], summary: "Ellie analysis status/result — advances one generation step per read while generating; only the owning account's credential may read it (E-08)",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: json(EllieAnalysisResponse, "The analysis and its sections."), 401: err("Credential required or refused."), 403: err("Scope, audience, or cross-user refused."), 404: err("Analysis not found.") } }),
  async (c) => {
    const gate = (c as any).get("gate");
    try {
      const engine = ellie.ellieEngineFromEnv(c.env as Env);
      const a = await engine.getAnalysisAdvancing(c.req.param("id"), { accountId: gate?.accountId });
      return c.json({ id: a.id, sessionId: a.sessionId, status: a.status, currentStep: a.currentStep, sections: a.sections }, 200);
    } catch (e: any) {
      const status = e instanceof ellie.EllieError && e.code === "forbidden" ? 403 : e instanceof ellie.EllieError && e.code === "not_found" ? 404 : 400;
      return c.json({ error: e instanceof ellie.EllieError ? e.code : "ellie_failed", detail: String(e?.message ?? e) }, status as never);
    }
  });

// WS-5 (2026-10-26): blog data has existed since Phase B (B-03) and the
// PB-4 wave, so spec 004's blog endpoints ship now. The website serves
// published posts as public JSON (/api/public/blog) and this API mirrors
// it — published posts only; a draft has no public form on any surface.
// Events (PB-4, G14) ride the same pattern. Scopes: read:blog for the
// blog routes, read:events for the events route (scopeForApiPath).
const BlogListResponse = z.object({ total: z.number(), posts: z.array(z.any()) }).openapi("BlogListResponse");
app.openapi(createRoute({ method: "get", path: "/v1/blog", tags: ["Content"], summary: "Blog posts and checklists (published only) — metadata; full text at /v1/blog/{slug}",
  responses: { 200: json(BlogListResponse, "Published posts, newest first."), 502: err("Blog source unavailable.") } }),
  async (c) => c.json(await loadBlogPosts(c.env as Env), 200));

const BlogPostResponse = z.object({ slug: z.string(), title: z.string(), body: z.string() }).passthrough().openapi("BlogPostResponse");
app.openapi(createRoute({ method: "get", path: "/v1/blog/{slug}", tags: ["Content"], summary: "One published blog post, full text",
  request: { params: z.object({ slug: z.string() }) },
  responses: { 200: json(BlogPostResponse, "The published post."), 404: err("No published post with that slug — drafts and unpublished posts have no public form."), 502: err("Blog source unavailable.") } }),
  async (c) => {
    const post = await loadBlogPost(c.env as Env, c.req.param("slug"));
    if (!post) return c.json({ error: "not_found", detail: "No published post with that slug. Drafts and unpublished posts have no public form." }, 404);
    return c.json(post, 200);
  });

const EventsResponse = z.object({ total: z.number(), events: z.array(z.any()) }).openapi("EventsResponse");
app.openapi(createRoute({ method: "get", path: "/v1/events", tags: ["Content"], summary: "Events (published only)",
  responses: { 200: json(EventsResponse, "Published events, newest first."), 502: err("Events source unavailable.") } }),
  async (c) => c.json(await loadEvents(c.env as Env), 200));

app.get("/llms.txt", (c) => c.text(
  `# ElectroHire API (beta)\n\nREST API: https://api-beta.electrohire.com (OpenAPI 3.1 at /openapi.json)\nMCP server (Streamable HTTP): https://mcp-beta.electrohire.com/mcp\nRead surfaces: site content, services, FAQ, pricing, blog (published posts and checklists), events, plus the cost estimator, scoping checklist, and timeline calculator tools.\nAction surfaces (a personal API key or OAuth 2.1 token with the action scope is required): start an Ellie analysis and read its result, subscribe to the newsletter (double opt-in), open a support ticket. No payments run through this API, in any phase.\nNo Turnstile or bot challenge on agent paths, by design.\n`));

app.notFound((c) => c.json({ error: "not_found", detail: `No route ${c.req.path}.` }, 404));
app.onError((e, c) => { console.log(JSON.stringify({ log: "eh-error", endpoint: c.req.path, message: String((e as Error)?.message ?? e) })); return c.json({ error: "upstream", detail: String((e as Error)?.message ?? e) }, 502); });

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "ElectroHire API", version: API_VERSION,
    description: "Public read + tools API for ElectroHire (beta). Static content is mirrored from the website's generated /content/v1.json (C-01); blog posts and events are mirrored from the website's published-only public JSON. Estimates always return a range with assumptions — never a bare number. Action endpoints require a personal API key or OAuth 2.1 token holding the action scope. No payments run through this API.",
  },
});

export default app;
