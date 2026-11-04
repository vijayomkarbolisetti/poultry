/**
 * Run: npx --yes tsx src/features/birds/bandChangeHelpers.test.ts
 */
import type { BirdSearchHit } from "../../api/birds";
import {
  bandChangeSaveLabel,
  bandChangeScreenTitle,
  bandsEqual,
  canSaveBandChange,
  evaluateLocalBandState,
  findBandConflict,
  isUnbanded,
} from "./bandChangeHelpers";

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
};

const hits = (rows: { id: string; band_id: string; is_active: boolean; match_kind: string }[]) =>
  rows as unknown as BirdSearchHit[];

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
  hits([
    { id: "self", band_id: "68B", is_active: true, match_kind: "exact" },
    { id: "other", band_id: "68B", is_active: true, match_kind: "exact" },
  ]),
  "self",
  "68B",
);
assert.equal(conflict?.id, "other");
assert.equal(
  findBandConflict(
    hits([{ id: "self", band_id: "68B", is_active: true, match_kind: "exact" }]),
    "self",
    "68B",
  ),
  null,
);
// Inactive birds and case differences.
assert.equal(
  findBandConflict(
    hits([{ id: "old", band_id: "68b", is_active: false, match_kind: "exact" }]),
    "self",
    "68B",
  ),
  null,
);
assert.equal(
  findBandConflict(
    hits([{ id: "other", band_id: "68b", is_active: true, match_kind: "partial" }]),
    "self",
    " 68B ",
  )?.id,
  "other",
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

console.log("bandChangeHelpers.test.ts OK");
