/**
 * Run: npx --yes tsx src/features/sickness/sicknessFilters.test.ts
 */
import {
  DEFAULT_SICKNESS_FILTERS,
  activeFilterCount,
  filtersAreActive,
} from "./sicknessFilters";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!filtersAreActive(DEFAULT_SICKNESS_FILTERS), "defaults are inactive");
assert(activeFilterCount(DEFAULT_SICKNESS_FILTERS) === 0, "default count");

assert(filtersAreActive({ ...DEFAULT_SICKNESS_FILTERS, severity: "severe" }), "severity active");
assert(filtersAreActive({ ...DEFAULT_SICKNESS_FILTERS, status: "active" }), "status active");
assert(
  filtersAreActive({ ...DEFAULT_SICKNESS_FILTERS, sickFrom: "2026-11-01" }),
  "date active",
);
assert(
  activeFilterCount({
    ...DEFAULT_SICKNESS_FILTERS,
    severity: "mild",
    status: "recovered",
    followUpState: "overdue",
  }) === 3,
  "filter count",
);

console.log("sicknessFilters.test.ts OK");
