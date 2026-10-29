/**
 * Run: node mobile/src/features/catalogues/__tests__/catalogueItemEditHelpers.node-test.mjs
 */
import assert from "node:assert/strict";

function parseAgeDays(ageDays) {
  const trimmed = ageDays.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { ok: false, error: "Recommended age must be a whole number of days (0 = hatch day)." };
  }
  return { ok: true, value: n };
}

function mapExistingItem(row) {
  return {
    sort_order: row.sort_order,
    name: row.name,
    category: row.category,
    description: row.description,
    disease_label: row.disease_label,
    instructions: row.instructions,
    recommended_dose_text: row.recommended_dose_text,
    route: row.route,
    diluent_instructions: row.diluent_instructions,
    rules: (row.rules ?? []).map((r) => ({
      dose_number: r.dose_number,
      target_age_days: r.target_age_days,
    })),
  };
}

function draftToItemInput(draft, sortOrder, ageNum) {
  return {
    sort_order: sortOrder,
    name: draft.name.trim(),
    category: "vaccine",
    description: null,
    disease_label: draft.disease.trim() || null,
    instructions: draft.notes.trim() || null,
    recommended_dose_text: draft.dose.trim() || null,
    route: draft.route.trim() || null,
    diluent_instructions: draft.diluent.trim() || null,
    rules: [{ dose_number: 1, target_age_days: ageNum }],
  };
}

function itemsAfterAdd(existing, draft) {
  const age = parseAgeDays(draft.ageDays);
  if (!age.ok) return { error: age.error };
  if (!draft.name.trim()) return { error: "Enter a vaccine name." };
  const nextOrder = existing.reduce((max, row) => Math.max(max, row.sort_order ?? 0), -1) + 1;
  return [...existing.map(mapExistingItem), draftToItemInput(draft, nextOrder, age.value)];
}

function itemsAfterEdit(existing, itemId, draft) {
  const age = parseAgeDays(draft.ageDays);
  if (!age.ok) return { error: age.error };
  if (!draft.name.trim()) return { error: "Enter a vaccine name." };
  return existing.map((row) => {
    const base = mapExistingItem(row);
    if (row.id !== itemId) return base;
    return {
      ...base,
      name: draft.name.trim(),
      disease_label: draft.disease.trim() || null,
      recommended_dose_text: draft.dose.trim() || null,
      route: draft.route.trim() || null,
      diluent_instructions: draft.diluent.trim() || null,
      instructions: draft.notes.trim() || null,
      rules: [{ dose_number: 1, target_age_days: age.value }],
    };
  });
}

const existing = [
  {
    id: "a",
    sort_order: 0,
    name: "Old",
    category: "vaccine",
    description: null,
    disease_label: "ND",
    instructions: null,
    recommended_dose_text: null,
    route: null,
    diluent_instructions: null,
    rules: [{ dose_number: 1, target_age_days: 7 }],
  },
];

const added = itemsAfterAdd(existing, {
  name: "New Vax",
  disease: "IBD",
  ageDays: "14",
  dose: "0.2 ml",
  route: "IM",
  diluent: "sterile water",
  notes: "keep cold",
});
assert.equal(added.length, 2);
assert.equal(added[1].name, "New Vax");
assert.equal(added[1].sort_order, 1);
assert.equal(added[1].rules[0].target_age_days, 14);
assert.equal(added[1].recommended_dose_text, "0.2 ml");

const edited = itemsAfterEdit(existing, "a", {
  name: "Renamed",
  disease: "ND",
  ageDays: "0",
  dose: "",
  route: "Eye drop",
  diluent: "",
  notes: "",
});
assert.equal(edited[0].name, "Renamed");
assert.equal(edited[0].rules[0].target_age_days, 0);
assert.equal(edited[0].route, "Eye drop");
assert.equal(edited[0].recommended_dose_text, null);

assert.deepEqual(itemsAfterAdd([], { name: "", disease: "", ageDays: "", dose: "", route: "", diluent: "", notes: "" }), {
  error: "Enter a vaccine name.",
});
assert.equal(
  itemsAfterAdd([], { name: "X", disease: "", ageDays: "-1", dose: "", route: "", diluent: "", notes: "" }).error.includes("whole number"),
  true,
);

console.log("catalogueItemEditHelpers.node-test.mjs: ok");
