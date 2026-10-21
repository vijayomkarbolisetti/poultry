import { api } from "./client";

export async function listVaccines() {
  const { data } = await api.get("/vaccines");
  return data as { id: string; name: string; category: string; is_active: boolean }[];
}

export async function createVaccine(input: {
  name: string;
  category?: string;
  rules: { target_age_days?: number; repeat_interval_days?: number; max_repeats?: number; grace_period_days?: number; reminder_lead_days?: number }[];
}) {
  const { data } = await api.post("/vaccines", input);
  return data;
}

export async function generateSchedules(flockId: string, vaccineIds?: string[]) {
  const { data } = await api.post("/vaccines/generate-schedules", {
    flock_id: flockId,
    vaccine_definition_ids: vaccineIds,
  });
  return data as { id: string; due_date: string; status: string; dose_number: number; eligible_count: number; completed_count: number }[];
}

export async function listScheduledDoses(opts?: { flockId?: string; shedId?: string }) {
  const params: Record<string, string> = {};
  if (opts?.flockId) params.flock_id = opts.flockId;
  if (opts?.shedId) params.shed_id = opts.shedId;
  const { data } = await api.get("/vaccines/scheduled-doses", { params });
  return data as {
    id: string;
    shed_id: string;
    flock_id: string;
    due_date: string;
    status: string;
    dose_number: number;
    eligible_count: number;
    completed_count: number;
    vaccine_definition_id: string;
    needs_review?: boolean;
  }[];
}

export async function recordVaccination(input: Record<string, unknown>) {
  const { data } = await api.post("/vaccination-events", input);
  return data;
}

export async function listVaccinations(flockId?: string) {
  const { data } = await api.get("/vaccination-events", { params: flockId ? { flock_id: flockId } : {} });
  return data;
}

export async function fetchCompliance() {
  const { data } = await api.get("/reports/compliance");
  return data as {
    on_time: number;
    late: number;
    overdue: number;
    due_today: number;
    needs_review: number;
    compliance_numerator: number;
    compliance_denominator: number;
  };
}

export async function listNotifications() {
  const { data } = await api.get("/notifications");
  return data as { id: string; title: string; body: string; severity: string; is_read: boolean; alert_type: string }[];
}

export async function generateNotifications() {
  const { data } = await api.post("/notifications/generate");
  return data;
}

export async function markNotificationRead(id: string) {
  const { data } = await api.post(`/notifications/${id}/read`);
  return data;
}
