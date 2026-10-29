/**
 * Pure helpers for the Vaccination dashboard (Phase 2).
 * Status vocabulary matches backend `schedule_engine` (do not invent new statuses).
 */

export type DoseBucket =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "needs_review"
  | "completed";

export type ScheduledDoseLike = {
  id: string;
  shed_id: string;
  flock_id: string;
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

export type DoseCardModel = ScheduledDoseLike & {
  vaccine_name: string;
  shed_name: string;
  flock_label: string;
  remaining_count: number;
  coverage_pct: number;
  bucket: DoseBucket;
  banded_count: number | null;
  unbanded_count: number | null;
};

const OVERDUE = new Set(["overdue"]);
const DUE_TODAY = new Set(["due_today"]);
const UPCOMING = new Set(["upcoming", "due_soon"]);
const NEEDS_REVIEW = new Set(["needs_review"]);
const COMPLETED = new Set([
  "completed_on_time",
  "completed_late",
  "completed_timing_unknown",
]);

/** Map API status → dashboard bucket; inactive / skipped are excluded. */
export function bucketForDose(dose: {
  status: string;
  needs_review: boolean;
}): DoseBucket | null {
  const status = (dose.status || "").toLowerCase();
  // Completed statuses win over a stale needs_review flag on the row.
  if (COMPLETED.has(status)) return "completed";
  if (dose.needs_review || NEEDS_REVIEW.has(status)) return "needs_review";
  if (OVERDUE.has(status)) return "overdue";
  if (DUE_TODAY.has(status)) return "due_today";
  if (UPCOMING.has(status)) return "upcoming";
  return null;
}

export function remainingCount(eligible: number, completed: number): number {
  const e = Number.isFinite(eligible) ? eligible : 0;
  const c = Number.isFinite(completed) ? completed : 0;
  return Math.max(0, e - Math.max(0, c));
}

export function coveragePercent(eligible: number, completed: number): number {
  const e = Number.isFinite(eligible) ? eligible : 0;
  const c = Math.max(0, Number.isFinite(completed) ? completed : 0);
  if (e <= 0) return c > 0 ? 100 : 0;
  return Math.min(100, Math.round((c / e) * 100));
}

export function formatDueDateLabel(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate || "—";
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function statusBadgeLabel(bucket: DoseBucket): string {
  switch (bucket) {
    case "overdue":
      return "OVERDUE";
    case "due_today":
      return "DUE TODAY";
    case "upcoming":
      return "UPCOMING";
    case "needs_review":
      return "NEEDS REVIEW";
    case "completed":
      return "COMPLETED";
  }
}

/** Prefer server labels; never invent veterinary vaccine names. */
export function displayVaccineName(dose: ScheduledDoseLike): string {
  const name = dose.vaccine_name?.trim();
  return name || "Vaccine name unavailable";
}

export function displayShedName(dose: ScheduledDoseLike): string {
  return dose.shed_name?.trim() || "Shed";
}

export function displayFlockLabel(dose: ScheduledDoseLike): string {
  return dose.flock_label?.trim() || "Population";
}

export function enrichDoseCards(doses: ScheduledDoseLike[]): DoseCardModel[] {
  const cards: DoseCardModel[] = [];
  for (const dose of doses) {
    const bucket = bucketForDose(dose);
    if (!bucket) continue;
    // Prefer API remaining_count when present; recompute defensively otherwise.
    const remainingFinal =
      dose.remaining_count != null && Number.isFinite(dose.remaining_count)
        ? Math.max(0, dose.remaining_count)
        : remainingCount(dose.eligible_count, dose.completed_count);
    cards.push({
      ...dose,
      vaccine_name: displayVaccineName(dose),
      shed_name: displayShedName(dose),
      flock_label: displayFlockLabel(dose),
      remaining_count: remainingFinal,
      coverage_pct: coveragePercent(dose.eligible_count, dose.completed_count),
      bucket,
      banded_count: dose.banded_count ?? null,
      unbanded_count: dose.unbanded_count ?? null,
    });
  }
  cards.sort((a, b) => {
    const rank = (b: DoseBucket) =>
      b === "needs_review" ? 0 : b === "overdue" ? 1 : b === "due_today" ? 2 : b === "upcoming" ? 3 : 4;
    if (rank(a.bucket) !== rank(b.bucket)) return rank(a.bucket) - rank(b.bucket);
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return a.vaccine_name.localeCompare(b.vaccine_name);
  });
  return cards;
}

export function groupDoseCards(cards: DoseCardModel[]): Record<DoseBucket, DoseCardModel[]> {
  const groups: Record<DoseBucket, DoseCardModel[]> = {
    overdue: [],
    due_today: [],
    upcoming: [],
    needs_review: [],
    completed: [],
  };
  for (const card of cards) {
    groups[card.bucket].push(card);
  }
  return groups;
}

/** Overdue + due today + needs review — primary work queue. */
export function needsAttentionCards(groups: Record<DoseBucket, DoseCardModel[]>): DoseCardModel[] {
  return [...groups.needs_review, ...groups.overdue, ...groups.due_today];
}

export function summaryCounts(groups: Record<DoseBucket, DoseCardModel[]>): {
  overdue: number;
  dueToday: number;
  upcoming: number;
  needsReview: number;
  completed: number;
} {
  return {
    overdue: groups.overdue.length,
    dueToday: groups.due_today.length,
    upcoming: groups.upcoming.length,
    needsReview: groups.needs_review.length,
    completed: groups.completed.length,
  };
}

export const BUCKET_LABELS: Record<DoseBucket, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  needs_review: "Needs review",
  completed: "Completed",
};

/** Population coverage copy — never implies specific birds for flock-level doses. */
export function coverageLine(card: DoseCardModel): string {
  const covered = Math.max(0, card.completed_count || 0);
  const eligible = Math.max(0, card.eligible_count || 0);
  return `${covered} of ${eligible} vaccinated`;
}

export function remainingLine(card: DoseCardModel): string {
  const rem = Math.max(0, card.remaining_count ?? 0);
  return `${rem} remaining`;
}

export function populationHint(card: DoseCardModel): string | null {
  if (card.banded_count == null && card.unbanded_count == null) return null;
  const banded = card.banded_count ?? 0;
  const unbanded = card.unbanded_count ?? 0;
  if (banded === 0 && unbanded === 0) return null;
  return `Population: ${banded} banded · ${unbanded} unbanded`;
}

export type ShedOverviewRow = {
  shedId: string;
  shedName: string;
  overdue: number;
  dueToday: number;
  upcoming: number;
  needsReview: number;
};

/** Aggregate open-dose counts per shed for the owner multi-shed overview. */
export function shedOverviewFromCards(cards: DoseCardModel[]): ShedOverviewRow[] {
  const map = new Map<string, ShedOverviewRow>();
  for (const card of cards) {
    if (card.bucket === "completed") continue;
    const key = card.shed_id || card.shed_name;
    let row = map.get(key);
    if (!row) {
      row = {
        shedId: card.shed_id,
        shedName: card.shed_name,
        overdue: 0,
        dueToday: 0,
        upcoming: 0,
        needsReview: 0,
      };
      map.set(key, row);
    }
    if (card.bucket === "overdue") row.overdue += 1;
    else if (card.bucket === "due_today") row.dueToday += 1;
    else if (card.bucket === "upcoming") row.upcoming += 1;
    else if (card.bucket === "needs_review") row.needsReview += 1;
  }
  return [...map.values()].sort((a, b) => a.shedName.localeCompare(b.shedName));
}

/** Days past due (positive = overdue). Null when no usable due date. */
export function daysPastDue(isoDate: string | null | undefined, todayIso?: string): number | null {
  if (!isoDate || isoDate.length < 10) return null;
  const due = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const todayStr = todayIso && todayIso.length >= 10 ? todayIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayStr}T12:00:00`);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return diff;
}
