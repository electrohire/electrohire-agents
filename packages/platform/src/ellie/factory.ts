/**
 * Worker wiring: build an engine from a Worker's env. The store is the
 * shared D1 store when DB is bound (fresh per call, like storeFromEnv)
 * or the seeded in-memory store otherwise; the model client is the
 * OpenAI-compatible client — with no key for the route in force it is
 * the same client with no key, whose calls throw the typed
 * `model_not_configured` error the engine turns into the honest
 * fallback.
 *
 * Routes (see openrouter.ts header): OpenRouter by default
 * (AI-PROVIDER-POLICY). Setting ELLIE_MODEL_BASE_URL switches the
 * Worker to the configured self-hosted endpoint (the
 * layer1labs-inference bridge, owner directive 2026-11-10) with
 * ELLIE_MODEL_API_KEY as its key; the OpenRouter configuration stays
 * in place and resumes the moment the variable is removed.
 */
import { OpenRouterClient, parseModelList, DEFAULT_TEXT_MODELS, DEFAULT_VISION_MODELS } from "./openrouter.ts";
import { ellieStoreFromEnv, type EllieStore } from "./store.ts";
import { createEngine, type EllieEngine } from "./engine.ts";

export interface EllieEnv {
  DB?: D1Database;
  FILES?: import("./store.ts").EllieFilesBucket;
  OPENROUTER_API_KEY?: string;
  /** Self-hosted route (optional): base URL of an OpenAI-compatible
   * endpoint, e.g. the inference gateway's /v1. Unset = OpenRouter. */
  ELLIE_MODEL_BASE_URL?: string;
  /** Key for the self-hosted route (a Worker secret, never a var in
   * a committed wrangler.toml). Falls back to OPENROUTER_API_KEY when
   * unset, so a same-key gateway needs no second secret. */
  ELLIE_MODEL_API_KEY?: string;
  ELLIE_MODELS_TEXT?: string;
  ELLIE_MODELS_VISION?: string;
  ELLIE_DAILY_SPEND_CAP_USD?: string;
  ELLIE_SITE_KEYS_JSON?: string;
}

export function ellieEngineFromEnv(env: EllieEnv, storeOverride?: EllieStore): EllieEngine {
  const store = storeOverride ?? ellieStoreFromEnv(env);
  const baseUrl = (env.ELLIE_MODEL_BASE_URL ?? "").trim() || undefined;
  const client = new OpenRouterClient({
    apiKey: (baseUrl ? (env.ELLIE_MODEL_API_KEY || env.OPENROUTER_API_KEY) : env.OPENROUTER_API_KEY) || undefined,
    baseUrl,
    textModels: parseModelList(env.ELLIE_MODELS_TEXT, DEFAULT_TEXT_MODELS),
    visionModels: parseModelList(env.ELLIE_MODELS_VISION, DEFAULT_VISION_MODELS),
  });
  const capRaw = Number(env.ELLIE_DAILY_SPEND_CAP_USD ?? "5");
  return createEngine({ store, modelClient: client, dailySpendCapUsd: Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 5 });
}
