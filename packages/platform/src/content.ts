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
 *
 * PB-4 / G20 resilience: if the upstream fetch fails, the mirror serves
 * the last document it successfully parsed (this isolate's last-good
 * copy, then the KV copy) instead of returning a 502 for the pricing,
 * content and FAQ routes. It only fails when no good copy exists
 * anywhere. See loadContent below.
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
/** The last document this isolate successfully parsed. Kept separately
 *  from memoryCache so resetContentCache() (drills/tests) cannot drop
 *  it — it is the fallback that keeps an upstream failure from becoming
 *  a 502. Content facts change rarely and are versioned, so serving the
 *  last-good copy is honest degraded service; a hard failure is not. */
let lastGoodDoc: ContentDoc | null = null;
function remember(doc: ContentDoc): ContentDoc { memoryCache = doc; lastGoodDoc = doc; return doc; }

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
    return remember(parseContentDoc(new TextDecoder().decode(bytes)));
  }
  if (env.CONTENT_JSON) {
    return remember(parseContentDoc(env.CONTENT_JSON));
  }
  if (env.CONTENT_KV) {
    const hit = await env.CONTENT_KV.get(KV_KEY);
    if (hit) { return remember(parseContentDoc(hit)); }
  }
  if (!env.CONTENT_SOURCE_URL) {
    if (lastGoodDoc) return lastGoodDoc;
    throw new Error("No content source configured (CONTENT_JSON, CONTENT_KV, or CONTENT_SOURCE_URL required)");
  }
  // Layer 6: the fetch itself goes through the egress allowlist.
  let raw: string;
  try {
    const res = await guardedFetch(env.CONTENT_SOURCE_URL);
    if (!res.ok) throw new Error(`Content source fetch failed: HTTP ${res.status}`);
    raw = await res.text();
  } catch (e) {
    // Upstream failure must not 502 the mirror (G20): serve the
    // last-good document — this isolate's copy first, then the KV copy
    // another isolate may have written — and only fail when no good
    // copy exists anywhere.
    if (lastGoodDoc) return lastGoodDoc;
    if (env.CONTENT_KV) {
      const hit = await env.CONTENT_KV.get(KV_KEY).catch(() => null);
      if (hit) { try { return remember(parseContentDoc(hit)); } catch { /* fall through to the original error */ } }
    }
    throw e;
  }
  const doc = parseContentDoc(raw);
  if (env.CONTENT_KV?.put) await env.CONTENT_KV.put(KV_KEY, raw).catch(() => undefined);
  return remember(doc);
}

/** Test/local helper: drop the in-isolate cache (e.g. between drills). */
export function resetContentCache(): void { memoryCache = null; }
