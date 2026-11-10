# ElectroHire for Meta Muse

Connect ElectroHire to Meta Muse and install the `electrohire-basics` skill so Muse knows how to use ElectroHire well. **Status: guide — verify config against Muse docs.** Muse (the personal agent) does not currently document a user-facing MCP config file you paste a server into. The documented routes are: ask Muse to build a custom connector for a service from its API or MCP URL (it builds the integration on its own VM and saves it as a skill), and, in Muse Code, add MCP servers in its settings. This guide follows those routes honestly rather than inventing a config file format.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp-beta.electrohire.com/mcp`) and API (`https://api-beta.electrohire.com`) are the live beta endpoints for the new ElectroHire platform. The beta is invite-only — you need an ElectroHire beta account to create a key. They are not the production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire beta dashboard** (app-beta.electrohire.com — the beta is invite-only, so you need a beta account first; key management is a feature of the new beta dashboard, not of the current production app). Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `Meta Muse`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. A Muse account. No local install is needed for the personal agent route.

## Setup

1. In Muse, ask: *"Build a custom connector for ElectroHire using its MCP server at https://mcp-beta.electrohire.com/mcp and its API docs at https://api-beta.electrohire.com/openapi.json. Use it for marketplace and fractional engineering questions."*
2. When Muse asks for a credential, enter your ElectroHire MCP API key **through its secure credential prompt** — never type the key into the chat text. Muse stores credentials outside the agent's runtime.
3. Install the skill: point Muse at the `electrohire-basics` skill in this repo (`skills/electrohire-basics/SKILL.md`) and ask it to install/import that skill. Do not copy the skill into this folder — this repo keeps one canonical copy.
4. If you use Muse Code instead, add the same server URL and bearer header in its MCP settings, following the generic MCP steps in `../generic-mcp/`.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "name": "electrohire",
  "server_url": "https://mcp-beta.electrohire.com/mcp",
  "transport": "streamable-http",
  "authorization": "Bearer ${ELECTROHIRE_API_KEY}",
  "skill": "electrohire-basics",
  "skill_source": "skills/electrohire-basics in the electrohire-agents repo"
}
```

> This connector is marked **guide** in the registry because Meta does not publish a paste-in MCP config format for the personal Muse agent. If Meta publishes one, this folder will gain a verified config example and its status will change to `config`.

## Test it

Ask your agent: *"Use ElectroHire to search for information about fractional engineering pods."*

Expected result: the agent calls the read-only `electrohire_site_search` tool and returns matching ElectroHire content — that proves the connection, the key, and the tool wiring work. If the agent answers from its own memory without calling the tool, the connector is not active yet: restart the client and check the setup steps above.

## Troubleshooting

- **401 Unauthorized** — the key is missing, revoked, or expired, or the `Authorization: Bearer <key>` header was not sent. Create a fresh key in the dashboard (step 1) and update the environment variable, then restart the client.
- **Scope / permission error** — the key works, but it does not include the scope the tool needs. Scopes cannot be changed on an existing key — create a new key with the required scope, revoke the old one, then retry.
- **Server not found / connection refused** — check the URL is exactly `https://mcp-beta.electrohire.com/mcp` and that you are online. These are the live beta endpoints; the production names are a later cutover, not a rename you should guess at.
- **Tools do not appear** — restart the client after editing its config; most clients only read MCP config at startup.

## Acting on ElectroHire's behalf of a user — OAuth 2.1 (action tools)

Read tools work with the API key above. **Action tools** — subscribing an address to the newsletter (`electrohire_newsletter_subscribe`), opening a support ticket (`electrohire_support_ticket`), and the Ellie tools (`electrohire_ellie_session` to start an analysis, `electrohire_ellie_analysis` to collect it) — work two ways, under exactly the same server-side scope checks: a personal API key that carries the matching action scope, or **OAuth 2.1 delegated authorization**:

1. Your client opens ElectroHire's authorization endpoint and sends the user there. The flow is **authorization code + PKCE (S256)** — no other grant, no plain PKCE.
2. The user sees ElectroHire's **consent screen** (a human form protected by Cloudflare Turnstile) naming your client and the exact scopes. Nothing is granted until the user approves there — an agent cannot approve on the user's behalf.
3. The token you receive is **audience-bound** (RFC 8707): a token minted for the API resource will not work at the MCP resource, or the other way round. Send tokens in the `Authorization: Bearer <token>` header only — a token in a URL is rejected, exactly like a key.
4. Two honesty rules are built in and cannot be configured away: a newsletter subscribe stays **pending until the person clicks the confirmation email link** (double opt-in), and the subscribe response never reveals whether an address was already subscribed. A support ticket filed this way lands in the same inbox, with the same fields, as one filed on the website.
5. Tokens last one hour. Revoking a token (the user, in their dashboard) takes effect on the very next request. Discovery: authorization-server metadata (RFC 8414) on the authorization host, protected-resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource` on each resource.

Ellie session/analysis actions **are offered** — the Ellie backend is live. `electrohire_ellie_session` starts an analysis and returns a handle at once; `electrohire_ellie_analysis` collects the result. Both need the `action:ellie_session` scope, and an analysis can only be read by the account whose credential started it.

## Revoke or rotate the key

1. In your ElectroHire dashboard, open **API Keys** (the MCP API keys page) in the dashboard sidebar.
2. Create a new key, update `ELECTROHIRE_API_KEY` wherever this client reads it, and restart the client.
3. Confirm the test above passes, then revoke the old key in the dashboard. Revoking takes effect immediately — any client still using the old key will start getting 401 errors.

> Never commit a real key to a file, a repo, or a chat. Every example in this folder uses an environment-variable reference or a clearly marked `REPLACE_ME` placeholder.

---
*Config format checked against: [Meta Muse MCP / custom connectors — secondary reporting (no official user-facing MCP config doc found)](https://parallel.ai/articles/meta-muse-custom-integrations) on 2026-10-23.*
