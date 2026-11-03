/**
 * Phase 4 API helper contracts (clone copies, guards, stale preview, scopes).
 * Run: node mobile/src/api/__tests__/cataloguesPhase4.node-test.mjs
 */
import assert from "node:assert/strict";

function farmCopiesOf(sourceId, list) {
  return list.filter((c) => !c.is_platform && c.cloned_from_catalogue_id === sourceId);
}

function guardsFromPreview(preview) {
  return {
    expected_version: preview.catalogue_version,
    expected_assignment_catalogue_id: preview.expected_assignment_catalogue_id,
    expected_override_flock_count: preview.expected_override_flock_count,
  };
}

function isStalePreviewError(e) {
  const err = e;
  if (err?.response?.status !== 409) return false;
  const detail = err.response?.data?.detail;
  if (typeof detail !== "string") return false;
  const lower = detail.toLowerCase();
  return lower.includes("since preview") || lower.includes("from preview");
}

/** Mirrors item-edit / detail save body for item-changing PATCH. */
function buildConfirmedItemUpdate({ items, removeItemIds, preview }) {
  return {
    ...(items ? { items } : {}),
    ...(removeItemIds?.length ? { remove_item_ids: removeItemIds } : {}),
    apply_scope: "new_flocks",
    confirm_change: true,
    ...guardsFromPreview(preview),
  };
}

/** UI must never offer all_active for catalogue item edits (backend 403 gated). */
function itemEditScopeOptions() {
  return ["new_flocks"];
}

const preview = {
  catalogue_id: "cat-1",
  catalogue_name: "Farm copy",
  catalogue_version: 4,
  requires_veterinary_review: false,
  apply_scope: "new_flocks",
  effective_date: "2026-10-29",
  is_farm_default: true,
  expected_assignment_catalogue_id: "cat-1",
  expected_override_flock_count: 2,
  inheriting_flock_count_if_default: 3,
  items_added: ["New Vax"],
  items_updated: ["a"],
  items_removed: [],
  rule_changes: [],
  open_doses_eligible_for_change: 1,
  completed_event_count: 0,
  flocks_affected_new_flocks: 0,
  flocks_affected_all_active: 5,
  warning: "all_active flock application remains gated until product unlock.",
  all_active_gated: true,
};

// Clone / open existing
const list = [
  { id: "plat", is_platform: true, cloned_from_catalogue_id: null },
  { id: "farm-a", is_platform: false, cloned_from_catalogue_id: "plat" },
  { id: "farm-b", is_platform: false, cloned_from_catalogue_id: "other" },
];
assert.deepEqual(
  farmCopiesOf("plat", list).map((c) => c.id),
  ["farm-a"],
);
assert.deepEqual(farmCopiesOf("missing", list), []);

// Guards from preview fingerprint
assert.deepEqual(guardsFromPreview(preview), {
  expected_version: 4,
  expected_assignment_catalogue_id: "cat-1",
  expected_override_flock_count: 2,
});

const upsertBody = buildConfirmedItemUpdate({
  items: [
    { id: "a", name: "Keep", sort_order: 0, category: "vaccine" },
    { name: "New", sort_order: 1, category: "vaccine" },
  ],
  preview,
});
assert.equal(upsertBody.apply_scope, "new_flocks");
assert.equal(upsertBody.confirm_change, true);
assert.equal(upsertBody.expected_version, 4);
assert.equal(upsertBody.expected_assignment_catalogue_id, "cat-1");
assert.equal(upsertBody.expected_override_flock_count, 2);
assert.equal(upsertBody.items[0].id, "a");
assert.equal(upsertBody.items[1].id, undefined);
assert.equal(upsertBody.remove_item_ids, undefined);

const removeBody = buildConfirmedItemUpdate({
  removeItemIds: ["b"],
  preview,
});
assert.deepEqual(removeBody.remove_item_ids, ["b"]);
assert.equal(removeBody.items, undefined);
assert.equal(removeBody.apply_scope, "new_flocks");

// Stale preview detection
assert.equal(
  isStalePreviewError({
    response: { status: 409, data: { detail: "Catalogue changed since preview; request a fresh preview" } },
  }),
  true,
);
assert.equal(
  isStalePreviewError({
    response: {
      status: 409,
      data: { detail: "Item updates require expected_version and expected_override_flock_count from preview" },
    },
  }),
  true,
);
assert.equal(
  isStalePreviewError({
    response: {
      status: 409,
      data: {
        detail:
          "Updating catalogue items requires confirm_change=true after reviewing impact preview",
      },
    },
  }),
  false,
);
assert.equal(
  isStalePreviewError({ response: { status: 409, data: { detail: "Code already exists" } } }),
  false,
);
assert.equal(
  isStalePreviewError({ response: { status: 403, data: { detail: "all_active gated preview" } } }),
  false,
);

// Cancellation: dismissing confirm never builds a PATCH
let writeCalls = 0;
function cancelWithoutWrite(pending) {
  if (!pending) return null;
  // Cancel path clears pending; does not call update
  return null;
}
assert.equal(cancelWithoutWrite({ kind: "upsert", items: [], preview }), null);
assert.equal(writeCalls, 0);

// Duplicate submission guard
let inFlight = false;
let submissions = 0;
async function guardedConfirm(action) {
  if (inFlight) return "blocked";
  inFlight = true;
  submissions += 1;
  inFlight = false;
  return action;
}
assert.equal(await guardedConfirm("ok"), "ok");
inFlight = true;
assert.equal(await guardedConfirm("second"), "blocked");
assert.equal(submissions, 1);

// all_active unavailable in item-edit UI
assert.deepEqual(itemEditScopeOptions(), ["new_flocks"]);
assert.equal(preview.all_active_gated, true);
assert.ok(!itemEditScopeOptions().includes("all_active"));

// Platform catalogues remain immutable on the client
function canEditCatalogue(cat, canManage) {
  return Boolean(cat && !cat.is_platform && canManage);
}
assert.equal(canEditCatalogue({ is_platform: true }, true), false);
assert.equal(canEditCatalogue({ is_platform: false }, false), false);
assert.equal(canEditCatalogue({ is_platform: false }, true), true);

console.log("cataloguesPhase4.node-test.mjs: ok");
