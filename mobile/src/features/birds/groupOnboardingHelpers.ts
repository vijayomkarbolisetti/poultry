/**
 * Pure helpers for shed-centric bird group onboarding + tagging defaults.
 * Maps friendly UI age chips → API dob_confidence / age fields without inventing exact dates.
 */

export type AgeChipId =
  | "day-old"
  | "1-week"
  | "2-weeks"
  | "3-weeks"
  | "4-weeks"
  | "exact"
  | "unknown";

export type AgeChip = {
  id: AgeChipId;
  label: string;
};

export const AGE_CHIPS: AgeChip[] = [
  { id: "day-old", label: "Day-old" },
  { id: "1-week", label: "~ 1 week" },
  { id: "2-weeks", label: "~ 2 weeks" },
  { id: "3-weeks", label: "~ 3 weeks" },
  { id: "4-weeks", label: "~ 4 weeks" },
  { id: "exact", label: "Exact date" },
  { id: "unknown", label: "Unknown" },
];

const WEEK_DAYS: Record<Exclude<AgeChipId, "exact" | "unknown">, number> = {
  "day-old": 0,
  "1-week": 7,
  "2-weeks": 14,
  "3-weeks": 21,
  "4-weeks": 28,
};

export type MappedAgePayload = {
  dob_confidence: "exact" | "estimated" | "unknown";
  estimated_age_days: number | null;
  hatch_date: string | null;
  age_reported_on: string | null;
};

function todayIsoLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Map UI age chip → flock create age fields. Never invents hatch_date for week chips. */
export function mapAgeChipToPayload(
  chip: AgeChipId,
  exactHatchDate: string | null,
  reportedOn: Date = new Date(),
): MappedAgePayload {
  if (chip === "exact") {
    return {
      dob_confidence: "exact",
      estimated_age_days: null,
      hatch_date: exactHatchDate,
      age_reported_on: null,
    };
  }
  if (chip === "unknown") {
    return {
      dob_confidence: "unknown",
      estimated_age_days: null,
      hatch_date: null,
      age_reported_on: null,
    };
  }
  return {
    dob_confidence: "estimated",
    estimated_age_days: WEEK_DAYS[chip],
    hatch_date: null,
    age_reported_on: todayIsoLocal(reportedOn),
  };
}

export function validateAgeSelection(
  chip: AgeChipId | null,
  exactHatchDate: string | null,
): string | null {
  if (!chip) return "Select an approximate age";
  if (chip === "exact") {
    if (!exactHatchDate) return "Pick the hatch date";
    const today = todayIsoLocal();
    if (exactHatchDate > today) return "Hatch date cannot be in the future";
  }
  return null;
}

/** Max headcount aligned with practical farm limits (schema allows large ints). */
export const MAX_GROUP_COUNT = 100_000;

export function validateBirdCount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter how many birds are in this group";
  if (!/^\d+$/.test(trimmed)) return "Enter a whole number";
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return "Enter at least 1 bird";
  if (n > MAX_GROUP_COUNT) return `Maximum is ${MAX_GROUP_COUNT.toLocaleString()} birds`;
  return null;
}

export function validateGroupName(raw: string): string | null {
  const code = raw.trim();
  if (!code) return "Group name is required";
  if (code.length > 64) return "Group name must be 64 characters or fewer";
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(code)) {
    return "Use letters, numbers, dots, dashes, or underscores";
  }
  return null;
}

/** Suggested batch_code from shed code + local calendar date. */
export function suggestGroupName(shedCode: string, date = new Date()): string {
  const code = (shedCode || "SHED").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "SHED";
  return `${code}-${todayIsoLocal(date)}`;
}

export type ActiveBatchLike = {
  id: string;
  status: string;
  batch_code: string;
  current_count?: number;
  banded_count?: number;
  unbanded_count?: number;
  tracking_mode?: string;
};

/** Prefer single active batch; otherwise null (caller must ask). */
export function resolveTagBatchId(batches: ActiveBatchLike[], preferredId?: string | null): string | null {
  const active = batches.filter((b) => b.status === "active");
  if (preferredId && active.some((b) => b.id === preferredId)) return preferredId;
  if (active.length === 1) return active[0].id;
  return null;
}

export function activeBatches(batches: ActiveBatchLike[]): ActiveBatchLike[] {
  return batches.filter((b) => b.status === "active");
}

export function validateBandNumber(raw: string): string | null {
  const band = raw.trim();
  if (!band) return "Enter a band number";
  if (band.length > 64) return "Band number must be 64 characters or fewer";
  return null;
}
