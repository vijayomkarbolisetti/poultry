from collections.abc import Sequence
from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.models.audit import AuditLog
from app.models.enums import DobConfidence, FlockStatus, MembershipRole
from app.models.flock import Bird, Flock
from app.models.owner import OwnerAccount
from app.models.shed import Shed
from app.models.vaccine import ScheduledDose, ScheduleRule, VaccineDefinition, VaccineScheduleVersion
from app.schemas.vaccine import ScheduledDoseOut
from app.services.schedule_engine import (
    STATUS_INACTIVE,
    STATUS_NEEDS_REVIEW,
    STATUS_NOT_APPLICABLE,
    STATUS_SKIPPED,
    compute_dose_status,
    farm_local_today,
    generate_due_dates,
)


class VaccineError(Exception):
    def __init__(self, message: str, code: str = "VACCINE_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def create_definition(db: AsyncSession, ctx: AuthContext, data) -> VaccineDefinition:
    assert ctx.owner_account_id
    definition = VaccineDefinition(
        owner_account_id=ctx.owner_account_id,
        name=data.name.strip(),
        category=data.category,
        description=data.description,
        instructions=data.instructions,
        is_active=True,
    )
    db.add(definition)
    await db.flush()
    version = VaccineScheduleVersion(
        owner_account_id=ctx.owner_account_id,
        vaccine_definition_id=definition.id,
        version_number=1,
        effective_date=data.effective_date or date.today(),
        notes=data.notes,
        is_current=True,
    )
    db.add(version)
    await db.flush()
    for i, rule in enumerate(data.rules or [], start=1):
        db.add(
            ScheduleRule(
                owner_account_id=ctx.owner_account_id,
                schedule_version_id=version.id,
                dose_number=rule.dose_number or i,
                target_age_days=rule.target_age_days,
                repeat_interval_days=rule.repeat_interval_days,
                max_repeats=rule.max_repeats,
                grace_period_days=rule.grace_period_days if rule.grace_period_days is not None else 0,
                reminder_lead_days=rule.reminder_lead_days if rule.reminder_lead_days is not None else 3,
                is_manual_only=rule.is_manual_only or False,
                label=rule.label,
            )
        )
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="vaccine.create",
            entity_type="vaccine_definition",
            entity_id=definition.id,
            after={"name": definition.name},
        )
    )
    await db.commit()
    await db.refresh(definition)
    return definition


async def list_definitions(db: AsyncSession, ctx: AuthContext, include_archived: bool = False) -> list[VaccineDefinition]:
    stmt = select(VaccineDefinition).where(VaccineDefinition.owner_account_id == ctx.owner_account_id)
    if not include_archived:
        stmt = stmt.where(VaccineDefinition.is_active.is_(True))
    return list(await db.scalars(stmt.order_by(VaccineDefinition.name)))


async def archive_definition(db: AsyncSession, ctx: AuthContext, definition_id: UUID) -> VaccineDefinition:
    definition = await db.scalar(
        select(VaccineDefinition).where(
            VaccineDefinition.id == definition_id,
            VaccineDefinition.owner_account_id == ctx.owner_account_id,
        )
    )
    if not definition:
        raise VaccineError("Not found", "NOT_FOUND")
    definition.is_active = False
    definition.archived_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(definition)
    return definition


async def create_new_version(db: AsyncSession, ctx: AuthContext, definition_id: UUID, data) -> VaccineScheduleVersion:
    """D5: new version with effective date; does not rewrite history."""
    definition = await db.scalar(
        select(VaccineDefinition).where(
            VaccineDefinition.id == definition_id,
            VaccineDefinition.owner_account_id == ctx.owner_account_id,
        )
    )
    if not definition:
        raise VaccineError("Not found", "NOT_FOUND")
    current = await db.scalar(
        select(VaccineScheduleVersion).where(
            VaccineScheduleVersion.vaccine_definition_id == definition_id,
            VaccineScheduleVersion.is_current.is_(True),
        )
    )
    next_num = (current.version_number + 1) if current else 1
    if current:
        current.is_current = False
    version = VaccineScheduleVersion(
        owner_account_id=ctx.owner_account_id,
        vaccine_definition_id=definition_id,
        version_number=next_num,
        effective_date=data.effective_date,
        notes=data.notes,
        is_current=True,
    )
    db.add(version)
    await db.flush()
    for i, rule in enumerate(data.rules or [], start=1):
        db.add(
            ScheduleRule(
                owner_account_id=ctx.owner_account_id,
                schedule_version_id=version.id,
                dose_number=rule.dose_number or i,
                target_age_days=rule.target_age_days,
                repeat_interval_days=rule.repeat_interval_days,
                max_repeats=rule.max_repeats,
                grace_period_days=rule.grace_period_days if rule.grace_period_days is not None else 0,
                reminder_lead_days=rule.reminder_lead_days if rule.reminder_lead_days is not None else 3,
                is_manual_only=rule.is_manual_only or False,
                label=rule.label,
            )
        )
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="vaccine.version",
            entity_type="vaccine_schedule_version",
            entity_id=version.id,
            after={"version": next_num, "effective_date": str(data.effective_date), "scope": data.apply_scope},
        )
    )
    await db.commit()
    await db.refresh(version)
    return version


