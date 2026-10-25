/**
 * Personal API keys — enforcement side (Phase C2: C-08…C-12).
 *
 * Keys are minted and managed in the dashboard (website repo,
 * @electrohire/apikeys); THIS module is the gate every API/MCP request
 * passes on the enforcement side. It carries the same scope catalog, the
 * same gate semantics, and the same provider-policy data as the dashboard
 * package, so the two cannot drift in what they enforce: a key-authenticated
 * request and an OAuth-token request pass exactly the same checks here
 * (C-10) — C3's OAuth tokens will resolve to the same credential shape,
 * and the cross-method matrix runs today against a test-double token.
 *
 * Local track: the key store lives in memory, seeded from
 * EH_LOCAL_KEYS_JSON_B64 (local test keys, hashed on ingest — the stand-in
 * for the D1-backed store the served track reads, exactly as kill-switch
 * flags stand in for KV in guard.ts). The behavior — hash-only storage,
 * constant-time comparison, next-request revocation, per-key quotas — is
 * the behavior; only the store's home differs, recorded not dressed up.
 *
 * Served track (follow-up 2026-10-24): when the Worker carries the D1
 * binding (env.DB → electrohire-platform, the website stack's database),
 * storeFromEnv returns a fresh D1-backed enforcement store per call, so
 * dashboard-issued keys are honored and a dashboard revocation refuses
 * the very next request. The D1 store reads/writes the same tables and
 * row shapes as the website repo's own D1-backed gate (migrations
 * 0004/0005): api_keys / oauth_tokens / oauth_test_doubles resolved by
 * secret hash, usage + rate fields persisted back to api_keys, and one
 * api_key_requests metadata row per admitted request. The Workers are
 * the enforcement side only — they never mint, so the D1 store's
 * lifecycle writers throw.
 */

export interface ScopeDef { id: string; group: "read" | "action"; label: string }
export const SCOPE_CATALOG: ScopeDef[] = [
  { id: "read:content", group: "read", label: "Search and read site content, pricing and FAQ" },
  { id: "read:blog", group: "read", label: "Read blog posts" },
  { id: "read:tools", group: "read", label: "Run the cost estimator, scoping checklist and timeline calculator" },
  { id: "action:ellie_session", group: "action", label: "Start an Ellie session and request an analysis" },
  { id: "action:newsletter_subscribe", group: "action", label: "Subscribe to the newsletter" },
  { id: "action:support_ticket", group: "action", label: "Open a support ticket" },
];
export const SCOPE_IDS = new Set(SCOPE_CATALOG.map((s) => s.id));

/** Scope a credential must hold for an API route (C-10 wiring). */
export function scopeForApiPath(path: string): string | null {
  if (path.startsWith("/v1/tools/")) return "read:tools";
  if (path.startsWith("/v1/content") || path === "/v1/faq" || path === "/v1/pricing") return "read:content";
  return null; // health / openapi / llms.txt carry no scope requirement
}
/** Scope a credential must hold for an MCP tool (C-10 wiring). */
export function scopeForMcpTool(name: string): string {
  // C-15 layer 3 (Phase C3): action tools map to their action scopes, so the
  // MCP dispatch check refuses a wrongly-scoped credential before execution.
  if (name === "electrohire_newsletter_subscribe") return "action:newsletter_subscribe";
  if (name === "electrohire_support_ticket") return "action:support_ticket";
  // Phase E (2026-10-25): the Ellie tools are action tools under the same rule.
  if (name === "electrohire_ellie_session" || name === "electrohire_ellie_analysis") return "action:ellie_session";
  if (["electrohire_estimate_cost", "electrohire_scoping_checklist", "electrohire_timeline_calculator"].includes(name)) return "read:tools";
  return "read:content";
}
/** Scope a credential must hold for a REST action route (Phase C3, C-13;
 * Phase E routes added 2026-10-25). */
