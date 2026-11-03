/**
 * Pure helpers for the Change / Assign band number screen.
 * Keep band-only saves lean; optional bird details stay out of the primary path.
 */

import type { BirdSearchHit } from "../../api/birds";
import { validateBandNumber } from "./groupOnboardingHelpers";

export type BandAvailability =
  | "idle"
  | "unchanged"
  | "invalid"
  | "checking"
  | "available"
  | "taken";

export function normalizeBand(raw: string): string {
  return raw.trim();
}

export function isUnbanded(bandId: string | null | undefined): boolean {
  return !normalizeBand(bandId ?? "");
}

export function bandChangeScreenTitle(hadBand: boolean): string {
  return hadBand ? "Change band number" : "Assign band number";
}

export function bandChangeSaveLabel(opts: {
  hadBand: boolean;
  bandDirty: boolean;
  detailsDirty: boolean;
}): string {
  if (opts.bandDirty || !opts.detailsDirty) return "Save band number";
  return "Save bird details";
}

export function bandsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeBand(a ?? "") === normalizeBand(b ?? "");
}

/** Exact active conflict for a candidate band (excluding the bird being edited). */
export function findBandConflict(
  items: BirdSearchHit[],
  birdId: string,
  candidateBand: string,
): BirdSearchHit | null {
  const want = normalizeBand(candidateBand).toLowerCase();
  if (!want) return null;
  for (const hit of items) {
    if (hit.id === birdId) continue;
    if (!hit.is_active) continue;
    const band = (hit.band_id ?? "").trim().toLowerCase();
    if (band === want && hit.match_kind === "exact") return hit;
    // Search may mark near-matches as partial; still treat exact string equality as taken.
    if (band === want) return hit;
  }
  return null;
}

export function evaluateLocalBandState(opts: {
  draft: string;
  original: string | null | undefined;
}): Extract<BandAvailability, "idle" | "unchanged" | "invalid"> {
  const band = normalizeBand(opts.draft);
  if (!band) return "idle";
  if (bandsEqual(band, opts.original)) return "unchanged";
  const err = validateBandNumber(band);
  if (err) return "invalid";
  return "idle";
}

export function canSaveBandChange(opts: {
  draft: string;
  original: string | null | undefined;
  detailsDirty: boolean;
  availability: BandAvailability;
  busy: boolean;
}): boolean {
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
