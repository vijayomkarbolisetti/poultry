/**
 * Pure checks for the shared search-context lifecycle.
 * Run: npx --yes tsx src/features/search/searchLifecycle.test.ts
 */
import {
  buildSearchContextKey,
  shouldResetSearchContext,
} from "./searchLifecycle";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const farmA = buildSearchContextKey({ ownerAccountId: "farm-a", shedId: "shed-1" });
const farmAShed2 = buildSearchContextKey({ ownerAccountId: "farm-a", shedId: "shed-2" });
const farmB = buildSearchContextKey({ ownerAccountId: "farm-b", shedId: "shed-1" });
const userB = buildSearchContextKey({
  ownerAccountId: "farm-a",
  shedId: "shed-1",
  userId: "user-b",
});

assert(farmA !== farmAShed2, "shed change produces a new key");
assert(farmA !== farmB, "farm change produces a new key");
assert(farmA !== userB, "user change produces a new key");

assert(shouldResetSearchContext(farmA, farmA) === false, "same context does not reset");
assert(shouldResetSearchContext(farmA, farmB) === true, "different farm resets");
assert(shouldResetSearchContext(farmA, farmAShed2) === true, "different shed resets");
assert(shouldResetSearchContext(null, "farm-a") === true, "set context after unset resets");

console.log("searchLifecycle.test.ts OK");
