/**
 * Pure checks for the transient search lifecycle (Sold Birds / Dead Birds).
 * Run: npx --yes tsx src/features/search/transientSearch.test.ts
 */
import {
  clearedTransientSearch,
  EMPTY_TRANSIENT_SEARCH,
  isTransientSearchEmpty,
  normalizeTransientQuery,
  reduceTransientSearch,
} from "./transientSearch";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isTransientSearchEmpty("") === true, "empty query is empty");
assert(isTransientSearchEmpty("   ") === true, "whitespace query is empty");
assert(isTransientSearchEmpty(" ab ") === false, "non-empty query is active");
assert(normalizeTransientQuery("  ab  ") === "ab", "query is trimmed");

let state = reduceTransientSearch(EMPTY_TRANSIENT_SEARCH, {
  type: "query",
  value: " AB ",
});
assert(state.query === " AB " && state.debouncedQuery === "", "typing starts with no debounced value");

state = reduceTransientSearch(state, { type: "debounced", value: " AB " });
assert(state.debouncedQuery === "AB", "debounced value is normalized");

state = reduceTransientSearch(state, { type: "query", value: "   " });
assert(
  state.query === "   " && state.debouncedQuery === "",
  "emptying the query clears the debounced value immediately",
);

state = reduceTransientSearch(state, { type: "debounced", value: "AB" });
assert(state.debouncedQuery === "AB", "late debounce can set a value before clear");

state = reduceTransientSearch(state, { type: "clear" });
assert(
  state.query === "" && state.debouncedQuery === "",
  "blur/clear clears both visible and debounced values",
);

const cleared = clearedTransientSearch();
assert(cleared.query === "" && cleared.debouncedQuery === "", "cleared state is empty");

console.log("transientSearch.test.ts OK");
