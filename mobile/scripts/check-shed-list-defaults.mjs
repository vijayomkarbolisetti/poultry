/**
 * Guard: ShedCard / listSheds must tolerate missing manager_names (device crash).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexSrc = fs.readFileSync(path.join(root, "app/(app)/sheds/index.tsx"), "utf8");
const apiSrc = fs.readFileSync(path.join(root, "src/api/sheds.ts"), "utf8");

if (!indexSrc.includes("shedListDefaults") || !indexSrc.includes("manager_names ?? []")) {
  console.error("check-shed-list-defaults FAIL: ShedCard missing defensive defaults");
  process.exit(1);
}
if (!apiSrc.includes("normalizeShedListItem") || !apiSrc.includes("Array.isArray(row.manager_names)")) {
  console.error("check-shed-list-defaults FAIL: listSheds must normalize manager_names");
  process.exit(1);
}
if (!fs.existsSync(path.join(root, "src/navigation/routeParams.ts"))) {
  console.error("check-shed-list-defaults FAIL: missing routeParams helper");
  process.exit(1);
}
console.log("check-shed-list-defaults: ok");
