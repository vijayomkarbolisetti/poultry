/** Pure helpers for consolidated shed bird-management UI (no I/O). */

export type BirdMgmtTab = "banded" | "unbanded";

/** Clear selection when tab or filter context changes. */
export function shouldClearSelectionOnContextChange(
  prevKey: string,
  nextKey: string,
): boolean {
  return prevKey !== nextKey;
}

export function buildBirdMgmtContextKey(opts: {
  tab: BirdMgmtTab;
  q: string;
  flockId: string | null;
  status: string;
}): string {
  return `${opts.tab}|${opts.q}|${opts.flockId ?? ""}|${opts.status}`;
}

/** Unbanded mortality/transfer require exactly one cohort selected. */
export function unbandedBulkActionAllowed(selectedCount: number): {
  ok: boolean;
  hint: string | null;
} {
  if (selectedCount === 0) return { ok: false, hint: null };
  if (selectedCount === 1) return { ok: true, hint: null };
  return {
    ok: false,
    hint: "Select one unbanded population for mortality or transfer.",
  };
}

export function bandedBulkActionAllowed(selectedCount: number): boolean {
  return selectedCount > 0;
}
