# ElectroHire for ChatGPT

Two honest routes exist, and which one you can use depends on your ChatGPT plan and workspace settings:

- **Developer-mode MCP connection** — ChatGPT's developer mode lets you add a remote MCP server as a custom app/connector. Availability depends on your plan (paid plans; workspace admins may need to allow it) and OpenAI has moved this setting between menus.
- **Custom GPT Action** — build a Custom GPT whose Action is driven by ElectroHire's OpenAPI document. This uses the REST API, not MCP, and the GPT calls only the operations in that document.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp.electrohire.com/mcp`) and API (`https://api.electrohire.com`) are planned beta endpoints for the new ElectroHire platform. They are not yet live production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire dashboard — the new ground-up user dashboard being built as part of the ElectroHire platform program (this key-management feature is part of that new dashboard; it is not a feature of the current production app).** Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `ChatGPT`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. A ChatGPT plan that offers developer mode / custom connectors, or a plan that lets you build Custom GPTs. If you do not see the options below, your plan or workspace does not offer them — that is a plan limit, not an ElectroHire error.

## Setup

**Route A — Developer-mode MCP**
1. In ChatGPT on the web, open **Settings → Apps (previously Connectors) → Advanced settings** and turn on **Developer mode**.
2. Choose **Create** / add a new app, name it `ElectroHire`, and enter the MCP server URL `https://mcp.electrohire.com/mcp`.
3. For authentication, use OAuth sign-in where offered. Where the connector asks for a header/token, use your dashboard MCP API key as `Authorization: Bearer <key>` — enter it in the connector's credential field, not in chat.
4. Review the discovered tools, enable the read-only tools first, and start a new chat with the ElectroHire app selected.

**Route B — Custom GPT Action**
1. Create a Custom GPT (GPT Builder → **Create**).
2. In **Configure → Actions → Create new action**, import the OpenAPI document from `https://api.electrohire.com/openapi.json`.
3. Set authentication to **API key → Bearer**, and paste your dashboard MCP API key in the action's credential field (stored by ChatGPT, never in the GPT's instructions).
4. Add instructions telling the GPT to present ElectroHire estimates as ranges with their assumptions, and to start with information, not commitments.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "name": "electrohire",
  "mcp_server_url": "https://mcp.electrohire.com/mcp",
  "transport": "streamable-http",
  "authentication": "OAuth 2.1 where the client supports it; otherwise a dashboard MCP API key as a Bearer token",
  "custom_gpt_action": {
    "openapi_url": "https://api.electrohire.com/openapi.json",
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
- **Server not found / connection refused** — check the URL is exactly `https://mcp.electrohire.com/mcp` and that you are online. Remember these are planned beta endpoints, not yet live production.
- **Tools do not appear** — restart the client after editing its config; most clients only read MCP config at startup.

## Revoke or rotate the key

1. In your ElectroHire dashboard, open **API Keys** (the MCP API keys page) in the dashboard sidebar.
2. Create a new key, update `ELECTROHIRE_API_KEY` wherever this client reads it, and restart the client.
3. Confirm the test above passes, then revoke the old key in the dashboard. Revoking takes effect immediately — any client still using the old key will start getting 401 errors.

> Never commit a real key to a file, a repo, or a chat. Every example in this folder uses an environment-variable reference or a clearly marked `REPLACE_ME` placeholder.

---
*Config format checked against: [OpenAI GPT Actions getting started](https://developers.openai.com/cookbook/examples/chatgpt/gpt_actions_library/.gpt_action_getting_started) on 2026-10-23.*
