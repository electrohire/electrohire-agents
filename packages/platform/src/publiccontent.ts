/**
 * WS-5 (2026-10-26) — public blog + events mirror.
 *
 * The blog and the events list are D1-backed website features (Phase B /
 * PB-4), so they cannot ride the build-time content document the way the
 * static site facts do. The website serves them as public JSON instead
 * (packages/data in the website repo):
 *
 *   GET /api/public/blog          published posts, metadata only
 *   GET /api/public/blog/:slug    one published post, full text
 *   GET /api/public/events        published events
 *
 * Those routes return PUBLISHED records only — a draft has no public
 * JSON form, exactly as it has no public page — and they are public
 * GET passthroughs in the beta gate, so these Workers can fetch them
 * server-side. This loader mirrors that shape, with the same honesty
 * rules as the content mirror (content.ts):
 *
 *  - no hand-maintained copy of any post or event exists in this repo;
 *  - a fetch failure serves the last-good copy this isolate parsed,
 *    and only fails when no good copy exists anywhere;
 *  - local stand-ins (BLOG_JSON / EVENTS_JSON, or their base64 forms)
 *    exist for local dev and tests, exactly like CONTENT_JSON.
 *
 * Spec 004's rule stands: published public content only, no personal
 * data — these feeds carry none by construction.
 */
import { guardedFetch } from "./security.ts";

export interface BlogPostSummary {
  slug: string; title: string; metaDescription: string; authorName: string;
  publishedAt: number | null; readMinutes: number | null;
  categories: string[]; kind: string; url: string;
}
export interface BlogPost extends BlogPostSummary { body: string }
export interface PublicEvent {
  slug: string; title: string; description: string; date: string;
  timeLabel: string; venue: string; tag: string; url: string;
}

export interface PublicContentEnv {
  /** Base the public JSON routes hang off. Default: the beta site. */
  PUBLIC_CONTENT_BASE_URL?: string;
  BLOG_JSON?: string;
  BLOG_JSON_B64?: string;
  EVENTS_JSON?: string;
  EVENTS_JSON_B64?: string;
}

export const DEFAULT_PUBLIC_CONTENT_BASE = "https://beta.electrohire.com";

const base = (env: PublicContentEnv) => (env.PUBLIC_CONTENT_BASE_URL ?? DEFAULT_PUBLIC_CONTENT_BASE).replace(/\/$/, "");

let lastGoodBlog: { total: number; posts: BlogPostSummary[] } | null = null;
let lastGoodEvents: { total: number; events: PublicEvent[] } | null = null;

function decodeStandIn(raw: string | undefined, b64: string | undefined): string | null {
  if (b64) {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return raw ?? null;
}

async function fetchJson(env: PublicContentEnv, path: string): Promise<unknown> {
  const res = await guardedFetch(`${base(env)}${path}`);
  if (!res.ok) throw new Error(`Public content fetch failed: HTTP ${res.status} for ${path}`);
  return res.json();
}

export async function loadBlogPosts(env: PublicContentEnv): Promise<{ total: number; posts: BlogPostSummary[] }> {
  const standIn = decodeStandIn(env.BLOG_JSON, env.BLOG_JSON_B64);
  if (standIn) { lastGoodBlog = JSON.parse(standIn); return lastGoodBlog!; }
  try {
    const doc = (await fetchJson(env, "/api/public/blog")) as { total: number; posts: BlogPostSummary[] };
    if (!Array.isArray(doc.posts)) throw new Error("Blog feed is missing its posts list");
    lastGoodBlog = doc;
    return doc;
  } catch (e) {
    if (lastGoodBlog) return lastGoodBlog;
    throw e;
  }
}

export async function loadBlogPost(env: PublicContentEnv, slug: string): Promise<BlogPost | null> {
  const standIn = decodeStandIn(env.BLOG_JSON, env.BLOG_JSON_B64);
  if (standIn) {
    // Local stand-in carries the list shape; a single-post stand-in may
    // carry a body. Either way, an unpublished slug is simply absent.
    const doc = JSON.parse(standIn) as { posts?: (BlogPostSummary & { body?: string })[] } & Partial<BlogPost>;
    if (doc.slug === slug && doc.body !== undefined) return doc as BlogPost;
    const hit = doc.posts?.find((p) => p.slug === slug);
    return hit ? { ...hit, body: hit.body ?? "" } : null;
  }
  const res = await guardedFetch(`${base(env)}/api/public/blog/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public content fetch failed: HTTP ${res.status} for blog post ${slug}`);
  return (await res.json()) as BlogPost;
}

export async function loadEvents(env: PublicContentEnv): Promise<{ total: number; events: PublicEvent[] }> {
  const standIn = decodeStandIn(env.EVENTS_JSON, env.EVENTS_JSON_B64);
  if (standIn) { lastGoodEvents = JSON.parse(standIn); return lastGoodEvents!; }
  try {
    const doc = (await fetchJson(env, "/api/public/events")) as { total: number; events: PublicEvent[] };
    if (!Array.isArray(doc.events)) throw new Error("Events feed is missing its events list");
    lastGoodEvents = doc;
    return doc;
  } catch (e) {
    if (lastGoodEvents) return lastGoodEvents;
    throw e;
  }
}

/** Test/local helper: drop the last-good copies between drills. */
export function resetPublicContentCache(): void { lastGoodBlog = null; lastGoodEvents = null; }
