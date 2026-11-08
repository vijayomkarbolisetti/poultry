/**
 * Pure checks for searchable selectors and stale selection reconciliation.
 * Run: npx --yes tsx src/components/ui/selectUtils.test.ts
 */
import type { SelectOption } from "./SelectField";
import { filterSelectOptions, reconcileSelectValue } from "./selectUtils";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const options: SelectOption[] = [
  { value: "shed-a", label: "North Barn", hint: "Owner managed" },
  { value: "shed-b", label: "South Barn", hint: "Farmer managed" },
  { value: "shed-c", label: "Quarantine", disabled: true },
];

assert(filterSelectOptions(options, "").length === 3, "empty query keeps all options");
assert(filterSelectOptions(options, "   ").length === 3, "whitespace keeps all options");
assert(filterSelectOptions(options, "barn").length === 2, "label search is case-insensitive");
assert(filterSelectOptions(options, "farmer").length === 1, "hint search works");
assert(filterSelectOptions(options, "shed-a").length === 1, "value search works");
assert(filterSelectOptions(options, "zzz").length === 0, "no matches returns empty");

assert(reconcileSelectValue("shed-a", options) === "shed-a", "valid selection kept");
assert(reconcileSelectValue("shed-z", options) === null, "stale selection cleared");
assert(reconcileSelectValue("shed-c", options) === null, "disabled selection cleared");
assert(reconcileSelectValue("all", options, ["all"]) === "all", "allowed sentinel kept");
assert(reconcileSelectValue(null, options) === null, "null stays null");

console.log("selectUtils.test.ts OK");
