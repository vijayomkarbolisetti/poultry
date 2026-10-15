from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access
from app.models.audit import AuditLog
from app.models.enums import DobConfidence, FlockStatus
from app.models.flock import Bird, Flock
from app.models.owner import OwnerAccount
from app.models.vaccine import ScheduledDose, ScheduleRule, VaccineDefinition, VaccineScheduleVersion
from app.services.schedule_engine import (
    STATUS_INACTIVE,
    STATUS_NEEDS_REVIEW,
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


async def generate_schedules_for_flock(
    db: AsyncSession,
    ctx: AuthContext,
    flock_id: UUID,
    *,
    vaccine_definition_ids: list[UUID] | None = None,
) -> list[ScheduledDose]:
    flock = await db.scalar(
        select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
    )
    if not flock:
        raise VaccineError("Flock not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="schedule.view")

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)

    defs_stmt = select(VaccineDefinition).where(
        VaccineDefinition.owner_account_id == ctx.owner_account_id,
        VaccineDefinition.is_active.is_(True),
    )
    if vaccine_definition_ids:
        defs_stmt = defs_stmt.where(VaccineDefinition.id.in_(vaccine_definition_ids))
    definitions = list(await db.scalars(defs_stmt))

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
                exists = await db.scalar(
                    select(ScheduledDose.id).where(
                        ScheduledDose.flock_id == flock.id,
                        ScheduledDose.schedule_rule_id == rule.id,
                        ScheduledDose.due_date == due,
                        ScheduledDose.bird_id.is_(None),
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
    await db.commit()
    return created


async def list_scheduled_doses(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    flock_id: UUID | None = None,
    status: str | None = None,
) -> list[ScheduledDose]:
    stmt = select(ScheduledDose).where(
        ScheduledDose.owner_account_id == ctx.owner_account_id,
        ScheduledDose.is_active.is_(True),
    )
    if flock_id:
        stmt = stmt.where(ScheduledDose.flock_id == flock_id)
    if status:
        stmt = stmt.where(ScheduledDose.status == status)
    return list(await db.scalars(stmt.order_by(ScheduledDose.due_date)))


async def refresh_dose_statuses(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    commit: bool = False,
) -> int:
    """Bulk-update open dose statuses in one SQL statement (no per-row Python loop).

    Default ``commit=False`` keeps the update in the current transaction so RLS GUCs
    (transaction-local) are not cleared mid-request. Callers that own the request
    lifecycle may pass ``commit=True`` (e.g. dedicated refresh endpoint).
    """
    from sqlalchemy import text

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)
    result = await db.execute(
        text(
            """
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
            ) AS v
            WHERE d.id = v.id
              AND d.status IS DISTINCT FROM v.new_status
            """
        ),
        {"today": today, "oid": str(ctx.owner_account_id)},
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
