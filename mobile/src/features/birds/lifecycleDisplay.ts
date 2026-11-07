import type { BirdProfileLifecycle } from "../../api/birds";

/**
 * Human details for a lifecycle row.
 * Shed names describe a transfer destination only; for onboarding, count
 * adjustment, mortality, etc. the event's own reason must win.
 */
export function lifecycleEventDetail(event: BirdProfileLifecycle): string {
  if (event.event_type === "transfer") {
    const fromName = event.from_shed_name?.trim();
    const toName = event.to_shed_name?.trim();
    if (fromName && toName) return `From ${fromName} to ${toName}`;
    if (toName) return `Transferred to ${toName}`;
    if (fromName) return `Transferred from ${fromName}`;
  }

  const raw = event.reason?.trim() ?? "";
  const cleaned = raw
    .replace(/^\[shed-move(?:-batch)?\]\s*/i, "")
    .replace(/^\[band-from-unbanded\]\s*/i, "Band assigned: ")
    .trim();
  if (cleaned) return cleaned;

  if (event.event_type === "sale") {
    return (
      [
        event.buyer_name ? `Buyer ${event.buyer_name}` : null,
        event.buyer_mobile ? `Mobile ${event.buyer_mobile}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Bird was sold"
    );
  }
  return "—";
}
