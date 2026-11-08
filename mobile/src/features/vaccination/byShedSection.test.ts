/**
 * Run: npx --yes tsx src/features/vaccination/byShedSection.test.ts
 */
import {
  byShedToggleLabel,
  hiddenByShedCount,
  shouldShowByShedToggle,
  visibleByShedRows,
} from "./byShedSection";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const eight = [1, 2, 3, 4, 5, 6, 7, 8];

assert(hiddenByShedCount(1) === 0, "1 shed hidden");
assert(hiddenByShedCount(3) === 0, "3 sheds hidden");
assert(hiddenByShedCount(4) === 1, "4 sheds hidden");
assert(hiddenByShedCount(8) === 5, "8 sheds hidden");

assert(!shouldShowByShedToggle(1), "no toggle for 1");
assert(!shouldShowByShedToggle(3), "no toggle for 3");
assert(shouldShowByShedToggle(4), "toggle for 4");
assert(shouldShowByShedToggle(8), "toggle for 8");

assert(visibleByShedRows(eight, false).join(",") === "1,2,3", "collapsed preview");
assert(visibleByShedRows(eight, true).length === 8, "expanded all");
assert(visibleByShedRows([1, 2, 3], false).join(",") === "1,2,3", "3 stays fully visible");
assert(visibleByShedRows([1], false).join(",") === "1", "1 stays fully visible");
assert(visibleByShedRows([1, 2, 3, 4], false).join(",") === "1,2,3", "4 collapsed");
assert(visibleByShedRows([1, 2, 3, 4], true).join(",") === "1,2,3,4", "4 expanded");

assert(byShedToggleLabel(5, false) === "View all (5)", "view all label");
assert(byShedToggleLabel(1, false) === "View all (1)", "view all one");
assert(byShedToggleLabel(5, true) === "Show less", "show less label");

console.log("byShedSection.test.ts OK");
