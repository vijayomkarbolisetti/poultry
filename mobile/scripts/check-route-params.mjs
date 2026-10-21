import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/navigation/routeParams.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const tmp = path.join(root, "scripts/_routeParams.tmp.mjs");
fs.writeFileSync(tmp, js);
try {
  const mod = await import(pathToFileURL(tmp).href);
  const { firstRouteParam } = mod;
  assert.equal(firstRouteParam("abc"), "abc");
  assert.equal(firstRouteParam(["abc", "def"]), "abc");
  assert.equal(firstRouteParam(["  ", "x"]), "x");
  assert.equal(firstRouteParam("  "), undefined);
  assert.equal(firstRouteParam(undefined), undefined);
  assert.equal(firstRouteParam(null), undefined);
  console.log("check-route-params: ok");
} finally {
  fs.unlinkSync(tmp);
}
