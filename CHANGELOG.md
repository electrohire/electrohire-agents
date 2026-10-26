# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each component (API, MCP server, skills, SDKs) is versioned independently; the
version heading below tracks the repository release.

## [Unreleased]

### Added

- Blog and events on the agent surfaces (WS-5, 2026-10-26). The blog
  data spec 004 waited for has existed since Phase B / PB-4, so the API
  gains `GET /v1/blog` and `GET /v1/blog/{slug}` (published posts only)
  and `GET /v1/events`, and the MCP server gains
  `electrohire_list_blog_posts`, `electrohire_get_blog_post`, and
  `electrohire_list_events` — mirrored from the website's published-only
  public JSON. New scope `read:events`; blog routes/tools take
  `read:blog` (whose dashboard scope entry previously named no tools).
  API and MCP move to 0.7.0; Python SDK to 0.3.0 with `blog()`,
  `blog_post()`, and `events()`.
- The MCP + skills coverage gate (`tools/check-coverage.mjs`,
  `tools/coverage-map.json`): a blocking CI check that enumerates the
  served OpenAPI operations, the MCP tools, and the skills / connector
  guide / docs / SDK references, and fails when they diverge. This is
  the enforcement for the standing rule (2026-10-26): no system change
  ships without its MCP + skills updates in the same change.
- Two skill packages from spec 004's launch set: `electrohire-ellie-brief`
  (bring Ellie a project) and `electrohire-cite-facts` (cite ElectroHire
  facts). `electrohire-basics` moves to 0.2.0 with the current surface.

### Changed

- Every connector guide, config example, the registry, the skills, and
  the SDK now point at the live beta endpoints
  (`api-beta.electrohire.com`, `mcp-beta.electrohire.com`) — they
  previously named the not-yet-live production names and said the
  endpoints were not live. Guides now state correctly that Ellie action
  tools are offered, and that action tools accept a personal key with
  the action scope as well as OAuth 2.1.
- The Workers' content source is now the beta host's
  `/content/v1.json`; the previous source host
  (electrohire-website-staging.pages.dev) was retired with the staging
  Pages project. A new `PUBLIC_CONTENT_BASE_URL` var names the beta host
  for the blog/events JSON mirrors.

## [0.11.0] - 2026-10-26

### Fixed

- Double Ellie launcher on the beta website (WS-8). Every marketing
  page carried two floating launchers at the same corner: the website
  layout's own static "Ask Ellie" pill and the pill this loader
  injected. The loader's launcher is now the single launcher (the
  website removes its static pill in the companion website change):
  a 56px brand-navy disc whose face is the ElectroHire robot logo
  mark (inline SVG of the production plug-face mark), accessible
  name exactly "Chat with Ellie", with an idempotence guard so a
  duplicate embed can never inject a second one. The old loader
  blue (#0b5fff) is gone; the frame is responsive (400px card on
  desktop, full-screen sheet on phones) with safe-area insets.

### Changed

- The panel bundle is restyled to the website design system
  (PR #35 tokens: primary #207CF9, secondary #1e88e5, amber #f59e0b;
  Poppins/Sora/Outfit; dark surfaces) in `panel.css`, and the panel
  header carries the robot mark instead of a letter "E". Behaviour
  contract unchanged (in-panel Turnstile, session-token calls,
  disclosure-first, finalize/plan polling).

## [0.9.0] - 2026-10-25

### Fixed

- The served panel could not start a conversation. The bundle had
  been written against the spec's contract, which the service never
  implemented: it sent no Turnstile token to session creation, posted
  messages as `{ content }` without the session token, uploaded to
  `/upload`, and read the plan from a route that does not exist — and
  the service refused the panel's own origin at creation. The bundle
  now speaks the served contract (Turnstile-gated creation with the
  disclosure rendered first, session-token message/upload/finalize/
  escalate calls, `{ text }` / `{ reply }` shapes), and the service
  accepts its own first-party origin at session creation alongside
  the registered embedding origins (site key + Turnstile still gate
  every creation). Added `GET /api/chat/sessions/:id/analysis` — the
  session-authorized plan read (engine: `getAnalysisBySession`,
  additive on the store + engine) — and the `/panel` CSP now admits
  the Turnstile widget. Pinned by five new tests in
  `tests/panel.test.mjs` covering the anonymous panel protocol at
  the Worker layer.

