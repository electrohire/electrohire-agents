/**
 * Worker wiring: build an engine from a Worker's env. The store is the
 * shared D1 store when DB is bound (fresh per call, like storeFromEnv)
 * or the seeded in-memory store otherwise; the model client is the
 * OpenRouter client — with no OPENROUTER_API_KEY it is the same client
 * with no key, whose calls throw the typed `model_not_configured`
 * error the engine turns into the honest fallback. No other model
 * route exists (AI-PROVIDER-POLICY: OpenRouter only).
 */
import { OpenRouterClient, parseModelList, DEFAULT_TEXT_MODELS, DEFAULT_VISION_MODELS } from "./openrouter.ts";
import { ellieStoreFromEnv, type EllieStore } from "./store.ts";
import { createEngine, type EllieEngine } from "./engine.ts";

export interface EllieEnv {
  DB?: D1Database;
  FILES?: import("./store.ts").EllieFilesBucket;
  OPENROUTER_API_KEY?: string;
  ELLIE_MODELS_TEXT?: string;
  ELLIE_MODELS_VISION?: string;
  ELLIE_DAILY_SPEND_CAP_USD?: string;
  ELLIE_SITE_KEYS_JSON?: string;
}

export function ellieEngineFromEnv(env: EllieEnv, storeOverride?: EllieStore): EllieEngine {
  const store = storeOverride ?? ellieStoreFromEnv(env);
  const client = new OpenRouterClient({
    apiKey: env.OPENROUTER_API_KEY || undefined,
    textModels: parseModelList(env.ELLIE_MODELS_TEXT, DEFAULT_TEXT_MODELS),
    visionModels: parseModelList(env.ELLIE_MODELS_VISION, DEFAULT_VISION_MODELS),
  });
  const capRaw = Number(env.ELLIE_DAILY_SPEND_CAP_USD ?? "5");
  return createEngine({ store, modelClient: client, dailySpendCapUsd: Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 5 });
}
