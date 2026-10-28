/**
 * Pure helpers for Create / Edit Shed (Screen 5).
 * Kept free of React so node tests can import the rules.
 */

export type CreateShedDraft = {
  name: string;
  code: string;
  location_notes?: string;
  capacityText?: string;
  catalogueId: string | null;
  farmOwnerAccountId: string | null;
  /** Preserved for farmer-managed sheds; Screen 5 defaults create to owner-managed. */
  is_owner_managed: boolean;
  initial_farmer_membership_id: string | null;
  cataloguesLoading?: boolean;
  farmsAvailable?: boolean;
  cataloguesAvailable?: boolean;
};

/** Minimal farmer shape needed to seed the selector after Add Farmer. */
export type CreatedFarmerMembership = {
  membership_id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export function farmerSelectionRequired(isOwnerManaged: boolean): boolean {
  return !isOwnerManaged;
}

/**
 * Merge a just-created farmer into the list using membership_id (stable shed payload key).
 * Prefer the created row so the selector can show the label before refetch completes.
 */
export function mergeCreatedFarmerIntoList<T extends CreatedFarmerMembership>(
  list: T[],
  created: T,
): T[] {
  const id = created.membership_id;
  if (!id) return list;
  const without = list.filter((f) => f.membership_id !== id);
  return [created, ...without];
}

/** Keep auto-selected membership when it is still present (or still refreshing). */
export function resolveFarmerSelectionAfterRefresh(
  selectedMembershipId: string | null,
  options: { value: string }[],
  opts?: { isRefreshing?: boolean },
): string | null {
  if (!selectedMembershipId) return null;
  if (options.some((o) => o.value === selectedMembershipId)) return selectedMembershipId;
  if (opts?.isRefreshing) return selectedMembershipId;
  return null;
}

export function isCreateShedButtonEnabled(
  isOwnerManaged: boolean,
  farmerMembershipId: string | null,
  loading: boolean,
): boolean {
  if (loading) return false;
  if (isOwnerManaged) return true;
  return Boolean(farmerMembershipId);
}

/** Generate a stable-enough unique shed code from the display name. */
export function suggestShedCode(name: string, existingCode?: string | null): string {
  if (existingCode?.trim()) return existingCode.trim().toUpperCase();
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stem = base || "SHED";
  return `${stem}_${suffix}`.slice(0, 64);
}

/** Parse optional capacity text → integer or null. Throws via return error string in validate. */
export function parseCapacityText(raw: string | null | undefined): {
  value: number | null;
  error: string | null;
} {
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

export function validateCreateShedDraft(draft: CreateShedDraft): string | null {
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

export function createShedPayload(draft: CreateShedDraft): {
  name: string;
  code: string;
  location_notes?: string;
  capacity?: number | null;
  is_owner_managed: boolean;
  initial_farmer_membership_id?: string;
} {
  const cap = parseCapacityText(draft.capacityText);
  const payload: {
    name: string;
    code: string;
    location_notes?: string;
    capacity?: number | null;
    is_owner_managed: boolean;
    initial_farmer_membership_id?: string;
  } = {
    name: draft.name.trim(),
    code: draft.code.trim(),
    is_owner_managed: draft.is_owner_managed,
    capacity: cap.value,
  };
  if (draft.location_notes?.trim()) {
    payload.location_notes = draft.location_notes.trim();
  } else {
    payload.location_notes = "";
  }
  if (!draft.is_owner_managed && draft.initial_farmer_membership_id) {
    payload.initial_farmer_membership_id = draft.initial_farmer_membership_id;
  }
  return payload;
}

export function updateShedPayload(draft: CreateShedDraft): {
  name: string;
  location_notes: string;
  capacity: number | null;
  is_owner_managed: boolean;
  initial_farmer_membership_id?: string;
} {
  const cap = parseCapacityText(draft.capacityText);
  const payload: {
    name: string;
    location_notes: string;
    capacity: number | null;
    is_owner_managed: boolean;
    initial_farmer_membership_id?: string;
  } = {
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

export function shouldAssignCatalogue(
  selectedCatalogueId: string | null,
  currentAssignmentCatalogueId: string | null | undefined,
): boolean {
  if (!selectedCatalogueId) return false;
  return selectedCatalogueId !== (currentAssignmentCatalogueId ?? null);
}
