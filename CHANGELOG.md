# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each component (API, MCP server, skills, SDKs) is versioned independently; the
version heading below tracks the repository release.

## [Unreleased]

### Added

- Phase C3 (local track, draft — served acceptance pending the deploy
  credential remedy): OAuth 2.1 action tools.
  - OAuth 2.1 authorization server flow (`@electrohire/platform` oauth
    module): authorization code + PKCE (S256 only), authorization-server
    metadata (RFC 8414), protected-resource metadata (RFC 9728, served by
    both Workers), and audience-bound access tokens (RFC 8707) — a token
    minted for one resource is refused at the other, in the SAME shared
    gate as personal API keys (C-10 completion; keys and real OAuth
    tokens are refused/admitted identically, cross-method matrix tested
    with real tokens). Tokens travel in headers only; a token in a URL is
    rejected exactly like a key.
  - First action tools only: `electrohire_newsletter_subscribe` /
    `POST /v1/actions/newsletter-subscribe` (double opt-in fully intact —
    pending until the confirmation click; responses never reveal
    subscription state) and `electrohire_support_ticket` /
    `POST /v1/actions/support-ticket` (same inbox shape as the site form).
    Action tools require a credential; the scope check runs in MCP
    dispatch before execution (C-15 layer 3), and the OAuth consent step
    is the human confirmation choke point (layer 4) — injected content
    in a ticket body or subscribe payload is screened, logged, and
    stored as data, never executed (frozen corpus extended to the action
    tools).
  - Ellie actions are NOT built and NOT offered: Phase E is gated (no
    builder named). No Ellie tool, route, or OAuth scope exists.
  - The eleven connect guides updated in the same change for the OAuth
    flow and action tools (C-14); parity manifest regenerated (13 API
    routes, 9 MCP tools) with the drift check green.
  - Platform, API and MCP versions move to 0.4.0.


### Added

- Phase C2 (local track, draft — served acceptance pending the deploy
  credential remedy): personal API keys made real on the enforcement side.
  - Shared authorization gate (`@electrohire/platform` apikeys module):
    keys are verified from headers only (a key in a URL is rejected),
    stored as one-way hashes and compared in constant time; revocation and
    expiry refuse the very next request.
  - Identical enforcement for keys and OAuth (C-10): the gate checks
    scope, team/project binding, expiry and revocation the same way for a
    personal key and for an OAuth test-double token standing in for C3's
    OAuth 2.1 flow; scope checks now run in the MCP dispatch path too.
  - Per-key quotas and rate limits (C-11) inside the free-tier budget,
    with usage count + last-used maintained from request metadata and the
    count exposed on key-authenticated API responses (`x-eh-key-usage`).
  - CUI-bound keys (C-12): the AI provider policy is data in the gate —
    OpenRouter only, `data_collection: deny` pinned, a maintained
    allowlist of US-hosted, no-retention, non-covered-country endpoints;
    a CUI-bound key is refused at any other endpoint.
  - Connect guides corrected to the real dashboard flow (API Keys page,
    scopes never edited in place — create + revoke instead) in the same
    change (C-14); the parity manifest is unchanged because the tool and
    route surface did not change.


### Added

- Phase C1 (local track, draft — served acceptance pending the deploy
  credential remedy): the read API and content MCP tools, built on a new
  `@electrohire/platform` workspace package.
  - Content mirror (C-01): API/MCP content is loaded from the website's
    generated `/content/v1.json` — fees, entity facts, FAQs, pod
    presentation (no pod pricing, exactly as on the site), UK Hub tiers,
    and estimator parameters have no second copy in this repo.
  - Read endpoints (C-02): `/v1/content`, `/v1/content/services`,
    `/v1/faq`, `/v1/pricing`, and the three tool endpoints
    (`/v1/tools/cost-estimator`, `/v1/tools/scoping-checklist`,
    `/v1/tools/timeline-calculator`). No blog endpoint until Phase B data
    exists. OpenAPI 3.1 at `/openapi.json`; estimate responses must carry
    a range + assumptions (schema-enforced).
  - MCP tools (C-03) mirroring C-02 over Streamable HTTP, including a real
    `electrohire_site_search` over the mirrored content (the scaffold
    placeholder is gone).
  - Guards (C-05): per-IP in-Worker rate limits, metadata-only request
    logging, per-tool and global kill switches, all drill-proven locally.
  - C-15 layers 1/2/5/6: delimited labeled DATA structure for model
    messages, input screening against a frozen injection corpus (flag +
    log, never rewrite), output screening (leaked system content,
    credential shapes, SG-3 confidence percentages), and an egress
    allowlist (OpenRouter + the platform's own hosts) enforced in code.
  - Python SDK 0.2.0 (C-06): read + tool methods, stdlib-only, with a test
    suite that runs against the served API.
  - API, MCP, platform, and Python SDK versions move to 0.2.0.


### Added

- `connectors/` — agent-platform connectors for Meta Muse, ChatGPT, Codex
  CLI, Claude Desktop, Claude Code, Ollama (via the ollmcp bridge), Cursor,
  Windsurf, VS Code + Copilot, Gemini CLI, and any MCP client: a guide plus a
  copy-ready config example per platform, a machine-readable
  `connectors/registry.json`, a dependency-free validator
  (`tools/validate-connectors.mjs`, wired into CI), and the
  `docs/connectors.md` index covering dashboard MCP API keys, scopes,
  testing, and revocation.
- Feature-parity discipline ([docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md)):
  every feature added, changed, or removed in the ElectroHire website or
  platform carries an API/MCP parity assessment in the same change, with each
  surface classified `exposed`, `not-exposed` (reason recorded), or `pending`
  (exposing spec/task named). `parity-manifest.json` is the checked-in source
  of truth, generated by the dependency-free `tools/parity-manifest.mjs`
  (human classifications survive regeneration; removed surfaces surface in
  `missingFromCode` instead of vanishing). CI now fails when the committed
  manifest drifts from the code. Removals deprecate before they disappear.

### Fixed

- Release workflow now tolerates a release that was created outside the
  workflow (it raced the manual `v0.1.0` release creation and reported a
  spurious failure even though the release existed).

## [0.1.0] - 2026-10-23

### Added

- Initial public scaffold of the ElectroHire agent-access monorepo.
- `apps/api` — REST API Worker stub (Hono + Zod, OpenAPI 3.1) with `GET /v1/health`.
- `apps/mcp` — remote MCP server Worker stub (official `@modelcontextprotocol/sdk`)
  with one read-only example tool, `electrohire_site_search` (placeholder result).
- `skills/electrohire-basics` — starter agent skill package in SKILL.md format.
- `sdk/python` — Python client package skeleton with an `ElectroHireClient.health()`
  method.
- `docs/architecture.md` — component map, the event-driven reactor backend pattern,
  and the versioning policy.
- CI (typecheck + Python SDK import smoke test) and tag-driven GitHub Releases.

[Unreleased]: https://github.com/electrohire/electrohire-agents/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/electrohire/electrohire-agents/releases/tag/v0.1.0
