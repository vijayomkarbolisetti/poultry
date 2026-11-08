import {
  compareIsoDates,
  formatIsoDate,
  parseIsoDate,
  todayIsoDate,
} from "../../components/ui/selectUtils";
import type {
  BirdHealthOverview,
  FollowUpState,
  SicknessCreateInput,
  SicknessEpisode,
  SicknessSeverity,
  SicknessStatus,
} from "../../api/sickness";

export const SEVERITY_OPTIONS = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

export const SEVERITY_LABELS: Record<SicknessSeverity, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

export function severityLabel(value: SicknessSeverity | string | null | undefined): string {
  if (!value) return "—";
  return SEVERITY_LABELS[value as SicknessSeverity] ?? String(value);
}

export function sicknessStatusLabel(value: SicknessStatus | string | null | undefined): string {
  if (value === "recovered") return "Recovered";
  if (value === "active") return "Active";
  return "—";
}

export function followUpLabel(value: FollowUpState | string | null | undefined): string {
  switch (value) {
    case "overdue":
      return "Overdue";
    case "due":
      return "Due soon";
    case "upcoming":
      return "Upcoming";
    default:
      return "No follow-up";
  }
}

function addDaysIso(iso: string, days: number): string {
  const parsed = parseIsoDate(iso) ?? new Date();
  parsed.setDate(parsed.getDate() + days);
  return formatIsoDate(parsed);
}

export function followUpState(
  followUpDate: string | null | undefined,
  today: string = todayIsoDate(),
): FollowUpState {
  if (!followUpDate) return "none";
  if (compareIsoDates(followUpDate, today) < 0) return "overdue";
  if (compareIsoDates(followUpDate, addDaysIso(today, 7)) <= 0) return "due";
  return "upcoming";
}

export type HealthStatus =
  | "sick"
  | "healthy"
  | "unresolved_inactive"
  | "not_applicable";

export function healthStatusForBird(input: {
  isActive: boolean;
  lifecycleStatus: string;
  hasActiveEpisode: boolean;
}): HealthStatus {
  const activeBird = input.isActive && input.lifecycleStatus === "active";
  if (activeBird) return input.hasActiveEpisode ? "sick" : "healthy";
  return input.hasActiveEpisode ? "unresolved_inactive" : "not_applicable";
}

export function healthStatusLabel(
  status: string,
  lifecycleStatus?: string | null,
): string {
  switch (status) {
    case "sick":
      return "Sick";
    case "healthy":
      return "Healthy";
    case "unresolved_inactive": {
      const birdState = lifecycleStatus?.replace(/_/g, " ") || "inactive";
      return `Unresolved — bird ${birdState}`;
    }
    case "not_applicable": {
      const birdState = lifecycleStatus?.replace(/_/g, " ") || "inactive";
      return `Not applicable — bird ${birdState}`;
    }
    default:
      return "—";
  }
}

export function healthOverviewStatus(
  overview: BirdHealthOverview | null | undefined,
): string {
  return overview?.status ?? "not_applicable";
}

export type SicknessFormValues = {
  sickDate: string;
  symptoms: string;
  severity: SicknessSeverity | "";
  followUpDate: string | null;
};

export function validateSicknessForm(
  values: SicknessFormValues,
  today: string = todayIsoDate(),
): string | null {
  if (!values.sickDate) return "Sick date is required.";
  if (compareIsoDates(values.sickDate, today) > 0) {
    return "Sick date cannot be in the future.";
  }
  if (!values.symptoms.trim()) return "Symptoms and observations are required.";
  if (!values.severity) return "Select a severity.";
  if (values.followUpDate && compareIsoDates(values.followUpDate, values.sickDate) < 0) {
    return "Follow-up date must be on or after the sick date.";
  }
  return null;
}

export function buildSicknessPayload(
  values: SicknessFormValues,
  extra: { idempotencyKey?: string | null } = {},
): SicknessCreateInput {
  return {
    sick_date: values.sickDate,
    symptoms: values.symptoms.trim(),
    severity: values.severity as SicknessSeverity,
    follow_up_date: values.followUpDate || null,
    idempotency_key: extra.idempotencyKey ?? null,
  };
}

export function formatSymptomsSummary(value: string | null | undefined, maxLength = 96): string {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "—";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function sortSicknessEpisodes<T extends Pick<SicknessEpisode, "sick_date" | "created_at">>(
  episodes: T[],
): T[] {
  return [...episodes].sort((a, b) => {
    const bySickDate = compareIsoDates(b.sick_date, a.sick_date);
    if (bySickDate !== 0) return bySickDate;
    return b.created_at.localeCompare(a.created_at);
  });
}

export function canRecoverEpisode(
  episode: Pick<SicknessEpisode, "status"> | null | undefined,
  birdIsActive: boolean,
): boolean {
  return Boolean(episode && episode.status === "active" && birdIsActive);
}
