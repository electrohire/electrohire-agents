# @electrohire/mcp

ElectroHire's remote MCP server, as a Cloudflare Worker — so any MCP-capable
agent (Claude, ChatGPT, Copilot, and others) can connect and use ElectroHire
tools directly.

- **Stack:** TypeScript, official `@modelcontextprotocol/sdk`, streamable HTTP
  transport (stateless), Zod input schemas.
- **Endpoint:** `/mcp` (plus `/health` for uptime checks).
- **Auth model (by design):** read tools are unauthenticated within rate
  limits; action tools will act only under a user-granted authorization.
  See `../../docs/architecture.md`.

## Develop

```bash
pnpm install
pnpm --filter @electrohire/mcp dev
# MCP endpoint: http://localhost:8787/mcp
pnpm --filter @electrohire/mcp typecheck
```

## Tools (scaffold)

| Tool | Status |
|---|---|
| `electrohire_site_search` | Placeholder — returns a marked, empty result. Real site search lands with the content API. |
