import type { FollowUpState, SicknessSeverity } from "../../api/sickness";

export type SicknessFilterState = {
  severity: SicknessSeverity | "";
  status: "active" | "recovered" | "";
  sickFrom: string | null;
  sickTo: string | null;
  followUpFrom: string | null;
  followUpTo: string | null;
  followUpState: FollowUpState | "";
};

export const DEFAULT_SICKNESS_FILTERS: SicknessFilterState = {
  severity: "",
  status: "",
  sickFrom: null,
  sickTo: null,
  followUpFrom: null,
  followUpTo: null,
  followUpState: "",
};

export function filtersAreActive(filters: SicknessFilterState): boolean {
  return Boolean(
    filters.severity ||
      filters.status ||
      filters.sickFrom ||
      filters.sickTo ||
      filters.followUpFrom ||
      filters.followUpTo ||
      filters.followUpState,
  );
}

export function activeFilterCount(filters: SicknessFilterState): number {
  return [
    filters.severity,
    filters.status,
    filters.sickFrom,
    filters.sickTo,
    filters.followUpFrom,
    filters.followUpTo,
    filters.followUpState,
  ].filter(Boolean).length;
}
