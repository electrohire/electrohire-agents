/**
 * Ellie store — D1-backed (served track) + in-memory (local track).
 *
 * FINAL SCHEMA (migration 0007, owned by the website-side builder; this
 * module is written against exactly this set — any change must land in
 * both places in the same change):
 *
 *   ellie_site_keys(key TEXT PRIMARY KEY, origins TEXT NOT NULL DEFAULT '[]',
 *     enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)
 *   ellie_sessions(id TEXT PRIMARY KEY, account_id TEXT,
 *     site_key TEXT NOT NULL, cui_flag INTEGER NOT NULL DEFAULT 0,
 *     state TEXT NOT NULL DEFAULT 'intake',
 *     question_set_version TEXT NOT NULL, session_token_hash TEXT,
 *     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
 *     -- session_token_hash is the ONE addition to the coordinator's
 *     -- original list, proposed in the Phase E run record: anonymous
 *     -- sessions carry a per-session bearer token, hashed at rest
 *     -- (SHA-256 hex), never the token itself. site_key is NOT NULL
 *     -- in the migration: sessions with no site key (the internal
 *     -- signed-in path) store '' — the D1 store maps null → ''.
 *     -- The engine stores its JSON intake state in `state`; the
 *     -- migration's lifecycle comment describes the same column from
 *     -- the panel's point of view.
 *   ellie_messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
 *     role TEXT NOT NULL, content TEXT NOT NULL,
 *     flags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)
 *   ellie_uploads(id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
 *     data BLOB NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
 *     size INTEGER NOT NULL, extracted_text TEXT NOT NULL DEFAULT '',
 *     r2_key TEXT, created_at INTEGER NOT NULL)
 *     -- AMENDED 2026-10-25 (coordinator): R2 was NOT enabled on this
 *     -- Cloudflare account, so upload bytes lived in the `data` BLOB
 *     -- column (single-row blob, 2 MB cap enforced in engine.ts).
 *     -- R2 STORAGE SWAP 2026-10-25 (migration 0011): R2 is enabled now.
 *     -- When an R2 bucket is bound (env FILES), createUpload puts the
 *     -- bytes in the bucket (electrohire-uploads) under the key
 *     -- ellie/<session_id>/<upload_id>, stores that key in r2_key, and
 *     -- leaves `data` an empty BLOB (the column stays NOT NULL; legacy
 *     -- rows keep their bytes in `data` with r2_key NULL and still
 *     -- read). With no bucket bound, the D1 BLOB behavior is unchanged
 *     -- (local track / fallback). The byte-touching methods are
 *     -- createUpload / getUploadData / deleteUpload.
 *   ellie_analyses(id TEXT PRIMARY KEY, session_id TEXT, account_id TEXT,
 *     brief TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 *     current_step INTEGER NOT NULL DEFAULT 0,
 *     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
 *   ellie_outputs(id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL,
 *     section TEXT NOT NULL, version INTEGER NOT NULL,
 *     content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 *     approved_by TEXT, approved_at INTEGER, payload_hash TEXT NOT NULL,
 *     created_at INTEGER NOT NULL)
 *   ellie_usage(day TEXT NOT NULL, model TEXT NOT NULL,
 *     requests INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
 *     PRIMARY KEY(day, model))
 *
 * Audit: security / approval / escalation events append through the
 * website packages/audit hash-chain algorithm (sha256(prev_hash | body),
 * GENESIS for the first row) into audit_log when a DB is bound;
 * otherwise the LocalAuditSink — INTERIM, labeled as such, exactly as
 * guard.ts labels its interim sink.
 */
import type { AuditEventInput } from "../guard.ts";

/** INTERIM local audit sink — same shape and labeling as guard.ts's
 * LocalAuditSink. Duplicated (not imported) so the local node:test
 * batteries, which load these modules in TypeScript strip-only mode,
 * never pull guard.ts's non-erasable syntax; Workers use the D1 path. */
