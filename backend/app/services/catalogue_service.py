"""Farm vaccination programme (catalogue) assignment, ownership, and materialization."""

from __future__ import annotations

import re
from datetime import date
from uuid import UUID, uuid4

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.authorization.deps import AuthContext
from app.models.audit import AuditLog
from app.models.catalogue import (
    OwnerCatalogueAssignment,
    VaccineCatalogue,
    VaccineCatalogueItem,
    VaccineCatalogueItemRule,
)
from app.models.enums import FlockStatus
from app.models.flock import Flock
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import ScheduledDose, ScheduleRule, VaccineDefinition, VaccineScheduleVersion
from app.schemas.catalogue import (
    CatalogueAssignIn,
    CatalogueCloneIn,
    CatalogueCreateIn,
    CatalogueItemIn,
    CataloguePreviewUpdateIn,
    CatalogueUpdateIn,
)
from app.services import vaccine_service
from app.services.schedule_engine import farm_local_today


class CatalogueError(Exception):
    def __init__(self, message: str, code: str = "CATALOGUE_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def _normalize_code(code: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", code.strip().upper()).strip("_")
    if not cleaned:
        raise CatalogueError("Catalogue code is invalid", "INVALID_CODE")
    return cleaned[:64]


def is_platform_catalogue(cat: VaccineCatalogue) -> bool:
    return cat.owner_account_id is None


async def list_catalogues(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    include_inactive: bool = False,
) -> list[VaccineCatalogue]:
    """Platform catalogues plus catalogues owned by the active farm."""
    assert ctx.owner_account_id is not None
    stmt = (
        select(VaccineCatalogue)
        .where(
            or_(
                VaccineCatalogue.owner_account_id.is_(None),
                VaccineCatalogue.owner_account_id == ctx.owner_account_id,
            )
        )
        .order_by(VaccineCatalogue.owner_account_id.nullsfirst(), VaccineCatalogue.name)
    )
    if not include_inactive:
        stmt = stmt.where(VaccineCatalogue.status == "active")
    return list(await db.scalars(stmt))


async def get_catalogue(db: AsyncSession, catalogue_id: UUID) -> VaccineCatalogue | None:
    return await db.scalar(
        select(VaccineCatalogue)
        .where(VaccineCatalogue.id == catalogue_id)
        .options(
            selectinload(VaccineCatalogue.items).selectinload(VaccineCatalogueItem.rules),
        )
    )


async def get_catalogue_for_owner(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue_id: UUID,
    *,
    allow_platform: bool = True,
) -> VaccineCatalogue:
    assert ctx.owner_account_id is not None
    cat = await get_catalogue(db, catalogue_id)
    if not cat:
        raise CatalogueError("Catalogue not found", "NOT_FOUND")
    if is_platform_catalogue(cat):
        if not allow_platform:
            raise CatalogueError("Platform catalogues cannot be modified", "PLATFORM_IMMUTABLE")
        return cat
    if cat.owner_account_id != ctx.owner_account_id:
        raise CatalogueError("Catalogue not found", "NOT_FOUND")
    return cat


async def assert_catalogue_assignable(db: AsyncSession, ctx: AuthContext, catalogue_id: UUID) -> VaccineCatalogue:
    """Catalogue must be active platform or owned by this farm."""
    cat = await get_catalogue_for_owner(db, ctx, catalogue_id, allow_platform=True)
    if cat.status != "active":
        raise CatalogueError("Catalogue is not active", "INACTIVE")
    return cat


async def catalogue_item_counts(db: AsyncSession, catalogue_ids: list[UUID]) -> dict[UUID, int]:
    if not catalogue_ids:
        return {}
    rows = await db.execute(
        select(VaccineCatalogueItem.catalogue_id, func.count())
        .where(
            VaccineCatalogueItem.catalogue_id.in_(catalogue_ids),
            VaccineCatalogueItem.is_active.is_(True),
        )
        .group_by(VaccineCatalogueItem.catalogue_id)
    )
    return {cid: int(n) for cid, n in rows.all()}


async def assignment_fingerprint(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue_id: UUID,
) -> dict:
    """Tenant-scoped assignment + override counts for stale-preview checks."""
    assert ctx.owner_account_id is not None
    current = await current_assignment(db, ctx.owner_account_id)
    override_count = int(
        await db.scalar(
            select(func.count())
            .select_from(Flock)
            .where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
                Flock.vaccination_catalogue_id == catalogue_id,
            )
        )
        or 0
    )
    is_farm_default = bool(current and current.catalogue_id == catalogue_id)
    inheriting = 0
    if is_farm_default:
        inheriting = int(
            await db.scalar(
                select(func.count())
                .select_from(Flock)
                .where(
                    Flock.owner_account_id == ctx.owner_account_id,
                    Flock.status == FlockStatus.active,
                    Flock.vaccination_catalogue_id.is_(None),
                )
            )
            or 0
        )
    return {
        "expected_assignment_catalogue_id": current.catalogue_id if current else None,
        "expected_override_flock_count": override_count,
        "is_farm_default": is_farm_default,
        "inheriting_flock_count_if_default": inheriting,
    }


