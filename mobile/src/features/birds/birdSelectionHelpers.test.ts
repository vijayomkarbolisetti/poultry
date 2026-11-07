/**
 * Run: npx --yes tsx src/features/birds/birdSelectionHelpers.test.ts
 */
import {
  areAllEligibleSelected,
  clearSelection,
  eligibleIdsFromLoaded,
  formatSelectedBirdsLabel,
  isLifecycleEligible,
  reconcileSelectionToLoaded,
  toggleSelectAllLoaded,
  toggleSelection,
} from "./birdSelectionHelpers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const birds = [
  { id: "b1", band_id: "A1", is_active: true, lifecycle_status: "active" },
  { id: "b2", band_id: "A2", is_active: true, lifecycle_status: "active" },
  { id: "b3", band_id: "A3", is_active: false, lifecycle_status: "dead" },
  { id: "b4", band_id: null, is_active: true, lifecycle_status: "active" },
];

assert(isLifecycleEligible(birds[0]), "active banded bird eligible");
assert(!isLifecycleEligible(birds[2]), "dead bird not eligible");
assert(eligibleIdsFromLoaded(birds).length === 3, "eligible loaded ids");

let selected = toggleSelection(new Set<string>(), "b1");
assert(selected.has("b1"), "toggle adds");
selected = toggleSelection(selected, "b1");
assert(!selected.has("b1"), "toggle removes");

selected = toggleSelectAllLoaded(new Set(), ["b1", "b2"]);
assert(areAllEligibleSelected(selected, ["b1", "b2"]), "select all loaded");
assert(!areAllEligibleSelected(selected, []), "empty list is not all selected");
selected = toggleSelectAllLoaded(selected, ["b1", "b2"]);
assert(selected.size === 0, "deselect all loaded");

selected = new Set(["b1", "stale"]);
const reconciled = reconcileSelectionToLoaded(selected, ["b1", "b2"]);
assert(reconciled.next.has("b1"), "keeps loaded selection");
assert(!reconciled.next.has("stale"), "drops stale selection");
assert(reconciled.removed === 1, "reports removed count");

assert(formatSelectedBirdsLabel(0) === "0 birds selected", "zero label");
assert(formatSelectedBirdsLabel(1) === "1 bird selected", "singular label");
assert(formatSelectedBirdsLabel(3) === "3 birds selected", "plural label");
assert(clearSelection().size === 0, "clear selection");

console.log("birdSelectionHelpers.test.ts OK");
