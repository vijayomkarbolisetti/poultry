/**
 * Run: npx --yes tsx src/features/sheds/shedFilterHelpers.test.ts
 */
import {
  ALL_SHEDS_ID,
  ALL_SHEDS_LABEL,
  buildShedFilterOptions,
  filterShedOptions,
  shedFilterLabel,
} from "./shedFilterHelpers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sheds = [
  { id: "s1", name: "North barn" },
  { id: "s2", name: "South Barn" },
  { id: "s3", name: "Quarantine" },
];

const options = buildShedFilterOptions(sheds);

assert(options[0]?.id === ALL_SHEDS_ID, "All sheds is first");
assert(options[0]?.label === ALL_SHEDS_LABEL, "All sheds label");
assert(options.length === 4, "all option plus three sheds");

assert(filterShedOptions(options, "").length === 4, "empty query keeps full list");
assert(filterShedOptions(options, "   ").length === 4, "whitespace query keeps full list");

const barn = filterShedOptions(options, "BARN");
assert(barn.length === 2, "case-insensitive barn match");
assert(
  barn.every((o) => o.label.toLowerCase().includes("barn")),
  "barn results are name matches",
);

const allHit = filterShedOptions(options, "all");
assert(allHit.length === 1 && allHit[0]?.id === ALL_SHEDS_ID, "All sheds matches search");

assert(filterShedOptions(options, "xyz").length === 0, "empty when nothing matches");

assert(shedFilterLabel(options, "all") === ALL_SHEDS_LABEL, "label for all");
assert(shedFilterLabel(options, "s2") === "South Barn", "label for selected shed");
assert(shedFilterLabel(options, "missing") === ALL_SHEDS_LABEL, "fallback label");

console.log("shedFilterHelpers.test.ts OK");