def _rules_signature(rules: list) -> list[tuple]:
    return sorted(
        (
            int(getattr(r, "dose_number", 1) or 1),
            getattr(r, "target_age_days", None),
            getattr(r, "repeat_interval_days", None),
            getattr(r, "max_repeats", None),
            int(getattr(r, "grace_period_days", 0) or 0),
            int(getattr(r, "reminder_lead_days", 3) or 3),
            bool(getattr(r, "is_manual_only", False)),
        )
        for r in (rules or [])
    )


def _item_impactful(body: CatalogueUpdateIn | CataloguePreviewUpdateIn) -> bool:
    return body.items is not None or bool(body.remove_item_ids)


async def current_assignment(db: AsyncSession, owner_account_id: UUID) -> OwnerCatalogueAssignment | None:
    return await db.scalar(
        select(OwnerCatalogueAssignment)
        .where(
            OwnerCatalogueAssignment.owner_account_id == owner_account_id,
            OwnerCatalogueAssignment.is_current.is_(True),
        )
        .options(selectinload(OwnerCatalogueAssignment.catalogue))
        .order_by(OwnerCatalogueAssignment.assigned_at.desc())
        .limit(1)
    )


async def resolve_effective_catalogue(
    db: AsyncSession,
    ctx: AuthContext,
    flock: Flock,
) -> VaccineCatalogue | None:
    """Flock override first; otherwise farm default assignment (A2′)."""
    assert ctx.owner_account_id is not None
    if flock.vaccination_catalogue_id is not None:
        return await assert_catalogue_assignable(db, ctx, flock.vaccination_catalogue_id)
    assignment = await current_assignment(db, ctx.owner_account_id)
    if not assignment:
        return None
    return await get_catalogue(db, assignment.catalogue_id)


def _set_item_fields(item: VaccineCatalogueItem, item_in: CatalogueItemIn, idx: int) -> None:
    item.sort_order = item_in.sort_order if item_in.sort_order else idx
    item.name = item_in.name.strip()
    item.category = item_in.category or "vaccine"
    item.description = item_in.description
    item.disease_label = item_in.disease_label
    item.instructions = item_in.instructions
    item.recommended_dose_text = item_in.recommended_dose_text
    item.route = item_in.route
    item.diluent_instructions = item_in.diluent_instructions


def _add_item_rules(db: AsyncSession, item_id: UUID, rules: list) -> None:
    for rule_in in rules:
        db.add(
            VaccineCatalogueItemRule(
                id=uuid4(),
                catalogue_item_id=item_id,
                dose_number=rule_in.dose_number,
                target_age_days=rule_in.target_age_days,
                display_day_label=rule_in.display_day_label,
                repeat_interval_days=rule_in.repeat_interval_days,
                max_repeats=rule_in.max_repeats,
                grace_period_days=rule_in.grace_period_days,
                reminder_lead_days=rule_in.reminder_lead_days,
                is_manual_only=rule_in.is_manual_only,
                label=rule_in.label,
            )
        )


def _add_items(db: AsyncSession, catalogue_id: UUID, items: list[CatalogueItemIn]) -> None:
    """Insert new catalogue items (create/clone). Ignores any client-supplied id."""
    for idx, item_in in enumerate(items):
        item = VaccineCatalogueItem(
            id=uuid4(),
            catalogue_id=catalogue_id,
            sort_order=item_in.sort_order if item_in.sort_order else idx,
            name=item_in.name.strip(),
            category=item_in.category or "vaccine",
            description=item_in.description,
            disease_label=item_in.disease_label,
            instructions=item_in.instructions,
            recommended_dose_text=item_in.recommended_dose_text,
            route=item_in.route,
            diluent_instructions=item_in.diluent_instructions,
            is_active=True,
        )
        db.add(item)
        _add_item_rules(db, item.id, item_in.rules)


async def _replace_item_rules(db: AsyncSession, item_id: UUID, rules: list) -> None:
    """Replace schedule rules for one item; parent item row / PK unchanged."""
    await db.execute(
        delete(VaccineCatalogueItemRule).where(VaccineCatalogueItemRule.catalogue_item_id == item_id)
    )
    await db.flush()
    _add_item_rules(db, item_id, rules)


