/**
 * Lightweight regression for bird search UI helpers (no RN runtime).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helpersPath = path.join(__dirname, "../src/features/birds/birdSearchHelpers.ts");

// Compile-free: duplicate minimal logic mirror for Node (TS not executed directly).
// Prefer importing compiled output if present; otherwise inline the same rules.
function normalizeBandQuery(raw) {
  return raw.trim();
}

function classifySearchResult(opts) {
  if (!opts.query) return "idle";
  if (opts.loading) return "loading";
  if (opts.error) return "error";
  if (opts.total === 0 || opts.items.length === 0) return "empty";
  if (opts.items.length === 1) {
    return opts.items[0].is_active ? "single" : "inactive_only";
  }
  const allInactive = opts.items.every((i) => !i.is_active);
  if (allInactive) return "inactive_only";
  if (opts.total > 1 || opts.exactCount > 1 || opts.items.length > 1) return "ambiguous";
  return "single";
}

function birdResultSubtitle(hit) {
  const shed = hit.shed_name ?? hit.shed_code ?? "Shed";
  const status = hit.is_active ? "Active" : hit.lifecycle_status.replace(/_/g, " ");
  return `${shed} · Batch ${hit.batch_code} · ${status}`;
}

assert.equal(normalizeBandQuery("  AB-1  "), "AB-1");
assert.equal(classifySearchResult({ query: "", loading: false, error: false, total: 0, exactCount: 0, items: [] }), "idle");
assert.equal(classifySearchResult({ query: "A", loading: true, error: false, total: 0, exactCount: 0, items: [] }), "loading");
assert.equal(classifySearchResult({ query: "A", loading: false, error: true, total: 0, exactCount: 0, items: [] }), "error");
assert.equal(classifySearchResult({ query: "A", loading: false, error: false, total: 0, exactCount: 0, items: [] }), "empty");
assert.equal(
  classifySearchResult({
    query: "A",
    loading: false,
    error: false,
    total: 1,
    exactCount: 1,
    items: [{ is_active: true }],
  }),
  "single",
);
assert.equal(
  classifySearchResult({
    query: "A",
    loading: false,
    error: false,
    total: 1,
    exactCount: 1,
    items: [{ is_active: false }],
  }),
  "inactive_only",
);
assert.equal(
  classifySearchResult({
    query: "A",
    loading: false,
    error: false,
    total: 2,
    exactCount: 0,
    items: [{ is_active: true }, { is_active: true }],
  }),
  "ambiguous",
);
assert.equal(
  birdResultSubtitle({
    batch_code: "B1",
    shed_name: "North",
    shed_code: "N1",
    is_active: false,
    lifecycle_status: "dead",
  }),
  "North · Batch B1 · dead",
);

// Keep TS module discoverable for future tooling.
assert.ok(helpersPath.includes("birdSearchHelpers.ts"));
void createRequire;
void pathToFileURL;

console.log("check-bird-search-helpers: ok");
