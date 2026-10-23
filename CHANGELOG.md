# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Each component (API, MCP server, skills, SDKs) is versioned independently; the
version heading below tracks the repository release.

## [Unreleased]

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
