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

    if data.bird_id:
        from app.models.enums import BirdLifecycleStatus
        from app.models.flock import Bird

        target = await db.scalar(
            select(Bird).where(
                Bird.id == data.bird_id,
                Bird.owner_account_id == ctx.owner_account_id,
            )
        )
        if target is None:
            raise VaccinationError("Bird not found", "NOT_FOUND")
        if not target.is_active or target.lifecycle_status != BirdLifecycleStatus.active:
            raise VaccinationError(
                "Cannot record vaccination for a bird that is not active (sold, dead, or transferred)",
                "BIRD_INACTIVE",
            )

    dose: ScheduledDose | None = None
    custom_vaccine_name: str | None = None
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
        custom_raw = getattr(data, "custom_vaccine_name", None)
        custom_vaccine_name = custom_raw.strip() if isinstance(custom_raw, str) and custom_raw.strip() else None
        if vaccine_id is None and not custom_vaccine_name:
            raise VaccinationError(
                "vaccine_definition_id or custom_vaccine_name is required",
                "INVALID",
            )
        if vaccine_id is not None:
            from app.models.vaccine import VaccineDefinition

            definition = await db.scalar(
                select(VaccineDefinition).where(
                    VaccineDefinition.id == vaccine_id,
                    VaccineDefinition.owner_account_id == ctx.owner_account_id,
                )
            )
            if definition is None:
                raise VaccinationError("Vaccine definition not found", "NOT_FOUND")

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
        custom_vaccine_name=custom_vaccine_name,
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
            custom_vaccine_name=None,
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


def serialize_vaccination_event(
    event: VaccinationEvent,
    *,
    vaccine_name: str | None = None,
) -> dict:
    """Build API payload with resolved vaccine name and scheduled vs manual kind."""
    resolved = vaccine_name or event.custom_vaccine_name
    return {
        "id": event.id,
        "shed_id": event.shed_id,
        "flock_id": event.flock_id,
        "bird_id": event.bird_id,
        "scheduled_dose_id": event.scheduled_dose_id,
        "vaccine_definition_id": event.vaccine_definition_id,
        "custom_vaccine_name": event.custom_vaccine_name,
        "vaccine_name": resolved,
        "recording_kind": "scheduled" if event.scheduled_dose_id else "manual",
        "administration_date": event.administration_date,
        "birds_covered": event.birds_covered,
        "lot_number": event.lot_number,
        "product_expiry": event.product_expiry,
        "manufacturer_or_brand": event.manufacturer_or_brand,
        "vaccine_type_or_strain": event.vaccine_type_or_strain,
        "dose_amount": event.dose_amount,
        "route": event.route,
        "notes": event.notes,
        "verification_status": event.verification_status,
        "timing_status": event.timing_status,
        "is_void": event.is_void,
        "created_at": event.created_at,
    }


async def enrich_vaccination_events(
    db: AsyncSession, events: list[VaccinationEvent]
) -> list[dict]:
    from app.models.vaccine import VaccineDefinition

    def_ids = {e.vaccine_definition_id for e in events if e.vaccine_definition_id}
    names: dict[UUID, str] = {}
    if def_ids:
        rows = await db.execute(
            select(VaccineDefinition.id, VaccineDefinition.name).where(
                VaccineDefinition.id.in_(def_ids)
            )
        )
        names = {row[0]: row[1] for row in rows}
    return [
        serialize_vaccination_event(
            event,
            vaccine_name=names.get(event.vaccine_definition_id) if event.vaccine_definition_id else None,
        )
        for event in events
    ]


async def record_manual_vaccination_batch(db: AsyncSession, ctx: AuthContext, data):
    """Record one individual vaccination event per selected bird (ad-hoc / manual)."""
    from types import SimpleNamespace

    from app.models.enums import BirdLifecycleStatus
    from app.models.flock import Bird
    from app.schemas.vaccine import ManualVaccinationBatchOut, ManualVaccinationBirdResultOut

    assert ctx.owner_account_id
    batch_key = data.idempotency_key.strip()
    bird_ids: list[UUID] = list(dict.fromkeys(data.bird_ids))

    prior = list(
        await db.scalars(
            select(VaccinationEvent).where(
                VaccinationEvent.owner_account_id == ctx.owner_account_id,
                VaccinationEvent.idempotency_key.like(f"{batch_key}:%"),
            )
        )
    )
    if prior:
        prior_bird_ids = {event.bird_id for event in prior}
        if len(prior) != len(bird_ids) or prior_bird_ids != set(bird_ids):
            raise VaccinationError(
                "Idempotency key was already used with a different batch payload.",
                "IDEMPOTENCY_CONFLICT",
            )
        results = [
            ManualVaccinationBirdResultOut(
                bird_id=event.bird_id,  # type: ignore[arg-type]
                status="success",
                event_id=event.id,
                message="Replayed from idempotency key",
            )
            for event in prior
            if event.bird_id is not None
        ]
        return ManualVaccinationBatchOut(
            results=results,
            success_count=len(results),
            skipped_count=0,
            failed_count=0,
        )

    birds = list(
        await db.scalars(
            select(Bird).where(
                Bird.id.in_(bird_ids),
                Bird.owner_account_id == ctx.owner_account_id,
            )
        )
    )
    by_id = {b.id: b for b in birds}
    results: list[ManualVaccinationBirdResultOut] = []
    success = skipped = failed = 0

    for bird_id in bird_ids:
        bird = by_id.get(bird_id)
        if bird is None:
            results.append(
                ManualVaccinationBirdResultOut(
                    bird_id=bird_id, status="failed", message="Bird not found"
                )
            )
            failed += 1
            continue
        if not bird.is_active or bird.lifecycle_status != BirdLifecycleStatus.active:
            results.append(
                ManualVaccinationBirdResultOut(
                    bird_id=bird_id,
                    status="skipped",
                    message="Bird is not active",
                )
            )
            skipped += 1
            continue
        flock_id = data.flock_id or bird.flock_id
        try:
            event = await record_vaccination(
                db,
                ctx,
                SimpleNamespace(
                    scheduled_dose_id=None,
                    flock_id=flock_id,
                    bird_id=bird.id,
                    vaccine_definition_id=data.vaccine_definition_id,
                    custom_vaccine_name=data.custom_vaccine_name,
                    schedule_version_id=None,
                    administered_at=data.administered_at,
                    administration_date=data.administration_date,
                    birds_covered=1,
                    lot_number=data.lot_number,
                    product_expiry=data.product_expiry,
                    manufacturer_or_brand=data.manufacturer_or_brand,
                    vaccine_type_or_strain=data.vaccine_type_or_strain,
                    dose_amount=data.dose_amount,
                    route=data.route,
                    notes=data.notes,
                    verification_status=data.verification_status or "verified",
                    idempotency_key=f"{batch_key}:{bird.id}",
                ),
                commit=False,
            )
            results.append(
                ManualVaccinationBirdResultOut(
                    bird_id=bird.id,
                    status="success",
                    event_id=event.id,
                )
            )
            success += 1
        except VaccinationError as exc:
            results.append(
                ManualVaccinationBirdResultOut(
                    bird_id=bird_id, status="failed", message=exc.message
                )
            )
            failed += 1

    if success == 0 and failed > 0 and skipped == 0:
        await db.rollback()
        raise VaccinationError("No vaccinations were recorded", "ALL_FAILED")

    await db.commit()
    return ManualVaccinationBatchOut(
        results=results,
        success_count=success,
        skipped_count=skipped,
        failed_count=failed,
    )


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
