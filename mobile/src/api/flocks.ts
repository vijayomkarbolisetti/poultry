/**
 * Internal flock/cohort client.
 * Product UX is shed- and hatch-date oriented; API/DB still use `/flocks`, `flock_id`, `batch_code`.
 */
import { api } from "./client";

/** API entity for an internal shed hatch-date cohort (legacy type name `Flock`). */
export type Flock = {
  id: string;
  shed_id: string;
  batch_code: string;
  breed: string | null;
  hatch_date: string | null;
  estimated_age_days: number | null;
  age_reported_on: string | null;
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

/** Legacy alias for {@link Flock} (prefer hatch-date labels in UI). */
export type Batch = Flock;

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

export type LifecycleEventInput = {
  event_type: "mortality" | "sale" | "transfer" | string;
  effective_date: string;
  bird_id?: string;
  flock_id?: string;
  quantity?: number;
  reason?: string | null;
  idempotency_key?: string | null;
};

export type LifecycleEventOut = {
  id: string;
  event_type: string;
  effective_date: string;
  flock_id: string | null;
  bird_id: string | null;
  quantity: number;
  reason: string | null;
  created_at: string;
};

export async function recordLifecycle(input: LifecycleEventInput): Promise<LifecycleEventOut> {
  const { data } = await api.post<LifecycleEventOut>("/lifecycle-events", input);
  return data;
}

export type LifecycleBulkInput = {
  event_type: "mortality" | "sale" | "transfer";
  effective_date: string;
  bird_ids: string[];
  reason?: string | null;
  idempotency_key: string;
};

export type LifecycleBulkItem = {
  bird_id: string;
  event_id: string;
  lifecycle_status: string;
  band_id: string | null;
  idempotent_replay: boolean;
};

export type LifecycleBulkOut = {
  applied: number;
  event_type: string;
  items: LifecycleBulkItem[];
  idempotent_replay: boolean;
};

export async function recordLifecycleBulk(input: LifecycleBulkInput): Promise<LifecycleBulkOut> {
  const { data } = await api.post<LifecycleBulkOut>("/lifecycle-events/bulk", input);
  return data;
}

export async function updateFlock(
  id: string,
  input: { breed?: string | null; notes?: string | null; status?: string; current_count?: number; add_unbanded?: number },
): Promise<Flock> {
  const { data } = await api.patch<Flock>(`/flocks/${id}`, input);
  return data;
}

export type ShedTransferInput = {
  destination_flock_id: string;
  effective_date: string;
  bird_ids?: string[];
  source_flock_id?: string;
  quantity?: number;
  reason?: string | null;
  idempotency_key: string;
};

export type ShedTransferOut = {
  moved: number;
  destination_flock_id: string;
  destination_shed_id: string;
  bird_ids: string[];
  idempotent_replay: boolean;
};

/** Move birds/headcount to another shed's group (birds stay active). */
export async function transferToShed(input: ShedTransferInput): Promise<ShedTransferOut> {
  const { data } = await api.post<ShedTransferOut>("/lifecycle-events/transfer-to-shed", input);
  return data;
}

/** Age key: exact hatch_date XOR (estimated_age_days + age_reported_on). */
export type CohortAgeFields =
  | { hatch_date: string; estimated_age_days?: never; age_reported_on?: never }
  | { hatch_date?: never; estimated_age_days: number; age_reported_on: string };

export type UnbandedLifecycleByCohortInput = CohortAgeFields & {
  shed_id: string;
  event_type: "mortality" | "sale" | "transfer";
  effective_date: string;
  quantity: number;
  reason?: string | null;
  idempotency_key: string;
};

/** Count-only lifecycle resolved by shed + age cohort (no flock_id). */
export async function recordUnbandedLifecycleByCohort(
  input: UnbandedLifecycleByCohortInput,
): Promise<LifecycleEventOut> {
  const { data } = await api.post<LifecycleEventOut>(
    "/lifecycle-events/unbanded-by-cohort",
    input,
  );
  return data;
}

export type ShedTransferByCohortInput = CohortAgeFields & {
  destination_shed_id: string;
  effective_date: string;
  bird_ids?: string[];
  source_shed_id?: string;
  quantity?: number;
  reason?: string | null;
  idempotency_key: string;
};

/**
 * Shed-centric transfer: server resolves/creates the destination cohort under
 * lifecycle.record (no client flock.create).
 */
export async function transferToShedByCohort(
  input: ShedTransferByCohortInput,
): Promise<ShedTransferOut> {
  const { data } = await api.post<ShedTransferOut>(
    "/lifecycle-events/transfer-to-shed-by-cohort",
    input,
  );
  return data;
}
