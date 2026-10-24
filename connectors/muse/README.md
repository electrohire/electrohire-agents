# ElectroHire for Meta Muse

Connect ElectroHire to Meta Muse and install the `electrohire-basics` skill so Muse knows how to use ElectroHire well. **Status: guide — verify config against Muse docs.** Muse (the personal agent) does not currently document a user-facing MCP config file you paste a server into. The documented routes are: ask Muse to build a custom connector for a service from its API or MCP URL (it builds the integration on its own VM and saves it as a skill), and, in Muse Code, add MCP servers in its settings. This guide follows those routes honestly rather than inventing a config file format.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp.electrohire.com/mcp`) and API (`https://api.electrohire.com`) are planned beta endpoints for the new ElectroHire platform. They are not yet live production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire dashboard — the new ground-up user dashboard being built as part of the ElectroHire platform program (this key-management feature is part of that new dashboard; it is not a feature of the current production app).** Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `Meta Muse`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. A Muse account. No local install is needed for the personal agent route.

## Setup

1. In Muse, ask: *"Build a custom connector for ElectroHire using its MCP server at https://mcp.electrohire.com/mcp and its API docs at https://api.electrohire.com/openapi.json. Use it for marketplace and fractional engineering questions."*
2. When Muse asks for a credential, enter your ElectroHire MCP API key **through its secure credential prompt** — never type the key into the chat text. Muse stores credentials outside the agent's runtime.
3. Install the skill: point Muse at the `electrohire-basics` skill in this repo (`skills/electrohire-basics/SKILL.md`) and ask it to install/import that skill. Do not copy the skill into this folder — this repo keeps one canonical copy.
4. If you use Muse Code instead, add the same server URL and bearer header in its MCP settings, following the generic MCP steps in `../generic-mcp/`.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "name": "electrohire",
  "server_url": "https://mcp.electrohire.com/mcp",
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
- **Server not found / connection refused** — check the URL is exactly `https://mcp.electrohire.com/mcp` and that you are online. Remember these are planned beta endpoints, not yet live production.
- **Tools do not appear** — restart the client after editing its config; most clients only read MCP config at startup.

## Revoke or rotate the key

1. In your ElectroHire dashboard, open **API Keys** (the MCP API keys page) in the dashboard sidebar.
2. Create a new key, update `ELECTROHIRE_API_KEY` wherever this client reads it, and restart the client.
3. Confirm the test above passes, then revoke the old key in the dashboard. Revoking takes effect immediately — any client still using the old key will start getting 401 errors.

> Never commit a real key to a file, a repo, or a chat. Every example in this folder uses an environment-variable reference or a clearly marked `REPLACE_ME` placeholder.

---
*Config format checked against: [Meta Muse MCP / custom connectors — secondary reporting (no official user-facing MCP config doc found)](https://parallel.ai/articles/meta-muse-custom-integrations) on 2026-10-23.*
