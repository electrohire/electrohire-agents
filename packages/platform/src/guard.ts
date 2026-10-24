/**
 * C-05 guard: per-IP rate limits inside the Worker, metadata-only request
 * logging, per-tool + global kill switches. Shared by the API and MCP
 * Workers so the two cannot drift into different behavior.
 *
 * Local track: limits live in in-isolate memory and kill switches in Worker
 * vars — a local stand-in for the KV-backed flags the served track uses
 * (no KV exists on the account yet). The behavior — trip point, refusal
 * shape, drills — is identical; only the flag store differs, and that
 * difference is recorded, not dressed up.
 *
 * C-15 layer 7 interface: A-08's substrate is @electrohire/audit in the
 * website repo (Phase A PR #28: appendAudit(db, ev) / listAudit(db, f),
 * append-only, hash-chained). Phase C does not import that package across
 * repos; instead every sink here speaks its event shape
 * ({eventType, action, actorEmail, ip, surface, detail, ts}), and
 * createA08Sink() adapts any appendAudit-compatible function when the two
 * land in one deployment. Until then BlockedAttempt records go to the
 * local sink and are labeled INTERIM.
 */

export interface GuardEnv {
  GLOBAL_KILL_SWITCH?: string;
  DISABLED_TOOLS?: string; // comma-separated tool/route names
  RATE_LIMIT_PER_MINUTE?: string;
}

export function globalKillOn(env: GuardEnv): boolean {
  return env.GLOBAL_KILL_SWITCH === "1" || env.GLOBAL_KILL_SWITCH === "true";
}

export function disabledTools(env: GuardEnv): Set<string> {
  return new Set((env.DISABLED_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limit: number, private windowMs = 60_000) {}
  static fromEnv(env: GuardEnv): RateLimiter {
    const n = Number(env.RATE_LIMIT_PER_MINUTE ?? "120");
    return new RateLimiter(Number.isFinite(n) && n > 0 ? n : 120);
  }
  check(ip: string, now = Date.now()): { allowed: boolean; remaining: number } {
    const slot = this.hits.get(ip);
    if (!slot || slot.resetAt <= now) {
      this.hits.set(ip, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }
    slot.count += 1;
    return { allowed: slot.count <= this.limit, remaining: Math.max(0, this.limit - slot.count) };
  }
}

/** Metadata ONLY: time, identity (key/token id or 'anonymous'), endpoint,
 * status — never payloads, never full keys. */
export interface RequestLogRecord {
  ts: string; identity: string; endpoint: string; status: number; flagged?: string[];
}
export function logRequest(rec: Omit<RequestLogRecord, "ts">): RequestLogRecord {
  const full: RequestLogRecord = { ts: new Date().toISOString(), ...rec };
  console.log(JSON.stringify({ log: "eh-request", ...full }));
  return full;
}

/** Identity for logs: an Authorization header yields only a short,
 * non-reversible label (first 4 chars of a SHA-256 hex), never the secret. */
export async function identityLabel(request: Request): Promise<string> {
  const auth = request.headers.get("authorization");
  if (!auth) return "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `cred:${hex.slice(0, 8)}`;
}

/* ---- C-15 layer 7: audit sink interface (A-08 shape, Phase A PR #28) ---- */

export interface AuditEventInput {
  actorAccountId?: string | null;
  actorEmail?: string;
  eventType: string;
  action: string;
  teamId?: string | null;
  subjectAccountId?: string | null;
  ip?: string;
  surface?: string;
  detail?: Record<string, unknown>;
  ts?: number;
}
export interface AuditSink { append(ev: AuditEventInput): Promise<void> }

/** INTERIM local sink: in-memory + structured log line. NOT the A-08
 * substrate — recorded as such wherever it is used. */
export class LocalAuditSink implements AuditSink {
  events: AuditEventInput[] = [];
  async append(ev: AuditEventInput): Promise<void> {
    this.events.push(ev);
    console.log(JSON.stringify({ log: "eh-audit-INTERIM", ...ev }));
  }
}

/** Adapter for the real A-08 substrate: takes Phase A's appendAudit
 * (db, ev) plus its Db handle, returns a sink with this file's shape. */
export function createA08Sink(
  db: unknown,
  appendAudit: (db: unknown, ev: AuditEventInput) => Promise<unknown>,
): AuditSink {
  return { append: async (ev) => { await appendAudit(db, ev); } };
}