def _is_preserved_terminal_dose_status(status: str) -> bool:
    """Statuses that retirement must never rewrite (history / explicit terminal)."""
    value = str(status)
    return (
        value.startswith("completed")
        or value == STATUS_SKIPPED
        or value == STATUS_NOT_APPLICABLE
    )


async def retire_superseded_open_doses(
    db: AsyncSession,
    *,
    owner_account_id: UUID,
    flock_ids: Sequence[UUID],
    definition_ids: Sequence[UUID],
    today: date,
) -> int:
    """Retire obsolete open flock-level doses for an explicit regen set.

    Scope (all required):
    - owner_account_id tenant
    - flock_id in flock_ids (tenant-verified)
    - vaccine_definition_id in definition_ids (tenant-verified)

    Retires active open doses when the definition is inactive / has no current version,
    the dose's schedule_version_id is not current, or (dose_number, due_date) is not in
    the current-rule due set for that flock.

    Never mutates vaccination_events. Never retires completed_*, skipped, or not_applicable.
    Idempotent: already-inactive rows are skipped.
    """
    flock_id_set = {fid for fid in flock_ids if fid is not None}
    definition_id_set = {did for did in definition_ids if did is not None}
    if not flock_id_set or not definition_id_set:
        return 0

    flocks = {
        flock.id: flock
        for flock in await db.scalars(
            select(Flock).where(
                Flock.owner_account_id == owner_account_id,
                Flock.id.in_(flock_id_set),
            )
        )
    }
    definitions = list(
        await db.scalars(
            select(VaccineDefinition).where(
                VaccineDefinition.owner_account_id == owner_account_id,
                VaccineDefinition.id.in_(definition_id_set),
            )
        )
    )
    if not flocks or not definitions:
        return 0

    retired = 0
    for definition in definitions:
        current_version = await db.scalar(
            select(VaccineScheduleVersion)
            .where(
                VaccineScheduleVersion.vaccine_definition_id == definition.id,
                VaccineScheduleVersion.owner_account_id == owner_account_id,
                VaccineScheduleVersion.is_current.is_(True),
            )
            .options(selectinload(VaccineScheduleVersion.rules))
        )

        for flock in flocks.values():
            doses = list(
                await db.scalars(
                    select(ScheduledDose).where(
                        ScheduledDose.owner_account_id == owner_account_id,
                        ScheduledDose.flock_id == flock.id,
                        ScheduledDose.vaccine_definition_id == definition.id,
                        ScheduledDose.is_active.is_(True),
                        ScheduledDose.bird_id.is_(None),
                    )
                )
            )
            if not doses:
                continue

            if not definition.is_active or current_version is None:
                for dose in doses:
                    if _is_preserved_terminal_dose_status(dose.status):
                        continue
                    dose.is_active = False
                    dose.status = STATUS_INACTIVE
                    retired += 1
                continue

            expected: set[tuple[int, date]] = set()
            for rule in current_version.rules:
                if rule.is_manual_only:
                    continue
                dues, needs_review = generate_due_dates(
                    hatch_date=flock.hatch_date,
                    target_age_days=rule.target_age_days,
                    repeat_interval_days=rule.repeat_interval_days,
                    max_repeats=rule.max_repeats,
                    dob_confidence=flock.dob_confidence,
                )
                if needs_review and not dues:
                    expected.add((rule.dose_number, today))
                    continue
                for n, due in enumerate(dues, start=rule.dose_number):
                    expected.add((n, due))

            for dose in doses:
                if _is_preserved_terminal_dose_status(dose.status):
                    continue
                obsolete = dose.schedule_version_id != current_version.id or (
                    dose.dose_number,
                    dose.due_date,
                ) not in expected
                if not obsolete:
                    continue
                dose.is_active = False
                dose.status = STATUS_INACTIVE
                retired += 1

    if retired:
        await db.flush()
    return retired


