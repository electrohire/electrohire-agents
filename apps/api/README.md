# @electrohire/api

The ElectroHire public REST API, as a Cloudflare Worker, live at
`https://api-beta.electrohire.com` (version 0.7.0).

- **Stack:** Hono + Zod via `@hono/zod-openapi` — one set of schemas validates
  requests and generates the OpenAPI 3.1 document.
- **Versioning:** semantic version in `package.json`; the API surface is
  URL-versioned (`/v1`). See `../../docs/architecture.md`.

## What it serves

Read + tool endpoints serve from the mirrored website content document
(`/content/v1.json`, C-01) loaded via `@electrohire/platform`; blog and
events mirror the website's published-only public JSON (WS-5, 2026-10-26).
Per-IP rate limits, metadata-only logging, and kill switches live in the
same shared package. Action endpoints (Ellie analysis, newsletter
subscribe, support ticket) require a personal API key or OAuth 2.1 token
holding the action scope and pass the one shared gate. No payments run
through this API.

Full surface: `GET /v1/health`, `GET /v1/content`,
`GET /v1/content/services`, `GET /v1/faq`, `GET /v1/pricing`,
`GET /v1/blog`, `GET /v1/blog/{slug}`, `GET /v1/events`,
`POST /v1/tools/cost-estimator`, `POST /v1/tools/scoping-checklist`,
`POST /v1/tools/timeline-calculator`, `POST /v1/actions/ellie-session`,
`GET /v1/ellie/analyses/{id}`, `POST /v1/actions/newsletter-subscribe`,
`POST /v1/actions/support-ticket`, `GET /openapi.json`,
`GET /.well-known/oauth-protected-resource`, `GET /llms.txt`.

## Develop

```bash
pnpm install
pnpm --filter @electrohire/api dev
curl http://localhost:8787/v1/health      # {"status":"ok","version":"0.7.0"}
curl http://localhost:8787/openapi.json   # OpenAPI 3.1 document
pnpm --filter @electrohire/api typecheck
```
