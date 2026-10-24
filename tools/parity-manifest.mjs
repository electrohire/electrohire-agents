#!/usr/bin/env node
/**
 * parity-manifest.mjs — regenerate parity-manifest.json from the code.
 *
 * Scans apps/api for Hono route registrations (createRoute definitions,
 * app.doc(), and direct app.<verb>() calls) and apps/mcp for registered MCP
 * tool names (registerTool / tool), then rewrites parity-manifest.json at
 * the repository root.
 *
 * Ownership split (see docs/FEATURE-PARITY.md): this script owns discovery —
 * names, kinds, and source files always match the code. Humans own the
 * classification — an existing entry's `state` and `reason` are preserved
 * across regenerations. A newly discovered surface enters as state
 * "pending" with a "not yet classified" reason. A surface that disappears
 * from the code is moved to `missingFromCode` instead of being silently
 * dropped, so removals stay visible.
 *
 * Dependency-free: Node's standard library only. Run from anywhere:
 *   node tools/parity-manifest.mjs        (or: pnpm parity)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(repoRoot, "parity-manifest.json");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", ".git"]);
const VALID_STATES = new Set(["exposed", "not-exposed", "pending"]);
const UNCLASSIFIED_REASON =
  "Discovered by the parity generator; not yet classified. Set the parity state and reason (see docs/FEATURE-PARITY.md).";

function listSourceFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listSourceFiles(join(dir, entry.name)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot > 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) {
        out.push(join(dir, entry.name));
      }
    }
  }
  return out.sort();
}

function rel(file) {
  return relative(repoRoot, file).split("\\").join("/");
}

function scanApi() {
  const found = new Map(); // name -> entry
  const add = (method, path, file) => {
    const name = `${method} ${path}`;
    if (!found.has(name)) {
      found.set(name, { name, kind: "route", method, path, file: rel(file) });
    }
  };
  for (const file of listSourceFiles(join(repoRoot, "apps", "api"))) {
    const src = readFileSync(file, "utf8");

    // createRoute({ method: "...", path: "...", ... }) — method and path are
    // top-of-object fields; read them from a window bounded by the next
    // createRoute call so neighbouring routes cannot bleed into each other.
    const starts = [...src.matchAll(/createRoute\s*\(/g)].map((m) => m.index);
    starts.forEach((start, i) => {
      const end = Math.min(start + 2000, starts[i + 1] ?? src.length);
      const window = src.slice(start, end);
      const method = /method:\s*["'`]([A-Za-z]+)["'`]/.exec(window);
      const path = /path:\s*["'`]([^"'`]+)["'`]/.exec(window);
      if (method && path) add(method[1].toUpperCase(), path[1], file);
    });

    // app.doc("/openapi.json", {...}) — the generated OpenAPI document.
    for (const m of src.matchAll(/\.doc\(\s*["'`]([^"'`]+)["'`]/g)) {
      add("GET", m[1], file);
    }

    // Direct Hono registrations: app.get("/x", ...), app.post(...), etc.
    for (const m of src.matchAll(
      /\bapp\.(get|post|put|patch|delete|head|options|all)\(\s*["'`]([^"'`]+)["'`]/g,
    )) {
      add(m[1].toUpperCase(), m[2], file);
    }
  }
  return [...found.values()];
}

function scanMcp() {
  const found = new Map(); // name -> entry
  const add = (name, file) => {
    if (!found.has(name)) {
      found.set(name, { name, kind: "tool", file: rel(file) });
    }
  };
  for (const file of listSourceFiles(join(repoRoot, "apps", "mcp"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.registerTool\(\s*["'`]([^"'`]+)["'`]/g)) {
      add(m[1], file);
    }
    // Legacy SDK spelling: server.tool("name", ...). Case-sensitive, so it
    // cannot double-count registerTool( above.
    for (const m of src.matchAll(/\.tool\(\s*["'`]([^"'`]+)["'`]/g)) {
      add(m[1], file);
    }
  }
  return [...found.values()];
}

function loadExisting() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    console.warn(`warning: could not parse existing manifest (${err.message}); regenerating fresh.`);
    return null;
  }
}

function mergeSurface(scanned, previousEntries, previousMissing) {
  const pool = new Map();
  for (const e of [...(previousEntries ?? []), ...(previousMissing ?? [])]) {
    if (e && typeof e.name === "string") pool.set(e.name, e);
  }
  return scanned
    .map((entry) => {
      const prev = pool.get(entry.name);
      pool.delete(entry.name);
      if (!prev) {
        return { ...entry, state: "pending", reason: UNCLASSIFIED_REASON };
      }
      if (prev.state !== undefined && !VALID_STATES.has(prev.state)) {
        console.warn(
          `warning: ${entry.name} has unknown parity state "${prev.state}" (expected one of ${[...VALID_STATES].join(", ")}); preserved as-is.`,
        );
      }
      // Regenerated fields (name/kind/method/path/file) come from the code;
      // human classification (state, reason, and any extra fields) survives.
      // `surface` is stripped too: entries returning from missingFromCode
      // carry it, and it must not leak into a live surface entry.
      const { name, kind, method, path, file, surface, ...humanFields } = prev;
      const merged = { ...entry, ...humanFields };
      merged.state = prev.state ?? "pending";
      merged.reason = prev.reason ?? UNCLASSIFIED_REASON;
      return merged;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectMissing(previous, scannedBySurface) {
  const missing = [];
  for (const [surface, entries] of Object.entries(previous?.surfaces ?? {})) {
    const live = new Set((scannedBySurface[surface] ?? []).map((e) => e.name));
    for (const e of entries ?? []) {
      if (e && typeof e.name === "string" && !live.has(e.name)) {
        missing.push({ surface, ...e });
      }
    }
  }
  // Entries already in missingFromCode stay there until a human deletes
  // them (that deletion is the recorded completion of a deprecation).
  for (const e of previous?.missingFromCode ?? []) {
    if (e && typeof e.name === "string") {
      const live = new Set((scannedBySurface[e.surface] ?? []).map((x) => x.name));
      if (!live.has(e.name) && !missing.some((m) => m.surface === e.surface && m.name === e.name)) {
        missing.push(e);
      }
    }
  }
  return missing.sort(
    (a, b) => a.surface.localeCompare(b.surface) || a.name.localeCompare(b.name),
  );
}

const previous = loadExisting();
const scannedBySurface = { api: scanApi(), mcp: scanMcp() };
const surfaces = {
  api: mergeSurface(scannedBySurface.api, previous?.surfaces?.api, previous?.missingFromCode),
  mcp: mergeSurface(scannedBySurface.mcp, previous?.surfaces?.mcp, previous?.missingFromCode),
};
const manifest = {
  version: 1,
  generatedBy: "tools/parity-manifest.mjs",
  regenerate: "node tools/parity-manifest.mjs",
  states: ["exposed", "not-exposed", "pending"],
  surfaces,
  missingFromCode: collectMissing(previous, scannedBySurface),
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `parity-manifest.json written: ${surfaces.api.length} API route(s), ${surfaces.mcp.length} MCP tool(s), ${manifest.missingFromCode.length} missing-from-code entr(ies).`,
);