async def _upsert_catalogue_items(
    db: AsyncSession,
    catalogue: VaccineCatalogue,
    items: list[CatalogueItemIn],
    *,
    remove_item_ids: list[UUID] | None = None,
) -> dict[str, int]:
    """Upsert items by stable id; soft-remove via remove_item_ids (no hard delete).

    - id present and belonging to this catalogue → update in place + replace rules (+ reactivate)
    - id omitted → create new active item
    - remove_item_ids → is_active=False; keep row and source_catalogue_item_id links
    """
    remove_ids = list(remove_item_ids or [])
    seen: set[UUID] = set()
    for item_in in items:
        if item_in.id is None:
            continue
        if item_in.id in seen:
            raise CatalogueError("Duplicate catalogue item id in request", "DUPLICATE_ITEM_ID")
        seen.add(item_in.id)
    remove_seen: set[UUID] = set()
    for rid in remove_ids:
        if rid in remove_seen:
            raise CatalogueError("Duplicate catalogue item id in remove_item_ids", "DUPLICATE_ITEM_ID")
        remove_seen.add(rid)
        if rid in seen:
            raise CatalogueError(
                "Catalogue item id cannot be both updated and removed",
                "INVALID_ITEM_ID",
            )

    existing_by_id = {item.id: item for item in catalogue.items}
    created = 0
    updated = 0
    removed = 0
    for rid in remove_ids:
        item = existing_by_id.get(rid)
        if item is None:
            raise CatalogueError(
                "Catalogue item id does not belong to this catalogue",
                "INVALID_ITEM_ID",
            )
        if item.is_active:
            item.is_active = False
            removed += 1

    for idx, item_in in enumerate(items):
        if item_in.id is not None:
            item = existing_by_id.get(item_in.id)
            if item is None:
                raise CatalogueError(
                    "Catalogue item id does not belong to this catalogue",
                    "INVALID_ITEM_ID",
                )
            _set_item_fields(item, item_in, idx)
            item.is_active = True
            await _replace_item_rules(db, item.id, item_in.rules)
            updated += 1
        else:
            new_item = VaccineCatalogueItem(
                id=uuid4(),
                catalogue_id=catalogue.id,
                is_active=True,
            )
            _set_item_fields(new_item, item_in, idx)
            db.add(new_item)
            await db.flush()
            _add_item_rules(db, new_item.id, item_in.rules)
            created += 1
    await db.flush()
    return {"created": created, "updated": updated, "removed": removed}


async def create_catalogue(db: AsyncSession, ctx: AuthContext, body: CatalogueCreateIn) -> VaccineCatalogue:
    assert ctx.owner_account_id is not None
    code = _normalize_code(body.code)
    cat = VaccineCatalogue(
        id=uuid4(),
        owner_account_id=ctx.owner_account_id,
        code=code,
        name=body.name.strip(),
        description=body.description,
        version=1,
        status="active",
        is_example=False,
        requires_veterinary_review=False,
        created_by_user_id=ctx.user.id,
    )
    db.add(cat)
    try:
        await db.flush()
        _add_items(db, cat.id, body.items)
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="catalogue.create",
                entity_type="vaccine_catalogue",
                entity_id=cat.id,
                after={"code": cat.code, "name": cat.name, "item_count": len(body.items)},
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise CatalogueError("Catalogue code already exists for this farm", "DUPLICATE_CODE") from exc
    loaded = await get_catalogue(db, cat.id)
    assert loaded is not None
    return loaded


async def clone_catalogue(
    db: AsyncSession,
    ctx: AuthContext,
    source_id: UUID,
    body: CatalogueCloneIn,
) -> VaccineCatalogue:
    """Deep-copy a platform or farm catalogue into a new farm-owned catalogue (V2)."""
    assert ctx.owner_account_id is not None
    source = await get_catalogue_for_owner(db, ctx, source_id, allow_platform=True)
    code = _normalize_code(body.code or f"{source.code}_FARM")
    name = (body.name or f"{source.name} (farm copy)").strip()
    clone = VaccineCatalogue(
        id=uuid4(),
        owner_account_id=ctx.owner_account_id,
        code=code,
        name=name,
        description=source.description,
        version=1,
        status="active",
        is_example=False,
        requires_veterinary_review=bool(getattr(source, "requires_veterinary_review", False)),
        cloned_from_catalogue_id=source.id,
        created_by_user_id=ctx.user.id,
    )
    db.add(clone)
    try:
        await db.flush()
        for item in sorted(source.items, key=lambda i: (i.sort_order, i.name)):
            if not getattr(item, "is_active", True):
                continue
            new_item = VaccineCatalogueItem(
                id=uuid4(),
                catalogue_id=clone.id,
                sort_order=item.sort_order,
                name=item.name,
                category=item.category,
                description=item.description,
                disease_label=item.disease_label,
                instructions=item.instructions,
                recommended_dose_text=item.recommended_dose_text,
                route=item.route,
                diluent_instructions=item.diluent_instructions,
                is_active=True,
            )
            db.add(new_item)
            await db.flush()
            for rule in sorted(item.rules, key=lambda r: r.dose_number):
                db.add(
                    VaccineCatalogueItemRule(
                        id=uuid4(),
                        catalogue_item_id=new_item.id,
                        dose_number=rule.dose_number,
                        target_age_days=rule.target_age_days,
                        display_day_label=rule.display_day_label,
                        repeat_interval_days=rule.repeat_interval_days,
                        max_repeats=rule.max_repeats,
                        grace_period_days=rule.grace_period_days,
                        reminder_lead_days=rule.reminder_lead_days,
                        is_manual_only=rule.is_manual_only,
                        label=rule.label,
                    )
                )
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="catalogue.clone",
                entity_type="vaccine_catalogue",
                entity_id=clone.id,
                after={"source_id": str(source.id), "code": clone.code},
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise CatalogueError("Catalogue code already exists for this farm", "DUPLICATE_CODE") from exc
    loaded = await get_catalogue(db, clone.id)
    assert loaded is not None
    return loaded