async def generate_schedules_for_flock(
    db: AsyncSession,
    ctx: AuthContext,
    flock_id: UUID,
    *,
    vaccine_definition_ids: list[UUID] | None = None,
    commit: bool = True,
) -> list[ScheduledDose]:
    flock = await db.scalar(
        select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
    )
    if not flock:
        raise VaccineError("Population not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="schedule.view")
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, flock.shed_id)
    except shed_service.ShedError as exc:
        raise VaccineError(exc.message, exc.code) from exc

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)

    defs_stmt = select(VaccineDefinition).where(
        VaccineDefinition.owner_account_id == ctx.owner_account_id,
        VaccineDefinition.is_active.is_(True),
    )
    if vaccine_definition_ids:
        defs_stmt = defs_stmt.where(VaccineDefinition.id.in_(vaccine_definition_ids))
    definitions = list(await db.scalars(defs_stmt))

    # Retire obsolete open doses for the explicit regen set before creating replacements.
    # Include inactive definitions when callers pass their ids (archive / deactivate path).
    retire_ids = (
        list(vaccine_definition_ids)
        if vaccine_definition_ids is not None
        else [definition.id for definition in definitions]
    )
    if retire_ids:
        await retire_superseded_open_doses(
            db,
            owner_account_id=ctx.owner_account_id,
            flock_ids=[flock.id],
            definition_ids=retire_ids,
            today=today,
        )

    created: list[ScheduledDose] = []
    for definition in definitions:
        version = await db.scalar(
            select(VaccineScheduleVersion)
            .where(
                VaccineScheduleVersion.vaccine_definition_id == definition.id,
                VaccineScheduleVersion.is_current.is_(True),
            )
            .options(selectinload(VaccineScheduleVersion.rules))
        )
        if not version:
            continue
        for rule in version.rules:
            if rule.is_manual_only:
                continue
            dues, needs_review = generate_due_dates(
                hatch_date=flock.hatch_date,
                target_age_days=rule.target_age_days,
                repeat_interval_days=rule.repeat_interval_days,
                max_repeats=rule.max_repeats,
                dob_confidence=flock.dob_confidence,
            )
            if needs_review and not dues:
                dose = ScheduledDose(
                    owner_account_id=ctx.owner_account_id,
                    shed_id=flock.shed_id,
                    flock_id=flock.id,
                    vaccine_definition_id=definition.id,
                    schedule_version_id=version.id,
                    schedule_rule_id=rule.id,
                    dose_number=rule.dose_number,
                    due_date=today,
                    grace_period_days=rule.grace_period_days,
                    reminder_lead_days=rule.reminder_lead_days,
                    status=STATUS_NEEDS_REVIEW,
                    eligible_count=flock.current_count,
                    needs_review=True,
                    is_active=flock.status == FlockStatus.active,
                )
                db.add(dose)
                created.append(dose)
                continue
            for n, due in enumerate(dues, start=rule.dose_number):
                # Deduplicate on the logical dose identity. Catalogue rematerialize
                # historically minted new schedule_rule_ids for unchanged rules; matching
                # only on schedule_rule_id then created twin Marex/ND cards for one flock.
                exists = await db.scalar(
                    select(ScheduledDose.id).where(
                        ScheduledDose.flock_id == flock.id,
                        ScheduledDose.vaccine_definition_id == definition.id,
                        ScheduledDose.dose_number == n,
                        ScheduledDose.due_date == due,
                        ScheduledDose.bird_id.is_(None),
                        ScheduledDose.is_active.is_(True),
                    )
                )
                if exists:
                    continue
                status = compute_dose_status(
                    due_date=due,
                    grace_period_days=rule.grace_period_days,
                    reminder_lead_days=rule.reminder_lead_days,
                    today=today,
                    dob_confidence=flock.dob_confidence,
                )
                if flock.status != FlockStatus.active:
                    status = STATUS_INACTIVE
                dose = ScheduledDose(
                    owner_account_id=ctx.owner_account_id,
                    shed_id=flock.shed_id,
                    flock_id=flock.id,
                    vaccine_definition_id=definition.id,
                    schedule_version_id=version.id,
                    schedule_rule_id=rule.id,
                    dose_number=n,
                    due_date=due,
                    grace_period_days=rule.grace_period_days,
                    reminder_lead_days=rule.reminder_lead_days,
                    status=status,
                    eligible_count=flock.current_count,
                    needs_review=flock.dob_confidence == DobConfidence.unknown,
                    is_active=flock.status == FlockStatus.active,
                )
                db.add(dose)
                created.append(dose)
    await reconcile_duplicate_scheduled_doses(db, owner_account_id=ctx.owner_account_id, flock_id=flock.id)
    if commit:
        await db.commit()
    else:
        await db.flush()
    return created


