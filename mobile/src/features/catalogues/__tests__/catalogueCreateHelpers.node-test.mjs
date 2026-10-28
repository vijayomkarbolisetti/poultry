/**
 * Run: node mobile/src/features/catalogues/__tests__/catalogueCreateHelpers.node-test.mjs
 */
import assert from "node:assert/strict";

function suggestCatalogueCode(name) {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 64);
}

function validateCatalogueCreateDraft(input) {
  const name = input.name.trim();
  if (!name) return "Name is required.";
  if (name.length > 255) return "Name must be 255 characters or fewer.";
  const rawCode = input.code.trim();
  if (!rawCode) return "Code is required.";
  const code = suggestCatalogueCode(rawCode);
  if (!code) return "Code must use letters, numbers, or underscores.";
  return null;
}

function parseAgeDays(ageDays) {
  const trimmed = ageDays.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { ok: false, error: "Recommended age must be a whole number of days (0 = hatch day)." };
  }
  return { ok: true, value: n };
}

function validateVaccineDraft(draft) {
  if (!draft.name.trim()) return "Enter a vaccine name.";
  const age = parseAgeDays(draft.ageDays);
  if (!age.ok) return age.error;
  return null;
}

function vaccineDraftToItemInput(draft, sortOrder = 0) {
  const age = parseAgeDays(draft.ageDays);
  if (!age.ok) return { error: age.error };
  if (!draft.name.trim()) return { error: "Enter a vaccine name." };
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
    rules: [{ dose_number: 1, target_age_days: age.value }],
  };
}

function validateCatalogueCreateWithVaccine(input) {
  const catErr = validateCatalogueCreateDraft(input);
  if (catErr) return catErr;
  return validateVaccineDraft(input.vaccine);
}

function catalogueCreatePayload(input) {
  const catErr = validateCatalogueCreateDraft(input);
  if (catErr) return { error: catErr };
  const name = input.name.trim();
  const code = suggestCatalogueCode(input.code.trim());
  const description = input.description?.trim() || null;
  if (!input.vaccine) return { code, name, description, items: [] };
  const item = vaccineDraftToItemInput(input.vaccine, 0);
  if ("error" in item) return { error: item.error };
  return { code, name, description, items: [item] };
}

assert.equal(suggestCatalogueCode("Farm winter programme"), "FARM_WINTER_PROGRAMME");
assert.equal(validateCatalogueCreateDraft({ name: "", code: "" }), "Name is required.");
assert.equal(validateCatalogueCreateDraft({ name: "My Farm", code: "" }), "Code is required.");

const vaccine = {
  name: "Marek",
  disease: "MD",
  ageDays: "1",
  dose: "0.2 ml",
  route: "IM",
  diluent: "sterile",
  notes: "cold chain",
};
assert.equal(
  validateCatalogueCreateWithVaccine({ name: "My Farm", code: "MY_FARM", vaccine: { ...vaccine, name: "" } }),
  "Enter a vaccine name.",
);
assert.equal(validateCatalogueCreateWithVaccine({ name: "My Farm", code: "MY_FARM", vaccine }), null);

const payload = catalogueCreatePayload({
  name: " My Farm ",
  code: "my-farm",
  description: " notes ",
  vaccine,
});
assert.equal(payload.code, "MY_FARM");
assert.equal(payload.name, "My Farm");
assert.equal(payload.description, "notes");
assert.equal(payload.items.length, 1);
assert.equal(payload.items[0].name, "Marek");
assert.equal(payload.items[0].rules[0].target_age_days, 1);
assert.equal(payload.items[0].route, "IM");

console.log("catalogueCreateHelpers.node-test.mjs: ok");
