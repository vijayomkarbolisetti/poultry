/**
 * Run: node mobile/src/features/catalogues/__tests__/catalogueListHelpers.node-test.mjs
 */
import assert from "node:assert/strict";

// Inline copies matching catalogueListHelpers.ts (no TS transpile in node --test).
function catalogueAgeRangeLabel(items) {
  if (!items?.length) return null;
  const ages = [];
  for (const item of items) {
    for (const rule of item.rules ?? []) {
      const n = rule.target_age_days;
      if (n != null && Number.isFinite(n)) ages.push(n);
    }
  }
  if (!ages.length) return null;
  return `${Math.min(...ages)}–${Math.max(...ages)} days`;
}

function catalogueListMetaLine(itemCount, ageRange) {
  const count = Number.isFinite(itemCount) ? Math.max(0, itemCount) : 0;
  const vaccines = `${count} vaccine${count === 1 ? "" : "s"}`;
  if (ageRange?.trim()) return `${vaccines} · ${ageRange.trim()}`;
  return vaccines;
}

assert.equal(catalogueAgeRangeLabel(null), null);
assert.equal(catalogueAgeRangeLabel([]), null);
assert.equal(
  catalogueAgeRangeLabel([{ rules: [{ target_age_days: 0 }, { target_age_days: 120 }] }]),
  "0–120 days",
);
assert.equal(
  catalogueAgeRangeLabel([{ rules: [{ target_age_days: 7 }] }, { rules: [{ target_age_days: 20 }] }]),
  "7–20 days",
);
assert.equal(catalogueAgeRangeLabel([{ rules: [{ target_age_days: null }] }]), null);
assert.equal(catalogueListMetaLine(8, "0–120 days"), "8 vaccines · 0–120 days");
assert.equal(catalogueListMetaLine(1, null), "1 vaccine");
assert.equal(catalogueListMetaLine(2, ""), "2 vaccines");

console.log("catalogueListHelpers.node-test.mjs: ok");
