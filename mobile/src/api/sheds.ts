import { api } from "./client";

function isHttpNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 404;
}

export type Shed = {
  id: string;
  owner_account_id: string;
  name: string;
  code: string;
  location_notes: string | null;
  is_owner_managed: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** List card metadata — same population/vax rules as shed overview. */
export type ShedListItem = Shed & {
  organization_name: string | null;
  manager_names: string[];
  active_batch_count: number;
  total_live_birds: number;
  banded_birds: number;
  unbanded_birds: number;
  count_mismatch: boolean;
  overdue_tasks: number;
  due_today_tasks: number;
  upcoming_tasks: number;
  needs_review_tasks: number;
};

export type ShedAssignment = {
  id: string;
  shed_id: string;
  owner_membership_id: string;
  is_manager: boolean;
  is_active: boolean;
  farmer_name: string | null;
  farmer_email: string | null;
};

export type ShedDependencies = {
  shed_id: string;
  is_active: boolean;
  active_batch_count: number;
  closed_batch_count: number;
  total_live_birds: number;
  banded_birds: number;
  unbanded_birds: number;
  count_mismatch: boolean;
  open_dose_tasks: number;
  vaccination_event_count: number;
  active_assignment_count: number;
  can_deactivate: boolean;
  can_reactivate: boolean;
  note: string;
};

export type ShedOverviewBatch = {
  id: string;
  batch_code: string;
  breed: string | null;
  hatch_date: string | null;
  estimated_age_days: number | null;
  dob_confidence: "exact" | "estimated" | "unknown";
  current_count: number;
  banded_count: number;
  unbanded_count: number;
  tracking_mode: "batch" | "individual" | "mixed";
  status: "active" | "closed";
  count_mismatch: boolean;
  overdue_tasks: number;
  due_today_tasks: number;
  upcoming_tasks: number;
  needs_review_tasks: number;
};

export type ShedOverview = {
  shed: Shed;
  organization_name: string | null;
  assignments: ShedAssignment[];
  population: {
    total_live_birds: number;
    active_batch_count: number;
    banded_birds: number;
    unbanded_birds: number;
  };
  vaccination: {
    overdue: number;
    due_today: number;
    upcoming: number;
    needs_review: number;
  };
  batches: ShedOverviewBatch[];
};

function normalizeShedListItem(row: ShedListItem): ShedListItem {
  return {
    ...row,
    manager_names: Array.isArray(row.manager_names) ? row.manager_names : [],
    organization_name: row.organization_name ?? null,
    active_batch_count: row.active_batch_count ?? 0,
    total_live_birds: row.total_live_birds ?? 0,
    banded_birds: row.banded_birds ?? 0,
    unbanded_birds: row.unbanded_birds ?? 0,
    count_mismatch: Boolean(row.count_mismatch),
    overdue_tasks: row.overdue_tasks ?? 0,
    due_today_tasks: row.due_today_tasks ?? 0,
    upcoming_tasks: row.upcoming_tasks ?? 0,
    needs_review_tasks: row.needs_review_tasks ?? 0,
  };
}

export async function listSheds(opts?: { includeInactive?: boolean }): Promise<ShedListItem[]> {
  const { data } = await api.get<ShedListItem[]>("/sheds", {
    params: opts?.includeInactive ? { include_inactive: true } : undefined,
  });
  return (data ?? []).map(normalizeShedListItem);
}

export async function getShed(id: string): Promise<Shed> {
  const { data } = await api.get<Shed>(`/sheds/${id}`);
  return data;
}

/** Compose overview when the server has no GET /sheds/{id}/overview (older deploys). */
async function legacyShedOverview(id: string): Promise<ShedOverview> {
  const shed = await getShed(id);
  let assignments: ShedAssignment[] = [];
  try {
    assignments = await listAssignments(id);
  } catch {
    assignments = [];
  }
  let fromList: ShedListItem | undefined;
  try {
    const rows = await listSheds({ includeInactive: true });
    fromList = rows.find((r) => r.id === id);
  } catch {
    fromList = undefined;
  }
  return {
    shed,
    organization_name: fromList?.organization_name ?? null,
    assignments,
    population: {
      total_live_birds: fromList?.total_live_birds ?? 0,
      active_batch_count: fromList?.active_batch_count ?? 0,
      banded_birds: fromList?.banded_birds ?? 0,
      unbanded_birds: fromList?.unbanded_birds ?? 0,
    },
    vaccination: {
      overdue: fromList?.overdue_tasks ?? 0,
      due_today: fromList?.due_today_tasks ?? 0,
      upcoming: fromList?.upcoming_tasks ?? 0,
      needs_review: fromList?.needs_review_tasks ?? 0,
    },
    batches: [],
  };
}

export async function getShedOverview(id: string): Promise<ShedOverview> {
  try {
    const { data } = await api.get<ShedOverview>(`/sheds/${id}/overview`);
    return data;
  } catch (error) {
    // Production sslip OpenAPI currently omits /overview — fall back so detail is usable.
    if (!isHttpNotFound(error)) throw error;
    return legacyShedOverview(id);
  }
}

export async function getShedDependencies(id: string): Promise<ShedDependencies> {
  const { data } = await api.get<ShedDependencies>(`/sheds/${id}/dependencies`);
  return data;
}

export async function createShed(input: {
  name: string;
  code: string;
  location_notes?: string;
  is_owner_managed?: boolean;
  /** Required when is_owner_managed is false — farmer OwnerMembership id. */
  initial_farmer_membership_id?: string;
}): Promise<Shed> {
  const { data } = await api.post<Shed>("/sheds", input);
  return data;
}

export async function updateShed(
  id: string,
  input: Partial<{
    name: string;
    code: string;
    location_notes: string;
    is_owner_managed: boolean;
    is_active: boolean;
    initial_farmer_membership_id: string;
  }>,
): Promise<Shed> {
  const { data } = await api.patch<Shed>(`/sheds/${id}`, input);
  return data;
}

export async function deactivateShed(id: string): Promise<Shed> {
  const { data } = await api.post<Shed>(`/sheds/${id}/deactivate`);
  return data;
}

export async function reactivateShed(id: string): Promise<Shed> {
  const { data } = await api.post<Shed>(`/sheds/${id}/reactivate`);
  return data;
}

export async function listAssignments(shedId: string): Promise<ShedAssignment[]> {
  const { data } = await api.get<ShedAssignment[]>(`/sheds/${shedId}/assignments`);
  return data;
}

export async function assignFarmer(
  shedId: string,
  input: { owner_membership_id: string; is_manager?: boolean },
): Promise<ShedAssignment> {
  const { data } = await api.post<ShedAssignment>(`/sheds/${shedId}/assignments`, input);
  return data;
}

export async function unassignFarmer(shedId: string, assignmentId: string): Promise<void> {
  await api.delete(`/sheds/${shedId}/assignments/${assignmentId}`);
}
