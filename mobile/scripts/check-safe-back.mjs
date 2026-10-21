import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layout = fs.readFileSync(path.join(root, "app/(app)/_layout.tsx"), "utf8");
const helper = fs.readFileSync(path.join(root, "src/navigation/safeBack.ts"), "utf8");
const search = fs.readFileSync(path.join(root, "app/(app)/birds/search.tsx"), "utf8");
const profile = fs.readFileSync(path.join(root, "app/(app)/birds/[id].tsx"), "utf8");

assert.match(helper, /canGoBack/);
assert.match(helper, /replace\(fallback\)/);
assert.match(layout, /safeBack/);
assert.doesNotMatch(layout, /onPress=\{\(\) => router\.back\(\)\}/);
assert.match(search, /Redirect|safeBack/);
assert.match(profile, /safeBack/);
assert.doesNotMatch(profile, /router\.back\(/);

console.log("check-safe-back: ok");
