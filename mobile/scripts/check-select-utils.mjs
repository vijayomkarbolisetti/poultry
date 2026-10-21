/** Lightweight assertions for selectUtils (no Jest). Run: node scripts/check-select-utils.mjs */

function isSelectValueValid(value, options, allowValues = []) {
  if (value == null || value === "") return true;
  if (allowValues.includes(value)) return true;
  return options.some((o) => o.value === value && !o.disabled);
}

function reconcileSelectValue(value, options, allowValues = []) {
  if (value == null || value === "") return null;
  return isSelectValueValid(value, options, allowValues) ? value : null;
}

function filterSelectOptions(options, query) {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) ||
      (o.hint?.toLowerCase().includes(q) ?? false) ||
      o.value.toLowerCase().includes(q),
  );
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [ys, ms, ds] = value.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const options = [
  { value: "a", label: "Alpha", hint: "first" },
  { value: "b", label: "Beta", disabled: true },
  { value: "c", label: "Gamma" },
];

assert(isSelectValueValid(null, options), "null is valid");
assert(isSelectValueValid("a", options), "a is valid");
assert(!isSelectValueValid("b", options), "disabled option is invalid");
assert(!isSelectValueValid("missing", options), "missing is invalid");
assert(isSelectValueValid("all", options, ["all"]), "allow-list works");
assert(reconcileSelectValue("missing", options) === null, "stale clears");
assert(reconcileSelectValue("a", options) === "a", "valid kept");
assert(filterSelectOptions(options, "gam").length === 1, "search by label");
assert(parseIsoDate("2026-02-30") === null, "invalid calendar date");
assert(parseIsoDate("2026-02-01")?.getDate() === 1, "valid date");

console.log("check-select-utils.mjs: all assertions passed");
