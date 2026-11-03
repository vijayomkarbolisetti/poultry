/**
 * Run: node mobile/src/features/catalogues/__tests__/catalogueDetailHelpers.node-test.mjs
 */
import assert from "node:assert/strict";

const NOT_SPECIFIED = "Not specified";

function isQaNoiseDescription(text) {
  const t = text?.trim().toLowerCase() ?? "";
  if (!t) return false;
  return (
    t.includes("for qa only") ||
    t.includes("illustrative") ||
    t.includes("not a veterinarian") ||
    t.includes("example only") ||
    t.includes("template only") ||
    t.includes("requires veterinary review") ||
    t.includes("not a veterinarian-approved")
  );
}

function primaryRule(item) {
  const rules = item.rules ?? [];
  const withAge = rules.filter((r) => r.target_age_days != null && Number.isFinite(r.target_age_days));
  if (withAge.length) {
    return withAge.reduce((best, r) =>
      r.target_age_days < best.target_age_days ? r : best,
    );
  }
  return rules[0] ?? null;
}

function itemTargetAgeDays(item) {
  const n = primaryRule(item)?.target_age_days;
  return n != null && Number.isFinite(n) ? n : null;
}

function sortScheduleItems(items) {
  return [...items].sort((a, b) => {
    const aa = itemTargetAgeDays(a);
    const bb = itemTargetAgeDays(b);
    if (aa != null && bb != null && aa !== bb) return aa - bb;
    if (aa != null && bb == null) return -1;
    if (aa == null && bb != null) return 1;
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

function dayBadgeParts(item) {
  const label = primaryRule(item)?.display_day_label?.trim();
  if (label) {
    const week = label.match(/^week\s+(.+)$/i);
    if (week) return { caption: "Wk", value: week[1].trim() };
    const day = label.match(/^day\s+(.+)$/i);
    if (day) {
      const rest = day[1].replace(/\(.*?\)/g, "").trim();
      return { caption: "Day", value: rest || "—" };
    }
    const m = label.match(/(\d+[–\-]\d+|\d+)/);
    if (m) return { caption: "Day", value: m[1] };
    return { caption: "Day", value: "—" };
  }
  const age = itemTargetAgeDays(item);
  if (age != null) return { caption: "Day", value: String(age) };
  return { caption: "Day", value: "—" };
}

function scheduleDiseaseLine(item) {
  return item.disease_label?.trim() || NOT_SPECIFIED;
}

function scheduleDoseRouteLine(item) {
  const dose = item.recommended_dose_text?.trim();
  const route = item.route?.trim();
  if (!dose && !route) return NOT_SPECIFIED;
  return `${dose || NOT_SPECIFIED} · ${route || NOT_SPECIFIED}`;
}

function scheduleTypeLine(item) {
  const desc = item.description?.trim();
  if (desc && !isQaNoiseDescription(desc)) return desc;
  const cat = item.category?.trim();
  if (!cat) return null;
  const lower = cat.toLowerCase();
  if (lower === "general" || lower === "vaccine" || lower === "vaccines") return null;
  return cat;
}

function catalogueHasQaNoise(items, catalogueDescription) {
  if (isQaNoiseDescription(catalogueDescription)) return true;
  return items.some((i) => isQaNoiseDescription(i.description));
}

const sorted = sortScheduleItems([
  { name: "B", rules: [{ target_age_days: 14 }] },
  { name: "A", rules: [{ target_age_days: 1 }] },
  { name: "C", rules: [{ target_age_days: null }] },
]);
assert.deepEqual(
  sorted.map((i) => i.name),
  ["A", "B", "C"],
);

assert.deepEqual(dayBadgeParts({ rules: [{ target_age_days: 7 }] }), { caption: "Day", value: "7" });
assert.deepEqual(
  dayBadgeParts({ rules: [{ target_age_days: 20 }, { target_age_days: 0 }] }),
  { caption: "Day", value: "0" },
);
assert.deepEqual(dayBadgeParts({ rules: [{ display_day_label: "Day 1 (hatch)", target_age_days: 0 }] }), {
  caption: "Day",
  value: "1",
});
assert.deepEqual(dayBadgeParts({ rules: [{ display_day_label: "Day 8–9", target_age_days: 7 }] }), {
  caption: "Day",
  value: "8–9",
});
assert.deepEqual(dayBadgeParts({ rules: [{ display_day_label: "Week 5–6", target_age_days: 34 }] }), {
  caption: "Wk",
  value: "5–6",
});
assert.deepEqual(
  sortScheduleItems([
    { name: "late", rules: [{ target_age_days: 20 }, { target_age_days: 0 }] },
    { name: "mid", rules: [{ target_age_days: 7 }] },
  ]).map((i) => i.name),
  ["late", "mid"],
);

assert.equal(scheduleDiseaseLine({ disease_label: "ND (example)" }), "ND (example)");
assert.equal(scheduleDiseaseLine({}), NOT_SPECIFIED);

assert.equal(scheduleDoseRouteLine({ recommended_dose_text: "0.2 ml", route: "IM" }), "0.2 ml · IM");
assert.equal(scheduleDoseRouteLine({ route: "IM" }), "Not specified · IM");
assert.equal(scheduleDoseRouteLine({ recommended_dose_text: "0.2 ml" }), "0.2 ml · Not specified");
assert.equal(scheduleDoseRouteLine({}), NOT_SPECIFIED);

assert.equal(scheduleTypeLine({ description: "Live vaccine" }), "Live vaccine");
assert.equal(scheduleTypeLine({ description: "Illustrative ND-style entry for QA only." }), null);
assert.equal(scheduleTypeLine({ category: "vaccine" }), null);
assert.equal(scheduleTypeLine({ category: "general" }), null);

assert.equal(
  catalogueHasQaNoise([{ description: "Illustrative IBD-style entry for QA only." }]),
  true,
);
assert.equal(catalogueHasQaNoise([{ description: "Live vaccine" }]), false);
assert.equal(
  catalogueHasQaNoise([], "Reference schedule — requires veterinary review before operational use."),
  true,
);

console.log("catalogueDetailHelpers.node-test.mjs: ok");
