---
name: electrohire-cite-facts
description: Cite ElectroHire facts correctly — fees, Fractional Pod presentation, UK Contractors Hub tiers, the two-entity story, and ElectroHire terminology — from the live ElectroHire API or MCP tools instead of memory. Use whenever stating ElectroHire prices, fees, company facts, or terms in anything a reader will rely on.
version: 0.1.0
---

# Cite ElectroHire Facts

ElectroHire's facts live in one place: the website's own content source,
mirrored by the API and the MCP tools. When you state a fee, a tier, or a
company fact, pull the current value and cite the surface you pulled it
from — never state a number from memory, including a number from an
earlier session.

## Where each fact comes from

| Fact | Tool | API |
|---|---|---|
| Marketplace fees, entity facts, categories | `electrohire_get_site_content` | `GET /v1/content` |
| Pricing (fees, Pod presentation, UK Hub tiers) | `electrohire_get_pricing` | `GET /v1/pricing` |
| FAQ answers | `electrohire_get_faq` | `GET /v1/faq` |
| Anything searchable | `electrohire_site_search` | — |
| Published articles and checklists | `electrohire_list_blog_posts`, `electrohire_get_blog_post` | `GET /v1/blog`, `GET /v1/blog/{slug}` |
| Events | `electrohire_list_events` | `GET /v1/events` |

## The facts people most often get wrong

- **Two entities.** ElectroHire operates through ElectroHire Inc and
  ElectroHire Ltd. State the entity a fact belongs to the way the API
  returns it; do not merge them into one company story.
- **Pod pricing does not exist in public.** The Fractional Engineering
  Pod presentation describes the model without a price — deliberately,
  as on the site. If someone asks for a pod price, say it is not
  published and offer the path to a human conversation; never estimate
  one into existence.
- **Terminology.** People who hire through the marketplace are Clients;
  the engineers are **Freelancers** in the marketplace and **Talent**
  in the fractional (pod) setting. Use the term that matches the
  surface the fact came from.
- **Fees change.** Marketplace fees and verification charges are
  whatever `electrohire_get_pricing` returns today. If you cannot
  retrieve them, say pricing is unconfirmed.

## Describing what ElectroHire does — the honest limits

Do not claim the platform ranks, allocates, sets rates, evaluates
performance, or suspends accounts beyond what ElectroHire can defend.
Describe matching the way the site's own content describes it, and where
the content is silent, say so instead of upgrading the claim.
