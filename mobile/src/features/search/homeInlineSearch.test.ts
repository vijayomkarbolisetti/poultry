/**
 * Pure checks for Home inline search helpers + session restore.
 * Run: npx --yes tsx src/features/search/homeInlineSearch.test.ts
 */
import {
  birdSubtitle,
  classifyGlobalSearch,
  isSearchQueryActive,
  MIN_QUERY_LENGTH,
  normalizeSearchQuery,
  placeholderForQuery,
  shedSubtitle,
} from "./globalSearchHelpers";
import {
  clearHomeSearchDraft,
  getHomeSearchDraft,
  setHomeSearchDraft,
} from "./homeSearchSession";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Empty query → idle (dashboard visible)
assert(
  classifyGlobalSearch({
    query: "",
    loading: false,
    fetchError: false,
    birdTotal: 0,
    batchTotal: 0,
    shedTotal: 0,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: false,
  }) === "idle",
  "empty query should be idle",
);

assert(
  classifyGlobalSearch({
    query: "a",
    loading: false,
    fetchError: false,
    birdTotal: 0,
    batchTotal: 0,
    shedTotal: 0,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: false,
  }) === "too_short",
  "short query",
);

assert(
  classifyGlobalSearch({
    query: "va",
    loading: true,
    fetchError: false,
    birdTotal: 0,
    batchTotal: 0,
    shedTotal: 0,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: false,
  }) === "loading",
  "loading",
);

assert(
  classifyGlobalSearch({
    query: "vax",
    loading: false,
    fetchError: false,
    birdTotal: 0,
    batchTotal: 0,
    shedTotal: 0,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: true,
  }) === "empty",
  "empty results",
);

assert(
  classifyGlobalSearch({
    query: "vax",
    loading: false,
    fetchError: false,
    birdTotal: 2,
    batchTotal: 0,
    shedTotal: 1,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: true,
  }) === "results",
  "results",
);

assert(
  classifyGlobalSearch({
    query: "vax",
    loading: false,
    fetchError: true,
    birdTotal: 0,
    batchTotal: 0,
    shedTotal: 0,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: false,
  }) === "error",
  "fetch error",
);

assert(MIN_QUERY_LENGTH === 2, "min length");
assert(normalizeSearchQuery("  hello   world ") === "hello world", "normalize");

assert(isSearchQueryActive("") === false, "empty query is inactive");
assert(isSearchQueryActive(" a ") === false, "short query is inactive");
assert(isSearchQueryActive(" ab ") === true, "trimmed query is active");
assert(isSearchQueryActive("ab", 3) === false, "custom min length is respected");

const prior = { query: "vax", birds: { total: 1 } };
assert(placeholderForQuery(prior, "vax") === prior, "matching query keeps prior data");
assert(placeholderForQuery(prior, "other") === undefined, "different query drops prior data");
assert(placeholderForQuery(undefined, "vax") === undefined, "no prior data stays undefined");

const birdSub = birdSubtitle({
  breed: "Aseel",
  batch_code: "B1",
  shed_name: "Vax Shed A",
  shed_code: "VAX-A",
  is_active: false,
  lifecycle_status: "sold",
});
assert(birdSub.includes("Vax Shed A"), `shed in subtitle: ${birdSub}`);
assert(birdSub.toLowerCase().includes("sold"), `lifecycle in subtitle: ${birdSub}`);

const shedSub = shedSubtitle(
  {
    organization_name: "Vax QA Farm",
    code: "VAX-A",
    manager_names: [],
    total_live_birds: 12,
    is_active: true,
  },
  { includeFarm: true },
);
assert(shedSub.includes("Vax QA Farm"), `farm in shed: ${shedSub}`);
assert(!shedSub.includes("VAX-A"), `no shed code in subtitle: ${shedSub}`);
assert(shedSub.includes("Active"), `status in shed: ${shedSub}`);

const shedSubPlain = shedSubtitle({
  organization_name: "Vax QA Farm",
  code: "VAX-A",
  manager_names: [],
  total_live_birds: 12,
  is_active: true,
});
assert(!shedSubPlain.includes("Vax QA Farm"), `farm omitted outside Home: ${shedSubPlain}`);
assert(!shedSubPlain.includes("VAX-A"), `no shed code outside Home: ${shedSubPlain}`);

clearHomeSearchDraft();
assert(getHomeSearchDraft() === "", "cleared");
setHomeSearchDraft("1222");
assert(getHomeSearchDraft() === "1222", "session persist");
clearHomeSearchDraft();
assert(getHomeSearchDraft() === "", "cleared again");

// Clearing query restores idle/dashboard path
assert(normalizeSearchQuery("") === "", "clear query empty");
assert(
  classifyGlobalSearch({
    query: "",
    loading: false,
    fetchError: false,
    birdTotal: 5,
    batchTotal: 0,
    shedTotal: 2,
    birdError: null,
    batchError: null,
    shedError: null,
    anySection: true,
  }) === "idle",
  "clear restores idle even if prior totals exist",
);

// Home entry points must not depend on navigating to "/(app)/search" for empty drafts.
assert(normalizeSearchQuery("   ") === "", "whitespace-only query stays empty/dashboard");
assert(getHomeSearchDraft() === "", "session empty after clear");
setHomeSearchDraft("VAX");
assert(getHomeSearchDraft() === "VAX", "session persists while Home stays focused");
clearHomeSearchDraft();
assert(getHomeSearchDraft() === "", "session cleared when Home loses focus");

console.log("homeInlineSearch.test.ts OK");
