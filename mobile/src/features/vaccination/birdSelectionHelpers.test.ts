/**
 * Pure checks for vaccination bird-selection helpers.
 * Run: npx --yes tsx src/features/vaccination/birdSelectionHelpers.test.ts
 */
import {
  addBirdIds,
  filterBirdRows,
  matchesBirdQuery,
  pruneIneligibleSelection,
  toggleBirdSelection,
  type SelectableBirdRow,
} from "./birdSelectionHelpers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const rows: SelectableBirdRow[] = [
  { id: "1", band: "GF-1234", meta: "Asil · 28 days", status: "eligible" },
  { id: "2", band: "GF-5678", meta: "Kadaknath · 40 days", status: "eligible" },
  { id: "3", band: "GF-9999", meta: "Asil · 10 days", status: "vaccinated" },
];

assert(matchesBirdQuery(rows[0], "1234"), "band search");
assert(matchesBirdQuery(rows[0], "asil"), "meta search");
assert(!matchesBirdQuery(rows[0], "zzzz"), "no match");

const eligible = filterBirdRows(rows, {
  filter: "eligible",
  query: "",
  selectedIds: new Set(),
});
assert(eligible.length === 2, "eligible filter");

const searched = filterBirdRows(rows, {
  filter: "eligible",
  query: "5678",
  selectedIds: new Set(),
});
assert(searched.length === 1 && searched[0].id === "2", "search within eligible");

const selectedOnly = filterBirdRows(rows, {
  filter: "selected",
  query: "",
  selectedIds: new Set(["1", "3"]),
});
assert(selectedOnly.map((r) => r.id).join(",") === "1,3", "selected filter keeps both");

let sel = new Set<string>();
sel = toggleBirdSelection(sel, "1");
sel = toggleBirdSelection(sel, "1");
assert(sel.size === 0, "toggle off");
sel = addBirdIds(sel, ["1", "2", "1"]);
assert(sel.size === 2, "dedupe add");
sel = pruneIneligibleSelection(sel, new Set(["2"]));
assert(sel.size === 1 && sel.has("1"), "prune ineligible");

// Scale: 50 birds filter stays O(n) and returns expected counts
const many: SelectableBirdRow[] = Array.from({ length: 50 }, (_, i) => ({
  id: `b${i}`,
  band: `B-${String(i).padStart(4, "0")}`,
  meta: i % 2 === 0 ? "Asil" : "Kadaknath",
  status: i < 45 ? ("eligible" as const) : ("vaccinated" as const),
}));
const manyEligible = filterBirdRows(many, {
  filter: "eligible",
  query: "",
  selectedIds: new Set(),
});
assert(manyEligible.length === 45, "50-bird eligible count");
const emptySearch = filterBirdRows(many, {
  filter: "eligible",
  query: "NOPE",
  selectedIds: new Set(),
});
assert(emptySearch.length === 0, "empty search");

console.log("birdSelectionHelpers.test.ts OK");
