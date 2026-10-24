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
  if (["electrohire_estimate_cost", "electrohire_scoping_checklist", "electrohire_timeline_calculator"].includes(name)) return "read:tools";
  return "read:content";
}

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
  id: string; kind: "api_key" | "oauth_double"; creatorId: string; name: string;
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

  async function add(kind: "api_key" | "oauth_double", input: { creatorId: string; name: string; scopes: string[]; teamId?: string | null; projectId?: string | null; projectCuiFlagged?: boolean; expiresAt?: number | null; quotaPerDay?: number; secret?: string; revoked?: boolean }) {
    const secret = input.secret ?? (kind === "api_key" ? mintSecret() : "eho_test_" + mintSecret().slice("ehk_live_".length));
    const t = now();
    const rec: CredentialRecord = {
      id: crypto.randomUUID(), kind, creatorId: input.creatorId, name: input.name,
      display: kind === "api_key" ? `ehk_live_…${secret.slice(-4)}` : "oauth_double",
      secretHash: await sha256Hex(secret), scopes: [...input.scopes],
      teamId: input.teamId ?? null, projectId: input.projectId ?? null,
      projectCuiFlagged: !!input.projectCuiFlagged, expiresAt: input.expiresAt ?? null,
      revokedAt: input.revoked ? t : null, createdAt: t,
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

/** Resolve a presented credential to its record, constant-time on the hash. */
async function resolve(store: KeyStore, cred: { kind: string; secret?: string; token?: string }): Promise<CredentialRecord | null> {
  const s = (store as unknown as { _byHash: Map<string, CredentialRecord> });
  const presented = cred.kind === "api_key" ? cred.secret : cred.token;
  if (!presented) return null;
  const hash = await sha256Hex(presented);
  const rec = s._byHash.get(hash);
  if (!rec || !timingSafeEqual(rec.secretHash, hash)) return null;
  if (cred.kind === "api_key" && rec.kind !== "api_key") return null;
  if (cred.kind === "oauth_double" && rec.kind !== "oauth_double") return null;
  return rec;
}

export interface GateRequirement { scope: string; teamId?: string; projectId?: string; endpointId?: string }
export interface GateResult { allowed: boolean; reason: string; keyId?: string; accountId?: string; kind?: string; usageCount?: number }

/** THE shared authorization gate (C-10): keys and OAuth tokens pass the
 * identical scope / binding / expiry / revocation / CUI-endpoint checks.
 * Per-key quota + rate limit (C-11) apply to keys; admitted key requests
 * write request metadata (never payloads, never the secret) and maintain
 * usage count + last-used from it. */
export async function authorizeCredential(store: KeyStore, cred: { kind: string; secret?: string; token?: string }, req: GateRequirement): Promise<GateResult> {
  const deny = (reason: string): GateResult => ({ allowed: false, reason });
  const s = store as unknown as { _meta: RequestMeta[]; _now: () => number; _ratePerMinute: number };
  const rec = await resolve(store, cred);
  if (!rec) return deny("Unknown credential — the key or token was not recognized.");
  const t = s._now();
  if (rec.revokedAt) return deny("Credential revoked — revocation takes effect on the very next request.");
  if (rec.expiresAt !== null && t > rec.expiresAt) return deny("Credential expired.");
  if (!rec.scopes.includes(req.scope)) return deny(`Scope refused: this credential does not hold ${req.scope}. Read and action scopes are separate grants.`);
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
    s._meta.push({ keyId: rec.id, ts: t, endpoint: req.endpointId ?? req.scope, status: 200 });
    return { allowed: true, reason: "ok", keyId: rec.id, accountId: rec.creatorId, kind: rec.kind, usageCount: rec.usageCount };
  }
  s._meta.push({ keyId: rec.id, ts: t, endpoint: req.endpointId ?? req.scope, status: 200 });
  return { allowed: true, reason: "ok", keyId: rec.id, accountId: rec.creatorId, kind: rec.kind };
}

/** Headers only (C-08): a credential in the URL is an error, never a login. */
export function extractCredential(input: { headers: Record<string, string | undefined>; url: string }): { secret?: string; token?: string; error?: string } {
  let url: URL;
  try { url = new URL(input.url); } catch { return { error: "credential_in_url" }; }
  const keyLike = /ehk_live_[0-9a-f]{16,}|eho_test_[0-9a-f]{16,}/;
  for (const [name, value] of url.searchParams.entries()) {
    if (["api_key", "apikey", "key", "access_token", "token"].includes(name.toLowerCase()) || keyLike.test(value)) {
      return { error: "credential_in_url" };
    }
  }
  if (keyLike.test(url.pathname)) return { error: "credential_in_url" };
  const auth = input.headers["authorization"] ?? input.headers["Authorization"];
  if (auth?.startsWith("Bearer ")) {
    const v = auth.slice(7).trim();
    return v.startsWith("eho_test_") ? { token: v } : { secret: v };
  }
  return {};
}

export interface KeysEnv { EH_LOCAL_KEYS_JSON_B64?: string }

/** Build the request-scoped store for a Worker from its env stand-in. */
const storesBySeed = new Map<string, Promise<KeyStore>>();
export function storeFromEnv(env: { EH_LOCAL_KEYS_JSON_B64?: string }): Promise<KeyStore> {
  const seed = env.EH_LOCAL_KEYS_JSON_B64 ?? "";
  if (!storesBySeed.has(seed)) {
    storesBySeed.set(seed, (async () => {
      const store = createKeyStore();
      if (seed) await store.seedFromJson(new TextDecoder().decode(Uint8Array.from(atob(seed), (ch) => ch.charCodeAt(0))));
      return store;
    })());
  }
  return storesBySeed.get(seed)!;
}
