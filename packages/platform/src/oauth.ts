/**
 * OAuth 2.1 — authorization-server side (Phase C3: C-13).
 *
 * Authorization code + PKCE (S256 only), protected-resource metadata
 * (RFC 9728), authorization-server metadata (RFC 8414), and audience-bound
 * access tokens (RFC 8707 resource indicators): a token is minted for ONE
 * resource and the shared gate (apikeys.ts) refuses it at any other.
 * Tokens travel in headers only — the shared extractor rejects a token in
 * a URL exactly as it rejects a key (C-08/C-13).
 *
 * C-15 layer 4 (human confirmation choke point): an authorization request
 * becomes a code ONLY through approveAuthorization, which requires the
 * human consent context — the signed-in account's id plus a Turnstile
 * verification that the website consent handler established server-side
 * (Amendment 1 P-2: Managed widget + Siteverify, fail-closed). Nothing
 * else in this module can mint a code or a token, and no payload content
 * (a ticket body, a subscribe address, any tool argument) is ever read as
 * a consent context: injected content cannot reach the choke point as an
 * instruction.
 *
 * Ellie actions are NOT offered: Phase E is gated (no builder named), so
 * `action:ellie_session` is absent from OAUTH_OFFERED_SCOPES and any
 * request for it is refused at authorize time.
 *
 * Local track: clients, requests and codes live in memory here (codes and
 * tokens hashed at rest); access tokens themselves are registered into
 * the shared key store, so they pass the SAME gate as personal API keys
 * (C-10 completion). The website repo carries the D1-backed system of
 * record for the consent/token endpoints; behavior is identical.
 */
import type { KeyStore } from "./apikeys.ts";

export const RESOURCES = {
  api: "https://api-beta.electrohire.com",
  mcp: "https://mcp-beta.electrohire.com",
} as const;
export const RESOURCE_LIST: string[] = [RESOURCES.api, RESOURCES.mcp];

/** Scopes an OAuth client may be granted. Read scopes plus the two C-13
 * action scopes. Ellie is deliberately absent (Phase E gated). */
export const OAUTH_OFFERED_SCOPES = [
  "read:content", "read:blog", "read:tools",
  "action:newsletter_subscribe", "action:support_ticket",
];

export const ACCESS_TOKEN_TTL_MS = 3600 * 1000; // 1 hour
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function mintCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "ehc_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 8414 authorization-server metadata. */
export function authorizationServerMetadata(issuer: string) {
  const base = issuer.replace(/\/$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_OFFERED_SCOPES],
  };
}

