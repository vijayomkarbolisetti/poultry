/** Pure helpers for bird search UI (testable without React Native). */

export type SearchUiState =
  | "idle"
  | "loading"
  | "empty"
  | "error"
  | "single"
  | "ambiguous"
  | "inactive_only";

export function normalizeBandQuery(raw: string): string {
  return raw.trim();
}

export function classifySearchResult(opts: {
  query: string;
  loading: boolean;
  error: boolean;
  total: number;
  exactCount: number;
  items: { is_active: boolean }[];
}): SearchUiState {
  if (!opts.query) return "idle";
  if (opts.loading) return "loading";
  if (opts.error) return "error";
  if (opts.total === 0 || opts.items.length === 0) return "empty";
  if (opts.items.length === 1) {
    return opts.items[0].is_active ? "single" : "inactive_only";
  }
  const allInactive = opts.items.every((i) => !i.is_active);
  if (allInactive) return "inactive_only";
  if (opts.total > 1 || opts.exactCount > 1 || opts.items.length > 1) return "ambiguous";
  return "single";
}

export function birdResultSubtitle(hit: {
  batch_code: string;
  shed_name: string | null;
  shed_code: string | null;
  is_active: boolean;
  lifecycle_status: string;
}): string {
  const shed = hit.shed_name ?? hit.shed_code ?? "Shed";
  const status = hit.is_active ? "Active" : hit.lifecycle_status.replace(/_/g, " ");
  return `${shed} · Batch ${hit.batch_code} · ${status}`;
}