async def reconcile_duplicate_scheduled_doses(
    db: AsyncSession,
    *,
    owner_account_id: UUID,
    flock_id: UUID | None = None,
    shed_id: UUID | None = None,
    commit: bool = False,
) -> int:
    """Deactivate superseded twin flock-level doses (same vaccine/due/dose_number).

    Keeps completed doses; among open twins keeps the earliest created row.
    Does not delete events or rewrite completed_count.
    """
    stmt = select(ScheduledDose).where(
        ScheduledDose.owner_account_id == owner_account_id,
        ScheduledDose.is_active.is_(True),
        ScheduledDose.bird_id.is_(None),
    )
    if flock_id is not None:
        stmt = stmt.where(ScheduledDose.flock_id == flock_id)
    if shed_id is not None:
        stmt = stmt.where(ScheduledDose.shed_id == shed_id)
    doses = list(await db.scalars(stmt.order_by(ScheduledDose.created_at.asc())))
    groups: dict[tuple, list[ScheduledDose]] = {}
    for dose in doses:
        key = (dose.flock_id, dose.vaccine_definition_id, dose.dose_number, dose.due_date)
        groups.setdefault(key, []).append(dose)

    deactivated = 0
    for group in groups.values():
        if len(group) < 2:
            continue
        completed = [d for d in group if str(d.status).startswith("completed")]
        open_doses = [d for d in group if d not in completed]
        if completed:
            # Keep earliest completed twin; retire open + extra completed clones.
            victims = open_doses + completed[1:]
        else:
            # Keep earliest open twin; deactivate the rest.
            victims = open_doses[1:]
        for dose in victims:
            dose.is_active = False
            if not str(dose.status).startswith("completed"):
                dose.status = STATUS_INACTIVE
            deactivated += 1
    if deactivated:
        await db.flush()
        if commit:
            await db.commit()
    return deactivated


async def list_scheduled_doses(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    flock_id: UUID | None = None,
    shed_id: UUID | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[ScheduledDose]:
    """List active scheduled doses.

    When the caller scopes to a shed (or a flock's shed), refresh open-dose statuses
    for that shed only so filtered task lists stay consistent with shed overview
    aggregates. Unfiltered org-wide reads remain pure (use POST /refresh-statuses).
    """
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(ScheduledDose).where(
        ScheduledDose.owner_account_id == ctx.owner_account_id,
        ScheduledDose.is_active.is_(True),
    )
    refresh_shed_id: UUID | None = None
    if shed_id is not None:
        await assert_shed_access(db, ctx, shed_id, permission_code="vaccination.view")
        stmt = stmt.where(ScheduledDose.shed_id == shed_id)
        refresh_shed_id = shed_id
    elif ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return []
        stmt = stmt.where(ScheduledDose.shed_id.in_(assigned))
    if flock_id:
        flock = await db.scalar(
            select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
        )
        if flock is None:
            return []
        await assert_shed_access(db, ctx, flock.shed_id, permission_code="vaccination.view")
        stmt = stmt.where(ScheduledDose.flock_id == flock_id)
        refresh_shed_id = flock.shed_id
    if status:
        stmt = stmt.where(ScheduledDose.status == status)
    # Collapse historical twin cards from repeated catalogue rematerialize.
    # Commit so the next dashboard load does not resurrect deactivated twins.
    deactivated = await reconcile_duplicate_scheduled_doses(
        db,
        owner_account_id=ctx.owner_account_id,
        flock_id=flock_id,
        shed_id=shed_id if flock_id is None else None,
        commit=True,
    )
    if deactivated:
        from app.core.database import set_rls_context

        await set_rls_context(
            db,
            user_id=ctx.user.id,
            owner_account_id=ctx.owner_account_id,
            role=ctx.membership.role.value if ctx.membership else None,
        )
    if refresh_shed_id is not None:
        await refresh_dose_statuses(db, ctx, shed_id=refresh_shed_id, commit=False)
    else:
        # Keep dashboard statuses accurate for "All sheds" without requiring schedule.manage.
        await refresh_dose_statuses(db, ctx, commit=False)
    return list(await db.scalars(stmt.order_by(ScheduledDose.due_date).limit(limit)))


async def enrich_scheduled_doses(
    db: AsyncSession,
    ctx: AuthContext,
    doses: list[ScheduledDose],
) -> list[ScheduledDoseOut]:
    """Attach display labels + flock population counts within the caller's owner scope.

    Vaccine names come from owner-scoped definitions — no schedule.view required.
    """
    assert ctx.owner_account_id is not None
    if not doses:
        return []

    vaccine_ids = {d.vaccine_definition_id for d in doses}
    shed_ids = {d.shed_id for d in doses}
    flock_ids = {d.flock_id for d in doses}

    vaccines = {
        row.id: row.name
        for row in await db.scalars(
            select(VaccineDefinition).where(
                VaccineDefinition.owner_account_id == ctx.owner_account_id,
                VaccineDefinition.id.in_(vaccine_ids),
            )
        )
    }
    sheds = {
        row.id: row.name
        for row in await db.scalars(
            select(Shed).where(
                Shed.owner_account_id == ctx.owner_account_id,
                Shed.id.in_(shed_ids),
            )
        )
    }
    flocks = {
        row.id: row
        for row in await db.scalars(
            select(Flock).where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.id.in_(flock_ids),
            )
        )
    }

    out: list[ScheduledDoseOut] = []
    for dose in doses:
        flock = flocks.get(dose.flock_id)
        eligible = int(dose.eligible_count or 0)
        completed = int(dose.completed_count or 0)
        remaining = max(0, eligible - completed)
        base = ScheduledDoseOut.model_validate(dose)
        out.append(
            base.model_copy(
                update={
                    "vaccine_name": vaccines.get(dose.vaccine_definition_id),
                    "shed_name": sheds.get(dose.shed_id),
                    "flock_label": (flock.batch_code if flock and flock.batch_code else None),
                    "banded_count": int(flock.banded_count) if flock is not None else None,
                    "unbanded_count": int(flock.unbanded_count) if flock is not None else None,
                    "remaining_count": remaining,
                }
            )
        )
    return out


