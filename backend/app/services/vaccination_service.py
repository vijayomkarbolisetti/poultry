from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.models.audit import AuditLog
from app.models.enums import MembershipRole
from app.models.flock import Flock
from app.models.owner import OwnerAccount
from app.models.vaccination import VaccinationCorrection, VaccinationEvent
from app.models.vaccine import ScheduledDose
from app.services.schedule_engine import (
    STATUS_COMPLETED_LATE,
    STATUS_COMPLETED_ON_TIME,
    STATUS_COMPLETED_TIMING_UNKNOWN,
    STATUS_OVERDUE,
    compute_dose_status,
    farm_local_date,
    farm_local_today,
)


class VaccinationError(Exception):
    def __init__(self, message: str, code: str = "VACCINATION_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def record_vaccination(db: AsyncSession, ctx: AuthContext, data) -> VaccinationEvent:
    assert ctx.owner_account_id
    if data.idempotency_key:
        existing = await db.scalar(
            select(VaccinationEvent).where(VaccinationEvent.idempotency_key == data.idempotency_key)
        )
        if existing:
            return existing

    dose: ScheduledDose | None = None
    if data.scheduled_dose_id:
        dose = await db.scalar(
            select(ScheduledDose).where(
                ScheduledDose.id == data.scheduled_dose_id,
                ScheduledDose.owner_account_id == ctx.owner_account_id,
            )
        )
        if not dose:
            raise VaccinationError("Scheduled dose not found", "NOT_FOUND")
        await assert_shed_access(db, ctx, dose.shed_id, permission_code="vaccination.record")
        flock_id = dose.flock_id
        shed_id = dose.shed_id
        vaccine_id = dose.vaccine_definition_id
        version_id = dose.schedule_version_id
    else:
        flock = await db.scalar(
            select(Flock).where(Flock.id == data.flock_id, Flock.owner_account_id == ctx.owner_account_id)
        )
        if not flock:
            raise VaccinationError("Flock not found", "NOT_FOUND")
        await assert_shed_access(db, ctx, flock.shed_id, permission_code="vaccination.record")
        flock_id = flock.id
        shed_id = flock.shed_id
        vaccine_id = data.vaccine_definition_id
        version_id = data.schedule_version_id
        if not vaccine_id:
            raise VaccinationError("vaccine_definition_id required", "INVALID")

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    admin_at = data.administered_at or datetime.now(timezone.utc)
    if admin_at.tzinfo is None:
        admin_at = admin_at.replace(tzinfo=timezone.utc)
    admin_date = data.administration_date or farm_local_date(admin_at, owner.timezone if owner else None)

    birds_covered = data.birds_covered or 1
    verification = data.verification_status or "verified"

    timing = STATUS_COMPLETED_TIMING_UNKNOWN
    if dose:
        timing = compute_dose_status(
            due_date=dose.due_date,
            grace_period_days=dose.grace_period_days,
            reminder_lead_days=dose.reminder_lead_days,
            today=farm_local_today(owner.timezone if owner else None),
            completed_admin_date=admin_date,
            verification_status=verification,
        )
        # remaining eligibility for partial bulk
        remaining = max(dose.eligible_count - dose.completed_count, 0)
        if birds_covered > remaining and remaining > 0:
            birds_covered = remaining
        dose.completed_count = min(dose.eligible_count, dose.completed_count + birds_covered)
        if dose.completed_count >= dose.eligible_count:
            dose.status = timing
        else:
            # partial — keep overdue/due if still open
            if dose.due_date < farm_local_today(owner.timezone if owner else None):
                dose.status = STATUS_OVERDUE
            dose.needs_review = False

    event = VaccinationEvent(
        owner_account_id=ctx.owner_account_id,
        shed_id=shed_id,
        flock_id=flock_id,
        bird_id=data.bird_id,
        scheduled_dose_id=dose.id if dose else None,
        vaccine_definition_id=vaccine_id,
        schedule_version_id=version_id,
        administered_at=admin_at,
        administration_date=admin_date,
        birds_covered=birds_covered,
        recorded_by_user_id=ctx.user.id,
        lot_number=data.lot_number,
        product_expiry=data.product_expiry,
        dose_amount=data.dose_amount,
        route=data.route,
        notes=data.notes,
        verification_status=verification,
        timing_status=timing
        if timing
        in {STATUS_COMPLETED_ON_TIME, STATUS_COMPLETED_LATE, STATUS_COMPLETED_TIMING_UNKNOWN}
        else STATUS_COMPLETED_ON_TIME,
        idempotency_key=data.idempotency_key,
    )
    db.add(event)
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="vaccination.record",
            entity_type="vaccination_event",
            entity_id=None,
            after={"birds_covered": birds_covered, "timing": event.timing_status},
        )
    )
    await db.commit()
    await db.refresh(event)
    return event


async def void_or_correct(db: AsyncSession, ctx: AuthContext, event_id: UUID, data) -> VaccinationEvent:
    event = await db.scalar(
        select(VaccinationEvent).where(
            VaccinationEvent.id == event_id,
            VaccinationEvent.owner_account_id == ctx.owner_account_id,
        )
    )
    if not event:
        raise VaccinationError("Not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, event.shed_id, permission_code="vaccination.correct")
    before = {
        "birds_covered": event.birds_covered,
        "administration_date": str(event.administration_date),
        "is_void": event.is_void,
        "notes": event.notes,
    }
    if data.void:
        event.is_void = True
        event.void_reason = data.reason
        if event.scheduled_dose_id:
            dose = await db.get(ScheduledDose, event.scheduled_dose_id)
            if dose:
                dose.completed_count = max(0, dose.completed_count - event.birds_covered)
                dose.status = STATUS_OVERDUE
    else:
        if data.birds_covered is not None:
            event.birds_covered = data.birds_covered
        if data.administration_date is not None:
            event.administration_date = data.administration_date
        if data.notes is not None:
            event.notes = data.notes
    after = {
        "birds_covered": event.birds_covered,
        "administration_date": str(event.administration_date),
        "is_void": event.is_void,
        "notes": event.notes,
    }
    db.add(
        VaccinationCorrection(
            owner_account_id=ctx.owner_account_id,
            vaccination_event_id=event.id,
            actor_user_id=ctx.user.id,
            reason=data.reason,
            before=before,
            after=after,
        )
    )
    await db.commit()
    await db.refresh(event)
    return event


async def list_events(db: AsyncSession, ctx: AuthContext, flock_id: UUID | None = None) -> list[VaccinationEvent]:
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(VaccinationEvent).where(
        VaccinationEvent.owner_account_id == ctx.owner_account_id,
        VaccinationEvent.is_void.is_(False),
    )
    if flock_id:
        flock = await db.scalar(
            select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
        )
        if flock is None:
            return []
        await assert_shed_access(db, ctx, flock.shed_id, permission_code="vaccination.view")
        stmt = stmt.where(VaccinationEvent.flock_id == flock_id)
    elif ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return []
        stmt = stmt.where(VaccinationEvent.shed_id.in_(assigned))
    return list(await db.scalars(stmt.order_by(VaccinationEvent.administered_at.desc())))
