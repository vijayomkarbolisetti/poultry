/**
 * Run: npx --yes tsx src/features/sheds/sumLiveBirds.test.ts
 */
import { sumLiveBirds } from "./sumLiveBirds";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(sumLiveBirds([]) === 0, "empty farm");
assert(sumLiveBirds([{ total_live_birds: 0 }]) === 0, "empty shed");
assert(sumLiveBirds([{ total_live_birds: 2 }]) === 2, "living only");
assert(
  sumLiveBirds([
    { total_live_birds: 2 },
    { total_live_birds: 5 },
  ]) === 7,
  "multi shed",
);
// Sold/dead are already excluded from total_live_birds — summing must not invent them.
assert(
  sumLiveBirds([
    { total_live_birds: 10 }, // e.g. 12 started − 1 sold − 1 mortality
  ]) === 10,
  "post sale/mortality aggregate",
);
assert(sumLiveBirds([{ total_live_birds: null }, { total_live_birds: 3 }]) === 3, "null safe");
assert(sumLiveBirds([{ total_live_birds: -1 }, { total_live_birds: 4 }]) === 4, "ignore negative");
assert(
  sumLiveBirds([
    { total_live_birds: 2 }, // banded
    { total_live_birds: 42 }, // unbanded cohort count
  ]) === 44,
  "banded + unbanded sheds",
);

console.log("sumLiveBirds.test.ts OK");
