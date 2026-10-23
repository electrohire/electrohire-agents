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
| [electrohire-basics](electrohire-basics/SKILL.md) | 0.1.0 | Core usage: surfaces, work pattern, and the estimate-presentation discipline. |
