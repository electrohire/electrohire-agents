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
 * No API key configured is NOT an exception the caller must catch as a
 * crash: chat() throws the typed `model_not_configured` error and the
 * engine answers with the honest fallback (see engine.ts).
 */
import { allowedEgress } from "../security.ts";

export type EllieErrorCode =
  | "model_not_configured"
  | "spend_cap_exceeded"
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
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  onUsage?: (info: { day: string; model: string; costUsd: number }) => Promise<void>;
}

export function parseModelList(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [...fallback];
}
export const DEFAULT_TEXT_MODELS = ["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4o-mini"];
export const DEFAULT_VISION_MODELS = ["meta-llama/llama-3.2-11b-vision-instruct", "openai/gpt-4o-mini"];

export class OpenRouterClient implements ModelClient {
  readonly configured: boolean;
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
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.onUsage = opts.onUsage;
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
    const models = req.vision ? this.visionModels : this.textModels;
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
    throw new EllieError("model_unavailable", `No configured model answered (last status ${lastStatus || "none"}).`);
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
