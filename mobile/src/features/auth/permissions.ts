import type { Membership, UserMe } from "../../api/auth";

/** Human labels for permission chips in owner UI. */
export const PERMISSION_LABELS: Record<string, { title: string; hint: string }> = {
  "shed.view": { title: "View sheds", hint: "See assigned sheds" },
  "shed.create": { title: "Create sheds", hint: "Add new sheds" },
  "shed.update": { title: "Update sheds", hint: "Edit shed details" },
  "farmer.manage": { title: "Manage farmers", hint: "Invite and edit farmers" },
  "flock.view": { title: "View shed birds", hint: "See birds and population in sheds" },
  "flock.create": { title: "Add shed birds", hint: "Add unbanded headcount in sheds" },
  "flock.update": { title: "Update shed birds", hint: "Adjust shed bird counts and details" },
  "bird.view": { title: "View birds", hint: "See bird records" },
  "bird.create": { title: "Add birds", hint: "Create / import birds" },
  "bird.update": { title: "Update birds", hint: "Edit bird records" },
  "report.view": { title: "View reports", hint: "Dashboard & compliance" },
  "lifecycle.record": { title: "Record lifecycle", hint: "Mortality / transfer events" },
  "media.view": { title: "View media", hint: "See uploaded photos" },
  "media.upload": { title: "Upload media", hint: "Attach photos" },
  "vaccination.view": { title: "View vaccinations", hint: "See due doses and schedule" },
  "vaccination.record": { title: "Record vaccinations", hint: "Mark doses as given" },
  "schedule.view": { title: "View catalogues", hint: "See vaccine catalogues and product guidance" },
  "schedule.manage": {
    title: "Manage catalogues",
    hint: "Create, clone, edit, and assign vaccine catalogues",
  },
};

export const FARMER_PERM_OPTIONS = [
  "shed.view",
  "shed.update",
  "flock.view",
  "flock.create",
  "flock.update",
  "bird.view",
  "bird.create",
  "report.view",
  "lifecycle.record",
  "vaccination.view",
  "vaccination.record",
  "schedule.view",
] as const;

export function activeMembership(user: UserMe | null, ownerAccountId: string | null): Membership | null {
  if (!user) return null;
  return user.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user.memberships[0] ?? null;
}

export function hasPermission(
  user: UserMe | null,
  ownerAccountId: string | null,
  code: string,
): boolean {
  if (!user) return false;
  if (user.is_platform_super_admin) return true;
  const m = activeMembership(user, ownerAccountId);
  if (!m) return false;
  if (m.role === "owner") return true;
  return (m.permission_codes ?? []).includes(code);
}