async def refresh_dose_statuses(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    commit: bool = False,
    shed_id: UUID | None = None,
) -> int:
    """Bulk-update open dose statuses in one SQL statement (no per-row Python loop).

    Default ``commit=False`` keeps the update in the current transaction so RLS GUCs
    (transaction-local) are not cleared mid-request. Callers that own the request
    lifecycle may pass ``commit=True`` (e.g. dedicated refresh endpoint).

    Optional ``shed_id`` scopes the update to one shed (shed overview freshness).
    """
    from sqlalchemy import text

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)
    shed_clause = ""
    params: dict = {"today": today, "oid": str(ctx.owner_account_id)}
    if shed_id is not None:
        shed_clause = "AND shed_id = CAST(:shed_id AS uuid)"
        params["shed_id"] = str(shed_id)
    result = await db.execute(
        text(
            f"""
            UPDATE scheduled_doses AS d
            SET status = v.new_status
            FROM (
              SELECT id,
                     CASE
                       WHEN needs_review THEN 'needs_review'
                       WHEN CAST(:today AS date) < (due_date - reminder_lead_days) THEN 'upcoming'
                       WHEN CAST(:today AS date) < due_date THEN 'due_soon'
                       WHEN CAST(:today AS date) = due_date THEN 'due_today'
                       WHEN grace_period_days > 0
                            AND CAST(:today AS date) > due_date
                            AND CAST(:today AS date) <= (due_date + grace_period_days)
                         THEN 'due_today'
                       WHEN CAST(:today AS date) > (due_date + GREATEST(grace_period_days, 0))
                         THEN 'overdue'
                       ELSE 'due_today'
                     END AS new_status
              FROM scheduled_doses
              WHERE owner_account_id = CAST(:oid AS uuid)
                AND is_active IS TRUE
                AND status NOT LIKE 'completed%'
                AND status NOT IN ('skipped', 'inactive')
                {shed_clause}
            ) AS v
            WHERE d.id = v.id
              AND d.status IS DISTINCT FROM v.new_status
            """
        ),
        params,
    )
    updated = result.rowcount or 0
    if commit and updated:
        await db.commit()
        # Commit ends the transaction and clears local RLS GUCs — restore for any follow-up work.
        from app.core.database import set_rls_context

        await set_rls_context(
            db,
            user_id=ctx.user.id,
            owner_account_id=ctx.owner_account_id,
            role=ctx.membership.role.value if ctx.membership else None,
        )
    return updated