export function scopeForApiAction(path: string): string | null {
  if (path === "/v1/actions/newsletter-subscribe") return "action:newsletter_subscribe";
  if (path === "/v1/actions/support-ticket") return "action:support_ticket";
  // Phase E: the API Worker's Ellie action + analysis routes, and the
  // Ellie Worker's own analysis routes — all one action scope.
  if (path === "/v1/actions/ellie-session") return "action:ellie_session";
  if (path.startsWith("/v1/ellie/analyses")) return "action:ellie_session";
  if (path === "/api/analyses" || path.startsWith("/api/analyses/")) return "action:ellie_session";
  return null;
}
/** The MCP action tools (Phase C3; Ellie tools added Phase E 2026-10-25):
 * binding actions — a credential is REQUIRED (C-15 layers 3+4); there is
 * no anonymous action call. */
export const MCP_ACTION_TOOLS = new Set(["electrohire_newsletter_subscribe", "electrohire_support_ticket", "electrohire_ellie_session", "electrohire_ellie_analysis"]);

/* ---- C-12 / CMP-10: the AI provider policy as data (same table as the
 * dashboard package — OpenRouter only, data_collection pinned to deny,
 * allowlist entries US-hosted, keeping no data, no covered-country
 * operators). A CUI-bound credential works only with these endpoints. */
export const PROVIDER_POLICY = {
  gateway: "openrouter",
  gatewayBaseUrl: "https://openrouter.ai/api/v1",
  routing: { data_collection: "deny" as const },
  eligibleEndpoints: [
    { id: "openrouter:us-noretention-primary", route: "openrouter", usHosted: true, retainsData: false, coveredCountryOperator: false, note: "OpenRouter route restricted to providers whose published terms keep no prompt data, US-hosted, data_collection=deny enforced at the gateway." },
    { id: "openrouter:us-noretention-secondary", route: "openrouter", usHosted: true, retainsData: false, coveredCountryOperator: false, note: "Second eligible route under the same criteria, for failover inside the allowlist only." },
  ],
};
export const isEligibleEndpoint = (id: string): boolean => PROVIDER_POLICY.eligibleEndpoints.some((e) => e.id === id);

