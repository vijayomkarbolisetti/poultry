import type { SelectOption } from "./SelectField";

/** True when value is null or present in options (or an explicit allow-list). */
export function isSelectValueValid(
  value: string | null | undefined,
  options: SelectOption[],
  allowValues: string[] = [],
): boolean {
  if (value == null || value === "") return true;
  if (allowValues.includes(value)) return true;
  return options.some((o) => o.value === value && !o.disabled);
}

/** Returns null when the current value is stale relative to options. */
export function reconcileSelectValue(
  value: string | null | undefined,
  options: SelectOption[],
  allowValues: string[] = [],
): string | null {
  if (value == null || value === "") return null;
  return isSelectValueValid(value, options, allowValues) ? value : null;
}

export function filterSelectOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false) || o.value.toLowerCase().includes(q),
  );
}

/** YYYY-MM-DD local calendar date (avoids UTC day-shift from toISOString). */
export function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local calendar Date (noon avoided — midnight local). */
export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [ys, ms, ds] = value.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function todayIsoDate(): string {
  return formatIsoDate(new Date());
}

/** Human-readable display for date-only fields (value remains YYYY-MM-DD). */
export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Compare YYYY-MM-DD strings lexicographically (valid for ISO dates). */
export function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function clampIsoDate(
  value: string,
  minimumDate?: string | null,
  maximumDate?: string | null,
): string {
  let next = value;
  if (minimumDate && compareIsoDates(next, minimumDate) < 0) next = minimumDate;
  if (maximumDate && compareIsoDates(next, maximumDate) > 0) next = maximumDate;
  return next;
}
