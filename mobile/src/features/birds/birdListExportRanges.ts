/** Pure date-range helpers for bird list export (no React Native imports). */

export type BirdListExportRange = {
  from: string;
  to: string;
};

/** Inclusive calendar ranges for export presets. */
export function exportPeriodRange(
  key: "last_month" | "last_3_months",
  today = new Date(),
): BirdListExportRange {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (key === "last_month") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: iso(from), to: iso(to) };
  }

  // Current calendar month + two preceding months, through today.
  const from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  return { from: iso(from), to: iso(today) };
}
