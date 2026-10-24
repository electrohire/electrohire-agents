// C2 HTTP battery seed generator (LOCAL ONLY). Mints the local test keys
// the frozen c2-http battery uses, writes them to c2-seed.json (test-side,
// gitignored — local fixtures, never committed), and installs them into
// both Workers' .dev.vars as EH_LOCAL_KEYS_JSON_B64 (the Workers hash the
// secrets on ingest; plaintext exists only in these local files).
// Referenced elsewhere by prefix + last 4 only.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const secret = () => "ehk_live_" + randomBytes(24).toString("hex");
const now = Date.now();

const keys = [
  { name: "READ_KEY", secret: secret(), scopes: ["read:content", "read:tools"], creatorId: "local-seed-user" },
  { name: "ACTION_ONLY_KEY", secret: secret(), scopes: ["action:support_ticket"], creatorId: "local-seed-user" },
  { name: "QUOTA_KEY", secret: secret(), scopes: ["read:content"], creatorId: "local-seed-user", quotaPerDay: 2 },
  { name: "REVOKED_KEY", secret: secret(), scopes: ["read:content"], creatorId: "local-seed-user", revoked: true },
  { name: "EXPIRED_KEY", secret: secret(), scopes: ["read:content"], creatorId: "local-seed-user", expiresAt: now - 1000 },
];
writeFileSync(join(here, "c2-seed.json"), JSON.stringify({ generatedAt: new Date(now).toISOString(), keys }, null, 2));
const b64 = Buffer.from(JSON.stringify(keys), "utf8").toString("base64");
for (const app of ["api", "mcp"]) {
  const path = join(root, "apps", app, ".dev.vars");
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  text = text.split("\n").filter((l) => !l.startsWith("EH_LOCAL_KEYS_JSON_B64=")).join("\n");
  writeFileSync(path, text.replace(/\n*$/, "\n") + `EH_LOCAL_KEYS_JSON_B64=${b64}\n`);
}
console.log("seeded", keys.map((k) => `${k.name}=ehk_live_…${k.secret.slice(-4)}`).join(" "));
