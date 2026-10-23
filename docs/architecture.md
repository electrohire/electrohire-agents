# Architecture

How the ElectroHire agent-access surface is put together, and why.

## Component map

```
                        ┌────────────────────────────────────────────┐
  AI agents / devs ───► │  apps/mcp     Remote MCP server (Worker)   │
                        │  apps/api     REST API (Worker, /v1)       │
                        └───────┬──────────────────────┬─────────────┘
                                │ reads / intake        │ events
                        ┌───────▼──────────┐   ┌────────▼──────────────┐
                        │ ElectroHire      │   │ Reactor (see below):  │
                        │ platform data    │   │ Queues → consumers,   │
                        │ (site content,   │   │ Workflows, Durable    │
                        │ tools, Ellie)    │   │ Objects               │
                        └──────────────────┘   └───────────────────────┘

  skills/   SKILL.md packages that teach agents to use the above well.
  sdk/      Client libraries (Python first) wrapping the REST API.
```

| Component | Runtime | Responsibility |
|---|---|---|
| `apps/api` | Cloudflare Worker (TypeScript, Hono + Zod) | Public REST API. Serves site content and the value-add tools, accepts Ellie intake and newsletter/contact actions. OpenAPI 3.1 document generated from the same Zod schemas that validate requests. |
| `apps/mcp` | Cloudflare Worker (TypeScript, official MCP SDK) | Remote MCP server. Tools mirror the API: read tools are unauthenticated within rate limits; action tools act only under a user-granted authorization. |
| `skills/` | Static packages (SKILL.md) | Portable instructions that teach any capable agent how to use the API/MCP, and the discipline for presenting ElectroHire estimates (ranges + assumptions, human approval before anything binding). |
| `sdk/python` | Python ≥ 3.10 package | Thin client over the REST API for agent developers in Python ecosystems. Runtimes stay TypeScript on Workers; Python is a client, never a deployment target. |

The website and marketplace application are a separate, private codebase. This repo
contains only the public, agent-facing surface and its contracts.

## The reactor pattern (event-driven backend)

Request handlers stay thin: they validate, respond, and **emit events**. Everything
slow, retryable, or stateful happens behind the request path in an event-driven
backend we call the **reactor**, built from Cloudflare primitives:

- **Cloudflare Queues** carry events (Stripe webhooks received, report jobs,
  newsletter sends, intake submissions). Producers enqueue in the request path;
  **consumers** process asynchronously with retries and dead-letter handling, so a
  slow downstream never blocks a user or an agent.
- **Cloudflare Workflows** run the long, multi-step jobs that must survive restarts
  and wait on humans — daily/weekly/monthly insight-report generation, Ellie
  analysis pipelines that pause at an approval gate and resume when a person
  responds. Steps are individually retried and the whole run is resumable.
- **Durable Objects** act as stateful coordinators where a single writer matters:
  one object per Ellie session (ordered turns, no cross-session bleed), per webhook
  stream (deduplication — a webhook is processed exactly once even when delivered
  twice), or per rate-limit bucket that needs stronger consistency than a counter
  in KV.
- **D1** stores relational state (newsletter subscribers, blog content, report
  history); **KV** serves read-mostly public content (site pages, FAQ) at the edge;
  **R2** holds generated artifacts (report files, exports).

Design rules:

1. Handlers never wait on work a queue can carry.
2. Every event consumer is idempotent; webhooks in particular are verified by
   signature at the edge and deduplicated in a Durable Object before any effect.
3. Anything that can block on a human (approvals, reviews) is a Workflow, not a
   request.
4. Ordering is only promised where a Durable Object provides it; consumers must
   tolerate out-of-order delivery everywhere else.

**Free-tier note.** The reactor is designed free-tier-first: Queues, Workflows,
Durable Objects (SQLite-backed), D1, KV, and R2 all have free-tier allowances on
Cloudflare's Workers Free plan, and the scaffold needs none of them yet — they
enter as the components above grow past stubs. Allowances change; check
[Cloudflare's pricing pages](https://developers.cloudflare.com/workers/platform/pricing/)
before designing against a specific number, and expect the heaviest report jobs to
be the first thing that justifies a paid Workers plan.

## Versioning policy

- **Semantic versioning per component.** Each app and SDK carries its own version
  (`apps/*/package.json`, `sdk/python/pyproject.toml`). The repository release
  version tracks the newest component release.
- **API: URL-versioned.** The REST API is versioned in the path (`/v1`). Breaking
  changes ship as a new path version; `/v1` keeps working. Non-breaking additions
  (new endpoints, new optional fields) stay within `/v1`. The OpenAPI document at
  `/openapi.json` always describes the deployed version.
- **MCP tools: individually stable, server versioned.** Tool names, once published,
  do not change meaning; a tool's behavior change is a new tool name or a major
  server version. The server reports its version in the MCP handshake.
- **Skills: per-skill versions.** Each `skills/<name>/VERSION` file versions that
  skill independently; skills state the minimum API/MCP versions they assume.
- **Releases:** git tags (`v<semver>`) on this repository trigger a GitHub Release
  whose notes come from the matching `CHANGELOG.md` section (Keep a Changelog
  format). Pre-1.0 releases may be marked pre-release; 0.x minor bumps may carry
  breaking changes and will say so in the changelog.

## Security posture (summary)

- Secrets live in Worker secrets / CI secrets only — never in this repo.
- Read surfaces are public within rate limits; action surfaces require a
  user-granted token and act only as that user.
- Payments events are only ever acted on from signature-verified webhooks, never
  from a client success signal.
- See [SECURITY.md](../SECURITY.md) for reporting a vulnerability.

## Connectors (client-side guides)

`connectors/` holds per-platform guides and config examples that teach a user's own agent — on Muse, ChatGPT, Codex, Claude, Ollama (via a bridge client), Cursor, Windsurf, VS Code Copilot, Gemini CLI, or any MCP client — how to reach the MCP server above with a personal MCP API key created in the user's ElectroHire dashboard. See [`docs/connectors.md`](connectors.md) for the index and the shared concepts (keys, scopes, testing, revocation).

These are client-side guides only — they add no provider integration to the platform, so the OpenRouter-only AI provider policy for ElectroHire's own AI is unaffected.
