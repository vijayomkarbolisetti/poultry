"""Shed hatch-date / estimated-age cohort resolve and create (P5)."""

from __future__ import annotations

from datetime import date
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access
from app.models.enums import DobConfidence, FlockStatus, LifecycleEventType, TrackingMode
from app.models.flock import Flock
from app.models.lifecycle import LifecycleEvent
from app.models.audit import AuditLog
from app.models.shed import Shed


def _flock_error(message: str, code: str):
    from app.services.flock_service import FlockError

    return FlockError(message, code)


async def _reconcile(db: AsyncSession, flock: Flock) -> None:
    from app.services.flock_service import reconcile_flock_counts

    await reconcile_flock_counts(db, flock)


def _cohort_batch_code_exact(shed_code: str, hatch_date: date, *, suffix: str = "") -> str:
    base = f"C-{shed_code.strip().upper()[:10]}-{hatch_date.strftime('%Y%m%d')}"
    if suffix:
        base = f"{base}-{suffix}"
    return base[:64]


def _cohort_batch_code_estimated(
    shed_code: str, estimated_age_days: int, age_reported_on: date, *, suffix: str = ""
) -> str:
    base = (
        f"C-{shed_code.strip().upper()[:8]}-E{estimated_age_days}-"
        f"{age_reported_on.strftime('%Y%m%d')}"
    )
    if suffix:
        base = f"{base}-{suffix}"
    return base[:64]


async def resolve_active_cohort(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    shed_id: UUID,
    hatch_date: date | None = None,
    estimated_age_days: int | None = None,
    age_reported_on: date | None = None,
    for_update: bool = False,
) -> Flock:
    """Resolve exactly one active cohort. Rejects missing / ambiguous / incomplete age keys."""
    assert ctx.owner_account_id is not None
    exact = hatch_date is not None
    estimated = estimated_age_days is not None and age_reported_on is not None
    if exact == estimated:
        raise _flock_error(
            "Provide either hatch_date or (estimated_age_days and age_reported_on)",
            "MISSING_DOB",
        )
    if exact and hatch_date > date.today():  # type: ignore[operator]
        raise _flock_error("Hatch date cannot be in the future", "INVALID_DOB")
    if estimated and age_reported_on > date.today():  # type: ignore[operator]
        raise _flock_error("Age reported date cannot be in the future", "INVALID_DOB")
    if estimated and estimated_age_days < 0:  # type: ignore[operator]
        raise _flock_error("Estimated age cannot be negative", "INVALID_DOB")

    filters = [
        Flock.owner_account_id == ctx.owner_account_id,
        Flock.shed_id == shed_id,
        Flock.status == FlockStatus.active,
    ]
    if exact:
        filters.extend(
            [
                Flock.dob_confidence == DobConfidence.exact,
                Flock.hatch_date == hatch_date,
            ]
        )
    else:
        filters.extend(
            [
                Flock.dob_confidence == DobConfidence.estimated,
                Flock.estimated_age_days == estimated_age_days,
                Flock.age_reported_on == age_reported_on,
            ]
        )

    stmt = select(Flock).where(*filters).order_by(Flock.created_at.asc())
    if for_update:
        stmt = stmt.with_for_update()
    rows = list(await db.scalars(stmt))
    if len(rows) == 0:
        raise _flock_error("Population not found", "NOT_FOUND")
    if len(rows) > 1:
        raise _flock_error(
            "Multiple active populations match this hatch-date key",
            "AMBIGUOUS_COHORT",
        )
    return rows[0]