async def update_catalogue(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue_id: UUID,
    body: CatalogueUpdateIn,
) -> tuple[VaccineCatalogue, int]:
    """Update farm-owned catalogue only. Platform catalogues are immutable.

    Item changes require confirm_change, expected_version, and assignment fingerprint.
    Entire upsert + materialize runs in one transaction (commit at end / rollback on error).
    """
    assert ctx.owner_account_id is not None
    try:
        cat = await get_catalogue_for_owner(db, ctx, catalogue_id, allow_platform=False)
        items_changed = _item_impactful(body)
        if items_changed and not body.confirm_change:
            raise CatalogueError(
                "Updating catalogue items requires confirm_change=true after reviewing impact preview",
                "CONFIRM_REQUIRED",
            )
        if items_changed:
            if body.expected_version is None or body.expected_override_flock_count is None:
                raise CatalogueError(
                    "Item updates require expected_version and expected_override_flock_count from preview",
                    "STALE_PREVIEW",
                )
            fingerprint = await assignment_fingerprint(db, ctx, cat.id)
            if int(body.expected_version) != int(cat.version or 1):
                raise CatalogueError(
                    "Catalogue changed since preview; request a fresh preview",
                    "STALE_PREVIEW",
                )
            if body.expected_assignment_catalogue_id != fingerprint["expected_assignment_catalogue_id"]:
                raise CatalogueError(
                    "Farm catalogue assignment changed since preview; request a fresh preview",
                    "STALE_PREVIEW",
                )
            if int(body.expected_override_flock_count) != int(
                fingerprint["expected_override_flock_count"]
            ):
                raise CatalogueError(
                    "Flock catalogue overrides changed since preview; request a fresh preview",
                    "STALE_PREVIEW",
                )

        if body.name is not None:
            cat.name = body.name.strip()
        if body.description is not None:
            cat.description = body.description
        if body.status is not None:
            if body.status not in {"active", "inactive", "archived"}:
                raise CatalogueError("Invalid catalogue status", "INVALID_STATUS")
            cat.status = body.status

        regenerated = 0
        item_upsert_stats: dict[str, int] = {"created": 0, "updated": 0, "removed": 0}
        if items_changed:
            if body.apply_scope not in {"new_flocks", "all_active"}:
                raise CatalogueError("apply_scope must be new_flocks or all_active", "INVALID_SCOPE")
            # Keep all_active flock application gated until preview UX unlock.
            if body.apply_scope == "all_active":
                raise CatalogueError(
                    "Applying catalogue item edits to all active flocks is not enabled yet",
                    "SCOPE_ALL_ACTIVE_GATED",
                )
            item_upsert_stats = await _upsert_catalogue_items(
                db,
                cat,
                body.items or [],
                remove_item_ids=body.remove_item_ids,
            )
            cat.version = int(cat.version or 1) + 1
            catalogue_pk = cat.id
            from app.models.owner import OwnerAccount

            owner = await db.get(OwnerAccount, ctx.owner_account_id)
            eff = body.effective_date or farm_local_today(owner.timezone if owner else None)
            await db.flush()
            for existing in list(cat.items):
                db.expire(existing, ["rules"])
            db.expire(cat, ["items"])
            cat = await get_catalogue(db, catalogue_pk)
            assert cat is not None
            await _materialize_catalogue(db, ctx, cat, effective_date=eff)

        catalogue_pk = cat.id
        actor_user_id = ctx.user.id
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=actor_user_id,
                action="catalogue.update",
                entity_type="vaccine_catalogue",
                entity_id=catalogue_pk,
                after={
                    "version": int(cat.version or 1),
                    "items_changed": items_changed,
                    "items_created": item_upsert_stats.get("created", 0),
                    "items_updated": item_upsert_stats.get("updated", 0),
                    "items_removed": item_upsert_stats.get("removed", 0),
                    "apply_scope": body.apply_scope if items_changed else None,
                    "regenerated_doses": regenerated,
                },
            )
        )
        await db.commit()
    except CatalogueError:
        await db.rollback()
        raise
    loaded = await get_catalogue(db, catalogue_pk)
    assert loaded is not None
    return loaded, regenerated


