// C3 HTTP battery seed generator (LOCAL ONLY). Mints local OAuth test
// tokens (audience-bound) and installs them into both Workers' .dev.vars
// as EH_LOCAL_OAUTH_JSON_B64 (hashed on ingest by the Workers; plaintext
// exists only in the gitignored c3-seed.json). Run AFTER c2-seed.mjs.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const token = () => "eho_live_" + randomBytes(24).toString("hex");
const API_RES = "https://api-beta.electrohire.com";
const MCP_RES = "https://mcp-beta.electrohire.com";

const tokens = [
  { name: "API_TOKEN", token: token(), accountId: "local-seed-user", scopes: ["action:newsletter_subscribe", "action:support_ticket"], audience: API_RES },
  { name: "MCP_TOKEN", token: token(), accountId: "local-seed-user", scopes: ["action:newsletter_subscribe", "action:support_ticket"], audience: MCP_RES },
  { name: "API_READ_TOKEN", token: token(), accountId: "local-seed-user", scopes: ["read:content"], audience: API_RES },
];
writeFileSync(join(here, "c3-seed.json"), JSON.stringify({ generatedAt: new Date().toISOString(), tokens }, null, 2));
const b64 = Buffer.from(JSON.stringify(tokens), "utf8").toString("base64");
for (const app of ["api", "mcp"]) {
  const path = join(root, "apps", app, ".dev.vars");
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  text = text.split("\n").filter((l) => !l.startsWith("EH_LOCAL_OAUTH_JSON_B64=")).join("\n");
  writeFileSync(path, text.replace(/\n*$/, "\n") + `EH_LOCAL_OAUTH_JSON_B64=${b64}\n`);
}
console.log("seeded", tokens.map((t) => `${t.name}=eho_live_…${t.token.slice(-4)}`).join(" "));
