# ElectroHire for Claude Desktop

Claude Desktop's config file is stdio-first: it starts local programs, it does not connect straight to a remote URL from that file. So this connector uses the `mcp-remote` stdio bridge — Desktop starts the bridge locally, and the bridge talks streamable HTTP to ElectroHire. (Desktop also offers a Custom Connectors UI for remote servers with OAuth sign-in; use that route if you prefer OAuth to a personal key.)

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp.electrohire.com/mcp`) and API (`https://api.electrohire.com`) are planned beta endpoints for the new ElectroHire platform. They are not yet live production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire dashboard — the new ground-up user dashboard being built as part of the ElectroHire platform program (this key-management feature is part of that new dashboard; it is not a feature of the current production app).** Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `Claude Desktop`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. Node.js installed (the bridge runs through `npx`). Replace `eh_live_REPLACE_ME` in the example's `env` block with your real key on your own machine — that file lives on your computer, never in a repo.

## Setup

1. Open Claude Desktop → **Settings → Developer → Edit Config**. That opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`).
2. Merge the config example below into the file, replacing `eh_live_REPLACE_ME` with your key.
3. The split `Authorization:${AUTH_HEADER}` form is deliberate: on some platforms a space inside an argument is mangled, so the header value lives in `env`.
4. Quit Claude Desktop completely and reopen it. ElectroHire should appear in the MCP tools list.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "mcpServers": {
    "electrohire": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.electrohire.com/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer eh_live_REPLACE_ME"
      }
    }
  }
}
```


## Test it

Ask your agent: *"Use ElectroHire to search for information about fractional engineering pods."*

Expected result: the agent calls the read-only `electrohire_site_search` tool and returns matching ElectroHire content — that proves the connection, the key, and the tool wiring work. If the agent answers from its own memory without calling the tool, the connector is not active yet: restart the client and check the setup steps above.

## Troubleshooting

- **401 Unauthorized** — the key is missing, revoked, or expired, or the `Authorization: Bearer <key>` header was not sent. Create a fresh key in the dashboard (step 1) and update the environment variable, then restart the client.
- **Scope / permission error** — the key works, but it does not include the scope the tool needs. Scopes cannot be changed on an existing key — create a new key with the required scope, revoke the old one, then retry.
- **Server not found / connection refused** — check the URL is exactly `https://mcp.electrohire.com/mcp` and that you are online. Remember these are planned beta endpoints, not yet live production.
- **Tools do not appear** — restart the client after editing its config; most clients only read MCP config at startup.

## Acting on ElectroHire's behalf of a user — OAuth 2.1 (action tools)

Read tools work with the API key above. **Action tools** — subscribing an address to the newsletter (`electrohire_newsletter_subscribe`) and opening a support ticket (`electrohire_support_ticket`) — use **OAuth 2.1 delegated authorization** instead of a personal key:

1. Your client opens ElectroHire's authorization endpoint and sends the user there. The flow is **authorization code + PKCE (S256)** — no other grant, no plain PKCE.
2. The user sees ElectroHire's **consent screen** (a human form protected by Cloudflare Turnstile) naming your client and the exact scopes. Nothing is granted until the user approves there — an agent cannot approve on the user's behalf.
3. The token you receive is **audience-bound** (RFC 8707): a token minted for the API resource will not work at the MCP resource, or the other way round. Send tokens in the `Authorization: Bearer <token>` header only — a token in a URL is rejected, exactly like a key.
4. Two honesty rules are built in and cannot be configured away: a newsletter subscribe stays **pending until the person clicks the confirmation email link** (double opt-in), and the subscribe response never reveals whether an address was already subscribed. A support ticket filed this way lands in the same inbox, with the same fields, as one filed on the website.
5. Tokens last one hour. Revoking a token (the user, in their dashboard) takes effect on the very next request. Discovery: authorization-server metadata (RFC 8414) on the authorization host, protected-resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource` on each resource.

Ellie session/analysis actions are **not offered** — they arrive only when the Ellie backend exists behind them, and no guide or client should promise them before then.

## Revoke or rotate the key

1. In your ElectroHire dashboard, open **API Keys** (the MCP API keys page) in the dashboard sidebar.
2. Create a new key, update `ELECTROHIRE_API_KEY` wherever this client reads it, and restart the client.
3. Confirm the test above passes, then revoke the old key in the dashboard. Revoking takes effect immediately — any client still using the old key will start getting 401 errors.

> Never commit a real key to a file, a repo, or a chat. Every example in this folder uses an environment-variable reference or a clearly marked `REPLACE_ME` placeholder.

---
*Config format checked against: [Cloudflare — test a remote MCP server (mcp-remote bridge pattern)](https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/) on 2026-10-23.*
