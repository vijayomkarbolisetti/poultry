/**
 * Pure range helpers for bird list export.
 * Run: npx --yes tsx src/features/birds/birdListExport.test.ts
 */
import { exportPeriodRange } from "./birdListExportRanges";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Fixed "today" = 2026-11-03 → last month = Oct 1–31; last 3 months = Sep 1 – Nov 3
const today = new Date(2026, 10, 3);

const all = exportPeriodRange("all", today);
assert(all.from === null && all.to === null, "all time has no date bounds");

const lastMonth = exportPeriodRange("last_month", today);
assert(lastMonth.from === "2026-10-01", `last month from: ${lastMonth.from}`);
assert(lastMonth.to === "2026-10-31", `last month to: ${lastMonth.to}`);

const last3 = exportPeriodRange("last_3_months", today);
assert(last3.from === "2026-09-01", `last 3 from: ${last3.from}`);
assert(last3.to === "2026-11-03", `last 3 to: ${last3.to}`);

// January edge: last month is December of previous year
const jan = exportPeriodRange("last_month", new Date(2026, 0, 15));
assert(jan.from === "2025-12-01", `jan last month from: ${jan.from}`);
assert(jan.to === "2025-12-31", `jan last month to: ${jan.to}`);

console.log("birdListExport.test.ts OK");
