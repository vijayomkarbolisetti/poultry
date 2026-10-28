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

export async function updateCatalogue(
  id: string,
  body: {
    name?: string;
    description?: string | null;
    status?: string;
    items?: CatalogueItemInput[];
    apply_scope?: string;
    effective_date?: string | null;
    confirm_change?: boolean;
  },
): Promise<CatalogueDetail> {
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