async def preview_update(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue_id: UUID,
    body: CataloguePreviewUpdateIn,
) -> dict:
    """Read-only impact preview for farm-owned catalogue item edits."""
    assert ctx.owner_account_id is not None
    cat = await get_catalogue_for_owner(db, ctx, catalogue_id, allow_platform=False)
    if body.apply_scope not in {"new_flocks", "all_active"}:
        raise CatalogueError("apply_scope must be new_flocks or all_active", "INVALID_SCOPE")

    fingerprint = await assignment_fingerprint(db, ctx, cat.id)
    from app.models.owner import OwnerAccount

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    eff = body.effective_date or farm_local_today(owner.timezone if owner else None)

    existing_by_id = {item.id: item for item in cat.items}
    active_ids = {item.id for item in cat.items if item.is_active}
    items_added: list[str] = []
    items_updated: list[UUID] = []
    rule_changes: list[UUID] = []
    for item_in in body.items or []:
        if item_in.id is None:
            items_added.append(item_in.name.strip())
            continue
        current = existing_by_id.get(item_in.id)
        if current is None:
            raise CatalogueError(
                "Catalogue item id does not belong to this catalogue",
                "INVALID_ITEM_ID",
            )
        items_updated.append(item_in.id)
        if _rules_signature(current.rules) != _rules_signature(item_in.rules):
            rule_changes.append(item_in.id)

    items_removed: list[UUID] = []
    for rid in body.remove_item_ids or []:
        if rid not in existing_by_id:
            raise CatalogueError(
                "Catalogue item id does not belong to this catalogue",
                "INVALID_ITEM_ID",
            )
        if rid in active_ids:
            items_removed.append(rid)

    # Open doses linked to defs sourced from this catalogue's items (tenant-scoped).
    item_ids = list(existing_by_id.keys())
    open_doses = 0
    if item_ids:
        open_doses = int(
            await db.scalar(
                select(func.count())
                .select_from(ScheduledDose)
                .join(
                    VaccineDefinition,
                    VaccineDefinition.id == ScheduledDose.vaccine_definition_id,
                )
                .where(
                    ScheduledDose.owner_account_id == ctx.owner_account_id,
                    ScheduledDose.is_active.is_(True),
                    ~ScheduledDose.status.like("completed%"),
                    ScheduledDose.status.notin_(["skipped", "inactive", "not_applicable"]),
                    VaccineDefinition.source_catalogue_item_id.in_(item_ids),
                )
            )
            or 0
        )
    completed_events = int(
        await db.scalar(
            select(func.count())
            .select_from(VaccinationEvent)
            .where(
                VaccinationEvent.owner_account_id == ctx.owner_account_id,
                VaccinationEvent.is_void.is_(False),
            )
        )
        or 0
    )

    flocks_all_active = fingerprint["expected_override_flock_count"]
    if fingerprint["is_farm_default"]:
        flocks_all_active += fingerprint["inheriting_flock_count_if_default"]

    warning = (
        "Historical vaccination events are preserved. "
        "Completed, skipped, and not_applicable doses are not retired. "
        f"apply_scope={body.apply_scope}: new_flocks materializes definitions only; "
        "all_active flock application remains gated until product unlock."
    )
    return {
        "catalogue_id": cat.id,
        "catalogue_name": cat.name,
        "catalogue_version": int(cat.version or 1),
        "requires_veterinary_review": bool(getattr(cat, "requires_veterinary_review", False)),
        "apply_scope": body.apply_scope,
        "effective_date": eff,
        "is_farm_default": fingerprint["is_farm_default"],
        "expected_assignment_catalogue_id": fingerprint["expected_assignment_catalogue_id"],
        "expected_override_flock_count": fingerprint["expected_override_flock_count"],
        "inheriting_flock_count_if_default": fingerprint["inheriting_flock_count_if_default"],
        "items_added": items_added,
        "items_updated": items_updated,
        "items_removed": items_removed,
        "rule_changes": rule_changes,
        "open_doses_eligible_for_change": open_doses,
        "completed_event_count": completed_events,
        "flocks_affected_new_flocks": 0,
        "flocks_affected_all_active": flocks_all_active,
        "warning": warning,
        "all_active_gated": True,
    }


