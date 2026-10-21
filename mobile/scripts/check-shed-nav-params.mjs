/**
 * Ensures shed list opens detail/edit with explicit Expo Router params objects
 * (string template paths can drop [id] on hidden tab screens).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "app/(app)/sheds/index.tsx");
const detailPath = path.join(root, "app/(app)/sheds/[id].tsx");
const indexSrc = fs.readFileSync(indexPath, "utf8");
const detailSrc = fs.readFileSync(detailPath, "utf8");

const badListPush = /router\.push\(`\/\(app\)\/sheds\/\$\{/;
if (badListPush.test(indexSrc)) {
  console.error("check-shed-nav-params: FAIL — list still uses string path for sheds/[id]");
  process.exit(1);
}
if (!indexSrc.includes('pathname: "/(app)/sheds/[id]"')) {
  console.error("check-shed-nav-params: FAIL — missing explicit detail params push");
  process.exit(1);
}
if (!detailSrc.includes("overviewPending") && !detailSrc.includes("isPending")) {
  console.error("check-shed-nav-params: FAIL — detail missing pending-gate for false not-found");
  process.exit(1);
}
console.log("check-shed-nav-params: ok");
