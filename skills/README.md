# Agent skills

Portable skill packages (SKILL.md format) that teach an AI agent how to use
ElectroHire well through the API and MCP server in this repository.

Each skill is a folder:

```
skills/<skill-name>/
  SKILL.md    # frontmatter (name, description, version) + instructions
  VERSION     # this skill's own semantic version
```

Skills are versioned independently of the API and MCP server. A skill states the
surfaces it assumes; check `GET /v1/health` or the MCP handshake before relying
on a capability.

| Skill | Version | Purpose |
|---|---|---|
| [electrohire-basics](electrohire-basics/SKILL.md) | 0.2.0 | Core usage: surfaces, the full tool list, work pattern, and the estimate-presentation discipline. |
| [electrohire-ellie-brief](electrohire-ellie-brief/SKILL.md) | 0.1.0 | Bring Ellie a project: what a good brief contains and how an analysis flows from start to result. |
| [electrohire-cite-facts](electrohire-cite-facts/SKILL.md) | 0.1.0 | Cite ElectroHire facts: fees, pod presentation, UK Hub tiers, the two-entity story, and terminology — from the live surfaces, not memory. |

Skills are kept in step with the API and MCP surface by the coverage gate
(`tools/check-coverage.mjs`, run in CI): a skill that names a tool or an
endpoint that no longer exists fails the build, and so does a tool no
skill or guide mentions. See `docs/FEATURE-PARITY.md`.
