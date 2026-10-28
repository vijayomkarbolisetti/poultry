/**
 * Pure helpers for the Catalogues list (Screen 2).
 * Age ranges come from catalogue item rules — never invent schedule days.
 */

export type RuleAgeLike = { target_age_days?: number | null };

export type ItemAgeLike = {
  rules?: RuleAgeLike[] | null;
};

/** Min–max target_age_days across items, e.g. "0–120 days". Null when no ages exist. */
export function catalogueAgeRangeLabel(items: ItemAgeLike[] | null | undefined): string | null {
  if (!items?.length) return null;
  const ages: number[] = [];
  for (const item of items) {
    for (const rule of item.rules ?? []) {
      const n = rule.target_age_days;
      if (n != null && Number.isFinite(n)) ages.push(n);
    }
  }
  if (!ages.length) return null;
  const min = Math.min(...ages);
  const max = Math.max(...ages);
  return `${min}–${max} days`;
}

/** Meta line: "N vaccines · 0–120 days" or "N vaccines" when range unavailable. */
export function catalogueListMetaLine(
  itemCount: number,
  ageRange: string | null | undefined,
): string {
  const count = Number.isFinite(itemCount) ? Math.max(0, itemCount) : 0;
  const vaccines = `${count} vaccine${count === 1 ? "" : "s"}`;
  if (ageRange?.trim()) return `${vaccines} · ${ageRange.trim()}`;
  return vaccines;
}
