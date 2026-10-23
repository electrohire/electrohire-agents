// Dependency-free validator for connectors/registry.json and its examples.
// Run: node tools/validate-connectors.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (m) => errors.push(m);

let registry;
try {
  registry = JSON.parse(readFileSync(join(root, "connectors/registry.json"), "utf8"));
} catch (e) {
  console.error(`FAIL: connectors/registry.json does not parse: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(registry.connectors) || registry.connectors.length === 0) fail("registry.connectors is missing or empty");

const seen = new Set();
for (const c of registry.connectors ?? []) {
  for (const k of ["id","name","platform","transport","configFormat","status","version","folder","configExample"]) {
    if (!c[k]) fail(`${c.id ?? "?"}: missing field ${k}`);
  }
  if (seen.has(c.id)) fail(`${c.id}: duplicate id`);
  seen.add(c.id);
  if (!["config","guide","bridge"].includes(c.status)) fail(`${c.id}: status must be config|guide|bridge`);
  if (!/^\d+\.\d+\.\d+$/.test(c.version ?? "")) fail(`${c.id}: version is not semver`);
  const dir = join(root, c.folder ?? "");
  if (!existsSync(dir)) { fail(`${c.id}: folder ${c.folder} missing`); continue; }
  if (!existsSync(join(dir, "README.md"))) fail(`${c.id}: README.md missing`);
  const cfgPath = join(dir, c.configExample ?? "");
  if (!existsSync(cfgPath)) { fail(`${c.id}: config example ${c.configExample} missing`); continue; }
  const text = readFileSync(cfgPath, "utf8");
  if (c.configExample.endsWith(".json")) {
    try { JSON.parse(text); } catch (e) { fail(`${c.id}: ${c.configExample} does not parse as JSON: ${e.message}`); }
  }
  if (c.configExample.endsWith(".toml")) {
    if (!/^\[mcp_servers\.electrohire\]/m.test(text)) fail(`${c.id}: TOML example lacks the [mcp_servers.electrohire] table header`);
  }
  // Real-key guard: fail on a long non-placeholder token after Bearer / eh_live_
  for (const m of text.matchAll(/(?:Bearer\s+|eh_live_)([A-Za-z0-9._\-]{12,})/g)) {
    const tok = m[1];
    if (tok.includes("REPLACE_ME") || tok.includes("${") || tok.startsWith("REPLACE")) continue;
    fail(`${c.id}: ${c.configExample} looks like it contains a real key (token after Bearer/eh_live_)`);
  }
  // README must cover the shared required sections
  const readme = existsSync(join(dir,"README.md")) ? readFileSync(join(dir,"README.md"),"utf8") : "";
  for (const needle of ["MCP API key", "401", "Revoke or rotate"]) {
    if (!readme.includes(needle)) fail(`${c.id}: README.md missing required content: ${needle}`);
  }
}
if (errors.length) { console.error("FAIL:\n- " + errors.join("\n- ")); process.exit(1); }
console.log(`OK: ${registry.connectors.length} connectors validated (registry, READMEs, config examples, no real keys).`);
