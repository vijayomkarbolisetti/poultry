"""Reconcile flock-level scheduled doses after population or shed membership changes.

Uses the existing partial-coverage model (eligible_count / completed_count):
- Growing a completed cohort reopens the dose only for uncovered headcount.
- Individual VaccinationEvent rows with bird_id are treated as coverage evidence.
- Historical administration fields are never rewritten.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.models.enums import BirdLifecycleStatus, FlockStatus
from app.models.flock import Bird, Flock
from app.models.owner import OwnerAccount
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import ScheduledDose
from app.services.schedule_engine import (
    STATUS_COMPLETED_TIMING_UNKNOWN,
    STATUS_INACTIVE,
    compute_dose_status,
    farm_local_today,
)


def _is_completed(status: str | None) -> bool:
    return str(status or "").startswith("completed")


async def refresh_flock_dose_eligibility(db: AsyncSession, flock_id: UUID) -> int:
    """Align flock-level dose counters with live headcount.

    - Open doses: eligible_count = live count; clamp completed_count ≤ eligible.
    - Completed doses with completed_count < live: reopen (keep completed_count).
    - Live count 0: deactivate open doses; zero eligible on completed historical rows.
    """
    flock = await db.get(Flock, flock_id)
    if not flock:
        return 0

    owner = await db.get(OwnerAccount, flock.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)
    live = max(int(flock.current_count), 0)

    doses = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.flock_id == flock_id,
                ScheduledDose.bird_id.is_(None),
                ScheduledDose.is_active.is_(True),
            )
        )
    )
    updated = 0
    for dose in doses:
        if live == 0:
            if _is_completed(dose.status):
                if dose.eligible_count != 0:
                    dose.eligible_count = 0
                    updated += 1
            else:
                dose.is_active = False
                dose.status = STATUS_INACTIVE
                dose.eligible_count = 0
                updated += 1
            continue

        before = (dose.eligible_count, dose.completed_count, dose.status, dose.is_active)
        dose.eligible_count = live

        if dose.completed_count > live:
            dose.completed_count = live

        if _is_completed(dose.status):
            if dose.completed_count < live:
                # Uncovered birds joined after full coverage — reopen for the delta only.
                dose.status = compute_dose_status(
                    due_date=dose.due_date,
                    grace_period_days=dose.grace_period_days,
                    reminder_lead_days=dose.reminder_lead_days,
                    today=today,
                    dob_confidence=flock.dob_confidence,
                )
                dose.needs_review = False
        else:
            if live > 0 and dose.completed_count >= live:
                dose.status = STATUS_COMPLETED_TIMING_UNKNOWN
                dose.needs_review = False
            elif flock.status != FlockStatus.active:
                dose.status = STATUS_INACTIVE
                dose.is_active = False
            else:
                dose.status = compute_dose_status(
                    due_date=dose.due_date,
                    grace_period_days=dose.grace_period_days,
                    reminder_lead_days=dose.reminder_lead_days,
                    today=today,
                    dob_confidence=flock.dob_confidence,
                )

        after = (dose.eligible_count, dose.completed_count, dose.status, dose.is_active)
        if after != before:
            updated += 1

    if updated:
        await db.flush()
    return updated


async def credit_individual_bird_coverage(db: AsyncSession, flock_id: UUID) -> int:
    """Raise completed_count from bird-linked vaccination evidence (never invent coverage).

    Evidence rules:
    - Non-void VaccinationEvent with bird_id currently in this flock.
    - If event.scheduled_dose_id is set, use that dose's dose_number + vaccine.
    - If not, credit dose_number 1 for the event's vaccine_definition_id only.
    """
    flock = await db.get(Flock, flock_id)
    if not flock or flock.current_count <= 0:
        return 0

    owner = await db.get(OwnerAccount, flock.owner_account_id)
    today = farm_local_today(owner.timezone if owner else None)

    birds = list(
        await db.scalars(
            select(Bird).where(
                Bird.flock_id == flock_id,
                Bird.is_active.is_(True),
                Bird.lifecycle_status == BirdLifecycleStatus.active,
            )
        )
    )
    if not birds:
        return 0
    bird_ids = [b.id for b in birds]

    events = list(
        await db.scalars(
            select(VaccinationEvent).where(
                VaccinationEvent.bird_id.in_(bird_ids),
                VaccinationEvent.is_void.is_(False),
            )
        )
    )
    if not events:
        return 0

    dose_ids = {e.scheduled_dose_id for e in events if e.scheduled_dose_id}
    dose_meta: dict[UUID, ScheduledDose] = {}
    if dose_ids:
        dose_meta = {
            d.id: d
            for d in await db.scalars(select(ScheduledDose).where(ScheduledDose.id.in_(dose_ids)))
        }

    # (bird_id, vaccine_definition_id, dose_number) covered with evidence
    covered: set[tuple[UUID, UUID, int]] = set()
    for event in events:
        if event.bird_id is None:
            continue
        if event.scheduled_dose_id and event.scheduled_dose_id in dose_meta:
            src = dose_meta[event.scheduled_dose_id]
            covered.add((event.bird_id, src.vaccine_definition_id, int(src.dose_number)))
        else:
            covered.add((event.bird_id, event.vaccine_definition_id, 1))

    doses = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.flock_id == flock_id,
                ScheduledDose.bird_id.is_(None),
                ScheduledDose.is_active.is_(True),
            )
        )
    )
    updated = 0
    for dose in doses:
        bird_hits = {
            bird_id
            for bird_id, vaccine_id, dose_number in covered
            if vaccine_id == dose.vaccine_definition_id and dose_number == dose.dose_number
        }
        individual_count = len(bird_hits)
        if individual_count <= 0:
            continue

        new_completed = max(int(dose.completed_count or 0), individual_count)
        new_completed = min(new_completed, int(dose.eligible_count or 0))
        if new_completed == dose.completed_count and _is_completed(dose.status):
            continue

        dose.completed_count = new_completed
        if new_completed >= dose.eligible_count and dose.eligible_count > 0:
            dose.status = STATUS_COMPLETED_TIMING_UNKNOWN
            dose.needs_review = False
        elif not _is_completed(dose.status):
            dose.status = compute_dose_status(
                due_date=dose.due_date,
                grace_period_days=dose.grace_period_days,
                reminder_lead_days=dose.reminder_lead_days,
                today=today,
                dob_confidence=flock.dob_confidence,
            )
        updated += 1

    if updated:
        await db.flush()
    return updated


async def sync_flock_vaccination_tasks(
    db: AsyncSession,
    ctx: AuthContext,
    flock_id: UUID,
    *,
    ensure_schedules: bool = True,
    commit: bool = True,
) -> dict[str, int]:
    """Ensure schedules exist, refresh eligibility, credit individual evidence, dedupe twins."""
    from app.services import catalogue_service, vaccine_service

    created = 0
    if ensure_schedules:
        created = await catalogue_service.ensure_schedules_for_flock(db, ctx, flock_id)

    refreshed = await refresh_flock_dose_eligibility(db, flock_id)
    credited = await credit_individual_bird_coverage(db, flock_id)
    deactivated = await vaccine_service.reconcile_duplicate_scheduled_doses(
        db,
        owner_account_id=ctx.owner_account_id,  # type: ignore[arg-type]
        flock_id=flock_id,
        commit=False,
    )
    if commit:
        await db.commit()
    return {
        "schedules_created": int(created or 0),
        "eligibility_updated": refreshed,
        "individual_credited": credited,
        "twins_deactivated": deactivated,
    }


async def reconcile_shed_transfer_vaccination(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    source_flock_ids: list[UUID],
    destination_flock_id: UUID,
    commit: bool = True,
) -> None:
    """After birds move sheds: shrink/deactivate source tasks; sync destination tasks."""
    seen: set[UUID] = set()
    for flock_id in source_flock_ids:
        if flock_id in seen or flock_id == destination_flock_id:
            continue
        seen.add(flock_id)
        # Source: do not mint new schedules; only realign existing counters / empty flock.
        await sync_flock_vaccination_tasks(
            db, ctx, flock_id, ensure_schedules=False, commit=False
        )

    await sync_flock_vaccination_tasks(
        db, ctx, destination_flock_id, ensure_schedules=True, commit=False
    )
    if commit:
        await db.commit()