## [0.8.0] - 2026-10-25

### Fixed

- The Ellie panel is no longer a stub. `GET /panel` on the Ellie
  Worker served a hardcoded 548-byte placeholder page (the
  `PANEL_STUB` constant) because the real panel bundle built in
  Phase E (website repo, `specs/002-ellie-platform/panel/`) was
  never copied into `apps/ellie/assets`. The bundle is now committed
  there (`panel/index.html` + `panel-assets/{panel.js,panel.css,
  ellie.css,ellie-aurora.css}`, byte-identical to the website-repo
  source) and the Worker serves it at `/panel` with the same framing
  headers; the stub remains only as a fallback if the bundle is
  missing at runtime. `/panel-assets/*` resolves through the ASSETS
  binding as designed. The enabled `/api/widget-config` response now
  carries the site key in its `panelUrl` (`/panel?siteKey=…`), which
  is the protocol the panel bundle reads its key from. Pinned by the
  new (non-frozen) `tests/panel.test.mjs`, which asserts the served
  content — not just the status — so a placeholder can never pass
  as the panel again.

## [0.7.0] - 2026-10-25

### Changed

- Ellie uploads moved from D1 BLOBs to R2 (the storage swap the Phase E
  store interface was shaped for): R2 was enabled on the account and
  the one platform bucket `electrohire-uploads` created; the Ellie
  Worker binds it as `FILES`. New uploads put their bytes in the
  bucket under `ellie/<session_id>/<upload_id>` and record the key in
  `ellie_uploads.r2_key` (website migration 0011); rows written before
  the swap keep their bytes in the `data` BLOB and still read. With no
  bucket bound, the store's D1 behavior is unchanged (local track /
  fallback). The 2 MB upload cap is **unchanged** — the frozen Phase E
  battery pins it; it stands as a product limit, not a storage limit.

### Added

- Session-authorized upload read-back routes on the Ellie Worker:
  `GET /api/chat/sessions/:id/uploads` (list),
  `GET /api/chat/sessions/:id/uploads/:uploadId` (the bytes), and
  `DELETE /api/chat/sessions/:id/uploads/:uploadId` (bytes + row +
  session-state note), behind the same session authorization as the
  chat POST routes. Store/engine gained `getUploadData` /
  `deleteUpload` / `getUpload` / `removeUpload` to match.
- Battery `tests/ellie-r2.test.mjs`: the D1 store against the real
  0008+0011 schema with a stand-in bucket — R2 round-trip, legacy BLOB
  read-back, no-bucket fallback, and delete semantics.
- Frozen-battery supersession (recorded, file untouched, per the C3
  precedent): `tests/frozen/ellie.test.mjs` runs 18/19 — its "D1
  store runs against the REAL migration 0007 schema" case embeds the
  pre-0011 schema verbatim, and the store's upload insert now names
  the `r2_key` column 0011 adds, so that one case fails on the missing
  column. The store requires migration 0011 (applied to the platform
  D1 in this change, before the Worker deploy); the frozen file is
  never edited.

## [0.6.0] - 2026-10-25

### Added

