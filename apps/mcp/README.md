# @electrohire/mcp

ElectroHire's remote MCP server, as a Cloudflare Worker — so any MCP-capable
agent (Claude, ChatGPT, Copilot, and others) can connect and use ElectroHire
tools directly. Live at `https://mcp-beta.electrohire.com/mcp`
(version 0.7.0).

- **Stack:** TypeScript, official `@modelcontextprotocol/sdk`, streamable HTTP
  transport (stateless), Zod input schemas.
- **Endpoint:** `/mcp` (plus `/health` for uptime checks).
- **Auth model:** read tools are unauthenticated within rate limits (a
  credential, when presented, is scope-checked); action tools require a
  personal API key or OAuth 2.1 token holding the action scope, checked in
  dispatch before the tool runs. See `../../docs/architecture.md`.

## Develop

```bash
pnpm install
pnpm --filter @electrohire/mcp dev
# MCP endpoint: http://localhost:8787/mcp
pnpm --filter @electrohire/mcp typecheck
```

## Tools (0.7.0)

Read: `electrohire_get_site_content`, `electrohire_get_faq`,
`electrohire_get_pricing`, `electrohire_site_search`,
`electrohire_list_blog_posts`, `electrohire_get_blog_post`,
`electrohire_list_events`, `electrohire_estimate_cost`,
`electrohire_scoping_checklist`, `electrohire_timeline_calculator`.

Action: `electrohire_ellie_session`, `electrohire_ellie_analysis`,
`electrohire_newsletter_subscribe`, `electrohire_support_ticket`.
