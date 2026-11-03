/**
 * Pure helpers for Change / Assign band number.
 * Run: node mobile/src/features/birds/__tests__/bandChangeHelpers.node-test.mjs
 */
import assert from "node:assert/strict";

function normalizeBand(raw) {
  return raw.trim();
}

function isUnbanded(bandId) {
  return !normalizeBand(bandId ?? "");
}

function bandChangeScreenTitle(hadBand) {
  return hadBand ? "Change band number" : "Assign band number";
}

function bandChangeSaveLabel(opts) {
  if (opts.bandDirty || !opts.detailsDirty) return "Save band number";
  return "Save bird details";
}

function bandsEqual(a, b) {
  return normalizeBand(a ?? "") === normalizeBand(b ?? "");
}

function validateBandNumber(raw) {
  const band = raw.trim();
  if (!band) return "Enter a band number";
  if (band.length > 64) return "Band number must be 64 characters or fewer";
  return null;
}

function findBandConflict(items, birdId, candidateBand) {
  const want = normalizeBand(candidateBand).toLowerCase();
  if (!want) return null;
  for (const hit of items) {
    if (hit.id === birdId) continue;
    if (!hit.is_active) continue;
    const band = (hit.band_id ?? "").trim().toLowerCase();
    if (band === want) return hit;
  }
  return null;
}

function evaluateLocalBandState(opts) {
  const band = normalizeBand(opts.draft);
  if (!band) return "idle";
  if (bandsEqual(band, opts.original)) return "unchanged";
  const err = validateBandNumber(band);
  if (err) return "invalid";
  return "idle";
}

function canSaveBandChange(opts) {
  if (opts.busy) return false;
  if (opts.availability === "taken" || opts.availability === "checking") return false;

  const band = normalizeBand(opts.draft);
  const bandDirty = !bandsEqual(band, opts.original);
  if (!bandDirty && !opts.detailsDirty) return false;
  if (bandDirty) {
    if (!band) return false;
    if (validateBandNumber(band)) return false;
    if (opts.availability === "invalid") return false;
  }
  return true;
}

assert.equal(isUnbanded(null), true);
assert.equal(isUnbanded("  "), true);
assert.equal(isUnbanded("67A"), false);

assert.equal(bandChangeScreenTitle(false), "Assign band number");
assert.equal(bandChangeScreenTitle(true), "Change band number");

assert.equal(
  bandChangeSaveLabel({ hadBand: true, bandDirty: true, detailsDirty: false }),
  "Save band number",
);
assert.equal(
  bandChangeSaveLabel({ hadBand: true, bandDirty: false, detailsDirty: true }),
  "Save bird details",
);

assert.equal(bandsEqual("67A", " 67A "), true);
assert.equal(bandsEqual("67A", "67B"), false);

assert.equal(evaluateLocalBandState({ draft: "", original: "67A" }), "idle");
assert.equal(evaluateLocalBandState({ draft: "67A", original: "67A" }), "unchanged");
assert.equal(evaluateLocalBandState({ draft: "A".repeat(65), original: "67A" }), "invalid");
assert.equal(evaluateLocalBandState({ draft: "68B", original: "67A" }), "idle");

const conflict = findBandConflict(
  [
    { id: "self", band_id: "68B", is_active: true, match_kind: "exact" },
    { id: "other", band_id: "68B", is_active: true, match_kind: "exact" },
  ],
  "self",
  "68B",
);
assert.equal(conflict?.id, "other");
assert.equal(
  findBandConflict(
    [{ id: "self", band_id: "68B", is_active: true, match_kind: "exact" }],
    "self",
    "68B",
  ),
  null,
);

assert.equal(
  canSaveBandChange({
    draft: "67A",
    original: "67A",
    detailsDirty: false,
    availability: "unchanged",
    busy: false,
  }),
  false,
);
assert.equal(
  canSaveBandChange({
    draft: "68B",
    original: "67A",
    detailsDirty: false,
    availability: "available",
    busy: false,
  }),
  true,
);
assert.equal(
  canSaveBandChange({
    draft: "68B",
    original: "67A",
    detailsDirty: false,
    availability: "taken",
    busy: false,
  }),
  false,
);
assert.equal(
  canSaveBandChange({
    draft: "",
    original: "",
    detailsDirty: true,
    availability: "idle",
    busy: false,
  }),
  true,
);
assert.equal(
  canSaveBandChange({
    draft: "NEW1",
    original: "",
    detailsDirty: false,
    availability: "available",
    busy: false,
  }),
  true,
);

console.log("bandChangeHelpers.node-test.mjs: ok");
