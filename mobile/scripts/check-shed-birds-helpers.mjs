/**
 * Static QA checks for shed bird management helpers / API surface.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const helpers = read("src/features/birds/birdListHelpers.ts");
assert.match(helpers, /Record mortality/);
assert.match(helpers, /Record sale/);
assert.match(helpers, /Record transfer/);
assert.doesNotMatch(helpers, /\bDelete\b/);

const shedBirds = read("app/(app)/sheds/[id]/birds.tsx");
assert.match(shedBirds, /listBirdsInShed/);
assert.match(shedBirds, /Unbanded/);
assert.match(shedBirds, /AddBirdsSheet/);
assert.match(shedBirds, /registerBanded|onRegisterBanded|birds\/add/);

const shedHub = read("app/(app)/sheds/[id]/index.tsx");
assert.match(shedHub, /Add birds|AddBirdsSheet/);
assert.match(shedHub, /Birds/);
assert.doesNotMatch(shedHub, /title="Groups"/);

const birdsApi = read("src/api/birds.ts");
assert.match(birdsApi, /\/birds\/in-shed/);
assert.match(birdsApi, /register-in-shed/);
assert.match(birdsApi, /add-unbanded-in-shed/);
assert.match(birdsApi, /updateBird/);

const profile = read("app/(app)/birds/[id].tsx");
assert.match(profile, /Change band number/);
assert.match(profile, /Record mortality/);
assert.match(profile, /Transfer to another shed/);
assert.match(profile, /fromShedId/);
assert.match(profile, /recordLifecycle/);
assert.doesNotMatch(profile, /Group \/ Batch/);

const add = read("app/(app)/birds/add.tsx");
assert.match(add, /registerBandedInShed/);
assert.match(add, /Hatch date/);
assert.doesNotMatch(add, /AGE_CHIPS|Estimated age/);

const addUnbanded = read("app/(app)/birds/add-unbanded.tsx");
assert.match(addUnbanded, /addUnbandedInShed/);
assert.match(addUnbanded, /Hatch date/);
assert.doesNotMatch(addUnbanded, /AGE_CHIPS|Group name/);

const edit = read("app/(app)/birds/edit/[id].tsx");
assert.match(edit, /updateBird/);

const layout = read("app/(app)/_layout.tsx");
assert.match(layout, /birds\/add/);
assert.match(layout, /birds\/add-unbanded/);
assert.match(layout, /headerShown:\s*false/);
assert.match(layout, /birds\/edit\/\[id\]/);

console.log("check-shed-birds-helpers: ok");
