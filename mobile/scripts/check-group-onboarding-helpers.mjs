/**
 * Static checks for shed-centric bird onboarding (groups hidden from UX).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const helpersSrc = read("src/features/birds/groupOnboardingHelpers.ts");
assert.match(helpersSrc, /validateBandNumber/);
assert.match(helpersSrc, /validateBirdCount/);

const sheet = read("src/components/birds/AddBirdsSheet.tsx");
assert.match(sheet, /Register banded bird/);
assert.match(sheet, /Add unbanded birds/);
assert.doesNotMatch(sheet, /noBatch|Add an unbanded count first/);
assert.doesNotMatch(sheet, /batchPick|Tag into/);

const add = read("app/(app)/birds/add.tsx");
assert.match(add, /registerBandedInShed/);
assert.match(add, /Save & add another/);
assert.doesNotMatch(add, /Select a group|createBird\(/);

const addUnbanded = read("app/(app)/birds/add-unbanded.tsx");
assert.match(addUnbanded, /addUnbandedInShed/);
assert.doesNotMatch(addUnbanded, /createFlock|AGE_CHIPS|Group name/);

const overview = read("app/(app)/sheds/[id]/index.tsx");
assert.match(overview, /AddBirdsSheet/);
assert.match(overview, /Add birds/);
assert.match(overview, /birds\/add-unbanded/);
assert.match(overview, /birds\/add/);

const layout = read("app/(app)/_layout.tsx");
assert.match(layout, /birds\/add/);
assert.match(layout, /birds\/add-unbanded/);
assert.match(layout, /birds\/band-from-unbanded/);

console.log("check-group-onboarding-helpers: PASS");
