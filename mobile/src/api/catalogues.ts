/**
 * Vaccine catalogues API — farm default assign + farm-owned CRUD/clone.
 * Product guidance fields live on catalogue items (not invented client-side).
 */
import { api } from "./client";

export type CatalogueRule = {
  id?: string;
  dose_number: number;
  target_age_days: number | null;
  display_day_label: string | null;
  repeat_interval_days: number | null;
  max_repeats: number | null;
  grace_period_days: number;
  reminder_lead_days: number;
  is_manual_only: boolean;
  label: string | null;
};

export type CatalogueItem = {
  id?: string;
  sort_order: number;
  name: string;
  category: string;
  description: string | null;
  disease_label: string | null;
  instructions: string | null;
  recommended_dose_text: string | null;
  route: string | null;
  diluent_instructions: string | null;
  is_active?: boolean;
  rules: CatalogueRule[];
};

export type CatalogueSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  is_example: boolean;
  requires_veterinary_review?: boolean;
  owner_account_id: string | null;
  cloned_from_catalogue_id: string | null;
  is_platform: boolean;
  item_count: number;
};

export type CatalogueDetail = CatalogueSummary & {
  items: CatalogueItem[];
};

export type CatalogueAssignment = {
  id: string;
  catalogue_id: string;
  catalogue_code: string;
  catalogue_name: string;
  assigned_at: string;
  effective_date: string;
  apply_scope: string;
  is_current: boolean;
  notes: string | null;
  materialized_definition_ids?: string[];
  regenerated_doses?: number;
};

export type CatalogueItemInput = {
  /** Stable id for existing entries; omit when creating a new item. */
  id?: string;
  sort_order?: number;
  name: string;
  category?: string;
  description?: string | null;
  disease_label?: string | null;
  instructions?: string | null;
  recommended_dose_text?: string | null;
  route?: string | null;
  diluent_instructions?: string | null;
  rules?: {
    dose_number?: number;
    target_age_days?: number | null;
    display_day_label?: string | null;
    repeat_interval_days?: number | null;
    max_repeats?: number | null;
    grace_period_days?: number;
    reminder_lead_days?: number;
    is_manual_only?: boolean;
    label?: string | null;
  }[];
};

/** Fingerprint fields required by PATCH when items / remove_item_ids change. */
export type CatalogueUpdateGuards = {
  expected_version: number;
  expected_assignment_catalogue_id: string | null;
  expected_override_flock_count: number;
};

export type CataloguePreviewUpdate = {
  catalogue_id: string;
  catalogue_name: string;
  catalogue_version: number;
  requires_veterinary_review: boolean;
  apply_scope: string;
  effective_date: string;
  is_farm_default: boolean;
  expected_assignment_catalogue_id: string | null;
  expected_override_flock_count: number;
  inheriting_flock_count_if_default: number;
  items_added: string[];
  items_updated: string[];
  items_removed: string[];
  rule_changes: string[];
  open_doses_eligible_for_change: number;
  completed_event_count: number;
  flocks_affected_new_flocks: number;
  flocks_affected_all_active: number;
  warning: string;
  all_active_gated: boolean;
};

export type CatalogueUpdateBody = {
  name?: string;
  description?: string | null;
  status?: string;
  items?: CatalogueItemInput[];
  remove_item_ids?: string[];
  apply_scope?: string;
  effective_date?: string | null;
  confirm_change?: boolean;
  expected_version?: number;
  expected_assignment_catalogue_id?: string | null;
  expected_override_flock_count?: number;
};

export async function listCatalogues(opts?: { includeInactive?: boolean }): Promise<CatalogueSummary[]> {
  const { data } = await api.get<CatalogueSummary[]>("/vaccine-catalogues", {
    params: opts?.includeInactive ? { include_inactive: true } : undefined,
  });
  return data ?? [];
}

export async function getCatalogue(id: string): Promise<CatalogueDetail> {
  const { data } = await api.get<CatalogueDetail>(`/vaccine-catalogues/${id}`);
  return data;
}

export async function getCatalogueAssignment(): Promise<CatalogueAssignment | null> {
  const { data } = await api.get<CatalogueAssignment | null>("/vaccine-catalogues/assignment");
  return data ?? null;
}

export async function createCatalogue(body: {
  code: string;
  name: string;
  description?: string | null;
  items?: CatalogueItemInput[];
}): Promise<CatalogueDetail> {
  const { data } = await api.post<CatalogueDetail>("/vaccine-catalogues", {
    items: [],
    ...body,
  });
  return data;
}

export async function cloneCatalogue(
  id: string,
  body?: { code?: string; name?: string },
): Promise<CatalogueDetail> {
  const { data } = await api.post<CatalogueDetail>(`/vaccine-catalogues/${id}/clone`, body ?? {});
  return data;
}

export async function previewCatalogueUpdate(
  id: string,
  body: {
    name?: string;
    description?: string | null;
    items?: CatalogueItemInput[] | null;
    remove_item_ids?: string[];
    apply_scope?: string;
    effective_date?: string | null;
  },
): Promise<CataloguePreviewUpdate> {
  const { data } = await api.post<CataloguePreviewUpdate>(`/vaccine-catalogues/${id}/preview-update`, {
    apply_scope: "new_flocks",
    ...body,
  });
  return data;
}

export async function updateCatalogue(id: string, body: CatalogueUpdateBody): Promise<CatalogueDetail> {
  const { data } = await api.patch<CatalogueDetail>(`/vaccine-catalogues/${id}`, body);
  return data;
}

export async function assignCatalogue(body: {
  catalogue_id: string;
  apply_scope?: string;
  effective_date?: string | null;
  notes?: string | null;
  confirm_change?: boolean;
}): Promise<CatalogueAssignment> {
  const { data } = await api.post<CatalogueAssignment>("/vaccine-catalogues/assign", {
    apply_scope: "all_active",
    ...body,
  });
  return data;
}

export function guardsFromPreview(preview: CataloguePreviewUpdate): CatalogueUpdateGuards {
  return {
    expected_version: preview.catalogue_version,
    expected_assignment_catalogue_id: preview.expected_assignment_catalogue_id,
    expected_override_flock_count: preview.expected_override_flock_count,
  };
}

export function isStalePreviewError(e: unknown): boolean {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } } };
  if (err.response?.status !== 409) return false;
  const detail = err.response?.data?.detail;
  if (typeof detail !== "string") return false;
  const lower = detail.toLowerCase();
  // Match STALE_PREVIEW messages; avoid CONFIRM_REQUIRED (also 409, mentions "impact preview").
  return lower.includes("since preview") || lower.includes("from preview");
}

/** Farm-owned catalogues cloned from a given platform/source id. */
export function farmCopiesOf(sourceId: string, list: CatalogueSummary[]): CatalogueSummary[] {
  return list.filter((c) => !c.is_platform && c.cloned_from_catalogue_id === sourceId);
}
