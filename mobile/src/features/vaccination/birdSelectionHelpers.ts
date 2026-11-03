/** Pure helpers for vaccination bird-selection UI (no React / API). */

export type BirdSelectFilter = "eligible" | "selected" | "vaccinated";

export type SelectableBirdRow = {
  id: string;
  band: string;
  meta: string;
  status: "eligible" | "vaccinated";
};

export function matchesBirdQuery(row: Pick<SelectableBirdRow, "band" | "meta">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return row.band.toLowerCase().includes(needle) || row.meta.toLowerCase().includes(needle);
}

export function filterBirdRows(
  rows: SelectableBirdRow[],
  opts: {
    filter: BirdSelectFilter;
    query: string;
    selectedIds: ReadonlySet<string>;
  },
): SelectableBirdRow[] {
  let list = rows;
  if (opts.filter === "eligible") list = rows.filter((r) => r.status === "eligible");
  else if (opts.filter === "vaccinated") list = rows.filter((r) => r.status === "vaccinated");
  else list = rows.filter((r) => opts.selectedIds.has(r.id));
  return list.filter((r) => matchesBirdQuery(r, opts.query));
}

/** Toggle without duplicates; returns a new Set. */
export function toggleBirdSelection(selected: ReadonlySet<string>, birdId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(birdId)) next.delete(birdId);
  else next.add(birdId);
  return next;
}

/** Add ids into selection (deduped). */
export function addBirdIds(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  for (const id of ids) next.add(id);
  return next;
}

/** Drop ids that are no longer eligible (e.g. already recorded). */
export function pruneIneligibleSelection(
  selected: ReadonlySet<string>,
  ineligibleIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of selected) {
    if (!ineligibleIds.has(id)) next.add(id);
  }
  return next;
}
