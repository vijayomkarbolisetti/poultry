/**
 * Lightweight Node assertions for bird-management pure helpers.
 * Run: node mobile/src/features/birds/__tests__/birdManagementHelpers.node-test.mjs
 *
 * Uses inline copies of pure logic so the suite runs without a TS loader.
 * Keep in sync with birdListHelpers / birdSelectionHelpers / birdManagementUiHelpers.
 */
import assert from "node:assert/strict";

function formatRelativeAgeLabel(opts, nowMs = Date.parse("2026-10-22T00:00:00Z")) {
  if (opts.hatch_date) {
    const hatchMs = Date.parse(opts.hatch_date);
    if (!Number.isFinite(hatchMs)) return `Hatch ${opts.hatch_date}`;
    const days = Math.floor((nowMs - hatchMs) / 86_400_000);
    if (days < 0) return `Hatch ${opts.hatch_date}`;
    if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
    const months = Math.max(1, Math.floor(days / 30));
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  if (opts.estimated_age_days != null) {
    const d = opts.estimated_age_days;
    if (d < 60) return `~${d} day${d === 1 ? "" : "s"}`;
    const months = Math.max(1, Math.floor(d / 30));
    return `~${months} month${months === 1 ? "" : "s"}`;
  }
  return "Age unknown";
}

function toggleSelection(selected, birdId) {
  const next = new Set(selected);
  if (next.has(birdId)) next.delete(birdId);
  else next.add(birdId);
  return next;
}

function selectAllLoaded(selected, loadedEligibleIds) {
  const next = new Set(selected);
  for (const id of loadedEligibleIds) next.add(id);
  return next;
}

function areAllEligibleSelected(selected, loadedEligibleIds) {
  return (
    loadedEligibleIds.length > 0 && loadedEligibleIds.every((id) => selected.has(id))
  );
}

function toggleSelectAllLoaded(selected, loadedEligibleIds) {
  if (loadedEligibleIds.length === 0) return new Set(selected);
  if (areAllEligibleSelected(selected, loadedEligibleIds)) {
    const next = new Set(selected);
    for (const id of loadedEligibleIds) next.delete(id);
    return next;
  }
  return selectAllLoaded(selected, loadedEligibleIds);
}

function formatSelectedBirdsLabel(count) {
  if (count === 1) return "1 bird selected";
  return `${count} birds selected`;
}

function selectAllLoadedScopeMessage(hasMorePages) {
  if (hasMorePages === true) {
    return "Only loaded birds are selected. Load more birds to select additional birds.";
  }
  if (hasMorePages == null) {
    return "Select All applies to eligible birds currently loaded in this list.";
  }
  return null;
}

function eligibleIdsFromLoaded(birds) {
  return birds
    .filter((b) => b.is_active && b.lifecycle_status === "active")
    .map((b) => b.id);
}

function reconcileSelectionToLoaded(selected, loadedEligibleIds) {
  const allowed = new Set(loadedEligibleIds);
  const next = new Set();
  let removed = 0;
  for (const id of selected) {
    if (allowed.has(id)) next.add(id);
    else removed += 1;
  }
  return { next, removed };
}

/** Simulate a double-firing handler (row + checkbox) with functional updates. */
function applyToggleTwice(selected, birdId) {
  let state = selected;
  state = toggleSelection(state, birdId);
  state = toggleSelection(state, birdId);
  return state;
}

function validateUnbandedQuantity(quantity, unbandedCount) {
  if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
    return "Enter a whole number of at least 1";
  }
  if (quantity > unbandedCount) {
    return `Quantity exceeds unbanded population (${unbandedCount})`;
  }
  return null;
}

function unbandedBulkActionAllowed(selectedCount) {
  if (selectedCount === 0) return { ok: false, hint: null };
  if (selectedCount === 1) return { ok: true, hint: null };
  return {
    ok: false,
    hint: "Select one unbanded population for mortality or transfer.",
  };
}

function buildBirdMgmtContextKey(opts) {
  return `${opts.tab}|${opts.q}|${opts.flockId ?? ""}|${opts.status}`;
}

// --- age labels ---
assert.equal(
  formatRelativeAgeLabel({ hatch_date: "2026-10-20", estimated_age_days: null }),
  "2 days",
);
assert.equal(
  formatRelativeAgeLabel({ hatch_date: "2026-07-22", estimated_age_days: null }),
  "3 months",
);
assert.equal(
  formatRelativeAgeLabel({ hatch_date: null, estimated_age_days: 10 }),
  "~10 days",
);
assert.equal(
  formatRelativeAgeLabel({ hatch_date: null, estimated_age_days: null }),
  "Age unknown",
);

// --- selection toggle ---
let sel = new Set();
sel = toggleSelection(sel, "a");
assert.equal(sel.has("a"), true);
sel = toggleSelection(sel, "a");
assert.equal(sel.has("a"), false);
sel = toggleSelection(sel, "a");
sel = toggleSelection(sel, "b");
assert.deepEqual([...sel].sort(), ["a", "b"]);
sel = toggleSelection(sel, "a");
assert.deepEqual([...sel], ["b"]);

