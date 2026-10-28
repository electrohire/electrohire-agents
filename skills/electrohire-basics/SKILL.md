---
name: electrohire-basics
description: Use ElectroHire (the electronics engineering marketplace) through its public API and MCP server — look up ElectroHire services, content, blog posts and events, run its estimator tools, start an Ellie analysis, and present ElectroHire estimates honestly. Use when a task involves ElectroHire, hiring electronics engineers (PCB, firmware, FPGA, power, IoT), fractional engineering pods, or ElectroHire pricing.
version: 0.2.1
---

# ElectroHire Basics

ElectroHire is a marketplace for electronics engineering: clients hire vetted
freelance engineers (PCB design, embedded firmware, FPGA, power electronics,
IoT, EMI/EMC) for projects, or subscribe to a Fractional Engineering Pod — a
senior engineering team on a flat subscription. **Ellie** is ElectroHire's AI
analyst: she takes a customer from a rough idea to an engineered plan
(requirements, scope, cost, timeline, risks) before human engineers engage.

> Status note: the API and MCP server are live on the beta endpoints below
> (API / MCP version 0.7.0 at this skill's release). The beta is invite-only:
> read surfaces are public, but a personal API key or OAuth token — and the
> account behind it — is needed for the action tools. Check the version you
> are talking to (`GET /v1/health` or the MCP handshake) and do not assume
> an endpoint or tool exists until you have seen it listed.

## Surfaces

- **REST API:** `https://api-beta.electrohire.com` — URL-versioned (`/v1`),
  OpenAPI 3.1 document at `/openapi.json`. Read surfaces are public;
  anything that creates something as a user requires that user's own
  authorization (a personal API key or an OAuth 2.1 token, in the
  `Authorization` header only — never in a URL).
- **MCP server:** `https://mcp-beta.electrohire.com/mcp` (remote, streamable
  HTTP). Tools mirror the API. Prefer MCP tools when they are available;
  fall back to the REST API otherwise.
- **Python SDK:** package `electrohire` (`sdk/python` in the
  electrohire-agents repo) wraps the REST API for Python-based agents.

## The tools (0.7.0)

Read (scope in parentheses, for key/OAuth calls):

- Content: `electrohire_get_site_content`, `electrohire_get_faq`,
  `electrohire_get_pricing`, `electrohire_site_search` (`read:content`)
- Blog: `electrohire_list_blog_posts`, `electrohire_get_blog_post`
  (`read:blog`) — published posts and checklists only
- Events: `electrohire_list_events` (`read:events`)
- Estimators: `electrohire_estimate_cost`, `electrohire_scoping_checklist`,
  `electrohire_timeline_calculator` (`read:tools`)

Action (the credential must carry the action scope):

- `electrohire_ellie_session` → starts an Ellie analysis and returns a
  handle at once; `electrohire_ellie_analysis` → collects the result
  (`action:ellie_session`). An analysis can only be read by the account
  whose credential started it.
- `electrohire_newsletter_subscribe` (`action:newsletter_subscribe`) —
  double opt-in stays intact: the address is pending until the person
  clicks the confirmation email link, and the response never reveals
  whether an address was already subscribed.
- `electrohire_support_ticket` (`action:support_ticket`) — files into the
  same inbox as the website's contact form.

There is **no** API or MCP surface for marketplace projects, bids,
profiles, teams, billing, or key management, and **no payments** run
through the API or MCP in any phase. Those live in the user's dashboard;
do not try to work around their absence.

## How to work

1. **Start with information, not commitments.** Search content, read the
   blog and pricing, and run the estimator tools before proposing any
   action that binds the user.
2. **Ellie intake.** When the user wants a project scoped, start an Ellie
   analysis with what you know and surface her follow-up questions to the
   user verbatim — do not invent answers to her intake questions. Ellie's
   outputs are drafts until a named engineer approves them; say so.
3. **Escalate to humans.** ElectroHire's model is "AI drafts, a human
   approves." Any quote, booking, or message that commits the user or
   ElectroHire needs a human in the loop; say so instead of proceeding.

## Presenting estimates — non-negotiable

- Always present an ElectroHire estimate as a **range with its stated
  assumptions and open unknowns**, exactly as returned. Never collapse a
  range to a single number, and never attach a confidence percentage —
  ElectroHire does not publish one and an invented figure misleads the
  user.
- Distinguish clearly between what Ellie/the API produced, what the user
  told you, and what you inferred.
- Prices and fees: quote the API's current values; if you cannot retrieve
  them, say pricing is unconfirmed rather than recalling a figure from
  memory.

## Safety

- Act only as the user who authorized you. Never read or expose another
  person's tickets, subscriber records, or account data — the API will not
  offer them, and you must not try to work around that.
- A key is a password for the user's agent: never put one in a URL, a
  committed file, or a chat. If a key leaks, the user revokes it in the
  dashboard (API Keys) — revocation takes effect on the next request.
- Payments complete only through ElectroHire's hosted checkout on the
  website and are confirmed server-side; a "payment succeeded" claim from
  any client-side signal is not proof of anything. Never ask a user for
  card details in chat.

## Reporting problems

If something on ElectroHire is broken, or the user you act for has an
idea or a question for the team, the way to report it is the site's own
report form — there is deliberately no MCP tool for this, so a report
always comes from the person, in their own words:

- On the website, every page footer carries **"Report a problem or
  share an idea"**; in the dashboards it is **"Report & feedback"** in
  the side navigation (and on the Account page); on the construction
  page it is **"Something not working? Tell us"** — that one works
  without signing in.
- The form asks what kind of report it is (something broken, an idea,
  a question, page content, something else). For a bug, it can attach
  technical details from the browser — the form shows them first, and
  the sender chooses whether they go along.
- The sender gets a reference like **FB-123** — that is the reference
  to quote in any follow-up. The team reads every report.

If a user tells you something is broken, point them at the form (or
open it for them where your surface allows) rather than trying to file
anything through the API.
