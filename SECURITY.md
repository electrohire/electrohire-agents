# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through **GitHub private vulnerability
reporting** for this repository:
[Report a vulnerability](https://github.com/electrohire/electrohire-agents/security/advisories/new).

Do **not** open a public issue for a vulnerability, and do not include API keys,
tokens, or other secrets in any issue, pull request, or report.

We aim to acknowledge reports within 3 business days and to keep reporters updated
as we investigate. Please give us a reasonable opportunity to fix an issue before
disclosing it publicly.

## Scope

In scope: the code in this repository — the API Worker (`apps/api`), the MCP server
Worker (`apps/mcp`), the skills (`skills/`), and the SDKs (`sdk/`), plus the public
endpoints they deploy to when announced here.

Out of scope: the ElectroHire website and marketplace application (separate, private
codebase), social engineering, and denial-of-service testing against live services.

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest release only.
