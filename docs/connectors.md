# Connectors — connect your own agent to ElectroHire

ElectroHire's MCP server and API are built so **your** agent — the one you
already use — can work with ElectroHire. A connector is a short, checked guide
plus a copy-ready config example for one platform. Pick yours:

| Connector | Platform | Transport | Status | Guide |
|---|---|---|---|---|
| Meta Muse | Meta Muse | HTTP (custom connector) | guide | [connectors/muse](../connectors/muse/README.md) |
| ChatGPT | ChatGPT (OpenAI) | MCP (developer mode) / Actions | guide | [connectors/openai-chatgpt](../connectors/openai-chatgpt/README.md) |
| Codex CLI | OpenAI Codex CLI | HTTP | config | [connectors/openai-codex](../connectors/openai-codex/README.md) |
| Claude Desktop | Claude Desktop | stdio bridge (`mcp-remote`) | config | [connectors/claude-desktop](../connectors/claude-desktop/README.md) |
| Claude Code | Claude Code | HTTP | config | [connectors/claude-code](../connectors/claude-code/README.md) |
| Ollama | Ollama via ollmcp | bridge | bridge | [connectors/ollama](../connectors/ollama/README.md) |
| Cursor | Cursor | HTTP | config | [connectors/cursor](../connectors/cursor/README.md) |
| Windsurf | Windsurf | HTTP | config | [connectors/windsurf](../connectors/windsurf/README.md) |
| VS Code + Copilot | Visual Studio Code / GitHub Copilot | HTTP | config | [connectors/vscode-copilot](../connectors/vscode-copilot/README.md) |
| Gemini CLI | Google Gemini CLI | HTTP | config | [connectors/gemini](../connectors/gemini/README.md) |
| Any MCP client | Any MCP client | HTTP / stdio bridge | config | [connectors/generic-mcp](../connectors/generic-mcp/README.md) |

Status means: **config** = a verified config-file format you can copy;
**guide** = the platform has no paste-in config file for this, so the guide
follows its documented flow and says so; **bridge** = the platform is not an
MCP client on its own, so the guide connects it through a bridge client.

The machine-readable list is [`connectors/registry.json`](../connectors/registry.json),
checked in CI by `tools/validate-connectors.mjs`.

> **Beta endpoints.** `https://mcp.electrohire.com/mcp` and
> `https://api.electrohire.com` are the planned beta endpoints for the new
> ElectroHire platform. They are not yet live production endpoints.

## The shared concepts (read once, every connector uses them)

### 1. Get a key in your dashboard

Sign in to **your ElectroHire dashboard — the new ground-up user dashboard
being built as part of the ElectroHire platform program** (this
key-management feature is part of that new dashboard; it is not a feature of
the current production app). Open **Settings → MCP API keys**, choose
**Create key**, name the key for the client that will use it, and pick its
scopes. The key is shown **once** — copy it then.

Your dashboard is also where you manage keys after creating them: see when a
key was last used, change its scopes, rotate it, and revoke it.

### 2. Keep it secret

A key acts as you. Store it in an environment variable
(`ELECTROHIRE_API_KEY`) or a secret store — every example in this repo
references the key that way, or uses a clearly marked `REPLACE_ME`
placeholder. Never commit a real key to a file, a repo, or a chat.

### 3. Scopes

Keys carry scopes — what that key is allowed to do. Read-only scopes are
enough to search and read. A tool that needs more will fail with a scope /
permission error (different from a 401): widen that key's scopes in the
dashboard, or create a key with the right scopes, rather than sharing a
broader key everywhere. Prefer one key per client, with the narrowest scopes
that client needs.

### 4. The other route: OAuth 2.1

Where a client supports it, OAuth 2.1 is the delegated-authorization route:
you sign in and grant that client access, and revoke it from the client or
your dashboard. A personal MCP API key is for **your own** agents; OAuth is
for authorizing a client as a delegate. The connector guides say which route
each platform supports.

### 5. Test the connection

Ask your agent to call the read-only `electrohire_site_search` tool (for
example: *"Use ElectroHire to search for information about fractional
engineering pods"*). In the scaffold release the tool returns a clearly
marked placeholder result — that still proves the connection, the key, and
the wiring. An answer given without a tool call means the connector is not
active yet.

### 6. Revoke and rotate

Dashboard → **Settings → MCP API keys**: create the new key, update the
client, confirm the test passes, then revoke the old key. Revoking takes
effect immediately — clients still using the old key get **401** errors,
which is also how you recognize a missing, revoked, or expired key anywhere
else.

## A note on providers

These connectors are client-side guides: they teach *your* agent, running on
*your* platform, how to reach ElectroHire. They add no provider integration
to the ElectroHire platform itself, so the OpenRouter-only AI provider
policy for ElectroHire's own AI is unaffected.
