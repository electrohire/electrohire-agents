/**
 * E-05 / CMP-10 — the ONLY model route: OpenRouter.
 *
 * Every request body this client builds pins
 * provider.data_collection = "deny" (the provider policy as data, same
 * rule as C-12). No direct provider integration exists anywhere in this
 * module — model families are reached through OpenRouter only
 * (docs/AI-PROVIDER-POLICY.md).
 *
 * Profiles:
 *  - standard: ordered model list from env (ELLIE_MODELS_TEXT /
 *    ELLIE_MODELS_VISION); on 404/429/5xx the next model is tried.
 *  - CUI: data_collection deny + allow_fallbacks=false + ONLY the
 *    configured models. If no endpoint answers a CUI session, the call
 *    refuses honestly with a typed `cui_no_endpoint` error — it never
 *    silently downgrades to a non-CUI route.
 *
 * Free-first rule (WS-15, 2026-10-26): the ACTIVE lists are the free
 * (`:free`) models. Paid models may be LISTED in configuration
 * (paidTextModels / paidVisionModels, from ELLIE_MODELS_PAID_TEXT /
 * ELLIE_MODELS_PAID_VISION) so a future, explicit decision can enable
 * them, but they are NEVER tried as a silent fallback: this client
 * only calls a paid model when `allowPaidFallback` is set true by an
 * explicit configuration act (ELLIE_ALLOW_PAID_FALLBACK="true"). With
 * it unset/false and every free model failing, chat() throws
 * `model_unavailable` and the engine answers with the plain-language
 * free-tier limit message — no paid call, no opaque error.
 *
 * No API key configured is NOT an exception the caller must catch as a
 * crash: chat() throws the typed `model_not_configured` error and the
 * engine answers with the honest fallback (see engine.ts).
 */
import { allowedEgress } from "../security.ts";

export type EllieErrorCode =
  | "model_not_configured"
  | "spend_cap_exceeded"
  | "free_daily_cap_exceeded"
  | "cui_no_endpoint"
  | "model_unavailable"
  | "not_staff"
  | "payload_hash_mismatch"
  | "not_found"
  | "forbidden"
  | "unsupported_upload_type"
  | "upload_too_large";

export class EllieError extends Error {
  code: EllieErrorCode;
  constructor(code: EllieErrorCode, message: string) {
    super(message);
    this.name = "EllieError";
    this.code = code;
  }
}

export interface ModelMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest {
  messages: ModelMessage[];
  cui?: boolean;
  vision?: boolean;
  /** Optional data-URI image parts for vision calls (E-03: images are
   * marked at upload and passed to the vision model list at analysis). */
  imageDataUris?: string[];
}
export interface ChatResult { text: string; model: string; costUsd: number }

export interface ModelClient {
  chat(req: ChatRequest): Promise<ChatResult>;
  readonly configured: boolean;
}

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export interface OpenRouterOpts {
  apiKey?: string;
  textModels: string[];
  visionModels: string[];
  /** Paid models LISTED in configuration. Inert unless
   * allowPaidFallback is explicitly true — see the free-first rule
   * in this module's header. Listing a model here never, by itself,
   * makes it reachable. */
  paidTextModels?: string[];
  paidVisionModels?: string[];
  allowPaidFallback?: boolean;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  onUsage?: (info: { day: string; model: string; costUsd: number }) => Promise<void>;
}

/** A model id is on the free route exactly when OpenRouter marks it
 * with the `:free` suffix (zero per-token price). */
export function isFreeModel(model: string): boolean {
  return model.trim().endsWith(":free");
}

export function parseModelList(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [...fallback];
}
/** Active (free) defaults — WS-15 survey, 2026-10-26 (see the WS-15
 * record for the full table and probe evidence):
 *  - google/gemma-4-31b-it:free is the primary. Its one live endpoint
 *    (Google AI Studio) was at 100% uptime in the OpenRouter catalog
 *    on survey day, it is multimodal (text + image in), and the
 *    program's own 2026-10-25 routing probe found it eligible under
 *    the pinned data_collection: deny (the account privacy lock
 *    excludes free endpoints that train on data; this route answered
 *    under the pin — a 429 from upstream rate limits, not a routing
 *    refusal).
 *  - google/gemma-4-26b-a4b-it:free is the ordered fallback: same
 *    provider, same catalog posture, also multimodal.
 *  - meta-llama/llama-3.3-70b-instruct:free had ZERO live endpoints
 *    in the catalog on survey day, so it cannot be the primary.
 *  - The Nvidia Nemotron free routes are NOT listed: the 2026-10-25
 *    probe found the Nemotron free endpoint excluded by the account
 *    lock because it trains on data, and on survey day its catalog
 *    endpoint showed 0% uptime. Unproven routes stay out.
 * The deny pin on every body remains the enforcement: a free endpoint
 * that collects data cannot serve a pinned request — OpenRouter
 * returns no eligible endpoint instead of silently routing to it. */
export const DEFAULT_TEXT_MODELS = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"];
export const DEFAULT_VISION_MODELS = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"];
/** Paid models, listed in configuration only. These are the models
 * Ellie ran on before WS-15; they stay named so a future explicit
 * decision can re-enable them, and they are never called while
 * allowPaidFallback is off (the default). */
export const DEFAULT_PAID_TEXT_MODELS = ["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4o-mini"];
export const DEFAULT_PAID_VISION_MODELS = ["meta-llama/llama-3.2-11b-vision-instruct", "openai/gpt-4o-mini"];

