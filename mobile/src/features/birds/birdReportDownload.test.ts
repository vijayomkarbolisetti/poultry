/**
 * Lightweight Node checks for report filename helpers.
 * Run: npx --yes tsx src/features/birds/birdReportDownload.test.ts
 */
import { buildBirdReportFilename, filenameFromContentDisposition } from "./birdReportFilename";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const name = buildBirdReportFilename("1222dsd", new Date("2026-10-28T12:00:00Z"));
assert(name === "bird-report-1222dsd-2026-10-28.pdf", `unexpected name: ${name}`);

const unsafe = buildBirdReportFilename('A/B\\C:D*?"<>|', new Date("2026-01-05T00:00:00Z"));
assert(unsafe.startsWith("bird-report-"), `prefix missing: ${unsafe}`);
assert(unsafe.endsWith(".pdf"), `extension missing: ${unsafe}`);
assert(!unsafe.includes("/") && !unsafe.includes("\\") && !unsafe.includes("*"), `unsafe chars: ${unsafe}`);

const empty = buildBirdReportFilename("   ", new Date("2026-03-01T00:00:00Z"));
assert(empty === "bird-report-unbanded-2026-03-01.pdf", `empty fallback: ${empty}`);

const fromHeader = filenameFromContentDisposition(
  'attachment; filename="bird-report-pdf-band-1-2026-10-28.pdf"',
  "fallback.pdf",
);
assert(fromHeader === "bird-report-pdf-band-1-2026-10-28.pdf", `cd parse: ${fromHeader}`);

console.log("birdReportDownload.test.ts OK");
