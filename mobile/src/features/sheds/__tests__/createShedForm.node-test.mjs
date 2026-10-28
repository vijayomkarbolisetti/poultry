/**
 * Run: node mobile/src/features/sheds/__tests__/createShedForm.node-test.mjs
 * Mirrors createShedForm.ts pure rules (same pattern as catalogue helper tests).
 */
import assert from "node:assert/strict";

function parseCapacityText(raw) {
  const text = (raw ?? "").trim();
  if (!text) return { value: null, error: null };
  if (!/^\d+$/.test(text)) {
    return { value: null, error: "Capacity must be a whole number" };
  }
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { value: null, error: "Capacity must be a whole number" };
  }
  if (n < 0) return { value: null, error: "Capacity cannot be negative" };
  if (n > 1_000_000) return { value: null, error: "Capacity is too large" };
  return { value: n, error: null };
}

function farmerSelectionRequired(isOwnerManaged) {
  return !isOwnerManaged;
}

function validateCreateShedDraft(draft) {
  if (!draft.name.trim()) return "Shed name is required";
  if (!draft.farmOwnerAccountId) return "Select a farm";
  if (draft.farmsAvailable === false) return "No farms available for your account";
  if (draft.cataloguesLoading) return "Catalogues are still loading";
  if (!draft.catalogueId) {
    if (draft.cataloguesAvailable === false) {
      return "No vaccination catalogues available. Create one under More → Catalogues.";
    }
    return "Select a vaccination catalogue";
  }
  const cap = parseCapacityText(draft.capacityText);
  if (cap.error) return cap.error;
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
  const cap = parseCapacityText(draft.capacityText);
  const payload = {
    name: draft.name.trim(),
    code: draft.code.trim(),
    is_owner_managed: draft.is_owner_managed,
    capacity: cap.value,
    location_notes: draft.location_notes?.trim() ? draft.location_notes.trim() : "",
  };
  if (!draft.is_owner_managed && draft.initial_farmer_membership_id) {
    payload.initial_farmer_membership_id = draft.initial_farmer_membership_id;
  }
  return payload;
}

function suggestShedCode(name, existingCode) {
  if (existingCode?.trim()) return existingCode.trim().toUpperCase();
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const suffix = "ABCD";
  const stem = base || "SHED";
  return `${stem}_${suffix}`.slice(0, 64);
}

function shouldAssignCatalogue(selectedCatalogueId, currentAssignmentCatalogueId) {
  if (!selectedCatalogueId) return false;
  return selectedCatalogueId !== (currentAssignmentCatalogueId ?? null);
}

function mergeCreatedFarmerIntoList(list, created) {
  const id = created.membership_id;
  if (!id) return list;
  const without = list.filter((f) => f.membership_id !== id);
  return [created, ...without];
}

function resolveFarmerSelectionAfterRefresh(selectedMembershipId, options, opts) {
  if (!selectedMembershipId) return null;
  if (options.some((o) => o.value === selectedMembershipId)) return selectedMembershipId;
  if (opts?.isRefreshing) return selectedMembershipId;
  return null;
}