/* ---- hashing: 192-bit secrets, SHA-256 at rest, constant-time compare
 * (the Phase A token pattern; the secret's entropy is what protects it). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function mintSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "ehk_live_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CredentialRecord {
  id: string; kind: "api_key" | "oauth_double" | "oauth"; creatorId: string; name: string;
  audience: string | null; // RFC 8707 resource the credential was minted for (OAuth tokens only; keys/doubles are null)
  display: string; secretHash: string; scopes: string[];
  teamId: string | null; projectId: string | null; projectCuiFlagged: boolean;
  expiresAt: number | null; revokedAt: number | null; createdAt: number;
  quotaPerDay: number; usageCount: number; usageDay: string;
  rateWindowStart: number; rateWindowCount: number; lastUsedAt: number | null;
}
export interface RequestMeta { keyId: string; ts: number; endpoint: string; status: number }
export interface AuditSinkLike { append(ev: Record<string, unknown>): Promise<void> }

export interface KeyStore {
  mint(input: { creatorId: string; name: string; scopes: string[]; teamId?: string | null; projectId?: string | null; projectCuiFlagged?: boolean; expiresAt?: number | null; quotaPerDay?: number; secret?: string; revoked?: boolean }): Promise<{ record: CredentialRecord; secret: string }>;
  registerOAuthDouble(input: { accountId: string; scopes: string[]; teamId?: string | null; projectId?: string | null; projectCuiFlagged?: boolean; expiresAt?: number | null }): Promise<{ token: string; id: string }>;
  registerOAuthToken(input: { accountId: string; scopes: string[]; audience: string; teamId?: string | null; projectId?: string | null; expiresAt?: number | null; token?: string }): Promise<{ token: string; id: string }>;
  seedOAuthFromJson(json: string): Promise<void>;
  revoke(id: string): Promise<void>;
  dump(): CredentialRecord[];
  requestLog(): RequestMeta[];
  setAuditSink(sink: AuditSinkLike): void;
  seedFromJson(json: string): Promise<void>;
}

export function createKeyStore(opts: { quotaPerDay?: number; ratePerMinute?: number; now?: () => number } = {}): KeyStore {
  const now = opts.now ?? (() => Date.now());
  const defaultQuota = opts.quotaPerDay ?? 600;
  const ratePerMinute = opts.ratePerMinute ?? 120;
  const records: CredentialRecord[] = [];
  const byHash = new Map<string, CredentialRecord>();
  const meta: RequestMeta[] = [];
  let auditSink: AuditSinkLike | null = null;
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const emit = async (action: string, r: CredentialRecord) => {
    if (auditSink) await auditSink.append({ eventType: "api_key", action, actorAccountId: r.creatorId, surface: "api", detail: { keyId: r.id, display: r.display, name: r.name, scopes: r.scopes } });
  };

  async function add(kind: "api_key" | "oauth_double" | "oauth", input: { creatorId: string; name: string; scopes: string[]; teamId?: string | null; projectId?: string | null; projectCuiFlagged?: boolean; expiresAt?: number | null; quotaPerDay?: number; secret?: string; revoked?: boolean; audience?: string | null }) {
    const secret = input.secret ?? (kind === "api_key" ? mintSecret() : kind === "oauth" ? "eho_live_" + mintSecret().slice("ehk_live_".length) : "eho_test_" + mintSecret().slice("ehk_live_".length));
    const t = now();
    const rec: CredentialRecord = {
      id: crypto.randomUUID(), kind, creatorId: input.creatorId, name: input.name,
      display: kind === "api_key" ? `ehk_live_…${secret.slice(-4)}` : kind === "oauth" ? `eho_live_…${secret.slice(-4)}` : "oauth_double",
      secretHash: await sha256Hex(secret), scopes: [...input.scopes],
      teamId: input.teamId ?? null, projectId: input.projectId ?? null,
      projectCuiFlagged: !!input.projectCuiFlagged, expiresAt: input.expiresAt ?? null,
      revokedAt: input.revoked ? t : null, createdAt: t, audience: input.audience ?? null,
      quotaPerDay: input.quotaPerDay ?? defaultQuota, usageCount: 0, usageDay: dayKey(t),
      rateWindowStart: t, rateWindowCount: 0, lastUsedAt: null,
    };
    records.push(rec); byHash.set(rec.secretHash, rec);
    if (kind === "api_key") await emit("api_key.create", rec);
    return { record: rec, secret };
  }

  const store: KeyStore & { _byHash: Map<string, CredentialRecord>; _meta: RequestMeta[]; _now: () => number; _ratePerMinute: number } = {
    async mint(input) { return add("api_key", input); },
    async registerOAuthDouble(input) {
      const { record, secret } = await add("oauth_double", { creatorId: input.accountId, name: "oauth_double", scopes: input.scopes, teamId: input.teamId, projectId: input.projectId, projectCuiFlagged: input.projectCuiFlagged, expiresAt: input.expiresAt });
      return { token: secret, id: record.id };
    },
    async registerOAuthToken(input) {
      const { record, secret } = await add("oauth", { creatorId: input.accountId, name: "oauth_token", scopes: input.scopes, teamId: input.teamId, projectId: input.projectId, expiresAt: input.expiresAt, audience: input.audience, secret: input.token });
      return { token: secret, id: record.id };
    },
    async seedOAuthFromJson(json: string) {
      const entries = JSON.parse(json) as Array<Record<string, unknown>>;
      for (const e of entries) {
        await add("oauth", {
          creatorId: String(e.accountId ?? "local-seed"), name: "oauth_token",
          scopes: (e.scopes as string[]) ?? [], audience: String(e.audience ?? ""),
          expiresAt: (e.expiresAt as number) ?? null, revoked: !!e.revoked,
          secret: typeof e.token === "string" ? e.token : undefined,
        });
      }
    },
    async revoke(id) {
      const rec = records.find((r) => r.id === id);
      if (!rec) throw new Error("Key not found.");
      rec.revokedAt = now();
      if (rec.kind === "api_key") await emit("api_key.revoke", rec);
    },
    dump() { return records.map((r) => ({ ...r })); },
    requestLog() { return meta.map((m) => ({ ...m })); },
    setAuditSink(sink) { auditSink = sink; },
    async seedFromJson(json: string) {
      const entries = JSON.parse(json) as Array<Record<string, unknown>>;
      for (const e of entries) {
        await add("api_key", {
          creatorId: String(e.creatorId ?? "local-seed"), name: String(e.name ?? "seed"),
          scopes: (e.scopes as string[]) ?? [], teamId: (e.teamId as string) ?? null,
          projectId: (e.projectId as string) ?? null, projectCuiFlagged: !!e.projectCuiFlagged,
          expiresAt: (e.expiresAt as number) ?? null, quotaPerDay: e.quotaPerDay as number,
          secret: e.secret as string, revoked: !!e.revoked,
        });
      }
    },
    _byHash: byHash, _meta: meta, _now: now, _ratePerMinute: ratePerMinute,
  };
  return store;
}

/* ---- D1-backed enforcement store (served track) ----
 * Same internals the gate touches (_byHash / _meta / _now /
 * _ratePerMinute) plus async hooks. Row → record mapping mirrors the
 * website repo's D1-backed gate (packages/apikeys) exactly, so both
 * surfaces read and write identical shapes: api_keys rows carry
 * creator_account_id / cui_bound / JSON scopes; oauth_tokens rows carry
 * account_id / audience; oauth_test_doubles rows carry account_id.
 * api_key_requests identity_kind follows the website gate's resolved
 * kinds: 'api_key' | 'oauth_token' | 'oauth_double'. */
