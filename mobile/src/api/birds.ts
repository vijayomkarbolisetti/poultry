/**
 * Individual bird search and profile client (B1/B2).
 * Batches remain under `/flocks`; birds use `/birds`.
 */
import { api } from "./client";

export type BirdSearchHit = {
  id: string;
  band_id: string | null;
  display_code: string | null;
  shed_id: string;
  shed_name: string | null;
  shed_code: string | null;
  flock_id: string;
  batch_code: string;
  breed: string | null;
  lifecycle_status: string;
  is_active: boolean;
  match_kind: "exact" | "partial" | string;
};

export type BirdSearchResult = {
  query: string;
  total: number;
  limit: number;
  offset: number;
  exact_count: number;
  items: BirdSearchHit[];
};

export type BirdProfileVaccinationEvent = {
  id: string;
  vaccine_definition_id: string;
  vaccine_name: string | null;
  administration_date: string;
  birds_covered: number;
  lot_number: string | null;
  timing_status: string;
  verification_status: string;
  notes: string | null;
  scheduled_dose_id: string | null;
  created_at: string;
};

export type BirdProfileBatchDose = {
  id: string;
  vaccine_definition_id: string;
  vaccine_name: string | null;
  dose_number: number;
  due_date: string;
  status: string;
  eligible_count: number;
  completed_count: number;
  needs_review: boolean;
  attribution_note: string;
};

export type BirdProfileLifecycle = {
  id: string;
  event_type: string;
  effective_date: string;
  quantity: number;
  reason: string | null;
  created_at: string;
};

export type BirdParentRef = {
  id: string;
  band_id: string | null;
  display_code: string | null;
};

export type BirdProfile = {
  id: string;
  band_id: string | null;
  display_code: string | null;
  breed: string | null;
  sex: string | null;
  hatch_date: string | null;
  estimated_age_days: number | null;
  dob_confidence: string;
  lifecycle_status: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  organization_name: string | null;
  shed_id: string;
  shed_name: string | null;
  shed_code: string | null;
  flock_id: string;
  batch_code: string;
  flock_tracking_mode: string;
  flock_status: string;
  flock_unbanded_count: number;
  flock_banded_count: number;
  flock_current_count: number;
  flock_count_mismatch: boolean;
  sire: BirdParentRef | null;
  dam: BirdParentRef | null;
  individual_vaccinations: BirdProfileVaccinationEvent[];
  batch_upcoming_doses: BirdProfileBatchDose[];
  lifecycle_events: BirdProfileLifecycle[];
};

export async function searchBirds(opts: {
  q: string;
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}): Promise<BirdSearchResult> {
  const { data } = await api.get<BirdSearchResult>("/birds/search", {
    params: {
      q: opts.q,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
      include_inactive: opts.includeInactive ?? true,
    },
  });
  return data;
}

export async function getBirdProfile(birdId: string): Promise<BirdProfile> {
  const { data } = await api.get<BirdProfile>(`/birds/${birdId}/profile`);
  return data;
}

export type ShedBirdListItem = {
  id: string;
  band_id: string | null;
  display_code: string | null;
  breed: string | null;
  sex: string | null;
  hatch_date: string | null;
  estimated_age_days: number | null;
  dob_confidence: string;
  lifecycle_status: string;
  is_active: boolean;
  flock_id: string;
  batch_code: string;
  shed_id: string;
  individual_vaccination_count: number;
  notes: string | null;
};

export type ShedBirdUnbandedBatch = {
  flock_id: string;
  batch_code: string;
  unbanded_count: number;
  tracking_mode: string;
  status: string;
};

export type ShedBirdList = {
  shed_id: string;
  total: number;
  limit: number;
  offset: number;
  items: ShedBirdListItem[];
  unbanded_total: number;
  unbanded_batches: ShedBirdUnbandedBatch[];
};

export async function listBirdsInShed(opts: {
  shedId: string;
  flockId?: string | null;
  q?: string;
  lifecycleStatus?: string | null;
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}): Promise<ShedBirdList> {
  const { data } = await api.get<ShedBirdList>("/birds/in-shed", {
    params: {
      shed_id: opts.shedId,
      flock_id: opts.flockId || undefined,
      q: opts.q?.trim() || undefined,
      lifecycle_status: opts.lifecycleStatus || undefined,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
      include_inactive: opts.includeInactive ?? false,
    },
  });
  return data;
}

export type BirdUpdateInput = {
  band_id?: string;
  breed?: string | null;
  sex?: string | null;
  hatch_date?: string | null;
  estimated_age_days?: number | null;
  age_reported_on?: string | null;
  dob_confidence?: string;
  notes?: string | null;
};

export async function updateBird(birdId: string, input: BirdUpdateInput) {
  const { data } = await api.patch(`/birds/${birdId}`, input);
  return data;
}

export type BandFromUnbandedResult = {
  bird: {
    id: string;
    shed_id: string;
    flock_id: string;
    band_id: string | null;
    lifecycle_status: string;
    is_active: boolean;
  };
  idempotent_replay: boolean;
  flock_unbanded_count: number;
  flock_banded_count: number;
  flock_current_count: number;
};

/** Atomic: one unbanded headcount → one banded bird (population unchanged). */
export async function bandFromUnbanded(input: {
  flock_id: string;
  band_id: string;
  idempotency_key: string;
  breed?: string | null;
  sex?: string | null;
  notes?: string | null;
}): Promise<BandFromUnbandedResult> {
  const { data } = await api.post<BandFromUnbandedResult>("/birds/band-from-unbanded", input);
  return data;
}

/** Shed-centric banded registration — server finds/creates a hidden DOB cohort. */
export async function registerBandedInShed(input: {
  shed_id: string;
  band_id: string;
  hatch_date: string;
  breed?: string | null;
  sex?: string | null;
  notes?: string | null;
}) {
  const { data } = await api.post("/birds/register-in-shed", input);
  return data;
}

export type AddUnbandedInShedResult = {
  flock: {
    id: string;
    shed_id: string;
    unbanded_count: number;
    banded_count: number;
    current_count: number;
    hatch_date: string | null;
  };
  created_cohort: boolean;
  quantity_added: number;
  idempotent_replay: boolean;
};

/** Shed-centric unbanded headcount — exact DOB cohort find-or-create. */
export async function addUnbandedInShed(input: {
  shed_id: string;
  quantity: number;
  hatch_date: string;
  idempotency_key?: string;
}): Promise<AddUnbandedInShedResult> {
  const { data } = await api.post<AddUnbandedInShedResult>("/birds/add-unbanded-in-shed", input);
  return data;
}

export type BirdPdfDownload = {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
};

/** Authenticated PDF download — never uses a public storage URL. */
export async function downloadBirdVaccinationReport(birdId: string): Promise<BirdPdfDownload> {
  const res = await api.get<ArrayBuffer>(`/birds/${birdId}/vaccination-report.pdf`, {
    responseType: "arraybuffer",
    headers: { Accept: "application/pdf" },
  });
  const cd = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^";]+)"?/i.exec(cd);
  const filename = match?.[1]?.trim() || `Bird_Report_${birdId.slice(0, 8)}.pdf`;
  return {
    bytes: res.data,
    filename,
    contentType: String(res.headers["content-type"] ?? "application/pdf"),
  };
}
