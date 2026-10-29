/**
 * Farm-level live bird total for the Sheds summary strip.
 * Uses each shed's authoritative `total_live_birds` (active flocks only:
 * current_count = living banded + unbanded; sold/dead already removed server-side).
 */
export function sumLiveBirds(
  sheds: ReadonlyArray<{ total_live_birds?: number | null }>,
): number {
  let total = 0;
  for (const shed of sheds) {
    const n = shed.total_live_birds;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total;
}
