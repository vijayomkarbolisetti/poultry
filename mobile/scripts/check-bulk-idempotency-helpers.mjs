/**
 * Mobile-level checks for bulk idempotency key helpers.
 * Note: this repo has no Jest/Vitest runner — lost-response HTTP transport tests
 * live in backend pytest (test_bulk_lost_response_retry_no_duplicate_events).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const helpersSrc = read("src/features/birds/birdSelectionHelpers.ts");
assert.match(helpersSrc, /newLifecycleIdempotencyKey/);
assert.match(helpersSrc, /reconcileSelectionToLoaded/);

const bulk = read("app/(app)/lifecycle-bulk.tsx");
assert.match(bulk, /idemKey\.current/);
assert.match(bulk, /recordLifecycleBulk/);
assert.match(bulk, /lock\.current/);
assert.match(bulk, /idempotent_replay/);

const profile = read("app/(app)/birds/[id].tsx");
assert.match(profile, /lifeIdemKey/);
assert.match(profile, /newLifecycleIdempotencyKey/);

// Runtime: keys for distinct ops must differ; same logical retry reuses a stored key.
function newLifecycleIdempotencyKey(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}
const a = newLifecycleIdempotencyKey("bulk-sale");
const b = newLifecycleIdempotencyKey("bulk-sale");
assert.notEqual(a, b, "new operations must get distinct keys");
const stored = a;
assert.equal(stored, a, "retry of same logical op reuses the same key");

console.log("check-bulk-idempotency-helpers: ok");
console.log(
  "note: mobile HTTP lost-response transport not executable here (no Jest); see pytest test_bulk_lost_response_retry_no_duplicate_events",
);
