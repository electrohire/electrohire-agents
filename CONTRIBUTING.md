# Contributing

Thanks for helping make ElectroHire easier for agents — and the people behind them —
to work with.

## Ground rules

- **No secrets, ever.** API keys, tokens, and credentials do not belong in code,
  issues, or pull requests. Local Worker secrets go in `.dev.vars` (git-ignored).
- **Honest stubs.** Placeholder code must say so, in its output and its comments.
  Never present a scaffold result as real data.
- **Estimates carry their uncertainty.** Anything user-facing that returns an
  ElectroHire estimate must include the range and stated assumptions, never a bare
  number or an invented confidence percentage.
- **Public-repo discipline.** This repository is public. Do not reference internal
  systems, private repositories, or account identifiers.

## Development

Requirements: Node 24 (see `.nvmrc`) and pnpm 12.

```bash
pnpm install
pnpm typecheck        # typechecks every workspace package
pnpm --filter @electrohire/api dev
pnpm --filter @electrohire/mcp dev
```

Python SDK:

```bash
pip install -e sdk/python
python -c "from electrohire import ElectroHireClient; print(ElectroHireClient())"
```

## Pull requests

- Keep one component per PR where you can (`apps/api`, `apps/mcp`, `skills/…`, `sdk/…`).
- Update `CHANGELOG.md` under `## [Unreleased]` for anything user-visible.
- Bump the component's own version (its `package.json`, `VERSION`, or `pyproject.toml`)
  when you change its behavior, following the versioning policy in
  [`docs/architecture.md`](docs/architecture.md#versioning-policy).
- CI must pass: TypeScript typecheck across the workspace and the Python SDK import
  smoke test.

## Releases

Releases are cut from git tags (`v*`) by a maintainer; the release workflow builds
the GitHub Release notes from the matching `CHANGELOG.md` section.