- Phase E — the Ellie service backend (spec 002 Phase 1; requirements
  E-01…E-05, E-07, E-08, E-10, and the service half of E-06):
  - New `@electrohire/platform` Ellie engine (`src/ellie/`): the
    versioned intake question set v1.0.0 as data (vendored
    `question-set.json`; the website's question-set document is
    generated from it), starter prompts per project type, the session
    state machine with the AI disclosure as every conversation's first
    message (SG-2), stepwise generation of the six analyst outputs
    (requirements, architecture, BOM, cost estimate, timeline,
    compliance roadmap — each a versioned draft with assumptions and
    unknowns; estimates always ranges with drivers, never a confidence
    percentage — SG-3, enforced by a hard output filter), staff-only
    approval of an exact version by payload hash (SG-1), edits that
    return an output to draft, and escalation filing a support ticket
    in the B-05 inbox shape with the conversation attached.
  - OpenRouter-only model client (AI provider policy / CMP-10):
    every request pins `provider.data_collection = "deny"`; ordered
    fallback on 404/429/5xx; the CUI profile additionally pins
    `allow_fallbacks = false` and refuses honestly
    (`cui_no_endpoint`) rather than downgrading. A daily spend guard
    refuses model calls at the configured cap. No direct provider
    integration exists anywhere.
  - New Worker `apps/ellie` (`electrohire-ellie`,
    ellie-beta.electrohire.com): the production-style site-key loader
    (`/loader.js` + `/api/widget-config`, registered origins only),
    website chat sessions (anonymous: site key + Origin + server-side
    Turnstile; signed-in: the internal BFF path only), uploads stored
    as D1 BLOBs with a 2 MB cap (R2 is not enabled on this account —
    storage sits behind the store interface), the `/panel` shell for
    the website-side panel bundle, and the credential-gated analysis
    API (`/api/analyses*`, scope `action:ellie_session`, audience-bound
    to the Ellie resource, cross-user bound).
  - Ellie actions on the existing surfaces (C-13 async pattern):
    `POST /v1/actions/ellie-session` + `GET /v1/ellie/analyses/:id` on
    the API Worker, and the `electrohire_ellie_session` /
    `electrohire_ellie_analysis` MCP tools, all through the shared
    gate. OAuth now offers `action:ellie_session` and the Ellie
    resource (`https://ellie-beta.electrohire.com`) — Phase E is
    un-gated as of 2026-10-25; the frozen C3 battery's "Ellie never
    offered" metadata assertion is superseded by this change and is
    recorded as such in the Phase E run record (the battery file
    itself is unchanged).
  - Copy-audit alignment (2026-10-25): the intake question set is
    production's agreed project-intake set (verbatim extraction in
    the website program's QUESTION-SET.md; production slug tokens
    for stage and services), with the facts-pass adaptations
    recorded in `questions.ts` (A1–A7 — the beta's published facts
    win over production wording). Ellie's prompt content is ported
    from production's project-intake analyst + extraction prompts
    (`prompts.ts` records ported vs fresh: consultant stance,
    guardrails, non-answer handling, evidence-only extraction,
    date/budget discipline; SG-1/SG-2/SG-3 framing written fresh),
    re-routed to OpenRouter only — production's LiteLLM/direct
    provider wiring was not ported. The E-07 corpus gains the five
    named injection cases from production's evals (b-assistant-edge-
    injection, b-customer-bio-injection, b-freelancer-ignore-
    instructions, b-project-injection, b-supplier-fake-system).
    `/api/widget-config` now answers in the production panel
    contract's shape with beta values (no email-reply or
    response-time promise in the copy). Production's backend
    dependency set (231 open Dependabot alerts, 14 critical) is
    inherited in full: none of it.
  - New local battery `tests/frozen/ellie.test.mjs` (18 tests:
    disclosure-first, question-set diff, stepwise six sections,
    SG-3 stripping, approval hash/staff gates, escalation, the
    injection corpus incl. the mined production cases, cross-user
    refusal, CUI refusal, spend cap, CMP-10 request capture +
    hostname grep, upload rules).
  - Parity manifest regenerated (15 API routes, 11 MCP tools).

### Changed

- Platform, API, MCP and Ellie versions move to 0.6.0.

## [0.5.0] - 2026-10-24

### Added

- D1-backed key store for the API and MCP Workers (follow-up to the
  Stage 1 backends acceptance): when the Worker carries the platform
  D1 binding (`DB` → electrohire-platform), the shared authorization
  gate resolves credentials from the same `api_keys` / `oauth_tokens`
  / `oauth_test_doubles` tables the dashboard writes — so a key minted
  in the dashboard works on the Workers, and a dashboard revocation
  refuses the very next request. Usage counts, rate windows and
  last-used persist back to the `api_keys` row, and every admitted
  request writes an `api_key_requests` metadata row in the website
  gate's exact shape. New frozen battery `tests/frozen/d1-store.test.mjs`
  proves the behavior against the real 0004/0005 schema.
- The committed `wrangler.toml` files for both apps are now the deploy
  config: they carry the `api-beta` / `mcp-beta` custom-domain routes
  and the `[[d1_databases]]` binding.

### Changed

- Platform, API and MCP versions move to 0.5.0.
- The deployed Workers no longer carry the `EH_LOCAL_KEYS_JSON_B64` /
  `EH_LOCAL_OAUTH_JSON_B64` seed vars: with `DB` bound, seed fixtures
  are inert by precedence (the gate never reads them) and are removed
  from the deployed settings. The seed path itself is unchanged for
  local development and tests.

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
