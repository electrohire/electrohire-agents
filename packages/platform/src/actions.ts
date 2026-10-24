/**
 * C-13 action implementations — LOCAL stand-in store (agents repo).
 *
 * The system of record is the website repo's data layer (B-02 subscribers,
 * B-05 support tickets, D-04 double opt-in). This in-memory store mirrors
 * that behavior exactly for the API/MCP Workers' local track, and is
 * labeled a stand-in wherever it is used:
 *  - Newsletter subscribe is DOUBLE OPT-IN (D-04/B-02): an agent-subscribed
 *    address is `pending` until the person clicks the confirmation link;
 *    pending addresses are in no send list. The subscribe response is one
 *    identical object for new / pending / already-confirmed addresses —
 *    it never reveals whether an address is already subscribed.
 *  - Confirmation tokens are single-use, expire in 7 days, stored hashed.
 *  - Support tickets carry the same inbox-visible fields the site form
 *    produces (B-05): requester, subject, body, context, status, the
 *    data-request flag and its one-month due date — a ticket filed via an
 *    action is indistinguishable in the inbox from one filed on the site.
 * Payload text is stored as DATA, byte-identical (C-15 layer 2 screens and
 * logs it in the dispatch path; it is never executed as an instruction).
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const DAY_MS = 24 * 3600 * 1000;
const CONFIRM_TTL_MS = 7 * DAY_MS;

export const SUBSCRIBE_RESPONSE = {
  ok: true as const,
  status: "pending_confirmation" as const,
  message: "If this address can be subscribed, a confirmation email is on its way. The subscription starts only when the confirmation link in that email is clicked.",
};

export interface SubscriberRecord { email: string; status: string; source: string; consentAskedAt: number; consentGivenAt: number | null }
export interface TicketRecord {
  id: string; requesterName: string; requesterEmail: string; subject: string; body: string; context: string;
  status: string; isDataRequest: boolean; sourceRoute: string; receivedAt: number; dueAt: number | null;
}

export function createActionStore(opts: { now?: () => number } = {}) {
  const now = opts.now ?? (() => Date.now());
  const subscribers = new Map<string, SubscriberRecord>();
  const confirmations = new Map<string, { email: string; expiresAt: number; usedAt: number | null }>();
  const tickets: TicketRecord[] = [];
  const norm = (e: string) => e.trim().toLowerCase();

  function subscribe(input: { email: string; source?: string }) {
    const email = norm(input.email ?? "");
    if (!email || !email.includes("@")) throw new Error("A valid email address is required.");
    let sub = subscribers.get(email);
    if (!sub) {
      sub = { email, status: "pending", source: input.source ?? "api-oauth", consentAskedAt: now(), consentGivenAt: null };
      subscribers.set(email, sub);
    }
    if (sub.status === "confirmed") return { response: { ...SUBSCRIBE_RESPONSE }, confirmationToken: null as string | null };
    const token = "ehsub_" + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    // The token's hash is the store key; the plaintext travels only in the
    // confirmation email (here: returned to the caller playing the mailer).
    void sha256Hex(token).then((h) => confirmations.set(h, { email, expiresAt: now() + CONFIRM_TTL_MS, usedAt: null }));
    return { response: { ...SUBSCRIBE_RESPONSE }, confirmationToken: token as string | null };
  }

  async function confirm(token: string) {
    const hash = await sha256Hex(token ?? "");
    // subscribe() registers the hash asynchronously in this stand-in; give
    // the microtask a chance (in the D1 record the row exists synchronously).
    let rec = confirmations.get(hash);
    if (!rec) { await new Promise((r) => setTimeout(r, 5)); rec = confirmations.get(hash); }
    if (!rec) throw new Error("Confirmation link invalid — it was not recognized.");
    if (rec.usedAt) throw new Error("Confirmation link already used — it works once only.");
    if (now() > rec.expiresAt) throw new Error("Confirmation link expired — subscribe again for a fresh one.");
    rec.usedAt = now();
    const sub = subscribers.get(rec.email);
    if (!sub) throw new Error("No subscriber record for that address.");
    sub.status = "confirmed";
    sub.consentGivenAt = now();
    return { ...sub };
  }

  function getSubscriber(email: string) {
    return subscribers.get(norm(email)) ?? null;
  }
  function buildSendList(): string[] {
    return [...subscribers.values()].filter((s) => s.status === "confirmed").map((s) => s.email).sort();
  }

  function createTicket(input: { requesterName: string; requesterEmail: string; subject: string; body: string; context?: string; isDataRequest?: boolean; sourceRoute?: string }) {
    const received = now();
    const isDr = !!input.isDataRequest;
    const t: TicketRecord = {
      id: crypto.randomUUID(), requesterName: input.requesterName, requesterEmail: input.requesterEmail,
      subject: input.subject, body: input.body, context: input.context ?? "", status: "open",
      isDataRequest: isDr, sourceRoute: input.sourceRoute ?? "site-contact",
      receivedAt: received, dueAt: isDr ? received + 30 * DAY_MS : null,
    };
    tickets.push(t);
    return { ...t };
  }
  function listTickets() { return tickets.map((t) => ({ ...t })); }

  return { subscribe, confirm, getSubscriber, buildSendList, createTicket, listTickets };
}
export type ActionStore = ReturnType<typeof createActionStore>;
