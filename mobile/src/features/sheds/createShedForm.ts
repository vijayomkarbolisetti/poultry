/**
 * Pure helpers for New Shed form validation (owner-managed vs farmer-managed).
 * Kept free of React so scripts / unit checks can import the rules.
 */

export type CreateShedDraft = {
  name: string;
  code: string;
  location_notes?: string;
  is_owner_managed: boolean;
  initial_farmer_membership_id: string | null;
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
  // Preserve selection across invalidate/refetch so SelectField does not flash "Select a farmer".
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

export function validateCreateShedDraft(draft: CreateShedDraft): string | null {
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

export function createShedPayload(draft: CreateShedDraft): {
  name: string;
  code: string;
  location_notes?: string;
  is_owner_managed: boolean;
  initial_farmer_membership_id?: string;
} {
  const payload: {
    name: string;
    code: string;
    location_notes?: string;
    is_owner_managed: boolean;
    initial_farmer_membership_id?: string;
  } = {
    name: draft.name.trim(),
    code: draft.code.trim(),
    is_owner_managed: draft.is_owner_managed,
  };
  if (draft.location_notes?.trim()) {
    payload.location_notes = draft.location_notes.trim();
  }
  if (!draft.is_owner_managed && draft.initial_farmer_membership_id) {
    payload.initial_farmer_membership_id = draft.initial_farmer_membership_id;
  }
  return payload;
}
