import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  loadContent, estimateCost, scopingChecklist, timelineCalculator,
  RateLimiter, globalKillOn, disabledTools, logRequest, identityLabel,
  screenInput, screenOutput, LocalAuditSink,
  extractCredential, authorizeCredential, storeFromEnv, scopeForMcpTool,
  type ContentEnv, type GuardEnv, type KeysEnv,
} from "@electrohire/platform";

/**
 * ElectroHire remote MCP server — Phase C1 (content tools), LOCAL TRACK.
 * Streamable HTTP, stateless per-request servers. Tools mirror the C-02
 * REST endpoints over the same mirrored content (C-01/C-03). No binding
 * (state-changing) tools exist in C1 — C-15 layer 4 (consent choke point)
 * is satisfied by ABSENCE and is not claimed as tested. No Turnstile or bot
 * challenge anywhere on this path (C-04 local half).
 *
 * Keep MCP_SERVER_VERSION in sync with this package's package.json version.
 */
const MCP_SERVER_VERSION = "0.3.0";

type Env = ContentEnv & GuardEnv & KeysEnv;
type Cred = { kind: "api_key"; secret: string } | { kind: "oauth_double"; token: string } | null;
const audit = new LocalAuditSink(); // INTERIM — A-08 wiring in @electrohire/platform guard.ts
const limiters = new Map<string, RateLimiter>();
const limiterFor = (env: Env) => {
  const key = env.RATE_LIMIT_PER_MINUTE ?? "120";
  if (!limiters.has(key)) limiters.set(key, RateLimiter.fromEnv(env));
  return limiters.get(key)!;
};

function textResult(value: unknown) {
  const text = JSON.stringify(value);
  const out = screenOutput(text); // C-15 layer 5
  if (out.blocked) {
    console.log(JSON.stringify({ log: "eh-output-blocked", surface: "mcp", reasons: out.reasons }));
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "output_blocked", detail: "Result withheld by output screening." }) }], isError: true };
  }
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Shared tool wrapper: per-tool kill switch (C-05), layer-2 input
 * screening (flag + audit, never rewrite), layer-5 output screening.
 * Tools register with server.registerTool DIRECTLY below so the parity
 * scanner (tools/parity-manifest.mjs) sees the true tool surface (C-14).
 */
async function guarded(env: Env, name: string, args: unknown, run: () => Promise<unknown>, cred: Cred = null) {
  const disabled = disabledTools(env);
  if (disabled.has(name) || disabled.has(name.replace("electrohire_", "").replaceAll("_", "-"))) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "tool_disabled", detail: `Tool ${name} is switched off.` }) }], isError: true };
  }
  // C-15 layer 3 + C-10 (Phase C2): a presented credential (key or OAuth
  // test-double) is scope-checked in the dispatch path, before the tool
  // handler runs — the same shared gate the REST API passes. No credential
  // keeps C1's public-read behavior.
  if (cred) {
    const store = await storeFromEnv(env);
    const gate = await authorizeCredential(store, cred, { scope: scopeForMcpTool(name) });
    if (!gate.allowed) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "scope_refused", detail: gate.reason }) }], isError: true };
    }
  }
  const probe = JSON.stringify(args ?? {});
  const s = screenInput(probe);
  if (s.flagged) {
    await audit.append({ eventType: "security.screening", action: "input_flagged", surface: "mcp", detail: { tool: name, reasons: s.reasons, payload: probe.slice(0, 2000) } });
  }
  try { return textResult(await run()); }
  catch (e: any) { return { content: [{ type: "text" as const, text: JSON.stringify({ error: "tool_failed", detail: String(e?.message ?? e) }) }], isError: true }; }
}

