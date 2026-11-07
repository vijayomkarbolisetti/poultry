export const BY_SHED_PREVIEW_COUNT = 3;

export function hiddenByShedCount(
  total: number,
  previewCount = BY_SHED_PREVIEW_COUNT,
): number {
  return Math.max(0, total - previewCount);
}

export function shouldShowByShedToggle(
  total: number,
  previewCount = BY_SHED_PREVIEW_COUNT,
): boolean {
  return total > previewCount;
}

export function visibleByShedRows<T>(
  rows: readonly T[],
  expanded: boolean,
  previewCount = BY_SHED_PREVIEW_COUNT,
): T[] {
  if (expanded || rows.length <= previewCount) return [...rows];
  return rows.slice(0, previewCount);
}

export function byShedToggleLabel(hiddenCount: number, expanded: boolean): string {
  return expanded ? "Show less" : `View all (${hiddenCount})`;
}
