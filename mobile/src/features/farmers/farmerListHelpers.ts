import type { Farmer } from "../../api/farmers";

export function filterFarmers(rows: readonly Farmer[], query: string): Farmer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(
    (f) => f.full_name.toLowerCase().includes(q) || f.email.toLowerCase().includes(q),
  );
}
