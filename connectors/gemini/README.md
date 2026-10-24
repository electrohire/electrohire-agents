# ElectroHire for Gemini CLI

Add ElectroHire as a remote MCP server in Google's Gemini CLI. Gemini CLI uses `httpUrl` (not `url`) for streamable HTTP servers, and expands `${ELECTROHIRE_API_KEY}` in header values from your environment.

> **Beta endpoints.** The ElectroHire MCP server (`https://mcp.electrohire.com/mcp`) and API (`https://api.electrohire.com`) are planned beta endpoints for the new ElectroHire platform. They are not yet live production endpoints.

## Prerequisites

1. **Create a key in your ElectroHire dashboard — the new ground-up user dashboard being built as part of the ElectroHire platform program (this key-management feature is part of that new dashboard; it is not a feature of the current production app).** Sign in, open **Settings → MCP API keys**, choose **Create key**, name it for this client (for example, `Gemini CLI`), pick the scopes you need (read-only is enough for the test below), and copy the key once — it is shown only once.
2. Store the key as an environment variable named `ELECTROHIRE_API_KEY` in your shell, your operating system's secret store, or your client's secret store. Never paste a real key into a config file you commit.
3. Gemini CLI installed. Set `ELECTROHIRE_API_KEY` in your shell.

## Setup

1. Either run:
   ```bash
   gemini mcp add electrohire https://mcp.electrohire.com/mcp --transport http --header "Authorization: Bearer $ELECTROHIRE_API_KEY"
   ```
2. Or add the config example below under `mcpServers` in `~/.gemini/settings.json`.
3. Start `gemini` and run `/mcp` — `electrohire` should show as connected with its tools listed.

## Config example

The machine-readable example in this folder uses this shape:

```json
{
  "mcpServers": {
    "electrohire": {
      "httpUrl": "https://mcp.electrohire.com/mcp",
      "headers": {
        "Authorization": "Bearer ${ELECTROHIRE_API_KEY}"
      }
    }
  }
}
```


## Test it

Ask your agent: *"Use ElectroHire to search for information about fractional engineering pods."*

Expected result: the agent calls the read-only `electrohire_site_search` tool and returns a result. In the scaffold release that result is clearly marked as a placeholder — that still proves the connection, the key, and the tool wiring work. If the agent answers from its own memory without calling the tool, the connector is not active yet: restart the client and check the setup steps above.

## Troubleshooting

- **401 Unauthorized** — the key is missing, revoked, or expired, or the `Authorization: Bearer <key>` header was not sent. Create a fresh key in the dashboard (step 1) and update the environment variable, then restart the client.
- **Scope / permission error** — the key works, but it does not include the scope the tool needs. Create a key with the required scope, or widen the existing key's scopes in the dashboard, then retry.
- **Server not found / connection refused** — check the URL is exactly `https://mcp.electrohire.com/mcp` and that you are online. Remember these are planned beta endpoints, not yet live production.
- **Tools do not appear** — restart the client after editing its config; most clients only read MCP config at startup.

## Revoke or rotate the key

1. In your ElectroHire dashboard, open **Settings → MCP API keys**.
2. Create a new key, update `ELECTROHIRE_API_KEY` wherever this client reads it, and restart the client.
3. Confirm the test above passes, then revoke the old key in the dashboard. Revoking takes effect immediately — any client still using the old key will start getting 401 errors.

> Never commit a real key to a file, a repo, or a chat. Every example in this folder uses an environment-variable reference or a clearly marked `REPLACE_ME` placeholder.

---
*Config format checked against: [Gemini CLI — configuration / MCP servers](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html) on 2026-10-23.*