export class OpenRouterClient implements ModelClient {
  readonly configured: boolean;
  /** The paid models listed in configuration (never called unless
   * allowPaidFallback was explicitly enabled). Exposed read-only so
   * tests and diagnostics can prove what is listed vs. what is live. */
  readonly paidTextModels: string[];
  readonly paidVisionModels: string[];
  readonly allowPaidFallback: boolean;
  private apiKey?: string;
  private textModels: string[];
  private visionModels: string[];
  private fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  private onUsage?: OpenRouterOpts["onUsage"];
  constructor(opts: OpenRouterOpts) {
    this.apiKey = opts.apiKey || undefined;
    this.configured = !!this.apiKey;
    this.textModels = opts.textModels.length ? opts.textModels : [...DEFAULT_TEXT_MODELS];
    this.visionModels = opts.visionModels.length ? opts.visionModels : [...DEFAULT_VISION_MODELS];
    this.paidTextModels = [...(opts.paidTextModels ?? DEFAULT_PAID_TEXT_MODELS)];
    this.paidVisionModels = [...(opts.paidVisionModels ?? DEFAULT_PAID_VISION_MODELS)];
    this.allowPaidFallback = opts.allowPaidFallback === true;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.onUsage = opts.onUsage;
  }

  /** The models one chat() call may actually try, in order. The paid
   * list joins the end ONLY under the explicit opt-in; otherwise the
   * active list is exactly the configured (free) list. */
  private modelsFor(req: ChatRequest): string[] {
    const active = req.vision ? this.visionModels : this.textModels;
    if (!this.allowPaidFallback) return active;
    const paid = req.vision ? this.paidVisionModels : this.paidTextModels;
    return [...active, ...paid.filter((m) => !active.includes(m))];
  }

  /** The request body for ONE model attempt. CMP-10 asserts on this
   * exact shape: data_collection is pinned to deny on every body. */
  buildRequestBody(model: string, req: ChatRequest): Record<string, unknown> {
    const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
    if (req.imageDataUris?.length && messages.length) {
      const last = messages[messages.length - 1] as unknown as { role: string; content: unknown };
      last.content = [
        { type: "text", text: String(req.messages[req.messages.length - 1].content) },
        ...req.imageDataUris.map((u) => ({ type: "image_url", image_url: { url: u } })),
      ];
    }
    const provider: Record<string, unknown> = { data_collection: "deny" };
    if (req.cui) provider.allow_fallbacks = false;
    return {
      model,
      messages,
      provider,
      ...(req.cui ? { allow_fallbacks: false } : {}),
    };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new EllieError("model_not_configured", "No OpenRouter API key is configured for Ellie (OPENROUTER_API_KEY is not set), so no model call can be made.");
    }
    const models = this.modelsFor(req);
    const url = `${OPENROUTER_BASE}/chat/completions`;
    if (!allowedEgress(url).allowed) throw new EllieError("model_unavailable", "Egress refused: the model gateway is not on the allowlist.");
    let lastStatus = 0;
    for (const model of models) {
      const body = this.buildRequestBody(model, req);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
        });
      } catch {
        lastStatus = 599;
        continue; // network failure: try the next configured model
      }
      if (res.status === 404 || res.status === 429 || res.status >= 500) {
        lastStatus = res.status;
        continue; // ordered fallback on 404/429/5xx only
      }
      if (!res.ok) {
        throw new EllieError("model_unavailable", `The model gateway refused the request (HTTP ${res.status}) for model ${model}.`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number }; model?: string };
      const text = data.choices?.[0]?.message?.content ?? "";
      const costUsd = typeof data.usage?.cost === "number" ? data.usage.cost : 0;
      if (this.onUsage) await this.onUsage({ day: new Date().toISOString().slice(0, 10), model: data.model ?? model, costUsd }).catch(() => undefined);
      return { text, model: data.model ?? model, costUsd };
    }
    if (req.cui) {
      throw new EllieError("cui_no_endpoint", `No eligible endpoint answered this CUI session (last status ${lastStatus || "none"}). The call is refused rather than downgraded: CUI sessions run only on the configured deny-collection profile.`);
    }
    const paidNote = !this.allowPaidFallback && (req.vision ? this.paidVisionModels : this.paidTextModels).length
      ? " Paid models are listed in configuration but paid fallback is not enabled, so none was tried."
      : "";
    throw new EllieError("model_unavailable", `No configured model answered (last status ${lastStatus || "none"}).${paidNote}`);
  }
}

/**
 * TEST-ONLY deterministic fake. Never wire this into a Worker: it
 * returns scripted replies in order (cycling the last one) so the local
 * batteries are deterministic with no network and no key.
 */
export class ScriptedModelClient implements ModelClient {
  readonly configured = true;
  calls: ChatRequest[] = [];
  private idx = 0;
  private script: string[] | ((req: ChatRequest, callIndex: number) => string);
  constructor(script: string[] | ((req: ChatRequest, callIndex: number) => string)) { this.script = script; }
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls.push(req);
    const i = this.idx++;
    const text = typeof this.script === "function"
      ? this.script(req, i)
      : this.script[Math.min(i, this.script.length - 1)] ?? "";
    return { text, model: "scripted-test-model", costUsd: 0.001 };
  }
}