async def preview_assign(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue_id: UUID,
    *,
    apply_scope: str,
    effective_date: date | None,
) -> dict:
    assert ctx.owner_account_id is not None
    cat = await assert_catalogue_assignable(db, ctx, catalogue_id)
    current = await current_assignment(db, ctx.owner_account_id)
    active_flocks = int(
        await db.scalar(
            select(func.count())
            .select_from(Flock)
            .where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
            )
        )
        or 0
    )
    inheriting = int(
        await db.scalar(
            select(func.count())
            .select_from(Flock)
            .where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
                Flock.vaccination_catalogue_id.is_(None),
            )
        )
        or 0
    )
    override_count = active_flocks - inheriting
    open_doses = int(
        await db.scalar(
            select(func.count())
            .select_from(ScheduledDose)
            .where(
                ScheduledDose.owner_account_id == ctx.owner_account_id,
                ScheduledDose.is_active.is_(True),
                ~ScheduledDose.status.like("completed%"),
                ScheduledDose.status.notin_(["skipped", "inactive", "not_applicable"]),
            )
        )
        or 0
    )
    completed_events = int(
        await db.scalar(
            select(func.count())
            .select_from(VaccinationEvent)
            .where(
                VaccinationEvent.owner_account_id == ctx.owner_account_id,
                VaccinationEvent.is_void.is_(False),
            )
        )
        or 0
    )
    from app.models.owner import OwnerAccount

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    eff = effective_date or farm_local_today(owner.timezone if owner else None)
    warning = (
        "Historical vaccination events are preserved. Only eligible future scheduled doses "
        f"are regenerated for apply_scope={apply_scope}. "
        f"Flocks with an explicit catalogue override ({override_count}) are not changed by farm default assign."
    )
    return {
        "catalogue_id": cat.id,
        "catalogue_name": cat.name,
        "current_catalogue_id": current.catalogue_id if current else None,
        "current_catalogue_name": current.catalogue.name if current and current.catalogue else None,
        "active_flock_count": active_flocks,
        "inheriting_flock_count": inheriting,
        "override_flock_count": override_count,
        "open_dose_count": open_doses,
        "completed_event_count": completed_events,
        "apply_scope": apply_scope,
        "effective_date": eff,
        "warning": warning,
    }


def _catalogue_item_matches_version(
    item: VaccineCatalogueItem,
    version: VaccineScheduleVersion,
) -> bool:
    """True when the current schedule version already mirrors the catalogue item rules."""
    item_rules = sorted(item.rules, key=lambda r: (r.dose_number, r.target_age_days or -1))
    ver_rules = sorted(version.rules, key=lambda r: (r.dose_number, r.target_age_days or -1))
    if len(item_rules) != len(ver_rules):
        return False
    for left, right in zip(item_rules, ver_rules, strict=True):
        if (
            left.dose_number != right.dose_number
            or left.target_age_days != right.target_age_days
            or left.repeat_interval_days != right.repeat_interval_days
            or left.max_repeats != right.max_repeats
            or left.grace_period_days != right.grace_period_days
            or left.reminder_lead_days != right.reminder_lead_days
            or bool(left.is_manual_only) != bool(right.is_manual_only)
        ):
            return False
    return True


async def _materialize_catalogue(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue: VaccineCatalogue,
    *,
    effective_date: date,
) -> list[UUID]:
    """Idempotently create/update tenant vaccine_definitions from catalogue items.

    Active catalogue items materialize/reactivate definitions. Soft-removed items
    deactivate linked definitions without clearing source_catalogue_item_id.
    """
    assert ctx.owner_account_id is not None
    definition_ids: list[UUID] = []
    active_items = sorted(
        (item for item in catalogue.items if getattr(item, "is_active", True)),
        key=lambda i: (i.sort_order, i.name),
    )
    inactive_items = [item for item in catalogue.items if not getattr(item, "is_active", True)]

    for item in inactive_items:
        existing = await db.scalar(
            select(VaccineDefinition).where(
                VaccineDefinition.owner_account_id == ctx.owner_account_id,
                VaccineDefinition.source_catalogue_item_id == item.id,
            )
        )
        if existing and existing.is_active:
            existing.is_active = False
            # Keep source_catalogue_item_id for provenance / auditability.

    for item in active_items:
        existing = await db.scalar(
            select(VaccineDefinition).where(
                VaccineDefinition.owner_account_id == ctx.owner_account_id,
                VaccineDefinition.source_catalogue_item_id == item.id,
            )
        )
        if existing:
            existing.name = item.name
            existing.category = item.category
            existing.description = item.description
            existing.instructions = item.instructions
            existing.is_active = True
            existing.archived_at = None
            definition = existing
        else:
            definition = VaccineDefinition(
                id=uuid4(),
                owner_account_id=ctx.owner_account_id,
                name=item.name,
                category=item.category,
                description=item.description,
                instructions=item.instructions,
                source_catalogue_item_id=item.id,
                is_active=True,
            )
            db.add(definition)
            await db.flush()

        # Idempotent materialize: do not mint a new schedule version/rules when the
        # current version already matches the catalogue item. Re-assigning the same
        # catalogue previously created new rule UUIDs every call, and schedule
        # generation (keyed by schedule_rule_id) then spawned duplicate doses.
        current_version = await db.scalar(
            select(VaccineScheduleVersion)
            .where(
                VaccineScheduleVersion.vaccine_definition_id == definition.id,
                VaccineScheduleVersion.is_current.is_(True),
            )
            .options(selectinload(VaccineScheduleVersion.rules))
        )
        if current_version and _catalogue_item_matches_version(item, current_version):
            definition_ids.append(definition.id)
            continue

        await db.execute(
            update(VaccineScheduleVersion)
            .where(
                VaccineScheduleVersion.vaccine_definition_id == definition.id,
                VaccineScheduleVersion.is_current.is_(True),
            )
            .values(is_current=False)
        )
        max_ver = await db.scalar(
            select(func.coalesce(func.max(VaccineScheduleVersion.version_number), 0)).where(
                VaccineScheduleVersion.vaccine_definition_id == definition.id
            )
        )
        version = VaccineScheduleVersion(
            id=uuid4(),
            owner_account_id=ctx.owner_account_id,
            vaccine_definition_id=definition.id,
            version_number=int(max_ver or 0) + 1,
            effective_date=effective_date,
            notes=f"Materialized from catalogue item {item.id}",
            is_current=True,
        )
        db.add(version)
        await db.flush()
        for rule in sorted(item.rules, key=lambda r: r.dose_number):
            db.add(
                ScheduleRule(
                    id=uuid4(),
                    owner_account_id=ctx.owner_account_id,
                    schedule_version_id=version.id,
                    dose_number=rule.dose_number,
                    target_age_days=rule.target_age_days,
                    repeat_interval_days=rule.repeat_interval_days,
                    max_repeats=rule.max_repeats,
                    grace_period_days=rule.grace_period_days,
                    reminder_lead_days=rule.reminder_lead_days,
                    is_manual_only=rule.is_manual_only,
                    label=rule.label or rule.display_day_label,
                )
            )
        definition_ids.append(definition.id)
    await db.flush()
    return definition_ids


