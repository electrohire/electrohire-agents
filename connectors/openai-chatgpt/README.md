# ElectroHire for ChatGPT

Two honest routes exist, and which one you can use depends on your ChatGPT plan and workspace settings:

- **Developer-mode MCP connection** — ChatGPT's developer mode lets you add a remote MCP server as a custom app/connector. Availability depends on your plan (paid plans; workspace admins may need to allow it) and OpenAI has moved this setting between menus.
- **Custom GPT Action** — build a Custom GPT whose Action is driven by ElectroHire's OpenAPI document. This uses the REST API, not MCP, and the GPT calls only the operations in that document.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp-beta.electrohire.com/mcp`) and API (`https://api-beta.electrohire.com`) are the live beta endpoints for the new ElectroHire platform. The beta is invite-only — you need an ElectroHire beta account to create a key. They are not the production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire beta dashboard** (app-beta.electrohire.com — the beta is invite-only, so you need a beta account first; key management is a feature of the new beta dashboard, not of the current production app). Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `ChatGPT`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. A ChatGPT plan that offers developer mode / custom connectors, or a plan that lets you build Custom GPTs. If you do not see the options below, your plan or workspace does not offer them — that is a plan limit, not an ElectroHire error.

## Setup

**Route A — Developer-mode MCP**
1. In ChatGPT on the web, open **Settings → Apps (previously Connectors) → Advanced settings** and turn on **Developer mode**.
2. Choose **Create** / add a new app, name it `ElectroHire`, and enter the MCP server URL `https://mcp-beta.electrohire.com/mcp`.
3. For authentication, use OAuth sign-in where offered. Where the connector asks for a header/token, use your dashboard MCP API key as `Authorization: Bearer <key>` — enter it in the connector's credential field, not in chat.
4. Review the discovered tools, enable the read-only tools first, and start a new chat with the ElectroHire app selected.

**Route B — Custom GPT Action**
1. Create a Custom GPT (GPT Builder → **Create**).
2. In **Configure → Actions → Create new action**, import the OpenAPI document from `https://api-beta.electrohire.com/openapi.json`.
3. Set authentication to **API key → Bearer**, and paste your dashboard MCP API key in the action's credential field (stored by ChatGPT, never in the GPT's instructions).
4. Add instructions telling the GPT to present ElectroHire estimates as ranges with their assumptions, and to start with information, not commitments.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "name": "electrohire",
  "mcp_server_url": "https://mcp-beta.electrohire.com/mcp",
  "transport": "streamable-http",
  "authentication": "OAuth 2.1 where the client supports it; otherwise a dashboard MCP API key as a Bearer token",
  "custom_gpt_action": {
    "openapi_url": "https://api-beta.electrohire.com/openapi.json",
    "authentication": "Bearer ${ELECTROHIRE_API_KEY}"
  }
}
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
*Config format checked against: [OpenAI GPT Actions getting started](https://developers.openai.com/cookbook/examples/chatgpt/gpt_actions_library/.gpt_action_getting_started) on 2026-10-23.*