async def find_or_create_cohort_flock(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    shed_id: UUID,
    tracking_mode: TrackingMode,
    access_permission: str,
    hatch_date: date | None = None,
    estimated_age_days: int | None = None,
    age_reported_on: date | None = None,
    initial_unbanded: int = 0,
    commit: bool = True,
) -> tuple[Flock, bool]:
    """Reuse or create an active cohort. Uses savepoints on unique conflicts (no full rollback)."""
    assert ctx.owner_account_id is not None
    exact = hatch_date is not None
    estimated = estimated_age_days is not None and age_reported_on is not None
    from app.services.flock_service import FlockError

    if exact == estimated:
        raise FlockError(
            "Provide either hatch_date or (estimated_age_days and age_reported_on)",
            "MISSING_DOB",
        )
    if exact and hatch_date > date.today():  # type: ignore[operator]
        raise FlockError("Hatch date cannot be in the future", "INVALID_DOB")
    if estimated and age_reported_on > date.today():  # type: ignore[operator]
        raise FlockError("Age reported date cannot be in the future", "INVALID_DOB")

    await assert_shed_access(db, ctx, shed_id, permission_code=access_permission)
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        raise FlockError(exc.message, exc.code) from exc

    try:
        existing = await resolve_active_cohort(
            db,
            ctx,
            shed_id=shed_id,
            hatch_date=hatch_date,
            estimated_age_days=estimated_age_days,
            age_reported_on=age_reported_on,
            for_update=False,
        )
        return existing, False
    except FlockError as exc:
        if exc.code != "NOT_FOUND":
            raise

    shed = await db.scalar(
        select(Shed).where(Shed.id == shed_id, Shed.owner_account_id == ctx.owner_account_id)
    )
    if shed is None:
        raise FlockError("Shed not found", "NOT_FOUND")

    for attempt in range(3):
        if exact:
            code = _cohort_batch_code_exact(
                shed.code,
                hatch_date,  # type: ignore[arg-type]
                suffix="" if attempt == 0 else uuid4().hex[:4].upper(),
            )
            dob = DobConfidence.exact
            hd, ead, aro = hatch_date, None, None
        else:
            code = _cohort_batch_code_estimated(
                shed.code,
                estimated_age_days,  # type: ignore[arg-type]
                age_reported_on,  # type: ignore[arg-type]
                suffix="" if attempt == 0 else uuid4().hex[:4].upper(),
            )
            dob = DobConfidence.estimated
            hd, ead, aro = None, estimated_age_days, age_reported_on

        flock = Flock(
            owner_account_id=ctx.owner_account_id,
            shed_id=shed_id,
            batch_code=code,
            breed=None,
            hatch_date=hd,
            estimated_age_days=ead,
            age_reported_on=aro,
            dob_confidence=dob,
            initial_count=initial_unbanded,
            current_count=initial_unbanded,
            banded_count=0,
            unbanded_count=initial_unbanded,
            tracking_mode=tracking_mode,
            status=FlockStatus.active,
            notes=None,
        )
        if tracking_mode == TrackingMode.individual:
            flock.unbanded_count = 0
            flock.initial_count = 0
            flock.current_count = 0
        await _reconcile(db, flock)

        nested = await db.begin_nested()
        try:
            db.add(flock)
            await db.flush()
            await nested.commit()
        except IntegrityError:
            # Savepoint rollback only — outer transaction work is preserved.
            await nested.rollback()
            # Nested rollback may already have expunged the failed INSERT instance.
            if flock in db:
                await db.expunge(flock)
            try:
                raced = await resolve_active_cohort(
                    db,
                    ctx,
                    shed_id=shed_id,
                    hatch_date=hatch_date,
                    estimated_age_days=estimated_age_days,
                    age_reported_on=age_reported_on,
                    for_update=False,
                )
                return raced, False
            except FlockError as race_exc:
                if race_exc.code == "NOT_FOUND":
                    # Winner not visible yet, or batch_code collision — retry with suffix.
                    continue
                raise

        db.add(
            LifecycleEvent(
                owner_account_id=ctx.owner_account_id,
                shed_id=flock.shed_id,
                flock_id=flock.id,
                event_type=LifecycleEventType.onboarding,
                effective_date=date.today(),
                quantity=flock.initial_count,
                reason="Internal cohort created",
                recorded_by_user_id=ctx.user.id,
            )
        )
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="flock.create_internal_cohort",
                entity_type="flock",
                entity_id=flock.id,
                after={
                    "batch_code": flock.batch_code,
                    "hatch_date": str(hatch_date) if hatch_date else None,
                    "estimated_age_days": estimated_age_days,
                    "age_reported_on": str(age_reported_on) if age_reported_on else None,
                    "access_permission": access_permission,
                },
            )
        )
        if commit:
            await db.commit()
            await db.refresh(flock)
        return flock, True

    raise _flock_error("Could not create internal cohort", "COHORT_CREATE_FAILED")


async def lock_flocks_ordered(db: AsyncSession, ctx: AuthContext, flock_ids: list[UUID]) -> dict[UUID, Flock]:
    """Deterministic FOR UPDATE lock order to avoid deadlocks."""
    assert ctx.owner_account_id is not None
    unique = sorted({fid for fid in flock_ids})
    out: dict[UUID, Flock] = {}
    for fid in unique:
        flock = await db.scalar(
            select(Flock)
            .where(Flock.id == fid, Flock.owner_account_id == ctx.owner_account_id)
            .with_for_update()
        )
        if flock is None:
            raise _flock_error("Population not found", "NOT_FOUND")
        out[fid] = flock
    return out