/** RFC 9728 protected-resource metadata. Bearer tokens in headers only. */
export function protectedResourceMetadata(resource: string, issuer: string) {
  return {
    resource,
    authorization_servers: [issuer.replace(/\/$/, "")],
    scopes_supported: [...OAUTH_OFFERED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://electrohire.com/developers",
  };
}

export interface OAuthClient { clientId: string; name: string; redirectUris: string[]; scopes: string[] }
interface AuthRequest {
  id: string; clientId: string; redirectUri: string; scopes: string[]; resource: string;
  codeChallenge: string; state?: string; status: "pending" | "approved" | "denied";
  accountId?: string; codeHash?: string; codeExpiresAt?: number; codeUsedAt?: number; createdAt: number;
}

export function createOAuthFlow(opts: { keyStore: KeyStore; now?: () => number }) {
  const now = opts.now ?? (() => Date.now());
  const clients = new Map<string, OAuthClient>();
  const requests = new Map<string, AuthRequest>();
  const byCodeHash = new Map<string, AuthRequest>();

  async function registerClient(c: OAuthClient) {
    clients.set(c.clientId, { ...c, redirectUris: [...c.redirectUris], scopes: [...c.scopes] });
    return c;
  }

  async function beginAuthorization(input: {
    clientId: string; redirectUri: string; responseType: string; scope: string[]; resource?: string;
    codeChallenge?: string; codeChallengeMethod?: string; state?: string;
  }) {
    const client = clients.get(input.clientId);
    if (!client) throw new Error("Unknown client — the client is not registered.");
    if (input.responseType !== "code") throw new Error("Only response_type=code is supported (OAuth 2.1 authorization code flow).");
    if (!client.redirectUris.includes(input.redirectUri)) throw new Error("Redirect URI refused: it does not exactly match a registered redirect URI for this client.");
    if (input.codeChallengeMethod !== "S256" || !input.codeChallenge) throw new Error("PKCE is required with the S256 code challenge method — plain PKCE is refused.");
    const scopes = [...new Set(input.scope ?? [])];
    if (scopes.length === 0) throw new Error("Scope required: name at least one scope.");
    for (const s of scopes) {
      if (!OAUTH_OFFERED_SCOPES.includes(s)) throw new Error(`Scope not offered: ${s}. Offered scopes are the read scopes and the newsletter / support-ticket action scopes; Ellie actions are not offered (Phase E is gated).`);
      if (!client.scopes.includes(s)) throw new Error(`Scope refused: this client was not registered for ${s}.`);
    }
    const resource = input.resource ?? RESOURCES.api;
    if (!RESOURCE_LIST.includes(resource)) throw new Error(`Resource refused: ${resource} is not a protected resource of this platform (RFC 8707).`);
    const req: AuthRequest = {
      id: crypto.randomUUID(), clientId: client.clientId, redirectUri: input.redirectUri,
      scopes, resource, codeChallenge: input.codeChallenge, state: input.state,
      status: "pending", createdAt: now(),
    };
    requests.set(req.id, req);
    return { requestId: req.id, clientName: client.name, scopes, resource };
  }

  /** The consent details a human sees — client, scopes, resource. */
  async function getConsentDetails(requestId: string) {
    const req = requests.get(requestId);
    if (!req) throw new Error("Authorization request not found.");
    const client = clients.get(req.clientId);
    return { requestId: req.id, clientName: client?.name ?? req.clientId, scopes: [...req.scopes], resource: req.resource, status: req.status };
  }

  /**
   * C-15 layer 4 — THE choke point. Approval requires the human consent
   * context: a signed-in account id AND `turnstileVerified === true`
   * (established server-side by the consent handler after Siteverify).
   * A string, a payload, or tool output can never satisfy this.
   */
  function requireHumanConsent(ctx: { accountId?: unknown; turnstileVerified?: unknown }) {
    if (typeof ctx?.accountId !== "string" || !ctx.accountId.trim()) {
      throw new Error("Human consent required: no signed-in human account is attached to this decision.");
    }
    if (ctx.turnstileVerified !== true) {
      throw new Error("Human consent required: Turnstile verification (established server-side at the consent screen) is missing or failed — consent fails closed.");
    }
  }

  async function approveAuthorization(requestId: string, ctx: { accountId?: unknown; turnstileVerified?: unknown }) {
    requireHumanConsent(ctx);
    const req = requests.get(requestId);
    if (!req) throw new Error("Authorization request not found.");
    if (req.status !== "pending") throw new Error("This authorization request has already been decided — it cannot be approved or denied twice.");
    req.status = "approved";
    req.accountId = ctx.accountId as string;
    const code = mintCode();
    req.codeHash = await sha256Hex(code);
    req.codeExpiresAt = now() + AUTH_CODE_TTL_MS;
    byCodeHash.set(req.codeHash, req);
    return { code, redirectUri: req.redirectUri, state: req.state, resource: req.resource, scopes: [...req.scopes] };
  }

  async function denyAuthorization(requestId: string, ctx: { accountId?: unknown; turnstileVerified?: unknown }) {
    requireHumanConsent(ctx);
    const req = requests.get(requestId);
    if (!req) throw new Error("Authorization request not found.");
    if (req.status !== "pending") throw new Error("This authorization request has already been decided — it cannot be approved or denied twice.");
    req.status = "denied";
    req.accountId = ctx.accountId as string;
    return { denied: true as const, redirectUri: req.redirectUri, state: req.state, error: "access_denied" };
  }

  async function exchangeCode(input: { code: string; codeVerifier: string; clientId: string; redirectUri: string; resource?: string }) {
    const hash = await sha256Hex(input.code ?? "");
    const req = byCodeHash.get(hash);
    if (!req || req.status !== "approved" || !req.codeHash) throw new Error("Authorization code not recognized — it may never have been issued.");
    if (req.codeUsedAt) throw new Error("Authorization code already used — codes are single-use.");
    if (now() > (req.codeExpiresAt ?? 0)) throw new Error("Authorization code expired — codes live 10 minutes.");
    if (input.clientId !== req.clientId) throw new Error("Client mismatch: the code was issued to a different client.");
    if (input.redirectUri !== req.redirectUri) throw new Error("Redirect URI mismatch: the token request must repeat the authorized redirect URI.");
    if (input.resource && input.resource !== req.resource) throw new Error("Audience/resource mismatch: the token request names a different resource than the authorization granted (RFC 8707).");
    const challenge = await pkceChallenge(input.codeVerifier ?? "");
    if (challenge !== req.codeChallenge) throw new Error("PKCE verifier mismatch: the code verifier does not match the authorized challenge.");
    req.codeUsedAt = now();
    const { token } = await opts.keyStore.registerOAuthToken({
      accountId: req.accountId as string, scopes: req.scopes, audience: req.resource,
      expiresAt: now() + ACCESS_TOKEN_TTL_MS,
    });
    return {
      accessToken: token, tokenType: "Bearer" as const, expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
      scope: req.scopes.join(" "), audience: req.resource, resource: req.resource, accountId: req.accountId as string,
    };
  }

  /** Revocation by the token's owner only (cross-user safe). */
  async function revokeOwnedToken(token: string, ctx: { accountId: string }) {
    const hash = await sha256Hex(token ?? "");
    const rec = opts.keyStore.dump().find((r) => r.kind === "oauth" && r.secretHash === hash);
    if (!rec) throw new Error("Token not found.");
    if (rec.creatorId !== ctx.accountId) throw new Error("Revocation refused: this token is not yours — a token can be revoked only by its owner.");
    await opts.keyStore.revoke(rec.id);
    return { revoked: true as const };
  }

  return { registerClient, beginAuthorization, getConsentDetails, approveAuthorization, denyAuthorization, exchangeCode, revokeOwnedToken };
}
export type OAuthFlow = ReturnType<typeof createOAuthFlow>;
