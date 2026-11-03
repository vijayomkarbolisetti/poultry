/**
 * Helpers for Add/Edit/Remove vaccine against a farm catalogue (stable-id upsert + soft-remove).
 */

import type {
  CatalogueItem,
  CatalogueItemInput,
  CataloguePreviewUpdate,
} from "../../api/catalogues";

export type VaccineDraft = {
  name: string;
  disease: string;
  ageDays: string;
  dose: string;
  route: string;
  diluent: string;
  notes: string;
};

export function parseAgeDays(ageDays: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = ageDays.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { ok: false, error: "Recommended age must be a whole number of days (0 = hatch day)." };
  }
  return { ok: true, value: n };
}

export function validateVaccineDraft(draft: VaccineDraft): string | null {
  if (!draft.name.trim()) return "Enter a vaccine name.";
  const age = parseAgeDays(draft.ageDays);
  if (!age.ok) return age.error;
  return null;
}

/** Map an existing catalogue row for upsert; preserves stable `id` when present. */
export function mapExistingItem(row: CatalogueItem): CatalogueItemInput {
  const base: CatalogueItemInput = {
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
      display_day_label: r.display_day_label,
      repeat_interval_days: r.repeat_interval_days,
      max_repeats: r.max_repeats,
      grace_period_days: r.grace_period_days,
      reminder_lead_days: r.reminder_lead_days,
      is_manual_only: r.is_manual_only,
      label: r.label,
    })),
  };
  if (row.id) base.id = row.id;
  return base;
}

export function vaccineDraftToItemInput(
  draft: VaccineDraft,
  sortOrder = 0,
): CatalogueItemInput | { error: string } {
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

/** Replace one existing item by id with draft values; all rows keep stable ids. */
export function itemsAfterEdit(
  existing: CatalogueItem[],
  itemId: string,
  draft: VaccineDraft,
): CatalogueItemInput[] | { error: string } {
  const age = parseAgeDays(draft.ageDays);
  if (!age.ok) return { error: age.error };
  if (!draft.name.trim()) return { error: "Enter a vaccine name." };

  return existing.map((row) => {
    const base = mapExistingItem(row);
    if (row.id !== itemId) return base;
    const rules =
      base.rules && base.rules.length
        ? base.rules.map((r, idx) =>
            idx === 0 ? { ...r, target_age_days: age.value, dose_number: r.dose_number ?? 1 } : r,
          )
        : [{ dose_number: 1, target_age_days: age.value }];
    return {
      ...base,
      id: row.id,
      name: draft.name.trim(),
      disease_label: draft.disease.trim() || null,
      recommended_dose_text: draft.dose.trim() || null,
      route: draft.route.trim() || null,
      diluent_instructions: draft.diluent.trim() || null,
      instructions: draft.notes.trim() || null,
      rules,
    };
  });
}

/** Append a new vaccine item (no id) while preserving existing item ids. */
export function itemsAfterAdd(
  existing: CatalogueItem[],
  draft: VaccineDraft,
): CatalogueItemInput[] | { error: string } {
  const nextOrder =
    existing.reduce((max, row) => Math.max(max, row.sort_order ?? 0), -1) + 1;
  const item = vaccineDraftToItemInput(draft, nextOrder);
  if ("error" in item) return item;
  return [...existing.map(mapExistingItem), item];
}

export function formatCataloguePreviewImpact(preview: CataloguePreviewUpdate): string {
  const lines: string[] = [];
  if (preview.items_added.length) {
    lines.push(`Add: ${preview.items_added.join(", ")}`);
  }
  if (preview.items_updated.length) {
    lines.push(`Update ${preview.items_updated.length} vaccine${preview.items_updated.length === 1 ? "" : "s"}`);
  }
  if (preview.rule_changes.length) {
    lines.push(`Rule changes: ${preview.rule_changes.length}`);
  }
  if (preview.items_removed.length) {
    lines.push(`Remove ${preview.items_removed.length} vaccine${preview.items_removed.length === 1 ? "" : "s"}`);
  }
  lines.push(`Open doses linked to this programme: ${preview.open_doses_eligible_for_change}`);
  lines.push(`Completed vaccination events kept: ${preview.completed_event_count}`);
  lines.push(
    preview.is_farm_default
      ? `Farm default · ${preview.inheriting_flock_count_if_default} inheriting flock(s)`
      : "Not the farm default",
  );
  if (preview.expected_override_flock_count > 0) {
    lines.push(`Override flocks using this catalogue: ${preview.expected_override_flock_count}`);
  }
  lines.push("Scope: new flocks only (existing flock schedules are not regenerated).");
  if (preview.warning?.trim()) lines.push(preview.warning.trim());
  return lines.join("\n");
}
