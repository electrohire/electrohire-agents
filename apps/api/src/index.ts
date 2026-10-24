import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  loadContent, estimateCost, scopingChecklist, timelineCalculator,
  EstimateResponse, RateLimiter, globalKillOn, disabledTools, logRequest,
  identityLabel, screenInput, screenOutput, LocalAuditSink,
  type ContentEnv, type GuardEnv,
} from "@electrohire/platform";

/**
 * ElectroHire public API — Phase C1 (read API + tools), LOCAL TRACK build.
 *
 * Content is mirrored from the website's generated /content/v1.json (C-01):
 * no content fact is maintained in this repo. Blog endpoints are ABSENT
 * until Phase B data exists (C-02) — an absent endpoint, not a fake empty
 * one. Agent paths carry no challenge machinery (C-04 local half): no
 * Turnstile, no bot challenge anywhere in this Worker; protection is the
 * in-Worker rate limit + kill switches (C-05).
 *
 * Keep API_VERSION in sync with this package's package.json version.
 */
const API_VERSION = "0.2.0";

type Env = ContentEnv & GuardEnv;
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

// NOTE (C-02): no /v1/blog route is registered. Blog data does not exist
// until Phase B (B-03); an absent endpoint is honest, a fake empty one is not.

app.get("/llms.txt", (c) => c.text(
  `# ElectroHire API (beta)\n\nREST API: https://api-beta.electrohire.com (OpenAPI 3.1 at /openapi.json)\nMCP server (Streamable HTTP): https://mcp-beta.electrohire.com/mcp\nHostnames are pending the deploy remedy — see the C1 run record. No Turnstile or bot challenge on agent paths, by design.\n`));

app.notFound((c) => c.json({ error: "not_found", detail: `No route ${c.req.path}.` }, 404));
app.onError((e, c) => { console.log(JSON.stringify({ log: "eh-error", endpoint: c.req.path, message: String((e as Error)?.message ?? e) })); return c.json({ error: "upstream", detail: String((e as Error)?.message ?? e) }, 502); });

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "ElectroHire API", version: API_VERSION,
    description: "Public read + tools API for ElectroHire. Content is mirrored from the website's generated /content/v1.json (C-01). Estimates always return a range with assumptions — never a bare number. LOCAL TRACK draft build (C1): proven locally, awaiting served acceptance after the deploy credential remedy.",
  },
});

export default app;
