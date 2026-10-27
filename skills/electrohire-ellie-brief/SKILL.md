---
name: electrohire-ellie-brief
description: Bring Ellie a project — prepare a brief ElectroHire's AI analyst can analyze well, start the analysis through the ElectroHire MCP tools or API, and work the follow-up questions with the user. Use when a user wants an electronics project scoped, planned, or sanity-checked by Ellie.
version: 0.1.0
---

# Bring Ellie a Project

Ellie is ElectroHire's AI analyst. She takes a rough idea and produces an
engineered plan: requirements, scope, a cost range with its assumptions, a
timeline range, and the risks a human engineer would flag first. Her output
is a **draft** — a named engineer approves anything before it is relied on
or money moves — and you must say that when you present it.

## What a good brief contains

Ask the user for what Ellie can actually use, and say plainly what is still
missing instead of filling gaps with guesses:

- **What the product must do**, in testable plain sentences.
- **What is deliberately out of scope** for the first version.
- **The needs involved**: PCB design, firmware, wireless, battery,
  enclosure, an app, compliance work.
- **Product type and stage** (idea, sketch, existing product) and the
  rough unit count if production is planned.
- **Constraints that bound the design**: size, environment, battery life,
  target markets (they decide the compliance route), and the date the
  product must exist by.
- **Budget range**, if the user has one. A range and a date are what
  engineers bid seriously against.

## The flow

1. Gather the brief above. Run `electrohire_scoping_checklist` first if
   the user is unsure what a project needs decided — its groups are the
   same list Ellie works from.
2. Start the analysis with `electrohire_ellie_session` (MCP) or
   `POST /v1/actions/ellie-session` (API). This needs a credential with
   the `action:ellie_session` scope — the user's own API key or OAuth
   grant. The call returns a handle at once; no call waits for Ellie to
   think.
3. Collect the result with `electrohire_ellie_analysis` (or
   `GET /v1/ellie/analyses/{id}`). While it is generating, tell the user
   it is still working rather than presenting a partial section as final.
   Only the account whose credential started the analysis can read it.
4. If Ellie asks follow-up questions, put them to the user **verbatim**.
   Never invent answers to her intake questions — an answer you made up
   becomes a requirement nobody chose.
5. Present the result: the plan, the cost **range with its assumptions**,
   the timeline **range** with its assumptions, and the risks — labelled
   as Ellie's draft, with the path to a human engineer offered.

## Rules

- Never present an estimate as a quote or a single firm number (see the
  electrohire-basics skill for the full presentation discipline).
- Disclose that Ellie is an AI analyst when her work is presented.
- If there is no credential with the Ellie scope, explain that the user
  can create a key in their dashboard (API Keys) with the
  `action:ellie_session` scope, or use Ellie on the website — do not ask
  the user to paste a key into chat.
