"""Buyer-facing lifecycle labels and shed-move detail formatting (no PDF deps)."""

from __future__ import annotations

import re
from uuid import UUID

from app.models.enums import BirdLifecycleStatus
from app.schemas.flock import BirdProfileLifecycleOut

_SHED_MOVE_TAG = re.compile(r"^\[shed-move(?:-batch)?\]\s*", re.IGNORECASE)
_FROM_TO_IN_REASON = re.compile(
    r"^\s*From\s+(.+?)\s+to\s+(.+?)(?:\s*[·•|\-]\s*(.*))?$",
    re.IGNORECASE | re.DOTALL,
)
_GENERIC_DEST_NOTE = re.compile(
    r"^(?:transferred(?:\s+\d+\s+unbanded)?\s+to\s+destination(?:\s+shed)?|"
    r"moved\s+\d+\s+birds?\s+to\s+destination(?:\s+shed)?)\.?$",
    re.IGNORECASE,
)


def _enum_value(value: object) -> str:
    if value is None:
        return ""
    if hasattr(value, "value"):
        return str(getattr(value, "value"))
    return str(value)


def format_lifecycle_label(status: object) -> str:
    """Map BirdLifecycleStatus / event types to customer-facing labels."""
    raw = _enum_value(status).lower().strip()
    mapping = {
        BirdLifecycleStatus.active.value: "Active",
        BirdLifecycleStatus.dead.value: "Dead",
        BirdLifecycleStatus.sold.value: "Sold",
        BirdLifecycleStatus.transferred_out.value: "Transferred out",
        BirdLifecycleStatus.inactive.value: "Inactive",
        "mortality": "Mortality",
        "sale": "Sale",
        "transfer": "Transfer",
        "registration": "Registration",
        "intake": "Intake",
        "onboarding": "Record created",
        "adjustment": "Adjustment",
        "band_assignment": "Band assigned",
        "count_adjustment": "Count adjustment",
        "flock_closure": "Batch closed",
    }
    if raw in mapping:
        return mapping[raw]
    return raw.replace("_", " ").strip().title() or "Not recorded"


def strip_internal_lifecycle_tags(reason: str) -> str:
    text = (reason or "").strip()
    text = _SHED_MOVE_TAG.sub("", text).strip()
    text = re.sub(
        r"^\[band-from-unbanded\]\s*", "Band assigned: ", text, flags=re.IGNORECASE
    ).strip()
    return text


def format_lifecycle_detail(ev: BirdProfileLifecycleOut) -> str:
    """Buyer-facing details for ownership/transfer rows (no internal tags)."""
    raw_reason = (ev.reason or "").strip()
    cleaned = strip_internal_lifecycle_tags(raw_reason)
    is_shed_move = bool(_SHED_MOVE_TAG.match(raw_reason))

    from_name = (ev.from_shed_name or "").strip() or None
    to_name = (ev.to_shed_name or "").strip() or None
    user_note: str | None = None

    parsed = _FROM_TO_IN_REASON.match(cleaned) if cleaned else None
    if parsed:
        from_name = from_name or parsed.group(1).strip()
        to_name = to_name or parsed.group(2).strip()
        user_note = (parsed.group(3) or "").strip() or None
    elif cleaned and not _GENERIC_DEST_NOTE.match(cleaned):
        user_note = cleaned

    bits: list[str] = []
    if from_name and to_name:
        bits.append(f"From {from_name} to {to_name}")
    elif is_shed_move and to_name:
        bits.append(f"Transferred to {to_name}")
    elif is_shed_move and from_name:
        bits.append(f"Transferred from {from_name}")
    elif user_note:
        bits.append(user_note)
        user_note = None

    if user_note and user_note.lower() not in {b.lower() for b in bits}:
        bits.append(user_note)
    if ev.buyer_name:
        bits.append(f"Buyer {ev.buyer_name}")
    if ev.buyer_mobile:
        bits.append(f"Mobile {ev.buyer_mobile}")
    if ev.quantity and ev.quantity != 1:
        bits.append(f"Qty {ev.quantity}")
    return " · ".join(bits) if bits else "—"


def enrich_lifecycle_shed_names(
    events: list[BirdProfileLifecycleOut],
    shed_names: dict[UUID, str],
) -> list[BirdProfileLifecycleOut]:
    """Infer from/to shed labels for shed-move transfer rows (chronological walk)."""
    chron = sorted(events, key=lambda e: (e.effective_date, e.created_at, str(e.id)))
    known_shed_id: UUID | None = None
    enriched_by_id: dict[UUID, BirdProfileLifecycleOut] = {}
    for ev in chron:
        from_name = ev.from_shed_name
        to_name = ev.to_shed_name
        reason = (ev.reason or "").strip()
        is_shed_move = bool(_SHED_MOVE_TAG.match(reason))
        if is_shed_move:
            if not to_name and ev.shed_id:
                to_name = shed_names.get(ev.shed_id)
            if not from_name and known_shed_id:
                from_name = shed_names.get(known_shed_id)
            if not from_name or not to_name:
                cleaned = strip_internal_lifecycle_tags(reason)
                parsed = _FROM_TO_IN_REASON.match(cleaned)
                if parsed:
                    from_name = from_name or parsed.group(1).strip()
                    to_name = to_name or parsed.group(2).strip()
            if ev.shed_id:
                known_shed_id = ev.shed_id
        elif ev.shed_id:
            known_shed_id = ev.shed_id
        enriched_by_id[ev.id] = ev.model_copy(
            update={"from_shed_name": from_name, "to_shed_name": to_name}
        )
    return [enriched_by_id.get(ev.id, ev) for ev in events]
