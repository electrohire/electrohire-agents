# ElectroHire for OpenAI Codex CLI

Add ElectroHire as a remote MCP server in Codex. Codex reads the bearer token from an environment variable, so no key ever sits in `config.toml`.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp-beta.electrohire.com/mcp`) and API (`https://api-beta.electrohire.com`) are the live beta endpoints for the new ElectroHire platform. The beta is invite-only — you need an ElectroHire beta account to create a key. They are not the production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire beta dashboard** (app-beta.electrohire.com — the beta is invite-only, so you need a beta account first; key management is a feature of the new beta dashboard, not of the current production app). Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `OpenAI Codex CLI`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. Codex CLI installed. Set the variable before you start Codex: `export ELECTROHIRE_API_KEY="<your key>"` (use your secret store where you can).

## Setup

1. Either run the CLI command:
   ```bash
   codex mcp add electrohire --url https://mcp-beta.electrohire.com/mcp --bearer-token-env-var ELECTROHIRE_API_KEY
   ```
2. Or add the config example below to `~/.codex/config.toml` yourself.
3. Start Codex and run `/mcp` — `electrohire` should show as connected.

## Config example

The machine-readable example in this folder uses this shape:

```toml
[mcp_servers.electrohire]
url = "https://mcp-beta.electrohire.com/mcp"
bearer_token_env_var = "ELECTROHIRE_API_KEY"
```


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
*Config format checked against: [OpenAI Developers — Docs MCP / Codex MCP config](https://developers.openai.com/learn/docs-mcp) on 2026-10-23.*
