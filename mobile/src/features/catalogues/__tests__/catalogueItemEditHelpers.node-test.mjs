/**
 * Phase 4: stable-id upsert, soft-remove prep, preview impact formatting.
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
  const base = {
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

function itemsAfterEdit(existing, itemId, draft) {
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

function itemsAfterAdd(existing, draft) {
  const nextOrder = existing.reduce((max, row) => Math.max(max, row.sort_order ?? 0), -1) + 1;
  const item = vaccineDraftToItemInput(draft, nextOrder);
  if ("error" in item) return item;
  return [...existing.map(mapExistingItem), item];
}

function formatCataloguePreviewImpact(preview) {
  const lines = [];
  if (preview.items_added.length) {
    lines.push(`Add: ${preview.items_added.join(", ")}`);
  }
  if (preview.items_updated.length) {
    lines.push(
      `Update ${preview.items_updated.length} vaccine${preview.items_updated.length === 1 ? "" : "s"}`,
    );
  }
  if (preview.rule_changes.length) {
    lines.push(`Rule changes: ${preview.rule_changes.length}`);
  }
  if (preview.items_removed.length) {
    lines.push(
      `Remove ${preview.items_removed.length} vaccine${preview.items_removed.length === 1 ? "" : "s"}`,
    );
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

/** Soft-remove contract: PATCH remove_item_ids only (no items array). */
function softRemovePayload(itemId, preview) {
  return {
    remove_item_ids: [itemId],
    apply_scope: "new_flocks",
    confirm_change: true,
    expected_version: preview.catalogue_version,
    expected_assignment_catalogue_id: preview.expected_assignment_catalogue_id,
    expected_override_flock_count: preview.expected_override_flock_count,
  };
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
    rules: [
      {
        dose_number: 1,
        target_age_days: 7,
        display_day_label: null,
        repeat_interval_days: null,
        max_repeats: null,
        grace_period_days: 0,
        reminder_lead_days: 3,
        is_manual_only: false,
        label: null,
      },
    ],
  },
  {
    id: "b",
    sort_order: 1,
    name: "Keep",
    category: "vaccine",
    description: null,
    disease_label: "IBD",
    instructions: null,
    recommended_dose_text: null,
    route: null,
    diluent_instructions: null,
    rules: [
      {
        dose_number: 1,
        target_age_days: 14,
        display_day_label: null,
        repeat_interval_days: null,
        max_repeats: null,
        grace_period_days: 0,
        reminder_lead_days: 3,
        is_manual_only: false,
        label: null,
      },
    ],
  },
];

// Existing item IDs preserved; new item has no id
const added = itemsAfterAdd(existing, {
  name: "New Vax",
  disease: "IBD",
  ageDays: "14",
  dose: "0.2 ml",
  route: "IM",
  diluent: "sterile water",
  notes: "keep cold",
});
assert.equal(added.length, 3);
assert.equal(added[0].id, "a");
assert.equal(added[1].id, "b");
assert.equal(added[2].id, undefined);
assert.equal(added[2].name, "New Vax");
assert.equal(added[2].sort_order, 2);
assert.equal(added[2].rules[0].target_age_days, 14);

const edited = itemsAfterEdit(existing, "a", {
  name: "Renamed",
  disease: "ND",
  ageDays: "0",
  dose: "",
  route: "Eye drop",
  diluent: "",
  notes: "",
});
assert.equal(edited[0].id, "a");
assert.equal(edited[1].id, "b");
assert.equal(edited[0].name, "Renamed");
assert.equal(edited[0].rules[0].target_age_days, 0);
assert.equal(edited[0].route, "Eye drop");
assert.equal(edited[0].recommended_dose_text, null);
assert.equal(edited[0].rules[0].grace_period_days, 0);

assert.deepEqual(
  itemsAfterAdd([], {
    name: "",
    disease: "",
    ageDays: "",
    dose: "",
    route: "",
    diluent: "",
    notes: "",
  }),
  { error: "Enter a vaccine name." },
);

const preview = {
  items_added: ["Gamma"],
  items_updated: ["a"],
  items_removed: ["b"],
  rule_changes: [],
  open_doses_eligible_for_change: 2,
  completed_event_count: 1,
  is_farm_default: true,
  inheriting_flock_count_if_default: 4,
  expected_override_flock_count: 1,
  warning: "all_active flock application remains gated until product unlock.",
  catalogue_version: 3,
  expected_assignment_catalogue_id: "cat-1",
};
const impact = formatCataloguePreviewImpact(preview);
assert.match(impact, /Add: Gamma/);
assert.match(impact, /Update 1 vaccine/);
assert.match(impact, /Remove 1 vaccine/);
assert.match(impact, /new flocks only/i);
assert.match(impact, /all_active flock application remains gated/i);
assert.ok(!impact.toLowerCase().includes("apply to all active"));

const remove = softRemovePayload("b", preview);
assert.deepEqual(remove.remove_item_ids, ["b"]);
assert.equal(remove.apply_scope, "new_flocks");
assert.equal(remove.confirm_change, true);
assert.equal(remove.expected_version, 3);
assert.equal(remove.items, undefined);

console.log("catalogueItemEditHelpers.node-test.mjs: ok");
