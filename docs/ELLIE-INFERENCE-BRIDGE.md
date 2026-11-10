# Ellie on the layer1labs-inference node — bridge design and activation

Owner directive, 2026-11-10: "I need Ellie now. We can connect to
layer1labs-inference for now." This document is the bridge that makes
that possible, the reachability evidence behind it, and the exact
activation steps. The code half is in this change (the model client
accepts a configured endpoint); the serving half below runs on
owner-controlled fleet hardware. Nothing here deploys anything by
itself.

## The node (facts of record, 2026-11-10)

`layer1labs-inference` is Ryan Anderson's GPU workstation (RTX PRO
5000 Blackwell, 48 GB) on the Layer1Labs tailnet, shared as a guest
to the ElectroHire and fleet tailnets. Its adopted inference stack
(bake-off scorecard, 2026-11-10): the NInfer engine serving
Qwen3.8-27B NVFP4, fronted by a LiteLLM proxy (`ninfer-litellm`),
with gpt-oss-20b as resident fast companion. The node's own LiteLLM
serves two model names: `NInfer` (primary, 16/16 corrected quality
in the bake-off, ~132 tok/s) and `gpt-oss-20b` (fast companion).
Those are the names Ellie uses on this route.

## Reachability — measured 2026-11-10, not assumed

Probed from the Muse VM and from mini-server (a native fleet-tailnet
machine), through the tailnet:

| Target | Result |
| --- | --- |
| Node engine, tailnet IP port 8090, plain HTTP | **Answers.** A models-list GET against its /v1 base, sent without a key, returns the OpenAI-shaped `401 {"error":{"code":"invalid_api_key",...}}`. Transport works from both vantage points; the endpoint is key-gated. |
| Node LiteLLM via Tailscale Serve HTTPS, port 4000 | **Handshake fails** from both vantage points (`tlsv1 alert internal error` for every SNI tried; plain HTTP gets Go's "Client sent an HTTP request to an HTTPS server"). A box-side serve condition; not fixable from the fleet side, and not needed by this design. |
| Anything on the node, from a Cloudflare Worker | **Impossible directly.** Workers have no tailnet client and the node has no public ingress. A bridge is required — that is what this document specifies. |

## Bridge shape

```text
Ellie Worker (Cloudflare)
  -- HTTPS, ELLIE_MODEL_API_KEY -->  inference gateway (mini-server)
  -- tailnet HTTP, node key ------>  layer1labs-inference engine :8090
```

- **Gateway**: a LiteLLM instance on **mini-server** (the fleet
  architecture of record already names mini-server as the one
  LiteLLM front door for serving machines). It holds the node key,
  exposes the two model names `NInfer` and `gpt-oss-20b`, and is the
  only component that talks to the node. Gateway model config
  sketch (keys via environment, never in the file):

  ```yaml
  model_list:
    - model_name: NInfer
      litellm_params:
        model: openai/<engine-served-model-id>   # read from the node's stack config when the key is handed over
        api_base: http://layer1labs-inference.tail8508ce.ts.net:8090/v1
        api_key: os.environ/NODE_INFERENCE_KEY
    - model_name: gpt-oss-20b
      litellm_params:
        model: openai/gpt-oss-20b
        api_base: http://layer1labs-inference.tail8508ce.ts.net:8090/v1
        api_key: os.environ/NODE_INFERENCE_KEY
  ```

  (gpt-oss-20b is registered in the node's own LiteLLM today; if the
  gateway must reach it engine-direct instead, its llama.cpp
  endpoint on the node is the upstream. The gateway's registration
  step settles this from the node's stack config — see blockers.)

- **Ingress**: mini-server already runs cloudflared for other fleet
  programs. Add one tunnel route on an ElectroHire-controlled
  hostname to the gateway port, with the gateway's own key auth
  (LiteLLM master/virtual key) as the credential Ellie presents.
  The hostname becomes `ELLIE_MODEL_BASE_URL` (`https://<host>/v1`).

- **Key custody**: two keys, both placed through the Secure Vault /
  `wrangler secret put` flows, never in files or chat: the node's
  engine key (held today only in the node's stack config on Ryan's
  box — the Layer1Labs side hands it over), and the gateway key
  (generated when the gateway is stood up; placed on the three
  Workers as `ELLIE_MODEL_API_KEY`).

## Activation (ordered; each step is a named act)

1. Layer1Labs side: hand over the node engine key and the engine's
   served model id (both read from the node's stack config), and
   record Ryan's consent to standing remote use — the serving plan's
   gate (b). The owner's 2026-11-10 directive authorizes the
   ElectroHire side; standing inference service on Ryan's hardware
   is the Layer1Labs-side grant, same as runner enrolment.
2. Fleet ops: stand up the LiteLLM gateway on mini-server with the
   node as upstream; verify from mini-server with the node key
   (a models-list call, then one chat completion per model).
3. Fleet ops: add the cloudflared route; verify the gateway answers
   over its public hostname with the gateway key, and refuses
   without it.
4. Owner decision recorded: amend docs/AI-PROVIDER-POLICY.md (the
   copy of record in the website repo) for this route, the way
   PR #73 recorded the retention-standard decision. Until then the
   route stays inactive in committed config.
5. ElectroHire side: in all three wrangler.toml files, set
   `ELLIE_MODEL_BASE_URL` to the gateway `/v1`, set
   `ELLIE_MODELS_TEXT` / `ELLIE_MODELS_VISION` to `NInfer,gpt-oss-20b`,
   place `ELLIE_MODEL_API_KEY` on all three Workers, deploy.
6. Proof (the WS-15 gate, carried over): run the three pilots
   against the deployed Ellie and confirm from `ellie_usage` which
   model answered. A 429 or failure round stops the activation, it
   does not get retried in a loop.

## What this change does NOT do

- It does not deploy, and the committed wrangler configuration keeps
  Ellie on OpenRouter. The route activates only through the steps
  above.
- It does not retire OpenRouter: the configuration remains as the
  fallback — removing `ELLIE_MODEL_BASE_URL` restores it exactly.
- It does not weaken the CUI profile: on this route a CUI session
  runs only on the configured endpoint and refuses (typed
  `cui_no_endpoint`) when it does not answer.
- Vision: the node's primary is text+vision capable at the engine,
  but the route's vision behavior is unproven; the pilots in step 6
  are text. Treat vision calls on this route as unverified until a
  vision pilot passes.
