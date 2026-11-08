export const ALL_SHEDS_ID = "all";
export const ALL_SHEDS_LABEL = "All sheds";

export type ShedFilterOption = {
  id: string;
  label: string;
};

export function buildShedFilterOptions(
  sheds: ReadonlyArray<{ id: string; name: string }>,
): ShedFilterOption[] {
  return [
    { id: ALL_SHEDS_ID, label: ALL_SHEDS_LABEL },
    ...sheds.map((s) => ({ id: s.id, label: s.name })),
  ];
}

/** Case-insensitive filter across the complete option list (including All sheds). */
export function filterShedOptions(
  options: ReadonlyArray<ShedFilterOption>,
  query: string,
): ShedFilterOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter((opt) => opt.label.toLowerCase().includes(needle));
}

export function shedFilterLabel(
  options: ReadonlyArray<ShedFilterOption>,
  selectedId: string,
): string {
  return options.find((opt) => opt.id === selectedId)?.label ?? ALL_SHEDS_LABEL;
}