interface ApiKeyRow {
  id: string; creator_account_id: string; name: string; display: string; secret_hash: string; scopes: string;
  team_id: string | null; project_id: string | null; cui_bound: number;
  expires_at: number | null; revoked_at: number | null; created_at: number;
  quota_per_day: number; usage_count: number; usage_day: string;
  rate_window_start: number; rate_window_count: number; last_used_at: number | null;
}
interface OAuthTokenRow {
  id: string; account_id: string; token_hash: string; display: string; scopes: string; audience: string;
  team_id: string | null; project_id: string | null; cui_bound: number;
  expires_at: number | null; revoked_at: number | null; created_at: number;
}
interface OAuthDoubleRow {
  id: string; account_id: string; token_hash: string; display: string; scopes: string;
  team_id: string | null; project_id: string | null; cui_bound: number;
  expires_at: number | null; revoked_at: number | null; created_at: number;
}
const parseScopes = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

export function createD1KeyStore(db: D1Database, opts: { quotaPerDay?: number; ratePerMinute?: number; now?: () => number } = {}): KeyStore {
  const now = opts.now ?? (() => Date.now());
  const defaultQuota = opts.quotaPerDay ?? 600;
  const ratePerMinute = opts.ratePerMinute ?? 120;
  const records: CredentialRecord[] = [];
  const byHash = new Map<string, CredentialRecord>();
  const meta: RequestMeta[] = [];
  const notSupported = (): never => { throw new Error("not supported on the D1 enforcement store — keys and tokens are minted and revoked in the dashboard; this store only enforces."); };
  const materialize = (rec: CredentialRecord): CredentialRecord => { records.push(rec); byHash.set(rec.secretHash, rec); return rec; };

  async function lookupByHash(kind: string, hash: string): Promise<CredentialRecord | null> {
    if (kind === "api_key") {
      const row = await db.prepare("SELECT * FROM api_keys WHERE secret_hash = ?").bind(hash).first<ApiKeyRow>();
      if (!row) return null;
      return materialize({
        id: row.id, kind: "api_key", creatorId: row.creator_account_id, name: row.name,
        audience: null, display: row.display, secretHash: row.secret_hash, scopes: parseScopes(row.scopes),
        teamId: row.team_id, projectId: row.project_id, projectCuiFlagged: row.cui_bound === 1,
        expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at,
        quotaPerDay: row.quota_per_day, usageCount: row.usage_count, usageDay: row.usage_day,
        rateWindowStart: row.rate_window_start, rateWindowCount: row.rate_window_count, lastUsedAt: row.last_used_at,
      });
    }
    if (kind === "oauth_token") {
      const row = await db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ?").bind(hash).first<OAuthTokenRow>();
      if (!row) return null;
      return materialize({
        id: row.id, kind: "oauth", creatorId: row.account_id, name: "oauth_token",
        audience: row.audience, display: row.display, secretHash: row.token_hash, scopes: parseScopes(row.scopes),
        teamId: row.team_id, projectId: row.project_id, projectCuiFlagged: row.cui_bound === 1,
        expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at,
        quotaPerDay: defaultQuota, usageCount: 0, usageDay: "", rateWindowStart: row.created_at, rateWindowCount: 0, lastUsedAt: null,
      });
    }
    if (kind === "oauth_double") {
      const row = await db.prepare("SELECT * FROM oauth_test_doubles WHERE token_hash = ?").bind(hash).first<OAuthDoubleRow>();
      if (!row) return null;
      return materialize({
        id: row.id, kind: "oauth_double", creatorId: row.account_id, name: "oauth_double",
        audience: null, display: row.display, secretHash: row.token_hash, scopes: parseScopes(row.scopes),
        teamId: row.team_id, projectId: row.project_id, projectCuiFlagged: row.cui_bound === 1,
        expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at,
        quotaPerDay: defaultQuota, usageCount: 0, usageDay: "", rateWindowStart: row.created_at, rateWindowCount: 0, lastUsedAt: null,
      });
    }
    return null;
  }

  const store: KeyStore & {
    _byHash: Map<string, CredentialRecord>; _meta: RequestMeta[]; _now: () => number; _ratePerMinute: number;
    _lookupByHash: (kind: string, hash: string) => Promise<CredentialRecord | null>;
    _persistUsage: (rec: CredentialRecord) => Promise<void>;
    _appendMeta: (entry: RequestMeta, rec: CredentialRecord) => Promise<void>;
  } = {
    async mint() { return notSupported(); },
    async registerOAuthDouble() { return notSupported(); },
    async registerOAuthToken() { return notSupported(); },
    async seedOAuthFromJson() { return notSupported(); },
    async revoke() { return notSupported(); },
    dump() { return records.map((r) => ({ ...r })); },
    requestLog() { return meta.map((m) => ({ ...m })); },
    setAuditSink() { /* enforcement side keeps no audit sink; lifecycle events are audited where they happen (the dashboard) */ },
    async seedFromJson() { return notSupported(); },
    _byHash: byHash, _meta: meta, _now: now, _ratePerMinute: ratePerMinute,
    _lookupByHash: lookupByHash,
    async _persistUsage(rec: CredentialRecord) {
      await db.prepare("UPDATE api_keys SET usage_count = ?, usage_day = ?, rate_window_start = ?, rate_window_count = ?, last_used_at = ? WHERE id = ?")
        .bind(rec.usageCount, rec.usageDay, rec.rateWindowStart, rec.rateWindowCount, rec.lastUsedAt, rec.id).run();
    },
    async _appendMeta(entry: RequestMeta, rec: CredentialRecord) {
      const identityKind = rec.kind === "oauth" ? "oauth_token" : rec.kind;
      await db.prepare("INSERT INTO api_key_requests (id, key_id, identity_kind, ts, endpoint, status) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), entry.keyId, identityKind, entry.ts, entry.endpoint, entry.status).run();
    },
  };
  return store;
}

/** Resolve a presented credential to its record, constant-time on the hash. */
async function resolve(store: KeyStore, cred: { kind: string; secret?: string; token?: string }): Promise<CredentialRecord | null> {
  const s = (store as unknown as { _byHash: Map<string, CredentialRecord>; _lookupByHash?: (kind: string, hash: string) => Promise<CredentialRecord | null> });
  const presented = cred.kind === "api_key" ? cred.secret : cred.token;
  if (!presented) return null;
  const hash = await sha256Hex(presented);
  let rec = s._byHash.get(hash);
  // D1-backed store: on a cache miss, resolve from the database (the
  // lookup materializes the record into _byHash). The in-memory store
  // has no lookup hook, so its behavior is unchanged.
  if (!rec && s._lookupByHash) rec = (await s._lookupByHash(cred.kind, hash)) ?? undefined;
  if (!rec || !timingSafeEqual(rec.secretHash, hash)) return null;
  if (cred.kind === "api_key" && rec.kind !== "api_key") return null;
  if (cred.kind === "oauth_double" && rec.kind !== "oauth_double") return null;
  if (cred.kind === "oauth_token" && rec.kind !== "oauth") return null;
  return rec;
}

export interface GateRequirement { scope: string; teamId?: string; projectId?: string; endpointId?: string; audience?: string }
export interface GateResult { allowed: boolean; reason: string; keyId?: string; accountId?: string; kind?: string; usageCount?: number }

/** THE shared authorization gate (C-10): keys and OAuth tokens pass the
 * identical scope / binding / expiry / revocation / CUI-endpoint checks.
 * Per-key quota + rate limit (C-11) apply to keys; admitted key requests
 * write request metadata (never payloads, never the secret) and maintain
 * usage count + last-used from it. */
export async function authorizeCredential(store: KeyStore, cred: { kind: string; secret?: string; token?: string }, req: GateRequirement): Promise<GateResult> {
  const deny = (reason: string): GateResult => ({ allowed: false, reason });
  const s = store as unknown as { _meta: RequestMeta[]; _now: () => number; _ratePerMinute: number; _persistUsage?: (rec: CredentialRecord) => Promise<void>; _appendMeta?: (entry: RequestMeta, rec: CredentialRecord) => Promise<void> };
  const rec = await resolve(store, cred);
  if (!rec) return deny("Unknown credential — the key or token was not recognized.");
  const t = s._now();
  if (rec.revokedAt) return deny("Credential revoked — revocation takes effect on the very next request.");
  if (rec.expiresAt !== null && t > rec.expiresAt) return deny("Credential expired.");
  if (!rec.scopes.includes(req.scope)) return deny(`Scope refused: this credential does not hold ${req.scope}. Read and action scopes are separate grants.`);
  // Audience binding (RFC 8707, C-13/C-10 completion): an OAuth token is
  // minted for ONE resource and is refused at any other. The token path
  // lands in this same gate — API and MCP handlers always name their
  // resource, so a scoped route cannot be added without the audience check.
  if (rec.kind === "oauth" && req.audience && rec.audience !== req.audience) {
    return deny(`Audience refused: this token was minted for ${rec.audience ?? "another resource"}, not for ${req.audience}. Tokens are bound to one resource (RFC 8707).`);
  }
  if (rec.teamId && req.teamId && req.teamId !== rec.teamId) return deny("Binding refused: this credential is bound to a different team.");
  if (rec.projectId && req.projectId && req.projectId !== rec.projectId) return deny("Binding refused: this credential is bound to a different project.");
  if (req.scope.startsWith("action:") && rec.teamId && !req.teamId && !req.projectId) return deny("Binding refused: a bound credential must name its team or project for an action.");
  if (req.scope.startsWith("action:") && rec.projectId && !req.projectId) return deny("Binding refused: a project-bound credential must name its project for an action.");
  if (rec.projectCuiFlagged && req.endpointId && !isEligibleEndpoint(req.endpointId)) {
    return deny(`Provider policy refused: endpoint ${req.endpointId} is not on the AI provider policy allowlist of eligible endpoints.`);
  }
  if (rec.kind === "api_key") {
    const day = new Date(t).toISOString().slice(0, 10);
    const usedToday = rec.usageDay === day ? rec.usageCount : 0;
    if (usedToday >= rec.quotaPerDay) return deny(`Quota refused: this key has reached its daily quota of ${rec.quotaPerDay} requests. Other keys are unaffected.`);
    const inWindow = t - rec.rateWindowStart < 60_000 ? rec.rateWindowCount : 0;
    if (inWindow >= s._ratePerMinute) return deny("Rate limit refused: too many requests in one minute for this key.");
    rec.usageCount = usedToday + 1; rec.usageDay = day;
    rec.rateWindowStart = t - rec.rateWindowStart < 60_000 ? rec.rateWindowStart : t;
    rec.rateWindowCount = inWindow + 1; rec.lastUsedAt = t;
    const entry: RequestMeta = { keyId: rec.id, ts: t, endpoint: req.endpointId ?? req.scope, status: 200 };
    s._meta.push(entry);
    // D1-backed store only: persist the mutated usage/rate fields back
    // to the api_keys row and write the request-metadata row, so quota
    // and usage survive across requests (fresh store per request). The
    // in-memory store has no hooks — its behavior is unchanged.
    if (s._persistUsage) await s._persistUsage(rec);
    if (s._appendMeta) await s._appendMeta(entry, rec);
    return { allowed: true, reason: "ok", keyId: rec.id, accountId: rec.creatorId, kind: rec.kind, usageCount: rec.usageCount };
  }
  const entry: RequestMeta = { keyId: rec.id, ts: t, endpoint: req.endpointId ?? req.scope, status: 200 };
  s._meta.push(entry);
  if (s._appendMeta) await s._appendMeta(entry, rec);
  return { allowed: true, reason: "ok", keyId: rec.id, accountId: rec.creatorId, kind: rec.kind };
}

/** Headers only (C-08): a credential in the URL is an error, never a login. */
export function extractCredential(input: { headers: Record<string, string | undefined>; url: string }): { secret?: string; token?: string; oauthToken?: string; error?: string } {
  let url: URL;
  try { url = new URL(input.url); } catch { return { error: "credential_in_url" }; }
  const keyLike = /ehk_live_[0-9a-f]{16,}|eho_(test|live)_[0-9a-f]{16,}/;
  for (const [name, value] of url.searchParams.entries()) {
    if (["api_key", "apikey", "key", "access_token", "token"].includes(name.toLowerCase()) || keyLike.test(value)) {
      return { error: "credential_in_url" };
    }
  }
  if (keyLike.test(url.pathname)) return { error: "credential_in_url" };
  const auth = input.headers["authorization"] ?? input.headers["Authorization"];
  if (auth?.startsWith("Bearer ")) {
    const v = auth.slice(7).trim();
    if (v.startsWith("eho_live_")) return { oauthToken: v };
    return v.startsWith("eho_test_") ? { token: v } : { secret: v };
  }
  return {};
}

export interface KeysEnv { EH_LOCAL_KEYS_JSON_B64?: string; EH_LOCAL_OAUTH_JSON_B64?: string; DB?: D1Database }

/** Build the request-scoped store for a Worker from its env.
 * With the D1 binding present (the served track), a FRESH D1-backed
 * store is returned on every call — deliberately no module-level
 * cache, so a dashboard revocation lands on the very next request —
 * and the seed vars are never read. Without it, the local seed path
 * below runs byte-unchanged. */
const storesBySeed = new Map<string, Promise<KeyStore>>();
export function storeFromEnv(env: KeysEnv): Promise<KeyStore> {
  if (env.DB) return Promise.resolve(createD1KeyStore(env.DB));
  const seed = env.EH_LOCAL_KEYS_JSON_B64 ?? "";
  const oauthSeed = env.EH_LOCAL_OAUTH_JSON_B64 ?? "";
  const cacheKey = seed + "|" + oauthSeed;
  if (!storesBySeed.has(cacheKey)) {
    storesBySeed.set(cacheKey, (async () => {
      const store = createKeyStore();
      if (seed) await store.seedFromJson(new TextDecoder().decode(Uint8Array.from(atob(seed), (ch) => ch.charCodeAt(0))));
      if (oauthSeed) await store.seedOAuthFromJson(new TextDecoder().decode(Uint8Array.from(atob(oauthSeed), (ch) => ch.charCodeAt(0))));
      return store;
    })());
  }
  return storesBySeed.get(cacheKey)!;
}
