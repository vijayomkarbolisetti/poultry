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


async def _deactivate_sibling_open_doses(db: AsyncSession, dose: ScheduledDose) -> int:
    """After full coverage, retire open twin doses for the same logical schedule slot."""
    from app.services.schedule_engine import STATUS_INACTIVE

    siblings = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.owner_account_id == dose.owner_account_id,
                ScheduledDose.flock_id == dose.flock_id,
                ScheduledDose.vaccine_definition_id == dose.vaccine_definition_id,
                ScheduledDose.dose_number == dose.dose_number,
                ScheduledDose.due_date == dose.due_date,
                ScheduledDose.bird_id.is_(None),
                ScheduledDose.is_active.is_(True),
                ScheduledDose.id != dose.id,
                ~ScheduledDose.status.like("completed%"),
            )
        )
    )
    for sibling in siblings:
        sibling.is_active = False
        sibling.status = STATUS_INACTIVE
    return len(siblings)


async def record_vaccination(
    db: AsyncSession,
    ctx: AuthContext,
    data,
    *,
    commit: bool = True,
    for_update: bool = False,
    strict_remaining: bool = False,
) -> VaccinationEvent:
    assert ctx.owner_account_id
    if data.idempotency_key:
        existing = await db.scalar(
            select(VaccinationEvent).where(VaccinationEvent.idempotency_key == data.idempotency_key)
        )
        if existing:
            return existing

    dose: ScheduledDose | None = None
    if data.scheduled_dose_id:
        stmt = select(ScheduledDose).where(
            ScheduledDose.id == data.scheduled_dose_id,
            ScheduledDose.owner_account_id == ctx.owner_account_id,
        )
        if for_update:
            stmt = stmt.with_for_update()
        dose = await db.scalar(stmt)
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
            raise VaccinationError("Population not found", "NOT_FOUND")
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
        if birds_covered > remaining:
            if strict_remaining or remaining == 0:
                raise VaccinationError(
                    f"Only {remaining} birds remaining for this dose (requested {birds_covered}). Refresh and try again.",
                    "STALE_COVERAGE",
                )
            birds_covered = remaining
        dose.completed_count = min(dose.eligible_count, dose.completed_count + birds_covered)
        if dose.completed_count >= dose.eligible_count:
            # Full coverage: mark completed and clear review so dashboards leave the open queue.
            dose.status = timing
            dose.needs_review = False
            # Twin doses (same flock/vaccine/due from rematerialized rules) stay open otherwise.
            await _deactivate_sibling_open_doses(db, dose)
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
        manufacturer_or_brand=getattr(data, "manufacturer_or_brand", None),
        vaccine_type_or_strain=getattr(data, "vaccine_type_or_strain", None),
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
    if commit:
        await db.commit()
        await db.refresh(event)
    else:
        await db.flush()
        await db.refresh(event)
    return event


async def record_vaccination_batch(db: AsyncSession, ctx: AuthContext, data) -> list[VaccinationEvent]:
    """Record one or more population coverages atomically (shed-wide confirm)."""
    from types import SimpleNamespace

    assert ctx.owner_account_id
    batch_key = data.idempotency_key.strip()
    # Replay only when the same batch key covered the exact same scheduled doses.
    # Matching on count alone wrongly "succeeds" when the client reuses a key across
    # different dose screens (Expo Router often keeps [id] mounted and reuseState).
    prior = list(
        await db.scalars(
            select(VaccinationEvent).where(
                VaccinationEvent.owner_account_id == ctx.owner_account_id,
                VaccinationEvent.idempotency_key.like(f"{batch_key}:%"),
            )
        )
    )
    if prior:
        prior_dose_ids = {event.scheduled_dose_id for event in prior}
        request_dose_ids = {item.scheduled_dose_id for item in data.items}
        if len(prior) != len(data.items) or prior_dose_ids != request_dose_ids:
            raise VaccinationError(
                "Idempotency key was already used with a different batch payload.",
                "IDEMPOTENCY_CONFLICT",
            )
        return prior

    events: list[VaccinationEvent] = []
    for item in data.items:
        row = SimpleNamespace(
            scheduled_dose_id=item.scheduled_dose_id,
            flock_id=None,
            bird_id=None,
            vaccine_definition_id=None,
            schedule_version_id=None,
            administered_at=None,
            administration_date=data.administration_date,
            birds_covered=item.birds_covered,
            lot_number=data.lot_number,
            product_expiry=data.product_expiry,
            manufacturer_or_brand=data.manufacturer_or_brand,
            vaccine_type_or_strain=data.vaccine_type_or_strain,
            dose_amount=data.dose_amount,
            route=data.route,
            notes=data.notes,
            verification_status=data.verification_status or "verified",
            idempotency_key=f"{batch_key}:{item.scheduled_dose_id}",
        )
        events.append(
            await record_vaccination(
                db,
                ctx,
                row,
                commit=False,
                for_update=True,
                strict_remaining=True,
            )
        )
    await db.commit()
    for event in events:
        await db.refresh(event)
    return events


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
