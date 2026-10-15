import type { Membership, UserMe } from "../../api/auth";

/** Human labels for permission chips in owner UI. */
export const PERMISSION_LABELS: Record<string, { title: string; hint: string }> = {
  "shed.view": { title: "View sheds", hint: "See assigned sheds" },
  "shed.create": { title: "Create sheds", hint: "Add new sheds" },
  "shed.update": { title: "Update sheds", hint: "Edit shed details" },
  "farmer.manage": { title: "Manage farmers", hint: "Invite and edit farmers" },
  "flock.view": { title: "View flocks", hint: "See flocks / birds lists" },
  "flock.create": { title: "Create flocks", hint: "Onboard new flocks" },
  "flock.update": { title: "Update flocks", hint: "Edit flock details" },
  "bird.view": { title: "View birds", hint: "See bird records" },
  "bird.create": { title: "Add birds", hint: "Create / import birds" },
  "bird.update": { title: "Update birds", hint: "Edit bird records" },
  "vaccination.view": { title: "View tasks", hint: "See doses & schedules" },
  "vaccination.record": { title: "Record vaccination", hint: "Mark doses done" },
  "vaccination.correct": { title: "Correct vaccination", hint: "Fix past records" },
  "schedule.view": { title: "View vaccines", hint: "See vaccine catalogue" },
  "schedule.manage": { title: "Manage schedules", hint: "Create vaccines & generate doses" },
  "report.view": { title: "View reports", hint: "Dashboard & compliance" },
  "lifecycle.record": { title: "Record lifecycle", hint: "Mortality / transfer events" },
  "media.view": { title: "View media", hint: "See uploaded photos" },
  "media.upload": { title: "Upload media", hint: "Attach photos" },
};

export const FARMER_PERM_OPTIONS = [
  "shed.view",
  "shed.update",
  "flock.view",
  "flock.create",
  "flock.update",
  "bird.view",
  "bird.create",
  "vaccination.view",
  "vaccination.record",
  "schedule.view",
  "schedule.manage",
  "report.view",
  "lifecycle.record",
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
