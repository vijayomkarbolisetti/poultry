/**
 * Vaccination API client — scheduled doses (enriched labels) + recording.
 */
import { api } from "./client";

export type ScheduledDose = {
  id: string;
  shed_id: string;
  flock_id: string;
  bird_id: string | null;
  vaccine_definition_id: string;
  dose_number: number;
  due_date: string;
  status: string;
  eligible_count: number;
  completed_count: number;
  needs_review: boolean;
  vaccine_name?: string | null;
  shed_name?: string | null;
  flock_label?: string | null;
  banded_count?: number | null;
  unbanded_count?: number | null;
  remaining_count?: number | null;
};

export type VaccinationEvent = {
  id: string;
  shed_id: string;
  flock_id: string;
  bird_id: string | null;
  scheduled_dose_id: string | null;
  vaccine_definition_id: string;
  administration_date: string;
  birds_covered: number;
  lot_number: string | null;
  product_expiry: string | null;
  manufacturer_or_brand: string | null;
  vaccine_type_or_strain: string | null;
  dose_amount: string | null;
  route: string | null;
  notes: string | null;
  verification_status: string;
  timing_status: string;
  is_void: boolean;
  created_at: string;
};

export type ListScheduledDosesParams = {
  flock_id?: string;
  shed_id?: string;
  status?: string;
  limit?: number;
};

export type VaccinationRecordInput = {
  scheduled_dose_id?: string;
  flock_id?: string;
  bird_id?: string | null;
  vaccine_definition_id?: string;
  administration_date?: string;
  birds_covered?: number;
  lot_number?: string | null;
  product_expiry?: string | null;
  manufacturer_or_brand?: string | null;
  vaccine_type_or_strain?: string | null;
  dose_amount?: string | null;
  route?: string | null;
  notes?: string | null;
  verification_status?: string;
  idempotency_key?: string;
};

export type VaccinationBatchInput = {
  items: { scheduled_dose_id: string; birds_covered: number }[];
  administration_date?: string;
  idempotency_key: string;
  lot_number?: string | null;
  product_expiry?: string | null;
  manufacturer_or_brand?: string | null;
  vaccine_type_or_strain?: string | null;
  dose_amount?: string | null;
  route?: string | null;
  notes?: string | null;
  verification_status?: string;
};

/** Server enforces owner scope and farmer shed assignment. */
export async function listScheduledDoses(
  params: ListScheduledDosesParams = {},
): Promise<ScheduledDose[]> {
  const { data } = await api.get<ScheduledDose[]>("/vaccines/scheduled-doses", {
    params: {
      flock_id: params.flock_id,
      shed_id: params.shed_id,
      status: params.status,
      limit: params.limit ?? 500,
    },
  });
  return data ?? [];
}

export async function getScheduledDose(id: string): Promise<ScheduledDose | null> {
  const rows = await listScheduledDoses({ limit: 500 });
  return rows.find((d) => d.id === id) ?? null;
}

export async function recordVaccination(input: VaccinationRecordInput): Promise<VaccinationEvent> {
  const { data } = await api.post<VaccinationEvent>("/vaccination-events", input);
  return data;
}

export async function recordVaccinationBatch(
  input: VaccinationBatchInput,
): Promise<VaccinationEvent[]> {
  const { data } = await api.post<VaccinationEvent[]>("/vaccination-events/batch", input);
  return data;
}

export async function listVaccinationEvents(flockId?: string): Promise<VaccinationEvent[]> {
  const { data } = await api.get<VaccinationEvent[]>("/vaccination-events", {
    params: flockId ? { flock_id: flockId } : undefined,
  });
  return data ?? [];
}

/** Stable client key for retries (8–100 chars for batch). */
export function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`.slice(0, 100);
}
