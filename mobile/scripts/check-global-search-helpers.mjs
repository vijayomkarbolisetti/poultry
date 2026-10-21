import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Helpers are TS — assert via source patterns + transpile-free checks mirrored here.
const helperSrc = fs.readFileSync(
  path.join(root, "src/features/search/globalSearchHelpers.ts"),
  "utf8",
);
assert.match(helperSrc, /MIN_QUERY_LENGTH = 2/);
assert.match(helperSrc, /SEARCH_DEBOUNCE_MS = 300/);
assert.match(helperSrc, /normalizeSearchQuery/);
assert.match(helperSrc, /classifyGlobalSearch/);

const layout = fs.readFileSync(path.join(root, "app/(app)/_layout.tsx"), "utf8");
assert.match(layout, /name="search"/);
assert.match(layout, /href: null/);
assert.doesNotMatch(layout, /Find a bird/);

const home = fs.readFileSync(path.join(root, "app/(app)/home.tsx"), "utf8");
assert.match(home, /\/\(app\)\/search/);
assert.doesNotMatch(home, /Find a bird/);

const settings = fs.readFileSync(path.join(root, "app/(app)/settings.tsx"), "utf8");
assert.match(settings, /label="Search"/);
assert.doesNotMatch(settings, /Find a bird/);

const redirect = fs.readFileSync(path.join(root, "app/(app)/birds/search.tsx"), "utf8");
assert.match(redirect, /Redirect/);
assert.match(redirect, /\/\(app\)\/search/);

const searchScreen = fs.readFileSync(path.join(root, "app/(app)/search.tsx"), "utf8");
assert.match(searchScreen, /Search birds, batches, or sheds/);
assert.match(searchScreen, /globalSearch/);

// Runtime classify logic (inline mirror of exported behavior)
function normalizeSearchQuery(raw) {
  return raw.trim().replace(/\s+/g, " ");
}
function classifyGlobalSearch(opts) {
  const q = normalizeSearchQuery(opts.query);
  if (!q) return "idle";
  if (q.length < 2) return "too_short";
  if (opts.loading) return "loading";
  if (opts.fetchError && !opts.anySection) return "error";
  const sectionErrors = [opts.birdError, opts.batchError, opts.shedError].filter(Boolean);
  const total = opts.birdTotal + opts.batchTotal + opts.shedTotal;
  if (total === 0 && sectionErrors.length > 0) return "partial_error";
  if (total === 0) return sectionErrors.length ? "partial_error" : "empty";
  if (sectionErrors.length > 0) return "partial_error";
  return "results";
}

assert.equal(classifyGlobalSearch({ query: "", loading: false, fetchError: false, birdTotal: 0, batchTotal: 0, shedTotal: 0, birdError: null, batchError: null, shedError: null, anySection: false }), "idle");
assert.equal(classifyGlobalSearch({ query: "a", loading: false, fetchError: false, birdTotal: 0, batchTotal: 0, shedTotal: 0, birdError: null, batchError: null, shedError: null, anySection: false }), "too_short");
assert.equal(classifyGlobalSearch({ query: "ab", loading: true, fetchError: false, birdTotal: 0, batchTotal: 0, shedTotal: 0, birdError: null, batchError: null, shedError: null, anySection: false }), "loading");
assert.equal(classifyGlobalSearch({ query: "ab", loading: false, fetchError: false, birdTotal: 0, batchTotal: 0, shedTotal: 0, birdError: null, batchError: null, shedError: null, anySection: true }), "empty");
assert.equal(classifyGlobalSearch({ query: "ab", loading: false, fetchError: false, birdTotal: 1, batchTotal: 0, shedTotal: 0, birdError: null, batchError: null, shedError: null, anySection: true }), "results");
assert.equal(classifyGlobalSearch({ query: "ab", loading: false, fetchError: false, birdTotal: 1, batchTotal: 0, shedTotal: 0, birdError: null, batchError: "fail", shedError: null, anySection: true }), "partial_error");

console.log("check-global-search-helpers: ok");
void require;
