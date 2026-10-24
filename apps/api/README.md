# @electrohire/api

The ElectroHire public REST API, as a Cloudflare Worker.

- **Stack:** Hono + Zod via `@hono/zod-openapi` — one set of schemas validates
  requests and generates the OpenAPI 3.1 document.
- **Versioning:** semantic version in `package.json`; the API surface is
  URL-versioned (`/v1`). See `../../docs/architecture.md`.

## Phase C1 status (local track)

Read + tool endpoints serve from the mirrored website content document (`/content/v1.json`, C-01) loaded via `@electrohire/platform`; per-IP rate limits, metadata-only logging, and kill switches are in the same shared package (C-05). Blog endpoints are absent until Phase B data exists. Proven locally (wrangler dev); this code has NOT been deployed — served acceptance waits for the Workers deploy credential remedy.

## Develop

```bash
pnpm install
pnpm --filter @electrohire/api dev
curl http://localhost:8787/v1/health      # {"status":"ok","version":"0.1.0"}
curl http://localhost:8787/openapi.json   # OpenAPI 3.1 document
pnpm --filter @electrohire/api typecheck
```

## Status

Scaffold: only `GET /v1/health` is implemented. Content, tools, and Ellie intake
endpoints land per the roadmap in the root README.
