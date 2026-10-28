/**
 * Lightweight Node assertions for vaccination dashboard helpers.
 * Run: node mobile/src/features/vaccination/__tests__/dashboardHelpers.node-test.mjs
 */
import assert from "node:assert/strict";

function bucketForDose(dose) {
  const status = (dose.status || "").toLowerCase();
  if (
    status === "completed_on_time" ||
    status === "completed_late" ||
    status === "completed_timing_unknown"
  ) {
    return "completed";
  }
  if (dose.needs_review || status === "needs_review") return "needs_review";
  if (status === "overdue") return "overdue";
  if (status === "due_today") return "due_today";
  if (status === "upcoming" || status === "due_soon") return "upcoming";
  return null;
}

function remainingCount(eligible, completed) {
  const e = Number.isFinite(eligible) ? eligible : 0;
  const c = Number.isFinite(completed) ? completed : 0;
  return Math.max(0, e - Math.max(0, c));
}

function coveragePercent(eligible, completed) {
  const e = Number.isFinite(eligible) ? eligible : 0;
  const c = Math.max(0, Number.isFinite(completed) ? completed : 0);
  if (e <= 0) return c > 0 ? 100 : 0;
  return Math.min(100, Math.round((c / e) * 100));
}

function displayVaccineName(dose) {
  const name = dose.vaccine_name?.trim?.() || dose.vaccine_name;
  return (typeof name === "string" && name.trim()) || "Vaccine name unavailable";
}

function enrichDoseCards(doses) {
  const cards = [];
  for (const dose of doses) {
    const bucket = bucketForDose(dose);
    if (!bucket) continue;
    const remainingFinal =
      dose.remaining_count != null && Number.isFinite(dose.remaining_count)
        ? Math.max(0, dose.remaining_count)
        : remainingCount(dose.eligible_count, dose.completed_count);
    cards.push({
      ...dose,
      vaccine_name: displayVaccineName(dose),
      shed_name: dose.shed_name?.trim?.() || dose.shed_name || "Shed",
      flock_label: dose.flock_label?.trim?.() || dose.flock_label || "Population",
      remaining_count: remainingFinal,
      coverage_pct: coveragePercent(dose.eligible_count, dose.completed_count),
      bucket,
    });
  }
  return cards;
}

function needsAttentionCards(groups) {
  return [...groups.needs_review, ...groups.overdue, ...groups.due_today];
}

assert.equal(bucketForDose({ status: "overdue", needs_review: false }), "overdue");
assert.equal(bucketForDose({ status: "due_today", needs_review: false }), "due_today");
assert.equal(bucketForDose({ status: "due_soon", needs_review: false }), "upcoming");
assert.equal(bucketForDose({ status: "completed_on_time", needs_review: false }), "completed");
assert.equal(bucketForDose({ status: "completed_late", needs_review: true }), "completed");
assert.equal(bucketForDose({ status: "upcoming", needs_review: true }), "needs_review");
assert.equal(bucketForDose({ status: "inactive", needs_review: false }), null);

// Duplicate ND cards: completed must not stay in attention; overdue sibling stays overdue.
{
  const cards = enrichDoseCards([
    {
      id: "nd-done",
      shed_id: "s1",
      flock_id: "f1",
      vaccine_definition_id: "v1",
      dose_number: 1,
      due_date: "2026-10-24",
      status: "completed_late",
      eligible_count: 50,
      completed_count: 50,
      needs_review: true,
      vaccine_name: "ND",
      shed_name: "S5DeviceShed2",
      remaining_count: 0,
    },
    {
      id: "nd-open",
      shed_id: "s2",
      flock_id: "f2",
      vaccine_definition_id: "v1",
      dose_number: 1,
      due_date: "2026-10-24",
      status: "overdue",
      eligible_count: 50,
      completed_count: 0,
      needs_review: false,
      vaccine_name: "ND",
      shed_name: "OtherShed",
      remaining_count: 50,
    },
  ]);
  assert.equal(cards.find((c) => c.id === "nd-done")?.bucket, "completed");
  assert.equal(cards.find((c) => c.id === "nd-open")?.bucket, "overdue");
  const attention = needsAttentionCards({
    needs_review: cards.filter((c) => c.bucket === "needs_review"),
    overdue: cards.filter((c) => c.bucket === "overdue"),
    due_today: [],
    upcoming: [],
    completed: cards.filter((c) => c.bucket === "completed"),
  });
  assert.equal(attention.length, 1);
  assert.equal(attention[0].id, "nd-open");
}

assert.equal(remainingCount(63, 10), 53);
assert.equal(remainingCount(10, 10), 0);
assert.equal(remainingCount(5, 8), 0);
assert.equal(remainingCount(NaN, 2), 0);
assert.equal(coveragePercent(50, 0), 0);
assert.equal(coveragePercent(50, 25), 50);
assert.equal(coveragePercent(50, 50), 100);

assert.equal(displayVaccineName({}), "Vaccine name unavailable");
assert.equal(displayVaccineName({ vaccine_name: "  NDV  " }), "NDV");

const enriched = enrichDoseCards([
  {
    id: "d1",
    shed_id: "s1",
    flock_id: "f1",
    vaccine_definition_id: "v1",
    dose_number: 1,
    due_date: "2026-10-10",
    status: "overdue",
    eligible_count: 40,
    completed_count: 10,
    needs_review: false,
    vaccine_name: "Example ND",
    shed_name: "Shed A",
    flock_label: "Hatch-1",
    remaining_count: 30,
    banded_count: 5,
    unbanded_count: 35,
  },
  {
    id: "d2",
    shed_id: "s1",
    flock_id: "f1",
    vaccine_definition_id: "v2",
    dose_number: 1,
    due_date: "2026-11-01",
    status: "completed_on_time",
    eligible_count: 40,
    completed_count: 40,
    needs_review: false,
    vaccine_name: null,
  },
]);

assert.equal(enriched.length, 2);
assert.equal(enriched[0].vaccine_name, "Example ND");
assert.equal(enriched[0].remaining_count, 30);
assert.equal(enriched[0].coverage_pct, 25);
assert.equal(enriched[1].bucket, "completed");
assert.equal(enriched[1].vaccine_name, "Vaccine name unavailable");

const groups = {
  overdue: [enriched[0]],
  due_today: [],
  upcoming: [],
  needs_review: [],
  completed: [enriched[1]],
};
assert.equal(needsAttentionCards(groups).length, 1);

console.log("dashboardHelpers.node-test.mjs: ok");
