# ElectroHire for AI Agents

Public API, MCP server, agent skills, and SDKs for [ElectroHire](https://electrohire.com) —
the AI-powered electronics engineering marketplace. This repository is the open,
agent-facing surface of ElectroHire: everything an AI agent (or a developer building
one) needs to interact with ElectroHire programmatically.

> **Status: initial scaffold (v0.1.0).** The components below are working stubs that
> prove the wiring — a health endpoint, one read-only MCP tool with a placeholder
> result, a starter skill, and a Python client skeleton. They are labeled as scaffold
> in code and are not yet the production agent interface. The ElectroHire website
> repository itself is private; this repo is public by design.

## Components

| Component | Path | Version | What it is |
|---|---|---|---|
| REST API | [`apps/api`](apps/api) | 0.1.0 | Cloudflare Worker (Hono + Zod, OpenAPI 3.1). URL-versioned under `/v1`. |
| MCP server | [`apps/mcp`](apps/mcp) | 0.1.0 | Remote MCP server on a Cloudflare Worker, using the official `@modelcontextprotocol/sdk`. |
| Agent skills | [`skills/`](skills) | per-skill `VERSION` file | SKILL.md packages that teach an agent how to use ElectroHire well. |
| Python SDK | [`sdk/python`](sdk/python) | 0.1.0 | Python client package (`electrohire` on PyPI when published) for agent developers. |

Runtimes are TypeScript on Cloudflare Workers (free-tier-first). Python exists as an
SDK for agent developers — see [`docs/architecture.md`](docs/architecture.md) for the
full component map, the event-driven "reactor" backend pattern, and the versioning
policy.

## Quickstart

### API

```bash
pnpm install
pnpm --filter @electrohire/api dev        # local Worker via wrangler
curl http://localhost:8787/v1/health
# {"status":"ok","version":"0.1.0"}
curl http://localhost:8787/openapi.json    # OpenAPI 3.1 document
```

### MCP server

```bash
pnpm --filter @electrohire/mcp dev         # local Worker via wrangler
```

Then point any MCP client at the server's `/mcp` endpoint. The scaffold ships one
read-only tool, `electrohire_site_search`, which currently returns a clearly marked
placeholder result.

### Python SDK

```bash
pip install -e sdk/python
```

```python
from electrohire import ElectroHireClient

client = ElectroHireClient()               # defaults to https://api.electrohire.com
print(client.health())                     # -> {"status": "ok", "version": "0.1.0"}
```

## Feature parity

The API and MCP server stay in step with the ElectroHire website and platform
by rule, not by cleanup pass: every feature added, changed, or removed carries
an API/MCP parity assessment in the same change, recorded in
[`parity-manifest.json`](parity-manifest.json) — the checked-in source of truth,
kept current by a CI drift check. The discipline, the parity states, and the
deprecate-before-removal rule are in
[`docs/FEATURE-PARITY.md`](docs/FEATURE-PARITY.md).

## Versioning

Every component is semantically versioned on its own. The API is additionally
URL-versioned (`/v1`); MCP tools and skills carry their own versions. Releases are
git tags (`v*`) with GitHub Releases and a [CHANGELOG](CHANGELOG.md) entry. Details:
[`docs/architecture.md`](docs/architecture.md#versioning-policy).

## Security

Do not put API keys or secrets in issues or pull requests. To report a vulnerability,
use GitHub's private vulnerability reporting for this repository — see
[SECURITY.md](SECURITY.md). API action tools (when they land) act only as the user
who authorized them; estimates returned by any surface carry their ranges and stated
assumptions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is licensed under the
[MIT License](LICENSE) — © ElectroHire Inc.
