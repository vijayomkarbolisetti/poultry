/** Display helpers for shed bird lists (no business rules). */

export function formatLifecycleLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBirdAge(opts: {
  hatch_date: string | null;
  estimated_age_days: number | null;
}): string {
  if (opts.hatch_date) return `Hatch ${opts.hatch_date}`;
  if (opts.estimated_age_days != null) return `~${opts.estimated_age_days}d`;
  return "Age unknown";
}

export function formatVaccSummary(count: number): string {
  if (count <= 0) return "No individual vaccinations";
  return `${count} individual vaccination${count === 1 ? "" : "s"}`;
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
      "This marks the bird as dead and removes it from the live population. Vaccination and lifecycle history are preserved for audit.",
  },
  {
    value: "sale",
    label: "Record sale",
    confirmTitle: "Record sale?",
    consequence:
      "This marks the bird as sold and removes it from the live population. Historical vaccination records remain auditable.",
  },
  {
    value: "transfer",
    label: "Record transfer",
    confirmTitle: "Record transfer?",
    consequence:
      "This marks the bird as transferred out and removes it from the live population. Historical records are preserved.",
  },
] as const;
