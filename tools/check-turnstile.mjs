#!/usr/bin/env node
// Turnstile coverage check — electrohire-agents (WS-Turnstile, 2026-10-26).
//
// Enforces tools/turnstile-forms.json, the registry for this repo's
// surfaces (Ellie panel + the API/MCP machine workers):
//   1. EVIDENCE — every entry's evidence patterns must still match. The
//      protected entry (anonymous Ellie session creation) fails here if
//      the panel loses its Turnstile widget or the Worker loses its
//      Siteverify call.
//   2. FORM DISCOVERY — every <form> in the Ellie panel bundle must be
//      claimed by a registry entry, and claims must not go stale.
//   3. ROUTE DISCOVERY — every POST route in the three Workers must be
//      claimed: Ellie routes are extracted from its path comparisons and
//      its two regex matchers (expanded); API routes from createRoute
//      declarations. The MCP endpoint is a single pathname check,
//      claimed with evidence instead of extraction.
//
// Exit 0 = coverage holds. Run: node tools/check-turnstile.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'tools/turnstile-forms.json'), 'utf8'));
const failures = [];
const fail = (m) => failures.push(m);
const cache = new Map();
function read(rel) {
  if (!existsSync(join(ROOT, rel))) return null;
  if (!cache.has(rel)) cache.set(rel, readFileSync(join(ROOT, rel), 'utf8'));
  return cache.get(rel);
}
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(relative(ROOT, p));
  }
  return out;
}

// ---------- 1. evidence + entry shape ----------
for (const e of registry.entries) {
  if (e.disposition === 'protected') {
    if (!e.widget?.sitekey) fail(`${e.id}: protected entry has no widget sitekey`);
    if (!e.clientEvidence?.length || !e.serverEvidence?.length)
      fail(`${e.id}: protected entry needs client AND server evidence`);
  }
  if ((e.disposition === 'excluded' || e.disposition === 'assigned') && !e.reason)
    fail(`${e.id}: ${e.disposition} entry has no reason`);
  if (e.disposition === 'assigned' && !e.owner) fail(`${e.id}: assigned entry has no owner`);
  for (const ev of [...(e.clientEvidence ?? []), ...(e.serverEvidence ?? [])]) {
    const body = read(ev.file);
    if (body === null) { fail(`${e.id}: evidence file missing: ${ev.file}`); continue; }
    const re = new RegExp(ev.pattern);
    if (ev.absent) { if (re.test(body)) fail(`${e.id}: ${ev.file} must NOT match /${ev.pattern}/`); }
    else if (!re.test(body)) fail(`${e.id}: evidence not found in ${ev.file}: /${ev.pattern}/`);
  }
}

// ---------- 2. form discovery ----------
const discoveredForms = [];
for (const f of walk(join(ROOT, 'apps'), ['.html'])) {
  const body = read(f) ?? '';
  for (const m of body.matchAll(/<form\b[^>]*>/g)) {
    const id = m[0].match(/id="([^"]+)"/)?.[1];
    if (id) discoveredForms.push({ file: f, id });
  }
}
const claimedForms = new Map();
for (const e of registry.entries) for (const fm of e.forms ?? []) claimedForms.set(`${fm.file}::${fm.id}`, e.id);
for (const d of discoveredForms)
  if (!claimedForms.has(`${d.file}::${d.id}`)) fail(`unregistered form: ${d.file} <form id="${d.id}"> — add a disposition in tools/turnstile-forms.json`);
for (const key of claimedForms.keys())
  if (!discoveredForms.some((d) => `${d.file}::${d.id}` === key)) fail(`stale form claim: ${key} (claimed by ${claimedForms.get(key)})`);

// ---------- 3. route discovery ----------
const discovered = new Set();
const ellie = read('apps/ellie/src/index.ts') ?? '';
for (const m of ellie.matchAll(/path === "([^"]+)" && req\.method === "POST"/g)) discovered.add(`POST ${m[1]}`);
// Ellie's two regex matchers, expanded:
for (const m of ellie.matchAll(/\(messages\|uploads\|finalize\|escalate\)/g)) {
  for (const a of ['messages', 'uploads', 'finalize', 'escalate']) discovered.add(`POST /api/chat/sessions/:id/${a}`);
}
if (/analysisMatch/.test(ellie)) { discovered.add('POST /api/analyses/:id/approve'); discovered.add('POST /api/analyses/:id/edit'); }
const api = read('apps/api/src/index.ts') ?? '';
for (const m of api.matchAll(/createRoute\(\{\s*method:\s*"post",\s*path:\s*"([^"]+)"/g))
  discovered.add(`POST ${m[1].replace(/\{(\w+)\}/g, ':$1')}`);
const claimed = new Map();
for (const e of registry.entries) for (const r of e.routes ?? []) claimed.set(r, e.id);
for (const r of discovered)
  if (!claimed.has(r)) fail(`unregistered POST route: ${r} — add a disposition in tools/turnstile-forms.json`);
for (const r of claimed.keys())
  if (r === 'POST /mcp' || r.startsWith('GET ')) continue; // MCP is evidence-claimed; GET claims are informational
  else if (!discovered.has(r)) fail(`stale route claim: ${r} (claimed by ${claimed.get(r)}) — update the registry`);

const counts = {};
for (const e of registry.entries) counts[e.disposition] = (counts[e.disposition] ?? 0) + 1;
if (failures.length) {
  console.error(`TURNSTILE COVERAGE (agents): FAIL (${failures.length} problem(s))`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`TURNSTILE COVERAGE (agents): PASS — ${registry.entries.length} entries (${counts.protected ?? 0} protected, ${counts.excluded ?? 0} excluded, ${counts.assigned ?? 0} assigned); ${discoveredForms.length} panel form(s) and ${discovered.size} extracted POST routes all dispositioned.`);
