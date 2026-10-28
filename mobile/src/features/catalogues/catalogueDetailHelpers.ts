/**
 * Pure helpers for Catalogue Details (Screen 3) schedule rows.
 * Uses API fields only — never invents dose, route, or product text.
 */

export type ScheduleRuleLike = {
  target_age_days?: number | null;
  display_day_label?: string | null;
  dose_number?: number | null;
};

export type ScheduleItemLike = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  description?: string | null;
  disease_label?: string | null;
  recommended_dose_text?: string | null;
  route?: string | null;
  sort_order?: number | null;
  rules?: ScheduleRuleLike[] | null;
};

const NOT_SPECIFIED = "Not specified";

/** Verbose QA / illustrative blurbs that should not appear on farmer schedule cards. */
export function isQaNoiseDescription(text: string | null | undefined): boolean {
  const t = text?.trim().toLowerCase() ?? "";
  if (!t) return false;
  return (
    t.includes("for qa only") ||
    t.includes("illustrative") ||
    t.includes("not a veterinarian") ||
    t.includes("example only") ||
    t.includes("template only")
  );
}

export function primaryRule(item: ScheduleItemLike): ScheduleRuleLike | null {
  const rules = item.rules ?? [];
  const withAge = rules.filter((r) => r.target_age_days != null && Number.isFinite(r.target_age_days));
  if (withAge.length) {
    return withAge.reduce((best, r) =>
      (r.target_age_days as number) < (best.target_age_days as number) ? r : best,
    );
  }
  return rules[0] ?? null;
}

export function itemTargetAgeDays(item: ScheduleItemLike): number | null {
  const n = primaryRule(item)?.target_age_days;
  return n != null && Number.isFinite(n) ? n : null;
}

/** Chronological by target age; items without age sort last (then sort_order / name). */
export function sortScheduleItems<T extends ScheduleItemLike>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aa = itemTargetAgeDays(a);
    const bb = itemTargetAgeDays(b);
    if (aa != null && bb != null && aa !== bb) return aa - bb;
    if (aa != null && bb == null) return -1;
    if (aa == null && bb != null) return 1;
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

/** Stacked day badge: caption "Day" + number from target_age_days when present. */
export function dayBadgeParts(item: ScheduleItemLike): { caption: string; value: string } {
  const age = itemTargetAgeDays(item);
  if (age != null) return { caption: "Day", value: String(age) };
  const label = primaryRule(item)?.display_day_label?.trim();
  if (label) {
    const m = label.match(/(\d+)/);
    if (m) return { caption: "Day", value: m[1] };
    return { caption: "Day", value: "—" };
  }
  return { caption: "Day", value: "—" };
}

/** Disease line for schedule cards — never invents a disease name. */
export function scheduleDiseaseLine(item: ScheduleItemLike): string {
  return item.disease_label?.trim() || NOT_SPECIFIED;
}

/**
 * Dose · route for schedule cards.
 * Missing parts become "Not specified"; never invents product guidance.
 */
export function scheduleDoseRouteLine(item: ScheduleItemLike): string {
  const dose = item.recommended_dose_text?.trim();
  const route = item.route?.trim();
  if (!dose && !route) return NOT_SPECIFIED;
  return `${dose || NOT_SPECIFIED} · ${route || NOT_SPECIFIED}`;
}

/**
 * Optional short type/category line — skips QA noise and generic "vaccine".
 * Returns null when nothing useful to show (do not fall back to inventing type).
 */
export function scheduleTypeLine(item: ScheduleItemLike): string | null {
  const desc = item.description?.trim();
  if (desc && !isQaNoiseDescription(desc)) return desc;
  const cat = item.category?.trim();
  if (!cat) return null;
  const lower = cat.toLowerCase();
  if (lower === "general" || lower === "vaccine" || lower === "vaccines") return null;
  return cat;
}

/** True when any item (or catalogue description) carries illustrative/QA-only wording. */
export function catalogueHasQaNoise(
  items: ScheduleItemLike[],
  catalogueDescription?: string | null,
): boolean {
  if (isQaNoiseDescription(catalogueDescription)) return true;
  return items.some((i) => isQaNoiseDescription(i.description));
}

/** @deprecated Prefer scheduleDiseaseLine + scheduleDoseRouteLine */
export function scheduleSecondaryLine(item: ScheduleItemLike): string {
  return scheduleDoseRouteLine(item);
}