async def assign_catalogue(
    db: AsyncSession,
    ctx: AuthContext,
    body: CatalogueAssignIn,
) -> tuple[OwnerCatalogueAssignment, list[UUID], int]:
    assert ctx.owner_account_id is not None
    if body.apply_scope not in {"new_flocks", "all_active"}:
        raise CatalogueError("apply_scope must be new_flocks or all_active", "INVALID_SCOPE")

    cat = await assert_catalogue_assignable(db, ctx, body.catalogue_id)

    current = await current_assignment(db, ctx.owner_account_id)
    if current and current.catalogue_id == body.catalogue_id and not body.confirm_change:
        from app.models.owner import OwnerAccount

        owner = await db.get(OwnerAccount, ctx.owner_account_id)
        eff = body.effective_date or farm_local_today(owner.timezone if owner else None)
        def_ids = await _materialize_catalogue(db, ctx, cat, effective_date=eff)
        regenerated = 0
        if body.apply_scope == "all_active":
            # Only inheriting flocks — never overwrite explicit overrides.
            regenerated = await _regen_inheriting_flocks(db, ctx, def_ids)
        await db.commit()
        await db.refresh(current)
        return current, def_ids, regenerated

    if current and current.catalogue_id != body.catalogue_id and not body.confirm_change:
        raise CatalogueError(
            "Catalogue change requires confirm_change=true after reviewing the preview",
            "CONFIRM_REQUIRED",
        )

    from app.models.owner import OwnerAccount

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    eff = body.effective_date or farm_local_today(owner.timezone if owner else None)

    if current:
        current.is_current = False

    assignment = OwnerCatalogueAssignment(
        id=uuid4(),
        owner_account_id=ctx.owner_account_id,
        catalogue_id=cat.id,
        assigned_by_user_id=ctx.user.id,
        effective_date=eff,
        apply_scope=body.apply_scope,
        is_current=True,
        notes=body.notes,
    )
    db.add(assignment)
    def_ids = await _materialize_catalogue(db, ctx, cat, effective_date=eff)

    regenerated = 0
    if body.apply_scope == "all_active":
        regenerated = await _regen_inheriting_flocks(db, ctx, def_ids)

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="catalogue.assign",
            entity_type="owner_catalogue_assignment",
            entity_id=assignment.id,
            after={
                "catalogue_id": str(cat.id),
                "catalogue_code": cat.code,
                "apply_scope": body.apply_scope,
                "effective_date": eff.isoformat(),
                "definition_ids": [str(i) for i in def_ids],
                "regenerated_doses": regenerated,
            },
        )
    )
    await db.commit()
    await db.refresh(assignment)
    return assignment, def_ids, regenerated


async def _regen_inheriting_flocks(db: AsyncSession, ctx: AuthContext, definition_ids: list[UUID]) -> int:
    """Regenerate schedules only for flocks that inherit the farm default (no override)."""
    flocks = list(
        await db.scalars(
            select(Flock).where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
                Flock.vaccination_catalogue_id.is_(None),
            )
        )
    )
    total = 0
    for flock in flocks:
        doses = await vaccine_service.generate_schedules_for_flock(
            db,
            ctx,
            flock.id,
            vaccine_definition_ids=definition_ids or None,
            commit=False,
        )
        total += len(doses)
    return total


