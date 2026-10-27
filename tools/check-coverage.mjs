#!/usr/bin/env node
/**
 * check-coverage.mjs — the MCP + skills coverage gate (WS-5, 2026-10-26).
 *
 * The standing rule: no system change ships without its MCP + skills
 * updates in the same change. This check enforces it inside this repo.
 * It enumerates, from the code and the docs as they actually are:
 *
 *   (a) the served OpenAPI operations — every route apps/api registers
 *       (createRoute definitions, app.doc, direct app.<verb> calls);
 *   (b) the MCP tools — every registerTool call in apps/mcp;
 *   (c) the references — every tool name (electrohire_*) and API path
 *       (/v1/..., /openapi.json) named in the skills, the connector
 *       guides and configs, the docs, the app READMEs, and the Python
 *       SDK client;
 *
 * and fails when they diverge from tools/coverage-map.json:
 *
 *   - an operation with no map entry, or a map entry for an operation
 *     the code does not serve;
 *   - an operation mapped to a tool that does not exist, or declared
 *     tool-less without a real reason;
 *   - a tool mapped from no operation and not declared in
 *     toolsWithoutOperation with a reason;
 *   - a doc, skill, guide, or SDK reference to a tool or path that
 *     does not exist (a dead reference a user would follow into a wall);
 *   - a tool or operation no doc surface mentions at all (shipped but
 *     undocumented — a user cannot find it);
 *   - the API-key scope catalog and the OAuth offered scopes disagreeing
 *     (packages/platform apikeys.ts vs oauth.ts), or a doc naming a
 *     scope that does not exist.
 *
 * The website repo carries the mirror-image gate
 * (scripts/check-agent-coverage.mjs against
 * specs/004-api-mcp/agent-surface-inventory.json); operation and tool
 * names must match across both. Dependency-free.
 * Run: node tools/check-coverage.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (m) => failures.push(m);
const read = (rel) => readFileSync(join(root, rel), "utf8");

function listFiles(dir, exts) {
  const out = [];
  if (!existsSync(join(root, dir))) return out;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") out.push(...listFiles(p, exts)); }
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out.sort();
}

// ---- (a) served OpenAPI operations --------------------------------------
const operations = new Set();
for (const file of listFiles("apps/api", [".ts"])) {
  const src = read(file);
  const starts = [...src.matchAll(/createRoute\s*\(/g)].map((m) => m.index);
  starts.forEach((start, i) => {
    const window = src.slice(start, Math.min(start + 2000, starts[i + 1] ?? src.length));
    const method = /method:\s*["'`]([A-Za-z]+)["'`]/.exec(window);
    const path = /path:\s*["'`]([^"'`]+)["'`]/.exec(window);
    if (method && path) operations.add(`${method[1].toUpperCase()} ${path[1]}`);
  });
  for (const m of src.matchAll(/\.doc\(\s*["'`]([^"'`]+)["'`]/g)) operations.add(`GET ${m[1]}`);
  for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
    operations.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
}

// ---- (b) MCP tools --------------------------------------------------------
const tools = new Set();
for (const file of listFiles("apps/mcp", [".ts"])) {
  const src = read(file);
  for (const m of src.matchAll(/\.registerTool\(\s*["'`]([^"'`]+)["'`]/g)) tools.add(m[1]);
}

// ---- the map ---------------------------------------------------------------
const map = JSON.parse(read("tools/coverage-map.json"));
const mappedOps = new Map();
for (const e of map.operations ?? []) {
  if (mappedOps.has(e.operation)) fail(`coverage map: duplicate operation ${e.operation}`);
  mappedOps.set(e.operation, e);
  if (e.tool == null && (!e.apiOnly || e.apiOnly.length < 40)) fail(`coverage map: ${e.operation} has no tool and no real apiOnly reason`);
  if (e.tool != null && !tools.has(e.tool)) fail(`coverage map: ${e.operation} maps to tool ${e.tool}, which apps/mcp does not register`);
}
for (const op of operations) if (!mappedOps.has(op)) fail(`operation ${op}: served by apps/api but missing from tools/coverage-map.json`);
for (const op of mappedOps.keys()) if (!operations.has(op)) fail(`operation ${op}: in tools/coverage-map.json but apps/api does not serve it`);

const toolsCovered = new Set([...mappedOps.values()].map((e) => e.tool).filter(Boolean));
const declaredToolOnly = new Map();
for (const e of map.toolsWithoutOperation ?? []) {
  declaredToolOnly.set(e.tool, e);
  if (!e.reason || e.reason.length < 40) fail(`coverage map: tool ${e.tool} is declared operation-less without a real reason`);
  if (!tools.has(e.tool)) fail(`coverage map: toolsWithoutOperation names ${e.tool}, which apps/mcp does not register`);
}
for (const t of tools) {
  if (!toolsCovered.has(t) && !declaredToolOnly.has(t)) fail(`tool ${t}: registered by apps/mcp but no operation maps to it and toolsWithoutOperation does not declare it`);
}

// ---- (c) doc / skill / guide / SDK references --------------------------------
const docFiles = [];
for (const surface of map.docSurfaces ?? []) {
  const abs = join(root, surface);
  if (!existsSync(abs)) { fail(`coverage map docSurfaces: ${surface} does not exist`); continue; }
  if (surface.includes(".")) docFiles.push(surface);
  else docFiles.push(...listFiles(surface, [".md", ".json", ".toml", ".py"]));
}
const referencedTools = new Map(); // tool -> first file
const referencedPaths = new Map(); // path -> first file
const referencedScopes = new Map();
for (const file of docFiles) {
  const text = read(file);
  for (const m of text.matchAll(/electrohire_[a-z][a-z0-9_]*/g)) {
    if (!referencedTools.has(m[0])) referencedTools.set(m[0], file);
  }
  for (const m of text.matchAll(/\/(?:v1\/[A-Za-z0-9/{}._-]+|openapi\.json|\.well-known\/[a-z-]+|llms\.txt)/g)) {
    const p = m[0].replace(/[.,)`"']+$/, "").replace(/\{[^}]*\}/g, (x) => x);
    if (!referencedPaths.has(p)) referencedPaths.set(p, file);
  }
  for (const m of text.matchAll(/\b(?:read|action):[a-z_]+/g)) {
    if (!referencedScopes.has(m[0])) referencedScopes.set(m[0], file);
  }
}
const opPaths = new Set([...operations].map((op) => op.split(" ")[1]));
const normalizePath = (p) => p.replace(/\{[^}]*\}/g, "{}").replace(/\/[A-Za-z0-9_-]+$/, (seg) => seg); // keep literal; compare segment-wise below
function pathExists(p) {
  if (opPaths.has(p)) return true;
  // A doc may cite a concrete instance (e.g. /v1/blog/some-slug in an
  // example): match it against parameterized operations segment by segment.
  const segs = p.split("/");
  for (const op of opPaths) {
    const osegs = op.split("/");
    if (osegs.length !== segs.length) continue;
    if (osegs.every((s, i) => s.startsWith("{") || s === segs[i])) return true;
  }
  return false;
}
for (const [t, file] of referencedTools) {
  if (!tools.has(t)) fail(`dead tool reference: ${file} names ${t}, which apps/mcp does not register`);
}
for (const [p, file] of referencedPaths) {
  if (!pathExists(p)) fail(`dead path reference: ${file} names ${p}, which apps/api does not serve`);
}
for (const t of tools) if (!referencedTools.has(t)) fail(`tool ${t}: registered but no skill, guide, doc, or SDK file mentions it — shipped but undocumented`);
for (const p of opPaths) {
  const mentioned = [...referencedPaths.keys()].some((r) => r === p || pathExists(r) && (() => { const rs = r.split("/"); const os = p.split("/"); return rs.length === os.length && os.every((s, i) => s.startsWith("{") || s === rs[i]); })());
  if (!mentioned) fail(`operation path ${p}: served but no skill, guide, doc, or SDK file mentions it — shipped but undocumented`);
}

// ---- scopes ------------------------------------------------------------------
const apikeysSrc = read("packages/platform/src/apikeys.ts");
const catalogIds = [...apikeysSrc.matchAll(/\{\s*id:\s*"(read|action):[a-z_]+"/g)].map((m) => m[0].match(/id:\s*"([^"]+)"/)[1]).sort();
const oauthSrc = read("packages/platform/src/oauth.ts");
const offeredBlock = /OAUTH_OFFERED_SCOPES\s*=\s*\[([^\]]*)\]/.exec(oauthSrc)?.[1] ?? "";
const offered = [...offeredBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
if (JSON.stringify(catalogIds) !== JSON.stringify(offered)) {
  fail(`scope catalog [${catalogIds.join(", ")}] != OAuth offered scopes [${offered.join(", ")}]`);
}
for (const [scope, file] of referencedScopes) {
  if (!catalogIds.includes(scope)) fail(`dead scope reference: ${file} names scope ${scope}, which the scope catalog does not have`);
}

if (failures.length) {
  console.error("MCP + SKILLS COVERAGE FAIL:");
  for (const f of failures) console.error(`- ${f}`);
  console.error("\nThe standing rule (2026-10-26): no system change ships without its MCP + skills updates in the same change. Update the code, tools/coverage-map.json, the skills, and the guides together.");
  process.exit(1);
}
console.log(`MCP + SKILLS COVERAGE OK: ${operations.size} operations, ${tools.size} tools, ${referencedTools.size} tool references, ${referencedPaths.size} path references across ${docFiles.length} doc files — all in step.`);