// Double-fire (row+checkbox) must net to no change — UI must not nest two toggles.
assert.deepEqual([...applyToggleTwice(new Set(), "x")], []);
assert.deepEqual([...applyToggleTwice(new Set(["x"]), "x")].sort(), ["x"]);

// --- select all / deselect all (loaded eligible scope) ---
const eligible = ["a", "b", "c"];
assert.equal(areAllEligibleSelected(new Set(), eligible), false);
assert.equal(areAllEligibleSelected(new Set(["a", "b"]), eligible), false);
assert.equal(areAllEligibleSelected(new Set(["a", "b", "c"]), eligible), true);
assert.equal(areAllEligibleSelected(new Set(["a"]), []), false); // empty never fully selected

let bulk = toggleSelectAllLoaded(new Set(["outside"]), eligible);
assert.deepEqual([...bulk].sort(), ["a", "b", "c", "outside"]);
assert.equal(areAllEligibleSelected(bulk, eligible), true);
bulk = toggleSelectAllLoaded(bulk, eligible);
assert.deepEqual([...bulk], ["outside"]); // out-of-scope preserved
bulk = toggleSelectAllLoaded(new Set(["a"]), eligible); // partial → select remaining
assert.deepEqual([...bulk].sort(), ["a", "b", "c"]);
assert.deepEqual([...toggleSelectAllLoaded(new Set(["z"]), [])], ["z"]); // empty no-op

// Ineligible birds excluded from select-all scope
const loadedBirds = [
  { id: "live", is_active: true, lifecycle_status: "active" },
  { id: "dead", is_active: false, lifecycle_status: "dead" },
  { id: "sold", is_active: false, lifecycle_status: "sold" },
];
assert.deepEqual(eligibleIdsFromLoaded(loadedBirds), ["live"]);
assert.deepEqual(
  [...toggleSelectAllLoaded(new Set(), eligibleIdsFromLoaded(loadedBirds))],
  ["live"],
);

// Refresh / re-render: reconcile drops stale shed/filter IDs
const reconciled = reconcileSelectionToLoaded(new Set(["a", "gone"]), ["a", "c"]);
assert.deepEqual([...reconciled.next], ["a"]);
assert.equal(reconciled.removed, 1);

const same = reconcileSelectionToLoaded(new Set(["a", "b"]), ["a", "b", "c"]);
assert.equal(same.removed, 0);
assert.deepEqual([...same.next].sort(), ["a", "b"]);

// Shed switch semantics: new empty set — no stale IDs from previous shed
const previousShed = new Set(["shed-a-bird"]);
const afterShedSwitch = new Set();
assert.equal(afterShedSwitch.size, 0);
assert.equal(previousShed.has("shed-a-bird"), true);

// Selected count always matches set size
const counted = toggleSelectAllLoaded(new Set(), ["1", "2", "3"]);
assert.equal(counted.size, 3);
assert.equal([...counted].length, counted.size);

// Farmer-facing count label (no "eligible loaded" wording)
assert.equal(formatSelectedBirdsLabel(0), "0 birds selected");
assert.equal(formatSelectedBirdsLabel(1), "1 bird selected");
assert.equal(formatSelectedBirdsLabel(3), "3 birds selected");
assert.equal(formatSelectedBirdsLabel(10), "10 birds selected");
assert.equal(formatSelectedBirdsLabel(1).includes("eligible"), false);
assert.equal(formatSelectedBirdsLabel(3).includes("loaded"), false);

// Pagination scope note only when relevant / known
assert.equal(selectAllLoadedScopeMessage(false), null);
assert.match(
  selectAllLoadedScopeMessage(true),
  /Only loaded birds are selected/,
);
assert.match(
  selectAllLoadedScopeMessage(undefined),
  /currently loaded in this list/,
);
assert.match(
  selectAllLoadedScopeMessage(null),
  /currently loaded in this list/,
);

// --- unbanded quantity ---
assert.equal(validateUnbandedQuantity(0, 5), "Enter a whole number of at least 1");
assert.equal(validateUnbandedQuantity(6, 5), "Quantity exceeds unbanded population (5)");
assert.equal(validateUnbandedQuantity(3, 5), null);

// --- bulk gating ---
assert.equal(unbandedBulkActionAllowed(0).ok, false);
assert.equal(unbandedBulkActionAllowed(1).ok, true);
assert.equal(unbandedBulkActionAllowed(2).ok, false);

// --- context key clears on tab switch ---
const k1 = buildBirdMgmtContextKey({ tab: "banded", q: "", flockId: null, status: "" });
const k2 = buildBirdMgmtContextKey({ tab: "unbanded", q: "", flockId: null, status: "" });
assert.notEqual(k1, k2);

console.log("birdManagementHelpers.node-test.mjs: all assertions passed");