function createServer(env: Env, cred: Cred = null): McpServer {
  const g = (name: string, args: unknown, run: () => Promise<unknown>) => guarded(env, name, args, run, cred);
  const server = new McpServer({ name: "electrohire", version: MCP_SERVER_VERSION });

  server.registerTool("electrohire_get_site_content", {
    title: "Get site content",
    description: "Fees, entity facts, categories, and navigation — mirrored from the ElectroHire website's own content source.",
    inputSchema: {},
  }, async (args) => g("electrohire_get_site_content", args, async () => {
    const d = await loadContent(env);
    return { contentVersion: d.schemaVersion, source: d.source, site: d.site, fees: d.fees, entities: d.entities, orgSameAs: d.orgSameAs };
  }));

  server.registerTool("electrohire_get_faq", {
    title: "Get FAQ",
    description: "Frequently asked questions from the website, optionally for one page (home, marketplace, pods, pricing, ellie, contact, startup-builder, tools).",
    inputSchema: { page: z.string().optional().describe("Page slug; omit for all pages.") },
  }, async (args) => g("electrohire_get_faq", args, async () => {
    const d = await loadContent(env);
    const page = (args as { page?: string }).page;
    if (page) {
      const items = d.faqs[page];
      if (!items) throw new Error(`Unknown FAQ page: ${page}`);
      return { total: items.length, faqs: items.map((f) => ({ page, ...f })) };
    }
    const all = Object.entries(d.faqs).flatMap(([p, items]) => items.map((f) => ({ page: p, ...f })));
    return { total: all.length, faqs: all };
  }));

  server.registerTool("electrohire_get_pricing", {
    title: "Get pricing",
    description: "Marketplace fees, pod presentation (no pod price exists — it is deliberately unpublished, as on the site), and UK Contractors Hub tiers.",
    inputSchema: {},
  }, async (args) => g("electrohire_get_pricing", args, async () => {
    const d = await loadContent(env);
    return { fees: d.fees, pods: d.pods, ukHub: d.ukHub };
  }));

  server.registerTool("electrohire_site_search", {
    title: "Search ElectroHire site content",
    description: "Search the ElectroHire FAQ, categories, and pod presentation. Returns real mirrored content.",
    inputSchema: { query: z.string().min(1).describe("What to search for.") },
  }, async (args) => g("electrohire_site_search", args, async () => {
    const d = await loadContent(env);
    const query = (args as { query: string }).query;
    const q = query.toLowerCase();
    const results: { kind: string; title: string; text: string }[] = [];
    for (const [page, items] of Object.entries(d.faqs)) for (const f of items)
      if ((f.q + " " + f.a).toLowerCase().includes(q)) results.push({ kind: "faq", title: `${page}: ${f.q}`, text: f.a });
    for (const cat of d.site.categories)
      if ((cat.name + " " + cat.blurb).toLowerCase().includes(q)) results.push({ kind: "category", title: cat.name, text: cat.blurb });
    if (q.includes("pod")) results.push({ kind: "pods", title: "Fractional Engineering Pods", text: d.pods.model });
    return { query, results };
  }));

  server.registerTool("electrohire_estimate_cost", {
    title: "Estimate project cost",
    description: "Planning estimate for electronics design + prototyping: always a range with assumptions and drivers — never a bare number, never a confidence figure.",
    inputSchema: {
      needs: z.array(z.string()).min(1).describe("Need ids: pcb, firmware, wireless, battery, enclosure, app, compliance."),
      productType: z.string().optional(), stage: z.string().optional(), units: z.string().optional(),
    },
  }, async (args) => g("electrohire_estimate_cost", args, async () => estimateCost(await loadContent(env), args)));

  server.registerTool("electrohire_scoping_checklist", {
    title: "Scoping checklist",
    description: "The decisions and documents a project needs before design spend, grouped, each with its reason.",
    inputSchema: { productType: z.string().optional(), needs: z.array(z.string()).min(1) },
  }, async (args) => g("electrohire_scoping_checklist", args, async () => scopingChecklist(args)));

  server.registerTool("electrohire_timeline_calculator", {
    title: "Timeline calculator",
    description: "Stage-by-stage duration ranges with waiting time (parts, labs, factories) counted, plus a total range and assumptions.",
    inputSchema: { needs: z.array(z.string()).min(1), stage: z.string().optional() },
  }, async (args) => g("electrohire_timeline_calculator", args, async () => timelineCalculator(await loadContent(env), args)));

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok", version: MCP_SERVER_VERSION });
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const identity = await identityLabel(request);
    if (globalKillOn(env)) {
      logRequest({ identity, endpoint: "/mcp", status: 503 });
      return Response.json({ error: "service_disabled" }, { status: 503 });
    }
    if (!limiterFor(env).check(ip).allowed) {
      logRequest({ identity, endpoint: "/mcp", status: 429 });
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    // C-08 (Phase C2): credentials travel in headers only — a key in the
    // URL is rejected before the MCP transport ever sees the request.
    const extracted = extractCredential({ headers: { authorization: request.headers.get("authorization") ?? undefined }, url: request.url });
    if (extracted.error) {
      logRequest({ identity: "credential-in-url", endpoint: "/mcp", status: 400 });
      return Response.json({ error: "credential_in_url", detail: "API keys are accepted in headers only — a key in a URL is rejected." }, { status: 400 });
    }
    const cred: Cred = extracted.secret ? { kind: "api_key", secret: extracted.secret } : extracted.token ? { kind: "oauth_double", token: extracted.token } : null;
    const server = createServer(env, cred);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const res = await transport.handleRequest(request);
    logRequest({ identity, endpoint: "/mcp", status: res.status });
    return res;
  },
};