function updateShedPayload(draft) {
  const cap = parseCapacityText(draft.capacityText);
  const payload = {
    name: draft.name.trim(),
    location_notes: draft.location_notes?.trim() || "",
    capacity: cap.value,
    is_owner_managed: draft.is_owner_managed,
  };
  if (!draft.is_owner_managed && draft.initial_farmer_membership_id) {
    payload.initial_farmer_membership_id = draft.initial_farmer_membership_id;
  }
  return payload;
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

check("validateCreateShedDraft requires name, farm, catalogue", () => {
  assert.equal(
    validateCreateShedDraft({
      name: "  ",
      code: "A",
      catalogueId: "c1",
      farmOwnerAccountId: "f1",
      is_owner_managed: true,
      initial_farmer_membership_id: null,
    }),
    "Shed name is required",
  );
  assert.equal(
    validateCreateShedDraft({
      name: "Shed A",
      code: "A",
      catalogueId: null,
      farmOwnerAccountId: "f1",
      is_owner_managed: true,
      initial_farmer_membership_id: null,
    }),
    "Select a vaccination catalogue",
  );
  assert.equal(
    validateCreateShedDraft({
      name: "Shed A",
      code: "A",
      catalogueId: "c1",
      farmOwnerAccountId: null,
      is_owner_managed: true,
      initial_farmer_membership_id: null,
    }),
    "Select a farm",
  );
  assert.equal(
    validateCreateShedDraft({
      name: "Shed A",
      code: "A",
      catalogueId: "c1",
      farmOwnerAccountId: "f1",
      is_owner_managed: true,
      initial_farmer_membership_id: null,
    }),
    null,
  );
});

check("parseCapacityText rejects invalid values", () => {
  assert.deepEqual(parseCapacityText(""), { value: null, error: null });
  assert.deepEqual(parseCapacityText("50"), { value: 50, error: null });
  assert.equal(parseCapacityText("-1").error, "Capacity must be a whole number");
  assert.equal(parseCapacityText("1.5").error, "Capacity must be a whole number");
  assert.equal(parseCapacityText("abc").error, "Capacity must be a whole number");
  assert.equal(parseCapacityText("1000001").error, "Capacity is too large");
});

check("createShedPayload trims and includes capacity", () => {
  const p = createShedPayload({
    name: "  P1 Shed A  ",
    code: "p1a",
    location_notes: "  note  ",
    capacityText: "50",
    catalogueId: "c1",
    farmOwnerAccountId: "f1",
    is_owner_managed: true,
    initial_farmer_membership_id: null,
  });
  assert.equal(p.name, "P1 Shed A");
  assert.equal(p.code, "p1a");
  assert.equal(p.location_notes, "note");
  assert.equal(p.capacity, 50);
  assert.equal(p.is_owner_managed, true);
  assert.equal(p.initial_farmer_membership_id, undefined);
});

check("suggestShedCode uses existing code when provided", () => {
  assert.equal(suggestShedCode("Anything", "KEEP_ME"), "KEEP_ME");
  assert.equal(suggestShedCode("P1 Shed A"), "P1_SHED_A_ABCD");
});

check("shouldAssignCatalogue only when selection differs", () => {
  assert.equal(shouldAssignCatalogue(null, "c1"), false);
  assert.equal(shouldAssignCatalogue("c1", "c1"), false);
  assert.equal(shouldAssignCatalogue("c2", "c1"), true);
  assert.equal(shouldAssignCatalogue("c1", null), true);
});

check("validateCreateShedDraft requires farmer for farmer-managed", () => {
  assert.equal(
    validateCreateShedDraft({
      name: "Shed A",
      code: "A",
      catalogueId: "c1",
      farmOwnerAccountId: "f1",
      is_owner_managed: false,
      initial_farmer_membership_id: null,
    }),
    "Select a farmer responsible for managing this shed",
  );
  assert.equal(
    validateCreateShedDraft({
      name: "Shed A",
      code: "A",
      catalogueId: "c1",
      farmOwnerAccountId: "f1",
      is_owner_managed: false,
      initial_farmer_membership_id: "m1",
    }),
    null,
  );
  assert.equal(
    validateCreateShedDraft({
      name: "Shed A",
      code: "A",
      catalogueId: "c1",
      farmOwnerAccountId: "f1",
      is_owner_managed: true,
      initial_farmer_membership_id: "m1",
    }),
    "Clear the farmer selection for owner-managed sheds",
  );
});

check("createShedPayload includes farmer membership only when farmer-managed", () => {
  const owner = createShedPayload({
    name: "O",
    code: "O1",
    catalogueId: "c1",
    farmOwnerAccountId: "f1",
    is_owner_managed: true,
    initial_farmer_membership_id: "m1",
  });
  assert.equal(owner.initial_farmer_membership_id, undefined);
  const farmer = createShedPayload({
    name: "F",
    code: "F1",
    catalogueId: "c1",
    farmOwnerAccountId: "f1",
    is_owner_managed: false,
    initial_farmer_membership_id: "m1",
  });
  assert.equal(farmer.is_owner_managed, false);
  assert.equal(farmer.initial_farmer_membership_id, "m1");
});

check("updateShedPayload switches modes with correct farmer field", () => {
  const toOwner = updateShedPayload({
    name: "S",
    code: "S1",
    catalogueId: "c1",
    farmOwnerAccountId: "f1",
    is_owner_managed: true,
    initial_farmer_membership_id: null,
  });
  assert.equal(toOwner.is_owner_managed, true);
  assert.equal(toOwner.initial_farmer_membership_id, undefined);

  const toFarmer = updateShedPayload({
    name: "S",
    code: "S1",
    catalogueId: "c1",
    farmOwnerAccountId: "f1",
    is_owner_managed: false,
    initial_farmer_membership_id: "m2",
  });
  assert.equal(toFarmer.is_owner_managed, false);
  assert.equal(toFarmer.initial_farmer_membership_id, "m2");
});

check("mergeCreatedFarmerIntoList prefers new membership and dedupes", () => {
  const merged = mergeCreatedFarmerIntoList(
    [
      {
        membership_id: "m1",
        full_name: "Old",
        email: "a@x.com",
        role: "farmer",
        is_active: true,
      },
    ],
    {
      membership_id: "m2",
      full_name: "New",
      email: "b@x.com",
      role: "farmer",
      is_active: true,
    },
  );
  assert.equal(merged[0].membership_id, "m2");
  assert.equal(merged.length, 2);
});

check("resolveFarmerSelectionAfterRefresh keeps id while refreshing", () => {
  assert.equal(
    resolveFarmerSelectionAfterRefresh("m1", [], { isRefreshing: true }),
    "m1",
  );
  assert.equal(
    resolveFarmerSelectionAfterRefresh("m1", [], { isRefreshing: false }),
    null,
  );
  assert.equal(
    resolveFarmerSelectionAfterRefresh("m1", [{ value: "m1" }], { isRefreshing: false }),
    "m1",
  );
});

console.log(`createShedForm.node-test.mjs: ok (${passed} checks)`);
