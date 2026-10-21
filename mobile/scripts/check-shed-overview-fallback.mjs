/**
 * Ensures getShedOverview has a 404 → legacy compose fallback for servers
 * that expose GET /sheds/{id} but not /overview.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/api/sheds.ts"), "utf8");
for (const needle of ["legacyShedOverview", "isHttpNotFound", "/overview", "listAssignments"]) {
  if (!src.includes(needle)) {
    console.error("check-shed-overview-fallback: FAIL missing", needle);
    process.exit(1);
  }
}
if (!src.includes("return legacyShedOverview(id)")) {
  console.error("check-shed-overview-fallback: FAIL no 404 fallback call");
  process.exit(1);
}
console.log("check-shed-overview-fallback: ok");
