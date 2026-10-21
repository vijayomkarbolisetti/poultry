/** Lightweight assertions mirroring createShedForm.ts. Run: node scripts/check-create-shed-form.mjs */

function farmerSelectionRequired(isOwnerManaged) {
  return !isOwnerManaged;
}

function mergeCreatedFarmerIntoList(list, created) {
  const id = created.membership_id;
  if (!id) return list;
  const without = list.filter((f) => f.membership_id !== id);
  return [created, ...without];
}

function resolveFarmerSelectionAfterRefresh(selectedMembershipId, options, opts = {}) {
  if (!selectedMembershipId) return null;
  if (options.some((o) => o.value === selectedMembershipId)) return selectedMembershipId;
  if (opts.isRefreshing) return selectedMembershipId;
  return null;
}

function isCreateShedButtonEnabled(isOwnerManaged, farmerMembershipId, loading) {
  if (loading) return false;
  if (isOwnerManaged) return true;
  return Boolean(farmerMembershipId);
}

function validateCreateShedDraft(draft) {
  if (!draft.name.trim()) return "Shed name is required";
  if (!draft.code.trim()) return "Code is required";
  if (farmerSelectionRequired(draft.is_owner_managed)) {
    if (!draft.initial_farmer_membership_id) {
      return "Select a farmer responsible for managing this shed";
    }
  } else if (draft.initial_farmer_membership_id) {
    return "Clear the farmer selection for owner-managed sheds";
  }
  return null;
}

function createShedPayload(draft) {
  const payload = {
    name: draft.name.trim(),
    code: draft.code.trim(),
    is_owner_managed: draft.is_owner_managed,
  };
  if (draft.location_notes?.trim()) payload.location_notes = draft.location_notes.trim();
  if (!draft.is_owner_managed && draft.initial_farmer_membership_id) {
    payload.initial_farmer_membership_id = draft.initial_farmer_membership_id;
  }
  return payload;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(farmerSelectionRequired(false) === true, "farmer-managed requires selection");
assert(farmerSelectionRequired(true) === false, "owner-managed does not");
assert(
  validateCreateShedDraft({
    name: "A",
    code: "A1",
    is_owner_managed: true,
    initial_farmer_membership_id: null,
  }) === null,
  "owner-managed ok",
);
assert(
  validateCreateShedDraft({
    name: "A",
    code: "A1",
    is_owner_managed: false,
    initial_farmer_membership_id: null,
  }) !== null,
  "farmer-managed without farmer rejected",
);
assert(
  validateCreateShedDraft({
    name: "A",
    code: "A1",
    is_owner_managed: false,
    initial_farmer_membership_id: "mem-1",
  }) === null,
  "farmer-managed with farmer ok",
);
assert(
  validateCreateShedDraft({
    name: "A",
    code: "A1",
    is_owner_managed: true,
    initial_farmer_membership_id: "mem-1",
  }) !== null,
  "owner-managed with farmer rejected",
);

const payload = createShedPayload({
  name: " North ",
  code: " n1 ",
  location_notes: " barn ",
  is_owner_managed: false,
  initial_farmer_membership_id: "mem-1",
});
assert(payload.name === "North" && payload.initial_farmer_membership_id === "mem-1", "payload");
assert(
  createShedPayload({
    name: "South",
    code: "S1",
    is_owner_managed: true,
    initial_farmer_membership_id: "mem-1",
  }).initial_farmer_membership_id === undefined,
  "omit farmer for owner-managed",
);

// --- Auto-select after Add Farmer ---
const existing = [
  {
    membership_id: "mem-old",
    full_name: "Old Farmer",
    email: "old@example.com",
    role: "farmer",
    is_active: true,
  },
];
const created = {
  membership_id: "mem-new",
  full_name: "New Farmer",
  email: "new@example.com",
  role: "farmer",
  is_active: true,
};
const merged = mergeCreatedFarmerIntoList(existing, created);
assert(merged[0].membership_id === "mem-new", "created farmer first in list");
assert(merged.length === 2, "merge keeps prior farmers");
assert(
  mergeCreatedFarmerIntoList(merged, created).length === 2,
  "merge is idempotent by membership_id",
);

const optionsAfterSeed = merged.map((f) => ({ value: f.membership_id, label: f.full_name }));
assert(
  resolveFarmerSelectionAfterRefresh("mem-new", optionsAfterSeed) === "mem-new",
  "auto-select uses membership_id",
);
assert(
  resolveFarmerSelectionAfterRefresh("mem-new", [], { isRefreshing: true }) === "mem-new",
  "selection survives refresh before options arrive",
);
assert(
  resolveFarmerSelectionAfterRefresh("mem-new", [{ value: "mem-old" }], { isRefreshing: false }) ===
    null,
  "stale membership cleared after refresh settles",
);
assert(
  resolveFarmerSelectionAfterRefresh(null, optionsAfterSeed) === null,
  "failed creation leaves no selection",
);

assert(isCreateShedButtonEnabled(false, "mem-new", false) === true, "create enabled after auto-select");
assert(isCreateShedButtonEnabled(false, null, false) === false, "create disabled without farmer");
assert(isCreateShedButtonEnabled(true, null, false) === true, "owner-managed create enabled");
assert(isCreateShedButtonEnabled(false, "mem-new", true) === false, "create disabled while submitting");

const autoPayload = createShedPayload({
  name: "Barn",
  code: "B1",
  is_owner_managed: false,
  initial_farmer_membership_id: resolveFarmerSelectionAfterRefresh("mem-new", optionsAfterSeed),
});
assert(
  autoPayload.initial_farmer_membership_id === "mem-new",
  "submitted initial_farmer_membership_id matches created membership",
);

// Failed creation must not invent a membership selection
assert(
  validateCreateShedDraft({
    name: "Keep",
    code: "K1",
    is_owner_managed: false,
    initial_farmer_membership_id: null,
  }) !== null,
  "failed farmer create keeps form invalid for submit",
);

console.log("check-create-shed-form: ok");
