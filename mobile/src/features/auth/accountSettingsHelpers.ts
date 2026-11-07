/** Client-side checks for Settings username + password forms. Never log secrets. */

export function profileInitials(name: string | undefined | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Username is required.";
  if (name.length > 255) return "Username is too long.";
  return null;
}

export function validatePasswordChange(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): string | null {
  if (!input.currentPassword) return "Current password is required.";
  if (input.newPassword.length < 8) return "New password must be at least 8 characters.";
  if (input.newPassword.length > 128) return "New password is too long.";
  if (input.newPassword !== input.confirmPassword) {
    return "New password and confirmation do not match.";
  }
  return null;
}
