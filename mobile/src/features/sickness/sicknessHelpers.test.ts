/**
 * Run: npx --yes tsx src/features/sickness/sicknessHelpers.test.ts
 */
import {
  buildSicknessPayload,
  canRecoverEpisode,
  followUpLabel,
  followUpState,
  formatSymptomsSummary,
  healthStatusForBird,
  healthStatusLabel,
  severityLabel,
  sortSicknessEpisodes,
  validateSicknessForm,
} from "./sicknessHelpers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const today = "2026-11-07";

assert(severityLabel("moderate") === "Moderate", "severity label");
assert(followUpLabel("overdue") === "Overdue", "follow-up label");

assert(followUpState(null, today) === "none", "no follow-up");
assert(followUpState("2026-11-06", today) === "overdue", "overdue follow-up");
assert(followUpState("2026-11-07", today) === "due", "due today");
assert(followUpState("2026-11-14", today) === "due", "due within seven days");
assert(followUpState("2026-11-15", today) === "upcoming", "future follow-up");

assert(
  healthStatusForBird({ isActive: true, lifecycleStatus: "active", hasActiveEpisode: true }) ===
    "sick",
  "active sick bird",
);
assert(
  healthStatusForBird({ isActive: true, lifecycleStatus: "active", hasActiveEpisode: false }) ===
    "healthy",
  "active healthy bird",
);
assert(
  healthStatusForBird({ isActive: false, lifecycleStatus: "dead", hasActiveEpisode: true }) ===
    "unresolved_inactive",
  "dead bird with open episode is unresolved",
);
assert(
  healthStatusForBird({ isActive: false, lifecycleStatus: "sold", hasActiveEpisode: false }) ===
    "not_applicable",
  "sold bird without episode is not applicable",
);
assert(
  healthStatusLabel("unresolved_inactive", "dead").includes("Unresolved"),
  "unresolved label",
);

assert(
  validateSicknessForm(
    { sickDate: "", symptoms: "x", severity: "mild", followUpDate: null },
    today,
  ) === "Sick date is required.",
  "sick date required",
);
assert(
  validateSicknessForm(
    { sickDate: "2026-11-08", symptoms: "x", severity: "mild", followUpDate: null },
    today,
  ) === "Sick date cannot be in the future.",
  "future sick date",
);
assert(
  validateSicknessForm(
    { sickDate: today, symptoms: "  ", severity: "mild", followUpDate: null },
    today,
  ) === "Symptoms and observations are required.",
  "symptoms required",
);
assert(
  validateSicknessForm(
    { sickDate: today, symptoms: "x", severity: "", followUpDate: null },
    today,
  ) === "Select a severity.",
  "severity required",
);
assert(
  validateSicknessForm(
    { sickDate: today, symptoms: "x", severity: "mild", followUpDate: "2026-11-06" },
    today,
  ) === "Follow-up date must be on or after the sick date.",
  "follow-up order",
);
assert(
  validateSicknessForm(
    { sickDate: today, symptoms: "x", severity: "moderate", followUpDate: "2026-11-09" },
    today,
  ) === null,
  "valid form",
);

const payload = buildSicknessPayload(
  { sickDate: today, symptoms: "  Coughing  ", severity: "severe", followUpDate: null },
  { idempotencyKey: "sick-1" },
);
assert(payload.symptoms === "Coughing", "payload trims symptoms");
assert(payload.severity === "severe", "payload severity");
assert(payload.follow_up_date === null, "payload no follow-up");
assert(payload.idempotency_key === "sick-1", "payload idempotency");

assert(formatSymptomsSummary("  a   b  ").length === 3, "symptom whitespace normalize");
assert(formatSymptomsSummary("x".repeat(120), 20).endsWith("…"), "symptom truncation");

const episodes = [
  { sick_date: "2026-11-01", created_at: "2026-11-01T10:00:00Z" },
  { sick_date: "2026-11-07", created_at: "2026-11-07T09:00:00Z" },
  { sick_date: "2026-11-07", created_at: "2026-11-07T11:00:00Z" },
];
const sorted = sortSicknessEpisodes(episodes);
assert(sorted[0].created_at.endsWith("11:00:00Z"), "newest episode first");
assert(sorted[2].sick_date === "2026-11-01", "oldest episode last");

assert(
  canRecoverEpisode({ status: "active" }, true) === true,
  "active episode on active bird can recover",
);
assert(
  canRecoverEpisode({ status: "active" }, false) === false,
  "dead bird cannot recover",
);
assert(
  canRecoverEpisode({ status: "recovered" }, true) === false,
  "recovered episode cannot recover again",
);

console.log("sicknessHelpers.test.ts OK");
