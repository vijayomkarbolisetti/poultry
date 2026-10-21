/** Pure helpers for global search UI (testable without React Native). */

export const MIN_QUERY_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 300;

export type GlobalSearchUiState =
  | "idle"
  | "too_short"
  | "loading"
  | "empty"
  | "results"
  | "error"
  | "partial_error";

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function classifyGlobalSearch(opts: {
  query: string;
  loading: boolean;
  fetchError: boolean;
  birdTotal: number;
  batchTotal: number;
  shedTotal: number;
  birdError: string | null;
  batchError: string | null;
  shedError: string | null;
  anySection: boolean;
}): GlobalSearchUiState {
  const q = normalizeSearchQuery(opts.query);
  if (!q) return "idle";
  if (q.length < MIN_QUERY_LENGTH) return "too_short";
  if (opts.loading) return "loading";
  if (opts.fetchError && !opts.anySection) return "error";

  const sectionErrors = [opts.birdError, opts.batchError, opts.shedError].filter(Boolean);
  const total = opts.birdTotal + opts.batchTotal + opts.shedTotal;
  if (total === 0 && sectionErrors.length > 0) return "partial_error";
  if (total === 0) return sectionErrors.length ? "partial_error" : "empty";
  if (sectionErrors.length > 0) return "partial_error";
  return "results";
}

export function birdSubtitle(hit: {
  breed: string | null;
  batch_code: string;
  shed_name: string | null;
  shed_code: string | null;
  is_active: boolean;
  lifecycle_status: string;
}): string {
  const parts = [
    hit.breed || null,
    `Batch ${hit.batch_code}`,
    hit.shed_name ?? hit.shed_code ?? null,
    hit.is_active ? "Active" : hit.lifecycle_status.replace(/_/g, " "),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function batchSubtitle(hit: {
  shed_name: string | null;
  shed_code: string | null;
  current_count: number;
  status: string;
  breed: string | null;
}): string {
  const shed = hit.shed_name ?? hit.shed_code ?? "Shed";
  const status = hit.status === "active" ? "Active" : hit.status.replace(/_/g, " ");
  const breed = hit.breed ? `${hit.breed} · ` : "";
  return `${breed}${shed} · ${hit.current_count} birds · ${status}`;
}

export function shedSubtitle(hit: {
  organization_name: string | null;
  code: string;
  manager_names: string[];
  total_live_birds: number;
  is_active: boolean;
}): string {
  const mgr = hit.manager_names[0] ? ` · ${hit.manager_names[0]}` : "";
  const farm = hit.organization_name ? `${hit.organization_name} · ` : "";
  const status = hit.is_active ? "Active" : "Inactive";
  return `${farm}${hit.code}${mgr} · ${hit.total_live_birds} birds · ${status}`;
}
