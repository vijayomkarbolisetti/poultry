/**
 * Run: npx --yes tsx src/features/auth/accountSettingsHelpers.test.ts
 */
import { profileInitials, validatePasswordChange, validateUsername } from "./accountSettingsHelpers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(profileInitials(null) === "?", "empty initials");
assert(profileInitials("Gopi") === "G", "single-name initial");
assert(profileInitials("Farm Owner") === "FO", "two-word initials");

assert(validateUsername("") === "Username is required.", "empty username");
assert(validateUsername("   ") === "Username is required.", "whitespace username");
assert(validateUsername("A".repeat(256)) === "Username is too long.", "long username");
assert(validateUsername("Farm Owner") === null, "valid username");

assert(
  validatePasswordChange({ currentPassword: "", newPassword: "password123", confirmPassword: "password123" }) ===
    "Current password is required.",
  "missing current",
);
assert(
  validatePasswordChange({ currentPassword: "old", newPassword: "short", confirmPassword: "short" }) ===
    "New password must be at least 8 characters.",
  "short new",
);
assert(
  validatePasswordChange({
    currentPassword: "old",
    newPassword: "password123",
    confirmPassword: "password124",
  }) === "New password and confirmation do not match.",
  "mismatch",
);
assert(
  validatePasswordChange({
    currentPassword: "old",
    newPassword: "password123",
    confirmPassword: "password123",
  }) === null,
  "valid passwords",
);

console.log("accountSettingsHelpers.test.ts OK");
