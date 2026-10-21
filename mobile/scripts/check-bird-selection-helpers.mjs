/**
 * Static QA for bulk selection helpers and bulk/batch lifecycle screens.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const helpers = read("src/features/birds/birdSelectionHelpers.ts");
assert.match(helpers, /eligibleIdsFromLoaded/);
assert.match(helpers, /reconcileSelectionToLoaded/);
assert.match(helpers, /validateUnbandedQuantity/);
assert.match(helpers, /batchCountActionAllowed/);
assert.match(helpers, /newLifecycleIdempotencyKey/);
assert.doesNotMatch(helpers, /\bDelete\b/);

const shedBirds = read("app/(app)/sheds/[id]/birds.tsx");
assert.match(shedBirds, /Select|selectMode/);
assert.match(shedBirds, /lifecycle-bulk/);
assert.match(shedBirds, /listBirdsInShed/);

const bulk = read("app/(app)/lifecycle-bulk.tsx");
assert.match(bulk, /recordLifecycleBulk/);
assert.match(bulk, /idempotency_key/);
assert.match(bulk, /Cancel/);

const batch = read("app/(app)/lifecycle-batch.tsx");
assert.match(batch, /unbanded/);
assert.match(batch, /recordLifecycle/);
assert.match(batch, /validateUnbandedQuantity/);

const flocksApi = read("src/api/flocks.ts");
assert.match(flocksApi, /lifecycle-events\/bulk/);
assert.match(flocksApi, /recordLifecycleBulk/);

const add = read("app/(app)/birds/add.tsx");
assert.match(add, /registerBandedInShed/);
assert.match(add, /Hatch date/);
assert.match(add, /Save & add another/);
assert.doesNotMatch(add, /AGE_CHIPS|createBird\(/);

const layout = read("app/(app)/_layout.tsx");
assert.match(layout, /lifecycle-bulk/);
assert.match(layout, /lifecycle-batch/);

const profile = read("app/(app)/birds/[id].tsx");
assert.match(profile, /lifeIdemKey/);
assert.match(profile, /newLifecycleIdempotencyKey/);

console.log("check-bird-selection-helpers: ok");