async def _regen_flocks_using_catalogue(
    db: AsyncSession,
    ctx: AuthContext,
    catalogue_id: UUID,
    definition_ids: list[UUID],
) -> int:
    """Regen flocks that use this catalogue as override OR inherit it as current farm default."""
    assignment = await current_assignment(db, ctx.owner_account_id)  # type: ignore[arg-type]
    inherit_default = bool(assignment and assignment.catalogue_id == catalogue_id)
    conditions = [Flock.vaccination_catalogue_id == catalogue_id]
    if inherit_default:
        conditions.append(Flock.vaccination_catalogue_id.is_(None))
    flocks = list(
        await db.scalars(
            select(Flock).where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
                or_(*conditions),
            )
        )
    )
    total = 0
    for flock in flocks:
        doses = await vaccine_service.generate_schedules_for_flock(
            db,
            ctx,
            flock.id,
            vaccine_definition_ids=definition_ids or None,
            commit=False,
        )
        total += len(doses)
    return total


async def ensure_schedules_for_flock(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> int:
    """Auto-generation after flock/bird onboarding using effective catalogue (A2′).

    Schedule generation requires ``schedule.view``. Callers such as shed transfer may run as
    farmers with ``lifecycle.record`` only — treat missing schedule permission as a soft skip
    so membership mutations are not rolled back or reported as 403 after commit.
    """
    from fastapi import HTTPException

    flock = await db.get(Flock, flock_id)
    if not flock or flock.owner_account_id != ctx.owner_account_id:
        return 0
    try:
        effective = await resolve_effective_catalogue(db, ctx, flock)
        if effective:
            from app.models.owner import OwnerAccount

            owner = await db.get(OwnerAccount, ctx.owner_account_id)
            eff = farm_local_today(owner.timezone if owner else None)
            # Ensure items are loaded
            cat = await get_catalogue(db, effective.id)
            if not cat:
                return 0
            def_ids = await _materialize_catalogue(db, ctx, cat, effective_date=eff)
            doses = await vaccine_service.generate_schedules_for_flock(
                db,
                ctx,
                flock.id,
                vaccine_definition_ids=def_ids or None,
                commit=True,
            )
            return len(doses)
        doses = await vaccine_service.generate_schedules_for_flock(db, ctx, flock_id, commit=True)
        return len(doses)
    except (vaccine_service.VaccineError, CatalogueError):
        return 0
    except HTTPException as exc:
        # Soft-skip authorization gaps during side-effect schedule sync (e.g. farmer transfer).
        if exc.status_code == 403:
            return 0
        raise


async def refresh_open_dose_eligibility(db: AsyncSession, flock_id: UUID) -> int:
    """Align flock-level dose eligibility with live headcount (incl. reopen for growth).

    Delegates to dose_reconciliation.refresh_flock_dose_eligibility so completed doses
    reopen when uncovered birds join, while preserving completed_count for birds already covered.
    """
    from app.services.dose_reconciliation import refresh_flock_dose_eligibility

    return await refresh_flock_dose_eligibility(db, flock_id)


async def recalculate_open_doses_for_hatch(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> int:
    """Recompute due dates for open flock-level doses after an exact hatch correction.

    Completed/historical doses are left unchanged. Partial completed_count is preserved.
    """
    from app.models.enums import DobConfidence
    from app.models.owner import OwnerAccount
    from app.services.schedule_engine import compute_dose_status, generate_due_dates

    flock = await db.get(Flock, flock_id)
    if not flock or not flock.hatch_date or flock.dob_confidence != DobConfidence.exact:
        return 0

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)

    open_doses = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.flock_id == flock_id,
                ScheduledDose.bird_id.is_(None),
                ScheduledDose.is_active.is_(True),
                ~ScheduledDose.status.like("completed%"),
            )
        )
    )
    if not open_doses:
        return 0

    rule_ids = {d.schedule_rule_id for d in open_doses}
    rules = {
        r.id: r
        for r in await db.scalars(select(ScheduleRule).where(ScheduleRule.id.in_(rule_ids)))
    }

    updated = 0
    for dose in open_doses:
        rule = rules.get(dose.schedule_rule_id)
        if not rule:
            continue
        dues, needs_review = generate_due_dates(
            hatch_date=flock.hatch_date,
            target_age_days=rule.target_age_days,
            repeat_interval_days=rule.repeat_interval_days,
            max_repeats=rule.max_repeats,
            dob_confidence=flock.dob_confidence,
        )
        if needs_review and not dues:
            dose.due_date = today
            dose.status = "needs_review"
            dose.needs_review = True
            updated += 1
            continue
        due_by_number = {n: due for n, due in enumerate(dues, start=rule.dose_number)}
        new_due = due_by_number.get(dose.dose_number)
        if new_due is None:
            continue
        if dose.due_date != new_due:
            dose.due_date = new_due
            updated += 1
        dose.status = compute_dose_status(
            due_date=new_due,
            grace_period_days=dose.grace_period_days,
            reminder_lead_days=dose.reminder_lead_days,
            today=today,
            dob_confidence=flock.dob_confidence,
        )
        dose.needs_review = False
    await db.flush()
    return updated
