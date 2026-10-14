import { api } from "./client";

export type Flock = {
  id: string;
  shed_id: string;
  batch_code: string;
  breed: string | null;
  hatch_date: string | null;
  estimated_age_days: number | null;
  dob_confidence: "exact" | "estimated" | "unknown";
  initial_count: number;
  current_count: number;
  banded_count: number;
  unbanded_count: number;
  tracking_mode: "batch" | "individual" | "mixed";
  status: "active" | "closed";
  count_mismatch: boolean;
  notes: string | null;
};

export type Bird = {
  id: string;
  flock_id: string;
  band_id: string | null;
  hatch_date: string | null;
  dob_confidence: string;
  breed: string | null;
  sex: string | null;
  lifecycle_status: string;
  is_active: boolean;
};

export async function listFlocks(shedId?: string): Promise<Flock[]> {
  const { data } = await api.get<Flock[]>("/flocks", { params: shedId ? { shed_id: shedId } : {} });
  return data;
}

export async function createFlock(input: Record<string, unknown>): Promise<Flock> {
  const { data } = await api.post<Flock>("/flocks", input);
  return data;
}

export async function getFlock(id: string): Promise<Flock> {
  const { data } = await api.get<Flock>(`/flocks/${id}`);
  return data;
}

export async function listBirds(flockId: string): Promise<Bird[]> {
  const { data } = await api.get<Bird[]>("/birds", { params: { flock_id: flockId } });
  return data;
}

export async function createBird(input: Record<string, unknown>): Promise<Bird> {
  const { data } = await api.post<Bird>("/birds", input);
  return data;
}

export async function bulkImportBirds(input: {
  flock_id: string;
  idempotency_key?: string;
  rows: { band_id: string; breed?: string; sex?: string }[];
}): Promise<{ created: number; failed: number; errors: { row: number; band_id: string; error: string }[] }> {
  const { data } = await api.post("/birds/bulk-import", input);
  return data;
}

export async function recordLifecycle(input: Record<string, unknown>) {
  const { data } = await api.post("/lifecycle-events", input);
  return data;
}
