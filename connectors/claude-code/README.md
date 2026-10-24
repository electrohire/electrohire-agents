# ElectroHire for Claude Code

Add ElectroHire as a remote (streamable HTTP) MCP server in Claude Code. Note the `"type": "http"` field — without it Claude Code reads the entry as a local stdio server and skips it.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp.electrohire.com/mcp`) and API (`https://api.electrohire.com`) are planned beta endpoints for the new ElectroHire platform. They are not yet live production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire dashboard — the new ground-up user dashboard being built as part of the ElectroHire platform program (this key-management feature is part of that new dashboard; it is not a feature of the current production app).** Sign in, open **API Keys** (the MCP API keys page) in the dashboard sidebar, choose **+ Create a new key**, name it for this client (for example, `Claude Code`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. Claude Code installed.

## Setup

1. Quickest route — run:
   ```bash
   claude mcp add --transport http electrohire https://mcp.electrohire.com/mcp --header "Authorization: Bearer $ELECTROHIRE_API_KEY"
   ```
   Add `--scope user` to use it in every project, or `--scope project` to write it to `.mcp.json`.
2. Or copy the `.mcp.json` example in this folder into your project root. The `${ELECTROHIRE_API_KEY}` reference keeps the key itself out of the file, so the file is safe to commit.
3. Run `claude mcp list` — `electrohire` should show as connected.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "mcpServers": {
    "electrohire": {
      "type": "http",
      "url": "https://mcp.electrohire.com/mcp",
      "headers": {
        "Authorization": "Bearer ${ELECTROHIRE_API_KEY}"
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

## Revoke or rotate the key

1. In your ElectroHire dashboard, open **API Keys** (the MCP API keys page) in the dashboard sidebar.
2. Create a new key, update `ELECTROHIRE_API_KEY` wherever this client reads it, and restart the client.
3. Confirm the test above passes, then revoke the old key in the dashboard. Revoking takes effect immediately — any client still using the old key will start getting 401 errors.

> Never commit a real key to a file, a repo, or a chat. Every example in this folder uses an environment-variable reference or a clearly marked `REPLACE_ME` placeholder.

---
*Config format checked against: [Claude Code MCP documentation (via Claude Wiki mirror)](https://claude-wiki.com/connect-claude-code-to-tools-via-mcp.html) on 2026-10-23.*
