/**
 * C-01 content mirror. The website is the source of truth: its build emits
 * a versioned document at /content/v1.json from apps/web/src/lib (fees and
 * entity facts in site.ts; FAQs, pod presentation, UK Hub tiers, and
 * estimator parameters in their own lib modules). This loader fetches and
 * caches that document — there is NO hand-maintained copy of any content
 * fact in this repository.
 *
 * Local track (C1 draft): no KV exists on the account yet, so the cache is
 * (a) a KV binding when one is present, else (b) in-isolate memory, with
 * CONTENT_JSON as a local-dev stand-in injected by wrangler --var / env.
 * The served track swaps the stand-in for the KV binding with no code
 * change. A document whose schemaVersion is not understood is REFUSED,
 * never served subtly wrong.
 */
import { guardedFetch } from "./security.ts";

export interface ContentDoc {
  schemaVersion: number;
  source: string;
  site: { name: string; nav: { href: string; label: string }[]; categories: { name: string; blurb: string }[] };
  fees: {
    clientFeePct: number; freelancerFeePct: number; sparksPerBid: number;
    identityVerification: string;
    example: { bid: number; clientPays: number; engineerReceives: number };
  };
  entities: Record<string, unknown>[];
  orgSameAs: string[];
  faqs: Record<string, { q: string; a: string }[]>;
  pods: {
    model: string; terms: string; notIncluded: string;
    audience: string[]; included: string[];
    composition: { role: string; detail: string }[];
    rhythm: { when: string; detail: string }[];
  };
  ukHub: { currency: string; tiers: Record<string, unknown>[] };
  services: { categories: { name: string; blurb: string }[]; pages: { slug: string; path: string; title: string }[] };
  estimator: {
    costs: Record<string, { label: string; low: number; high: number }>;
    typeMultipliers: Record<string, number>;
    stageMultipliers: Record<string, number>;
    largeRun: { unitsValue: string; low: number; high: number; label: string };
    timeline: { baseLow: number; perNeedLow: number; baseHigh: number; perNeedHigh: number };
    assumptions: string[];
  };
}

export interface KvLike {
  get(key: string): Promise<string | null>;
  put?(key: string, value: string): Promise<void>;
}

export interface ContentEnv {
  CONTENT_JSON?: string;
  /** Local-dev stand-in, base64-encoded (dotenv parsers mangle raw JSON). */
  CONTENT_JSON_B64?: string;
  CONTENT_SOURCE_URL?: string;
  CONTENT_KV?: KvLike;
}

export const SUPPORTED_CONTENT_SCHEMA = 1;
const KV_KEY = "content/v1.json";
let memoryCache: ContentDoc | null = null;

export function parseContentDoc(raw: string): ContentDoc {
  const doc = JSON.parse(raw) as ContentDoc;
  if (doc.schemaVersion !== SUPPORTED_CONTENT_SCHEMA) {
    throw new Error(`Unsupported content schemaVersion ${doc.schemaVersion} (this build understands ${SUPPORTED_CONTENT_SCHEMA})`);
  }
  if (!doc.fees || !doc.faqs || !doc.pods || !doc.ukHub || !doc.estimator) {
    throw new Error("Content document is missing required sections");
  }
  return doc;
}

export async function loadContent(env: ContentEnv): Promise<ContentDoc> {
  if (memoryCache) return memoryCache;
  if (env.CONTENT_JSON_B64) {
    const bytes = Uint8Array.from(atob(env.CONTENT_JSON_B64), (ch) => ch.charCodeAt(0));
    memoryCache = parseContentDoc(new TextDecoder().decode(bytes));
    return memoryCache;
  }
  if (env.CONTENT_JSON) {
    memoryCache = parseContentDoc(env.CONTENT_JSON);
    return memoryCache;
  }
  if (env.CONTENT_KV) {
    const hit = await env.CONTENT_KV.get(KV_KEY);
    if (hit) { memoryCache = parseContentDoc(hit); return memoryCache; }
  }
  if (!env.CONTENT_SOURCE_URL) throw new Error("No content source configured (CONTENT_JSON, CONTENT_KV, or CONTENT_SOURCE_URL required)");
  // Layer 6: the fetch itself goes through the egress allowlist.
  const res = await guardedFetch(env.CONTENT_SOURCE_URL);
  if (!res.ok) throw new Error(`Content source fetch failed: HTTP ${res.status}`);
  const raw = await res.text();
  const doc = parseContentDoc(raw);
  if (env.CONTENT_KV?.put) await env.CONTENT_KV.put(KV_KEY, raw).catch(() => undefined);
  memoryCache = doc;
  return doc;
}

/** Test/local helper: drop the in-isolate cache (e.g. between drills). */
export function resetContentCache(): void { memoryCache = null; }
