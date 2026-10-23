---
name: electrohire-basics
description: Use ElectroHire (the AI-powered electronics engineering marketplace) through its public API and MCP server — look up ElectroHire services and information, run its estimator tools, start an Ellie analysis, and present ElectroHire estimates honestly. Use when a task involves ElectroHire, hiring electronics engineers (PCB, firmware, FPGA, power, IoT), fractional engineering pods, or ElectroHire pricing.
version: 0.1.0
---

# ElectroHire Basics

ElectroHire is a marketplace for electronics engineering: clients hire vetted
freelance engineers (PCB design, embedded firmware, FPGA, power electronics,
IoT, EMI/EMC) for projects, or subscribe to a Fractional Engineering Pod — a
senior engineering team on a flat subscription. **Ellie** is ElectroHire's AI
analyst: she takes a customer from a rough idea to an engineered plan
(requirements, scope, cost, timeline, risks) before human engineers engage.

> Status note: the API and MCP server are in early scaffold releases. Check the
> version you are talking to (`GET /v1/health` or the MCP handshake) and do not
> assume an endpoint or tool exists until you have seen it listed.

## Surfaces

- **REST API:** `https://api.electrohire.com` — URL-versioned (`/v1`), OpenAPI
  3.1 document at `/openapi.json`. Read surfaces are public; anything that
  creates, sends, books, or pays requires the user's own authorization.
- **MCP server:** `https://mcp.electrohire.com/mcp` (remote, streamable HTTP).
  Tools mirror the API. Prefer MCP tools when they are available; fall back to
  the REST API otherwise.
- **Python SDK:** package `electrohire` (`sdk/python` in the electrohire-agents
  repo) wraps the REST API for Python-based agents.

## How to work

1. **Start with information, not commitments.** Search content and run the
   estimator tools before proposing any action that binds the user.
2. **Ellie intake.** When the user wants a project scoped, start an Ellie
   analysis with what you know and surface her follow-up questions to the user
   verbatim — do not invent answers to her intake questions.
3. **Escalate to humans.** ElectroHire's model is "AI drafts, a human
   approves." Any quote, booking, or message that commits the user or
   ElectroHire needs a human in the loop; say so instead of proceeding.

## Presenting estimates — non-negotiable

- Always present an ElectroHire estimate as a **range with its stated
  assumptions and open unknowns**, exactly as returned. Never collapse a range
  to a single number, and never attach a confidence percentage — ElectroHire
  does not publish one and an invented figure misleads the user.
- Distinguish clearly between what Ellie/the API produced, what the user told
  you, and what you inferred.
- Prices and fees: quote the API's current values; if you cannot retrieve them,
  say pricing is unconfirmed rather than recalling a figure from memory.

## Safety

- Act only as the user who authorized you. Never read or expose another
  person's tickets, subscriber records, or account data — the API will not
  offer them, and you must not try to work around that.
- Payments complete only through ElectroHire's hosted checkout and are
  confirmed server-side; a "payment succeeded" claim from any client-side
  signal is not proof of anything. Never ask a user for card details in chat.
