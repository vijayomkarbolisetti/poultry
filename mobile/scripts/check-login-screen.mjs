/**
 * Static checks for redesigned login screen (no Jest runner in this package).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
  console.error("check-login-screen FAIL:", msg);
  process.exit(1);
};

const loginPath = path.join(root, "app/(auth)/login.tsx");
const tokensPath = path.join(root, "src/theme/tokens.ts");
const bgPath = path.join(root, "assets/loginbackround.png");
const logoSvg = path.join(root, "assets/brand-logo.svg");

const login = fs.readFileSync(loginPath, "utf8");
const tokens = fs.readFileSync(tokensPath, "utf8");

if (!fs.existsSync(bgPath)) fail("missing assets/loginbackround.png");
if (!fs.existsSync(logoSvg)) fail("missing assets/brand-logo.svg");
if (!login.includes('require("../../assets/loginbackround.png")')) {
  fail("login must require assets/loginbackround.png");
}
if (login.includes("login_background.png")) fail("stale login_background.png reference");
for (const needle of [
  "Farm health, made simple.",
  "Smarter Farms. Healthier Flocks.",
  "Sign In",
  "Create Farm Account",
  "Contact Admin",
  "Remember me",
  "Forgot password?",
]) {
  if (!login.includes(needle)) fail(`missing copy: ${needle}`);
}
if (!login.includes("acceptSession") || !login.includes("login(values)")) {
  fail("auth wiring must call login() + acceptSession");
}
for (const color of ["#047857", "#0F766E", "#064E3B", "#022C22"]) {
  if (!tokens.includes(color)) fail(`tokens missing ${color}`);
}
if (!tokens.includes('surfaceTranslucent: "rgba(255, 255, 255, 0.86)"')) {
  fail("login card opacity 0.86 missing");
}
if (!tokens.includes('inputBg: "rgba(255, 255, 255, 0.96)"')) {
  fail("input opacity 0.96 missing");
}

const deleted = ["assets/logo 1.svg", "assets/login_background.png", "assets/loginbackround.png.png"];
for (const rel of deleted) {
  if (fs.existsSync(path.join(root, rel))) fail(`expected deleted: ${rel}`);
}

console.log("check-login-screen: ok");
