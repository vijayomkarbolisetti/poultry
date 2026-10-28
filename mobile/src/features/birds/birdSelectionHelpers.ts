/** Pure helpers for shed bird multi-select and bulk lifecycle (no I/O). */

export type SelectableBird = {
  id: string;
  band_id?: string | null;
  display_code?: string | null;
  is_active: boolean;
  lifecycle_status: string;
};

export function birdLabel(bird: SelectableBird): string {
  return bird.band_id ?? bird.display_code ?? bird.id.slice(0, 8);
}

export function isLifecycleEligible(bird: SelectableBird): boolean {
  return bird.is_active && bird.lifecycle_status === "active";
}

/** Selection is limited to currently loaded eligible rows — never unloaded pages. */
export function eligibleIdsFromLoaded(birds: SelectableBird[]): string[] {
  return birds.filter(isLifecycleEligible).map((b) => b.id);
}

export function toggleSelection(selected: Set<string>, birdId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(birdId)) next.delete(birdId);
  else next.add(birdId);
  return next;
}

export function selectAllLoaded(selected: Set<string>, loadedEligibleIds: string[]): Set<string> {
  const next = new Set(selected);
  for (const id of loadedEligibleIds) next.add(id);
  return next;
}

/** Empty eligible lists are never "fully selected". */
export function areAllEligibleSelected(
  selected: Set<string>,
  loadedEligibleIds: string[],
): boolean {
  return (
    loadedEligibleIds.length > 0 && loadedEligibleIds.every((id) => selected.has(id))
  );
}

/**
 * Select every loaded eligible id, or clear those ids from the set when already
 * fully selected. IDs outside the current scope are preserved.
 */
export function toggleSelectAllLoaded(
  selected: Set<string>,
  loadedEligibleIds: string[],
): Set<string> {
  if (loadedEligibleIds.length === 0) return new Set(selected);
  if (areAllEligibleSelected(selected, loadedEligibleIds)) {
    const next = new Set(selected);
    for (const id of loadedEligibleIds) next.delete(id);
    return next;
  }
  return selectAllLoaded(selected, loadedEligibleIds);
}

export function clearSelection(): Set<string> {
  return new Set();
}

/** Farmer-facing selection count — derived from the selected-ID set size. */
export function formatSelectedBirdsLabel(count: number): string {
  if (count === 1) return "1 bird selected";
  return `${count} birds selected`;
}

/**
 * Optional one-shot explanation after Select All.
 * Pass `hasMorePages` from the list query when known; `null`/`undefined` means unknown.
 * Returns null when every eligible bird is already loaded (no warning needed).
 */
export function selectAllLoadedScopeMessage(
  hasMorePages: boolean | null | undefined,
): string | null {
  if (hasMorePages === true) {
    return "Only loaded birds are selected. Load more birds to select additional birds.";
  }
  if (hasMorePages == null) {
    return "Select All applies to eligible birds currently loaded in this list.";
  }
  return null;
}

/**
 * When search/filters change, drop IDs that are no longer in the loaded eligible set
 * so stale hidden selections cannot be submitted.
 */
export function reconcileSelectionToLoaded(
  selected: Set<string>,
  loadedEligibleIds: string[],
): { next: Set<string>; removed: number } {
  const allowed = new Set(loadedEligibleIds);
  const next = new Set<string>();
  let removed = 0;
  for (const id of selected) {
    if (allowed.has(id)) next.add(id);
    else removed += 1;
  }
  return { next, removed };
}

/** True when both sets contain the same ids (order-independent). */
export function selectionSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function newLifecycleIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function validateUnbandedQuantity(quantity: number, unbandedCount: number): string | null {
  if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
    return "Enter a whole number of at least 1";
  }
  if (quantity > unbandedCount) {
    return `Quantity exceeds unbanded population (${unbandedCount})`;
  }
  return null;
}

export type BatchLifecycleScope = {
  trackingMode: string;
  unbandedCount: number;
  bandedCount: number;
  currentCount: number;
};

export function batchCountActionAllowed(scope: BatchLifecycleScope): string | null {
  if (scope.trackingMode === "individual") {
    return "This hatch-date population is individually tracked. Select registered birds instead of a count.";
  }
  if (scope.unbandedCount < 1) {
    return "No unbanded birds available for a count-only action.";
  }
  return null;
}
