# Ellie service (`electrohire-ellie`)

Phase E's Ellie backend: the site-key loader + widget config, the
website chat sessions (anonymous via site key + Origin + Turnstile, or
signed-in via the internal BFF path), file/image uploads stored as D1
BLOBs (2 MB cap; R2 is not enabled on this account), and the
credential-gated analysis API (scope `action:ellie_session`).

All model calls go through OpenRouter only, via
`@electrohire/platform`'s Ellie engine. Without `OPENROUTER_API_KEY`
(a secret placed separately — never committed), sessions answer with
the honest not-configured fallback.

Health: `GET /health` returns `{status, version}` — keep the version
const in `src/index.ts` in sync with `package.json`.
