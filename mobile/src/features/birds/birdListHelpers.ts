/** Display helpers for shed bird lists (no business rules). */

export const BIRD_SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
] as const;

export function formatLifecycleLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatSexLabel(sex: string | null | undefined): string {
  if (!sex) return "—";
  const s = sex.trim().toLowerCase();
  if (s === "m" || s === "male") return "Male";
  if (s === "f" || s === "female") return "Female";
  return sex.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize stored sex values (M/F/male/female) to SelectField option values. */
export function normalizeSexSelectValue(sex: string | null | undefined): string | null {
  if (!sex) return null;
  const s = sex.trim().toLowerCase();
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  return null;
}

/** Human-readable relative age for list cards (e.g. "3 months"). */
export function formatRelativeAgeLabel(opts: {
  hatch_date: string | null;
  estimated_age_days: number | null;
  nowMs?: number;
}): string {
  const now = opts.nowMs ?? Date.now();
  if (opts.hatch_date) {
    const hatchMs = Date.parse(opts.hatch_date);
    if (!Number.isFinite(hatchMs)) return `Hatch ${opts.hatch_date}`;
    const days = Math.floor((now - hatchMs) / 86_400_000);
    if (days < 0) return `Hatch ${opts.hatch_date}`;
    if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
    const months = Math.max(1, Math.floor(days / 30));
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  if (opts.estimated_age_days != null) {
    const d = opts.estimated_age_days;
    if (d < 60) return `~${d} day${d === 1 ? "" : "s"}`;
    const months = Math.max(1, Math.floor(d / 30));
    return `~${months} month${months === 1 ? "" : "s"}`;
  }
  return "Age unknown";
}

export function formatBirdAge(opts: {
  hatch_date: string | null;
  estimated_age_days: number | null;
}): string {
  if (opts.hatch_date) return `Hatch ${opts.hatch_date}`;
  if (opts.estimated_age_days != null) return `~${opts.estimated_age_days}d`;
  return "Age unknown";
}

/** User-facing label for an unbanded population row (never shows batch_code). */
export function formatUnbandedCohortLabel(opts: {
  hatch_date: string | null;
  estimated_age_days: number | null;
  unbanded_count: number;
}): string {
  const age = formatBirdAge(opts);
  return `${age} · ${opts.unbanded_count} unbanded`;
}

export const LIFECYCLE_FILTER_OPTIONS = [
  { value: "", label: "Active only", hint: "Default — live registered birds" },
  { value: "all", label: "All statuses", hint: "Includes dead, sold, transferred" },
  { value: "active", label: "Active", hint: "lifecycle_status = active" },
  { value: "dead", label: "Dead", hint: "Mortality recorded" },
  { value: "sold", label: "Sold", hint: "Sale recorded" },
  { value: "transferred_out", label: "Transferred out", hint: "Transfer recorded" },
  { value: "inactive", label: "Inactive", hint: "Inactive status" },
] as const;

export const BIRD_LIFECYCLE_ACTIONS = [
  {
    value: "mortality",
    label: "Record mortality",
    confirmTitle: "Record mortality?",
    consequence:
      "This marks the bird as dead and removes it from the live population. Lifecycle history is preserved for audit.",
  },
  {
    value: "sale",
    label: "Record sale",
    confirmTitle: "Record sale?",
    consequence:
      "This marks the bird as sold and removes it from the live population. Historical records remain auditable.",
  },
  {
    value: "transfer",
    label: "Record transfer",
    confirmTitle: "Record transfer?",
    consequence:
      "This marks the bird as transferred out and removes it from the live population. Historical records are preserved.",
  },
] as const;
