import { api } from "./client";

export type SicknessSeverity = "mild" | "moderate" | "severe";
export type SicknessStatus = "active" | "recovered";
export type FollowUpState = "none" | "upcoming" | "due" | "overdue";

export type SicknessRecord = {
  id: string;
  bird_id: string;
  band_id: string | null;
  display_code: string | null;
  breed: string | null;
  batch_code: string;
  current_shed_id: string;
  current_shed_name: string | null;
  recorded_shed_id: string;
  recorded_shed_name: string | null;
  sick_date: string;
  symptoms: string;
  severity: SicknessSeverity;
  notes: string | null;
  treatment: string | null;
  follow_up_date: string | null;
  recovery_date: string | null;
  status: SicknessStatus;
  bird_is_active: boolean;
  bird_lifecycle_status: string;
  created_by_user_id: string;
  recovered_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  follow_up_state: FollowUpState;
  days_sick: number | null;
};

export type SicknessEpisode = {
  id: string;
  bird_id: string;
  sick_date: string;
  symptoms: string;
  severity: SicknessSeverity;
  notes: string | null;
  treatment: string | null;
  follow_up_date: string | null;
  recovery_date: string | null;
  status: SicknessStatus;
  recorded_shed_id: string;
  recorded_shed_name: string | null;
  created_by_user_id: string;
  recovered_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  follow_up_state: FollowUpState;
};

export type BirdHealthOverview = {
  status: "sick" | "healthy" | "unresolved_inactive" | "not_applicable" | string;
  total_episodes: number;
  last_sickness_date: string | null;
  last_recovery_date: string | null;
  active_episode_id: string | null;
};

export type SicknessHistory = {
  bird_id: string;
  band_id: string | null;
  display_code: string | null;
  current_health_status: "sick" | "healthy" | "unresolved_inactive" | "not_applicable" | string;
  total_episodes: number;
  last_sickness_date: string | null;
  last_recovery_date: string | null;
  active_episode: SicknessEpisode | null;
  episodes: SicknessEpisode[];
};

export type SicknessList = {
  total: number;
  limit: number;
  offset: number;
  items: SicknessRecord[];
};

export type SicknessBulkResult = {
  success_count: number;
  recorded: SicknessRecord[];
  idempotent_replay: boolean;
};

export type SicknessShedBreakdown = {
  shed_id: string;
  shed_name: string | null;
  active_birds: number;
  active_episodes: number;
  due: number;
  overdue: number;
};

export type SicknessSummary = {
  as_of: string;
  from_date: string | null;
  to_date: string | null;
  currently_sick_birds: number;
  active_episodes: number;
  follow_ups_due: number;
  follow_ups_overdue: number;
  recovered_birds: number;
  recovered_episodes: number;
  new_episodes: number;
  new_unique_birds: number;
  unresolved_inactive_episodes: number;
  severity_breakdown: Record<string, number>;
  new_severity_breakdown: Record<string, number>;
  shed_breakdown: SicknessShedBreakdown[];
};

export type SicknessCreateInput = {
  sick_date: string;
  symptoms: string;
  severity: SicknessSeverity;
  notes?: string | null;
  treatment?: string | null;
  follow_up_date?: string | null;
  idempotency_key?: string | null;
};

export type SicknessBulkInput = SicknessCreateInput & { bird_ids: string[] };

export type SicknessRecoverInput = {
  recovery_date: string;
  notes?: string | null;
};

export type SicknessUpdateInput = Partial<
  Pick<
    SicknessCreateInput,
    "sick_date" | "symptoms" | "severity" | "notes" | "treatment" | "follow_up_date"
  >
>;

export async function recordBirdSickness(
  birdId: string,
  input: SicknessCreateInput,
): Promise<SicknessRecord> {
  const { data } = await api.post<SicknessRecord>(`/birds/${birdId}/sickness`, input);
  return data;
}

export async function recordBulkSickness(
  input: SicknessBulkInput,
): Promise<SicknessBulkResult> {
  const { data } = await api.post<SicknessBulkResult>("/sickness/bulk", input);
  return data;
}

export async function listSickness(opts: {
  q?: string;
  status?: SicknessStatus | "";
  severity?: SicknessSeverity | "";
  birdId?: string | null;
  shedId?: string | null;
  sickFrom?: string | null;
  sickTo?: string | null;
  followUpFrom?: string | null;
  followUpTo?: string | null;
  followUpState?: FollowUpState | "";
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<SicknessList> {
  const { data } = await api.get<SicknessList>("/sickness", {
    params: {
      q: opts.q?.trim() || undefined,
      status: opts.status || undefined,
      severity: opts.severity || undefined,
      bird_id: opts.birdId || undefined,
      shed_id: opts.shedId || undefined,
      sick_from: opts.sickFrom || undefined,
      sick_to: opts.sickTo || undefined,
      follow_up_from: opts.followUpFrom || undefined,
      follow_up_to: opts.followUpTo || undefined,
      follow_up_state: opts.followUpState || undefined,
      include_inactive: opts.includeInactive ?? false,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    },
  });
  return data;
}

export async function getSicknessSummary(opts?: {
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<SicknessSummary> {
  const { data } = await api.get<SicknessSummary>("/sickness/summary", {
    params: {
      from_date: opts?.fromDate || undefined,
      to_date: opts?.toDate || undefined,
    },
  });
  return data;
}

export async function getBirdSicknessHistory(birdId: string): Promise<SicknessHistory> {
  const { data } = await api.get<SicknessHistory>(`/birds/${birdId}/sickness-history`);
  return data;
}

export async function recoverSickness(
  recordId: string,
  input: SicknessRecoverInput,
): Promise<SicknessRecord> {
  const { data } = await api.post<SicknessRecord>(`/sickness/${recordId}/recover`, input);
  return data;
}

export async function updateSickness(
  recordId: string,
  input: SicknessUpdateInput,
): Promise<SicknessRecord> {
  const { data } = await api.patch<SicknessRecord>(`/sickness/${recordId}`, input);
  return data;
}
