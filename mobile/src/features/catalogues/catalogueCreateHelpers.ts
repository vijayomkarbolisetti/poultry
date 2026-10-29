/**
 * Client helpers for Create Catalogue — mirrors backend `_normalize_code` rules.
 * Create accepts an optional first vaccine item in the same POST body.
 */

import type { CatalogueItemInput } from "../../api/catalogues";
import {
  type VaccineDraft,
  validateVaccineDraft,
  vaccineDraftToItemInput,
} from "./catalogueItemEditHelpers";

export function suggestCatalogueCode(name: string): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 64);
}

export function validateCatalogueCreateDraft(input: {
  name: string;
  code: string;
}): string | null {
  const name = input.name.trim();
  if (!name) return "Name is required.";
  if (name.length > 255) return "Name must be 255 characters or fewer.";
  const rawCode = input.code.trim();
  if (!rawCode) return "Code is required.";
  const code = suggestCatalogueCode(rawCode);
  if (!code) return "Code must use letters, numbers, or underscores.";
  return null;
}

/** Validate catalogue metadata + first vaccine for the combined create flow. */
export function validateCatalogueCreateWithVaccine(input: {
  name: string;
  code: string;
  vaccine: VaccineDraft;
}): string | null {
  const catErr = validateCatalogueCreateDraft(input);
  if (catErr) return catErr;
  return validateVaccineDraft(input.vaccine);
}

export function catalogueCreatePayload(input: {
  name: string;
  code: string;
  description?: string;
  vaccine?: VaccineDraft;
}):
  | { code: string; name: string; description: string | null; items: CatalogueItemInput[] }
  | { error: string } {
  const catErr = validateCatalogueCreateDraft(input);
  if (catErr) return { error: catErr };

  const name = input.name.trim();
  const code = suggestCatalogueCode(input.code.trim());
  const description = input.description?.trim() || null;

  if (!input.vaccine) {
    return { code, name, description, items: [] };
  }

  const item = vaccineDraftToItemInput(input.vaccine, 0);
  if ("error" in item) return { error: item.error };
  return { code, name, description, items: [item] };
}