export class LocalAuditSink {
  events: AuditEventInput[] = [];
  async append(ev: AuditEventInput): Promise<void> {
    this.events.push(ev);
    console.log(JSON.stringify({ log: "eh-audit-INTERIM", ...ev }));
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Approval payload hash: SHA-256 hex of the EXACT stored content. */
export async function computePayloadHash(content: string): Promise<string> {
  return sha256Hex(content);
}
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SiteKeyRow { key: string; origins: string[]; enabled: boolean; createdAt: number }
export interface SessionRow {
  id: string; accountId: string | null; siteKey: string | null; cuiFlag: boolean;
  state: Record<string, unknown>; questionSetVersion: string;
  sessionTokenHash: string | null; createdAt: number; updatedAt: number;
}
export interface MessageRow { id: string; sessionId: string; role: string; content: string; flags: string[]; createdAt: number }
export interface UploadRow {
  id: string; sessionId: string; r2Key: string | null; filename: string; mime: string;
  size: number; extractedText: string; hasData: boolean; createdAt: number;
}
export interface AnalysisRow {
  id: string; sessionId: string | null; accountId: string | null; brief: string;
  status: string; currentStep: number; createdAt: number; updatedAt: number;
}
export interface OutputRow {
  id: string; analysisId: string; section: string; version: number; content: string;
  status: string; approvedBy: string | null; approvedAt: number | null;
  payloadHash: string; createdAt: number;
}
export interface TicketRow {
  id: string; requester_name: string; requester_email: string; subject: string; body: string;
  context: string; status: string; is_data_request: number; source_route: string;
  received_at: number; due_at: number | null; created_at: number; updated_at: number;
  // camelCase aliases for local-track consumers
  requesterName: string; requesterEmail: string; isDataRequest: boolean; sourceRoute: string; receivedAt: number;
}

export interface EllieStore {
  getSiteKey(key: string): Promise<SiteKeyRow | null>;
  createSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  listSessionsByAccount(accountId: string): Promise<SessionRow[]>;
  updateSession(id: string, state: Record<string, unknown>, updatedAt: number): Promise<void>;
  appendMessage(row: MessageRow): Promise<void>;
  listMessages(sessionId: string): Promise<MessageRow[]>;
  createUpload(row: UploadRow & { data?: Uint8Array | null }): Promise<void>;
  listUploads(sessionId: string): Promise<UploadRow[]>;
  getUploadData(id: string): Promise<{ row: UploadRow; data: Uint8Array } | null>;
  deleteUpload(id: string): Promise<boolean>;
  createAnalysis(row: AnalysisRow): Promise<void>;
  getAnalysis(id: string): Promise<AnalysisRow | null>;
  getAnalysisBySession(sessionId: string): Promise<AnalysisRow | null>;
  listAnalysesByAccount(accountId: string): Promise<AnalysisRow[]>;
  updateAnalysis(id: string, patch: { status?: string; currentStep?: number }, updatedAt: number): Promise<void>;
  createOutput(row: OutputRow): Promise<void>;
  listOutputs(analysisId: string): Promise<OutputRow[]>;
  getOutput(analysisId: string, section: string, version: number): Promise<OutputRow | null>;
  updateOutputApproval(id: string, approvedBy: string, approvedAt: number): Promise<void>;
  addUsage(day: string, model: string, costUsd: number): Promise<void>;
  usageTotalForDay(day: string): Promise<number>;
  /** WS-15 per-user free-route usage: how many model calls one user
   * has used on/after `sinceMs` (UTC day start). One model call is
   * counted per user-role message (each drives one chat call) plus
   * one per generated analysis output (each advance drives one call).
   * Counted from the tables that already exist — no new schema.
   * Identity: the account id when the session is signed-in; for an
   * anonymous website session, that session itself is the "user"
   * (the panel visitor has no account to count across). */
  modelCallsForUserDay(sinceMs: number, who: { accountId?: string | null; sessionId?: string | null }): Promise<number>;
  isStaff(accountId: string): Promise<boolean>;
  createTicket(input: { requesterName: string; requesterEmail: string; subject: string; body: string; context: string; sourceRoute: string }): Promise<TicketRow>;
  appendAudit(ev: AuditEventInput): Promise<void>;
}

/* ---------------- in-memory (local track) ---------------- */

export interface MemoryStoreOpts {
  siteKeys?: SiteKeyRow[];
  staff?: string[];
  now?: () => number;
}

export function createMemoryStore(opts: MemoryStoreOpts = {}): EllieStore & {
  setStaff(id: string, staff: boolean): void;
  auditEvents(): AuditEventInput[];
  listTickets(): TicketRow[];
  auditSink: LocalAuditSink;
} {
  const now = opts.now ?? (() => Date.now());
  const siteKeys = new Map<string, SiteKeyRow>((opts.siteKeys ?? []).map((k) => [k.key, k]));
  const staff = new Set(opts.staff ?? []);
  const sessions = new Map<string, SessionRow>();
  const messages: MessageRow[] = [];
  const uploads: (UploadRow & { data?: Uint8Array | null })[] = [];
  const analyses = new Map<string, AnalysisRow>();
  const outputs: OutputRow[] = [];
  const usage = new Map<string, { requests: number; cost: number }>();
  const tickets: TicketRow[] = [];
  const auditSink = new LocalAuditSink();

  const store = {
    auditSink,
    setStaff(id: string, v: boolean) { if (v) staff.add(id); else staff.delete(id); },
    auditEvents() { return auditSink.events.map((e) => ({ ...e })); },
    listTickets() { return tickets.map((t) => ({ ...t })); },
    async getSiteKey(key: string) { return siteKeys.get(key) ?? null; },
    async createSession(row: SessionRow) { sessions.set(row.id, { ...row, state: { ...row.state } }); },
    async getSession(id: string) { const s = sessions.get(id); return s ? { ...s, state: { ...s.state } } : null; },
    async listSessionsByAccount(accountId: string) {
      return [...sessions.values()].filter((s) => s.accountId === accountId)
        .sort((a, b) => b.createdAt - a.createdAt).map((s) => ({ ...s, state: { ...s.state } }));
    },
    async updateSession(id: string, state: Record<string, unknown>, updatedAt: number) {
      const s = sessions.get(id); if (!s) throw new Error("Session not found.");
      s.state = { ...state }; s.updatedAt = updatedAt;
    },
    async appendMessage(row: MessageRow) { messages.push({ ...row }); },
    async listMessages(sessionId: string) { return messages.filter((m) => m.sessionId === sessionId).map((m) => ({ ...m })); },
    async createUpload(row: UploadRow & { data?: Uint8Array | null }) { uploads.push({ ...row }); },
    async listUploads(sessionId: string) { return uploads.filter((u) => u.sessionId === sessionId).map(({ data: _d, ...rest }) => ({ ...rest })); },
    async getUploadData(id: string) {
      const u = uploads.find((x) => x.id === id);
      if (!u) return null;
      const { data, ...rest } = u;
      return { row: rest as UploadRow, data: data ?? new Uint8Array(0) };
    },
    async deleteUpload(id: string) {
      const i = uploads.findIndex((x) => x.id === id);
      if (i < 0) return false;
      uploads.splice(i, 1);
      return true;
    },
    async createAnalysis(row: AnalysisRow) { analyses.set(row.id, { ...row }); },
    async getAnalysis(id: string) { const a = analyses.get(id); return a ? { ...a } : null; },
    async getAnalysisBySession(sessionId: string) {
      const all = [...analyses.values()].filter((a) => a.sessionId === sessionId).sort((x, y) => y.createdAt - x.createdAt);
      return all[0] ? { ...all[0] } : null;
    },
    async listAnalysesByAccount(accountId: string) {
      return [...analyses.values()].filter((a) => a.accountId === accountId)
        .sort((a, b) => b.createdAt - a.createdAt).map((a) => ({ ...a }));
    },
    async updateAnalysis(id: string, patch: { status?: string; currentStep?: number }, updatedAt: number) {
      const a = analyses.get(id); if (!a) throw new Error("Analysis not found.");
      if (patch.status !== undefined) a.status = patch.status;
      if (patch.currentStep !== undefined) a.currentStep = patch.currentStep;
      a.updatedAt = updatedAt;
    },
    async createOutput(row: OutputRow) { outputs.push({ ...row }); },
    async listOutputs(analysisId: string) { return outputs.filter((o) => o.analysisId === analysisId).map((o) => ({ ...o })); },
    async getOutput(analysisId: string, section: string, version: number) {
      return outputs.find((o) => o.analysisId === analysisId && o.section === section && o.version === version) ?? null;
    },
    async updateOutputApproval(id: string, approvedBy: string, approvedAt: number) {
      const o = outputs.find((x) => x.id === id); if (!o) throw new Error("Output not found.");
      o.status = "approved"; o.approvedBy = approvedBy; o.approvedAt = approvedAt;
    },
    async addUsage(day: string, model: string, costUsd: number) {
      const k = `${day}|${model}`; const cur = usage.get(k) ?? { requests: 0, cost: 0 };
      cur.requests += 1; cur.cost += costUsd; usage.set(k, cur);
    },
    async usageTotalForDay(day: string) {
      let total = 0;
      for (const [k, v] of usage.entries()) if (k.startsWith(day + "|")) total += v.cost;
      return total;
    },
    async modelCallsForUserDay(sinceMs: number, who: { accountId?: string | null; sessionId?: string | null }) {
      let count = 0;
      for (const m of messages) {
        if (m.role !== "user" || m.createdAt < sinceMs) continue;
        const s = sessions.get(m.sessionId);
        if (who.accountId ? s?.accountId === who.accountId : m.sessionId === who.sessionId) count += 1;
      }
      for (const o of outputs) {
        if (o.createdAt < sinceMs) continue;
        const a = analyses.get(o.analysisId);
        if (who.accountId ? a?.accountId === who.accountId : a?.sessionId === who.sessionId) count += 1;
      }
      return count;
    },
    async isStaff(accountId: string) { return staff.has(accountId); },
    async createTicket(input: { requesterName: string; requesterEmail: string; subject: string; body: string; context: string; sourceRoute: string }) {
      const t = now();
      const row: TicketRow = {
        id: crypto.randomUUID(),
        requester_name: input.requesterName, requester_email: input.requesterEmail,
        subject: input.subject, body: input.body, context: input.context,
        status: "open", is_data_request: 0, source_route: input.sourceRoute,
        received_at: t, due_at: null, created_at: t, updated_at: t,
        requesterName: input.requesterName, requesterEmail: input.requesterEmail,
        isDataRequest: false, sourceRoute: input.sourceRoute, receivedAt: t,
      };
      tickets.push(row);
      return { ...row };
    },
    async appendAudit(ev: AuditEventInput) { await auditSink.append(ev); },
  };
  return store as EllieStore & { setStaff(id: string, staff: boolean): void; auditEvents(): AuditEventInput[]; listTickets(): TicketRow[]; auditSink: LocalAuditSink };
}

/* ---------------- D1-backed (served track) ---------------- */

/** Hash-chain append copied from the website packages/audit algorithm:
 * entry_hash = sha256(prev_hash + '|' + body), prev = last row's hash
 * or 'GENESIS'. If audit_log is absent (migration not yet applied), the
 * append is skipped with a log line — INTERIM behavior, labeled here,
 * never dressed up as a written audit row. */
async function appendAuditD1(db: D1Database, ev: AuditEventInput): Promise<void> {
  try {
    const ts = ev.ts ?? Date.now();
    const id = crypto.randomUUID();
    const detail = JSON.stringify(ev.detail ?? {});
    const last = await db.prepare("SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1").first<{ entry_hash: string }>();
    const prevHash = last?.entry_hash ?? "GENESIS";
    const body = [ts, ev.actorAccountId ?? "", ev.actorEmail ?? "", ev.eventType, ev.action, ev.teamId ?? "", ev.subjectAccountId ?? "", ev.ip ?? "", ev.surface ?? "", detail].join("|");
    const entryHash = await sha256Hex(prevHash + "|" + body);
    await db.prepare("INSERT INTO audit_log (id, ts, actor_account_id, actor_email, event_type, action, team_id, subject_account_id, ip, surface, detail, prev_hash, entry_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, ts, ev.actorAccountId ?? null, ev.actorEmail ?? "", ev.eventType, ev.action, ev.teamId ?? null, ev.subjectAccountId ?? null, ev.ip ?? "", ev.surface ?? "", detail, prevHash, entryHash).run();
  } catch (e) {
    console.log(JSON.stringify({ log: "eh-audit-INTERIM-skip", reason: "audit_log unavailable", message: String((e as Error)?.message ?? e) }));
  }
}

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

/** The R2 surface the store uses — the structural subset of the
 * Workers R2Bucket binding (put/get/delete). One bucket serves the
 * whole platform (electrohire-uploads); Ellie objects live under the
 * ellie/ prefix. */
export interface EllieFilesBucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

export function createD1Store(db: D1Database, files?: EllieFilesBucket): EllieStore {
  return {
    async getSiteKey(key) {
      const row = await db.prepare("SELECT * FROM ellie_site_keys WHERE key = ?").bind(key)
        .first<{ key: string; origins: string; enabled: number; created_at: number }>();
      if (!row) return null;
      return { key: row.key, origins: parseJson<string[]>(row.origins, []), enabled: row.enabled === 1, createdAt: row.created_at };
    },
    async createSession(row) {
      await db.prepare("INSERT INTO ellie_sessions (id, account_id, site_key, cui_flag, state, question_set_version, session_token_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(row.id, row.accountId, row.siteKey ?? "", row.cuiFlag ? 1 : 0, JSON.stringify(row.state), row.questionSetVersion, row.sessionTokenHash, row.createdAt, row.updatedAt).run();
    },
    async getSession(id) {
      const row = await db.prepare("SELECT * FROM ellie_sessions WHERE id = ?").bind(id)
        .first<{ id: string; account_id: string | null; site_key: string | null; cui_flag: number; state: string; question_set_version: string; session_token_hash: string | null; created_at: number; updated_at: number }>();
      if (!row) return null;
      return { id: row.id, accountId: row.account_id, siteKey: row.site_key || null, cuiFlag: row.cui_flag === 1, state: parseJson(row.state, {}), questionSetVersion: row.question_set_version, sessionTokenHash: row.session_token_hash, createdAt: row.created_at, updatedAt: row.updated_at };
    },
    async listSessionsByAccount(accountId) {
      const { results } = await db.prepare("SELECT * FROM ellie_sessions WHERE account_id = ? ORDER BY created_at DESC").bind(accountId)
        .all<{ id: string; account_id: string | null; site_key: string | null; cui_flag: number; state: string; question_set_version: string; session_token_hash: string | null; created_at: number; updated_at: number }>();
      return results.map((row) => ({ id: row.id, accountId: row.account_id, siteKey: row.site_key || null, cuiFlag: row.cui_flag === 1, state: parseJson(row.state, {}), questionSetVersion: row.question_set_version, sessionTokenHash: row.session_token_hash, createdAt: row.created_at, updatedAt: row.updated_at }));
    },
    async updateSession(id, state, updatedAt) {
      await db.prepare("UPDATE ellie_sessions SET state = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(state), updatedAt, id).run();
    },
    async appendMessage(row) {
      await db.prepare("INSERT INTO ellie_messages (id, session_id, role, content, flags, created_at) VALUES (?,?,?,?,?,?)")
        .bind(row.id, row.sessionId, row.role, row.content, JSON.stringify(row.flags), row.createdAt).run();
    },
    async listMessages(sessionId) {
      const { results } = await db.prepare("SELECT * FROM ellie_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC").bind(sessionId)
        .all<{ id: string; session_id: string; role: string; content: string; flags: string; created_at: number }>();
      return results.map((r) => ({ id: r.id, sessionId: r.session_id, role: r.role, content: r.content, flags: parseJson<string[]>(r.flags, []), createdAt: r.created_at }));
    },
    async createUpload(row) {
      // R2 storage swap (migration 0011): with a bucket bound, the
      // bytes go to R2 under ellie/<session_id>/<upload_id> and the row
      // records r2_key with an empty `data` BLOB (the column is NOT
      // NULL). Without a bucket, the original D1 BLOB behavior stands
      // (local track / fallback) — one interface, two byte stores.
      const bytes = row.data ?? new Uint8Array(0);
      let r2Key: string | null = null;
      let stored: Uint8Array = bytes;
      if (files && row.data) {
        r2Key = `ellie/${row.sessionId}/${row.id}`;
        await files.put(r2Key, bytes, { httpMetadata: { contentType: row.mime } });
        stored = new Uint8Array(0);
      }
      await db.prepare("INSERT INTO ellie_uploads (id, session_id, filename, mime, size, extracted_text, data, r2_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(row.id, row.sessionId, row.filename, row.mime, row.size, row.extractedText, stored, r2Key, row.createdAt).run();
      // The caller keeps the row object it passed (the engine returns
      // its fields), so reflect the key the bytes actually landed
      // under — without this the upload response reports r2Key null
      // for an R2-backed upload.
      row.r2Key = r2Key;
    },
    async listUploads(sessionId) {
      const { results } = await db.prepare("SELECT id, session_id, filename, mime, size, extracted_text, r2_key, length(data) AS data_len, created_at FROM ellie_uploads WHERE session_id = ? ORDER BY created_at ASC").bind(sessionId)
        .all<{ id: string; session_id: string; filename: string; mime: string; size: number; extracted_text: string; r2_key: string | null; data_len: number; created_at: number }>();
      return results.map((r) => ({ id: r.id, sessionId: r.session_id, r2Key: r.r2_key ?? null, filename: r.filename, mime: r.mime, size: r.size, extractedText: r.extracted_text, hasData: r.r2_key != null || (r.data_len ?? 0) > 0, createdAt: r.created_at }));
    },
    async getUploadData(id) {
      const r = await db.prepare("SELECT id, session_id, filename, mime, size, extracted_text, data, r2_key, created_at FROM ellie_uploads WHERE id = ?").bind(id)
        .first<{ id: string; session_id: string; filename: string; mime: string; size: number; extracted_text: string; data: Uint8Array | ArrayBuffer | null; r2_key: string | null; created_at: number }>();
      if (!r) return null;
      const row: UploadRow = { id: r.id, sessionId: r.session_id, r2Key: r.r2_key ?? null, filename: r.filename, mime: r.mime, size: r.size, extractedText: r.extracted_text, hasData: r.r2_key != null || (r.data ? (r.data as Uint8Array).byteLength > 0 : false), createdAt: r.created_at };
      if (r.r2_key) {
        if (!files) return null; // bytes live in R2 but no bucket is bound here
        const obj = await files.get(r.r2_key);
        if (!obj) return null;
        return { row, data: new Uint8Array(await obj.arrayBuffer()) };
      }
      const raw = r.data;
      const data = raw instanceof Uint8Array ? raw : raw ? new Uint8Array(raw as ArrayBuffer) : new Uint8Array(0);
      return { row, data };
    },
    async deleteUpload(id) {
      const r = await db.prepare("SELECT r2_key FROM ellie_uploads WHERE id = ?").bind(id).first<{ r2_key: string | null }>();
      if (!r) return false;
      if (r.r2_key && files) await files.delete(r.r2_key);
      await db.prepare("DELETE FROM ellie_uploads WHERE id = ?").bind(id).run();
      return true;
    },
    async createAnalysis(row) {
      await db.prepare("INSERT INTO ellie_analyses (id, session_id, account_id, brief, status, current_step, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(row.id, row.sessionId, row.accountId, row.brief, row.status, row.currentStep, row.createdAt, row.updatedAt).run();
    },
    async getAnalysis(id) {
      const row = await db.prepare("SELECT * FROM ellie_analyses WHERE id = ?").bind(id)
        .first<{ id: string; session_id: string | null; account_id: string | null; brief: string; status: string; current_step: number; created_at: number; updated_at: number }>();
      if (!row) return null;
      return { id: row.id, sessionId: row.session_id, accountId: row.account_id, brief: row.brief, status: row.status, currentStep: row.current_step, createdAt: row.created_at, updatedAt: row.updated_at };
    },
    async getAnalysisBySession(sessionId) {
      const row = await db.prepare("SELECT * FROM ellie_analyses WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").bind(sessionId)
        .first<{ id: string; session_id: string | null; account_id: string | null; brief: string; status: string; current_step: number; created_at: number; updated_at: number }>();
      if (!row) return null;
      return { id: row.id, sessionId: row.session_id, accountId: row.account_id, brief: row.brief, status: row.status, currentStep: row.current_step, createdAt: row.created_at, updatedAt: row.updated_at };
    },
    async listAnalysesByAccount(accountId) {
      const { results } = await db.prepare("SELECT * FROM ellie_analyses WHERE account_id = ? ORDER BY created_at DESC").bind(accountId)
        .all<{ id: string; session_id: string | null; account_id: string | null; brief: string; status: string; current_step: number; created_at: number; updated_at: number }>();
      return results.map((row) => ({ id: row.id, sessionId: row.session_id, accountId: row.account_id, brief: row.brief, status: row.status, currentStep: row.current_step, createdAt: row.created_at, updatedAt: row.updated_at }));
    },
    async updateAnalysis(id, patch, updatedAt) {
      if (patch.status !== undefined && patch.currentStep !== undefined) {
        await db.prepare("UPDATE ellie_analyses SET status = ?, current_step = ?, updated_at = ? WHERE id = ?").bind(patch.status, patch.currentStep, updatedAt, id).run();
      } else if (patch.status !== undefined) {
        await db.prepare("UPDATE ellie_analyses SET status = ?, updated_at = ? WHERE id = ?").bind(patch.status, updatedAt, id).run();
      } else if (patch.currentStep !== undefined) {
        await db.prepare("UPDATE ellie_analyses SET current_step = ?, updated_at = ? WHERE id = ?").bind(patch.currentStep, updatedAt, id).run();
      }
    },
    async createOutput(row) {
      await db.prepare("INSERT INTO ellie_outputs (id, analysis_id, section, version, content, status, approved_by, approved_at, payload_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(row.id, row.analysisId, row.section, row.version, row.content, row.status, row.approvedBy, row.approvedAt, row.payloadHash, row.createdAt).run();
    },
    async listOutputs(analysisId) {
      const { results } = await db.prepare("SELECT * FROM ellie_outputs WHERE analysis_id = ? ORDER BY created_at ASC").bind(analysisId)
        .all<{ id: string; analysis_id: string; section: string; version: number; content: string; status: string; approved_by: string | null; approved_at: number | null; payload_hash: string; created_at: number }>();
      return results.map((r) => ({ id: r.id, analysisId: r.analysis_id, section: r.section, version: r.version, content: r.content, status: r.status, approvedBy: r.approved_by, approvedAt: r.approved_at, payloadHash: r.payload_hash, createdAt: r.created_at }));
    },
    async getOutput(analysisId, section, version) {
      const row = await db.prepare("SELECT * FROM ellie_outputs WHERE analysis_id = ? AND section = ? AND version = ?").bind(analysisId, section, version)
        .first<{ id: string; analysis_id: string; section: string; version: number; content: string; status: string; approved_by: string | null; approved_at: number | null; payload_hash: string; created_at: number }>();
      if (!row) return null;
      return { id: row.id, analysisId: row.analysis_id, section: row.section, version: row.version, content: row.content, status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at, payloadHash: row.payload_hash, createdAt: row.created_at };
    },
    async updateOutputApproval(id, approvedBy, approvedAt) {
      await db.prepare("UPDATE ellie_outputs SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").bind(approvedBy, approvedAt, id).run();
    },
    async addUsage(day, model, costUsd) {
      await db.prepare("INSERT INTO ellie_usage (day, model, requests, cost_usd) VALUES (?,?,1,?) ON CONFLICT(day, model) DO UPDATE SET requests = requests + 1, cost_usd = cost_usd + excluded.cost_usd")
        .bind(day, model, costUsd).run();
    },
    async usageTotalForDay(day) {
      const row = await db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ellie_usage WHERE day = ?").bind(day).first<{ total: number }>();
      return row?.total ?? 0;
    },
    async modelCallsForUserDay(sinceMs, who) {
      // Existing tables only (sessions/messages for chat calls,
      // analyses/outputs for generation calls) — see the interface
      // comment. A counting failure must never break the conversation:
      // the caller also catches, and this returns 0 on any error.
      try {
        if (who.accountId) {
          const m = await db.prepare("SELECT COUNT(*) AS n FROM ellie_messages msg JOIN ellie_sessions s ON msg.session_id = s.id WHERE s.account_id = ? AND msg.role = 'user' AND msg.created_at >= ?").bind(who.accountId, sinceMs).first<{ n: number }>();
          const o = await db.prepare("SELECT COUNT(*) AS n FROM ellie_outputs outp JOIN ellie_analyses a ON outp.analysis_id = a.id WHERE a.account_id = ? AND outp.created_at >= ?").bind(who.accountId, sinceMs).first<{ n: number }>();
          return (m?.n ?? 0) + (o?.n ?? 0);
        }
        if (who.sessionId) {
          const m = await db.prepare("SELECT COUNT(*) AS n FROM ellie_messages WHERE session_id = ? AND role = 'user' AND created_at >= ?").bind(who.sessionId, sinceMs).first<{ n: number }>();
          const o = await db.prepare("SELECT COUNT(*) AS n FROM ellie_outputs outp JOIN ellie_analyses a ON outp.analysis_id = a.id WHERE a.session_id = ? AND outp.created_at >= ?").bind(who.sessionId, sinceMs).first<{ n: number }>();
          return (m?.n ?? 0) + (o?.n ?? 0);
        }
        return 0;
      } catch { return 0; }
    },
    async isStaff(accountId) {
      try {
        const row = await db.prepare("SELECT is_staff FROM accounts WHERE id = ?").bind(accountId).first<{ is_staff: number }>();
        return row?.is_staff === 1;
      } catch { return false; }
    },
    async createTicket(input) {
      // SAME D1 shape as the B-05 inbox (migration 0003 support_tickets).
      const t = Date.now();
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO support_tickets (id, requester_name, requester_email, subject, body, context, status, is_data_request, source_route, received_at, due_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id, input.requesterName, input.requesterEmail, input.subject, input.body, input.context, "open", 0, input.sourceRoute, t, null, t, t).run();
      return {
        id, requester_name: input.requesterName, requester_email: input.requesterEmail,
        subject: input.subject, body: input.body, context: input.context, status: "open",
        is_data_request: 0, source_route: input.sourceRoute, received_at: t, due_at: null,
        created_at: t, updated_at: t, requesterName: input.requesterName,
        requesterEmail: input.requesterEmail, isDataRequest: false, sourceRoute: input.sourceRoute, receivedAt: t,
      };
    },
    async appendAudit(ev) { await appendAuditD1(db, ev); },
  };
}

/** Store selection mirroring storeFromEnv's discipline: D1 when bound,
 * the seeded in-memory store otherwise (env-seeded site keys locally). */
export interface EllieStoreEnv {
  DB?: D1Database;
  FILES?: EllieFilesBucket;
  ELLIE_SITE_KEYS_JSON?: string;
}
const memoryBySeed = new Map<string, ReturnType<typeof createMemoryStore>>();
export function ellieStoreFromEnv(env: EllieStoreEnv): EllieStore {
  if (env.DB) return createD1Store(env.DB, env.FILES);
  const seed = env.ELLIE_SITE_KEYS_JSON ?? "";
  if (!memoryBySeed.has(seed)) {
    let siteKeys: SiteKeyRow[] = [];
    if (seed) {
      try {
        siteKeys = (JSON.parse(seed) as { key: string; origins?: string[]; enabled?: boolean }[])
          .map((k) => ({ key: k.key, origins: k.origins ?? [], enabled: k.enabled !== false, createdAt: Date.now() }));
      } catch { siteKeys = []; }
    }
    memoryBySeed.set(seed, createMemoryStore({ siteKeys }));
  }
  return memoryBySeed.get(seed)!;
}
