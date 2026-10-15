from datetime import date, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access
from app.models.audit import AuditLog
from app.models.enums import (
    BirdLifecycleStatus,
    DobConfidence,
    FlockStatus,
    LifecycleEventType,
    TrackingMode,
)
from app.models.flock import Bird, Flock
from app.models.lifecycle import LifecycleEvent
from app.models.shed import Shed


class FlockError(Exception):
    def __init__(self, message: str, code: str = "FLOCK_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def derive_hatch_date(
    *,
    hatch_date: date | None,
    estimated_age_days: int | None,
    age_reported_on: date | None,
    dob_confidence: DobConfidence,
) -> date | None:
    if hatch_date:
        return hatch_date
    if dob_confidence == DobConfidence.estimated and estimated_age_days is not None:
        reported = age_reported_on or date.today()
        return reported - timedelta(days=estimated_age_days)
    return None


async def reconcile_flock_counts(db: AsyncSession, flock: Flock) -> None:
    active_banded = (
        await db.scalar(
            select(func.count())
            .select_from(Bird)
            .where(
                Bird.flock_id == flock.id,
                Bird.is_active.is_(True),
                Bird.lifecycle_status == BirdLifecycleStatus.active,
                Bird.band_id.is_not(None),
            )
        )
        or 0
    )
    flock.banded_count = int(active_banded)
    if flock.tracking_mode == TrackingMode.batch:
        flock.unbanded_count = flock.current_count
        flock.banded_count = 0
    elif flock.tracking_mode == TrackingMode.individual:
        flock.unbanded_count = 0
        flock.current_count = flock.banded_count
    else:
        # mixed: current_count should equal banded + unbanded
        expected = flock.banded_count + flock.unbanded_count
        flock.count_mismatch = flock.current_count != expected
        if not flock.count_mismatch:
            flock.current_count = expected


async def create_flock(db: AsyncSession, ctx: AuthContext, data) -> Flock:
    assert ctx.owner_account_id is not None
    await assert_shed_access(db, ctx, data.shed_id, permission_code="flock.create")
    shed = await db.scalar(
        select(Shed).where(Shed.id == data.shed_id, Shed.owner_account_id == ctx.owner_account_id)
    )
    if shed is None:
        raise FlockError("Shed not found", "SHED_NOT_FOUND")

    hatch = derive_hatch_date(
        hatch_date=data.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        dob_confidence=data.dob_confidence,
    )
    unbanded = data.unbanded_count
    if unbanded is None:
        if data.tracking_mode == TrackingMode.individual:
            unbanded = 0
        else:
            unbanded = data.initial_count

    flock = Flock(
        owner_account_id=ctx.owner_account_id,
        shed_id=data.shed_id,
        batch_code=data.batch_code.strip().upper(),
        breed=data.breed,
        hatch_date=hatch,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        dob_confidence=data.dob_confidence,
        initial_count=data.initial_count,
        current_count=data.initial_count,
        banded_count=0,
        unbanded_count=unbanded,
        tracking_mode=data.tracking_mode,
        status=FlockStatus.active,
        notes=data.notes,
    )
    await reconcile_flock_counts(db, flock)
    db.add(flock)
    await db.flush()
    db.add(
        LifecycleEvent(
            owner_account_id=ctx.owner_account_id,
            shed_id=flock.shed_id,
            flock_id=flock.id,
            event_type=LifecycleEventType.onboarding,
            effective_date=date.today(),
            quantity=flock.initial_count,
            reason="Flock onboarded",
            recorded_by_user_id=ctx.user.id,
        )
    )
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="flock.create",
            entity_type="flock",
            entity_id=flock.id,
            after={"batch_code": flock.batch_code, "initial_count": flock.initial_count},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise FlockError("Batch code already exists", "DUPLICATE_BATCH") from exc
    await db.refresh(flock)
    return flock


async def list_flocks(db: AsyncSession, ctx: AuthContext, shed_id: UUID | None = None) -> list[Flock]:
    assert ctx.owner_account_id is not None
    stmt = select(Flock).where(
        Flock.owner_account_id == ctx.owner_account_id,
        Flock.status == FlockStatus.active,
    )
    if shed_id:
        await assert_shed_access(db, ctx, shed_id, permission_code="flock.view")
        stmt = stmt.where(Flock.shed_id == shed_id)
    return list(await db.scalars(stmt.order_by(Flock.created_at.desc()).limit(200)))


async def get_flock(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> Flock:
    flock = await db.scalar(
        select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
    )
    if flock is None:
        raise FlockError("Flock not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="flock.view")
    return flock


async def update_flock(db: AsyncSession, ctx: AuthContext, flock_id: UUID, data) -> Flock:
    flock = await get_flock(db, ctx, flock_id)
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="flock.update")
    if data.breed is not None:
        flock.breed = data.breed
    if data.notes is not None:
        flock.notes = data.notes
    if data.status is not None:
        flock.status = data.status
    if data.current_count is not None:
        if data.current_count < 0:
            raise FlockError("Count cannot be negative", "NEGATIVE_COUNT")
        before = flock.current_count
        flock.current_count = data.current_count
        if flock.tracking_mode == TrackingMode.batch:
            flock.unbanded_count = data.current_count
        db.add(
            LifecycleEvent(
                owner_account_id=ctx.owner_account_id,
                shed_id=flock.shed_id,
                flock_id=flock.id,
                event_type=LifecycleEventType.count_adjustment,
                effective_date=date.today(),
                quantity=data.current_count,
                reason=f"Count adjusted from {before}",
                recorded_by_user_id=ctx.user.id,
            )
        )
    await reconcile_flock_counts(db, flock)
    await db.commit()
    await db.refresh(flock)
    return flock


async def create_bird(db: AsyncSession, ctx: AuthContext, data) -> Bird:
    flock = await get_flock(db, ctx, data.flock_id)
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="bird.create")
    if flock.tracking_mode == TrackingMode.batch and data.band_id:
        raise FlockError("Batch flocks cannot add banded birds; switch to mixed/individual", "MODE")
    if data.band_id:
        dup = await db.scalar(
            select(Bird.id).where(
                Bird.owner_account_id == ctx.owner_account_id,
                Bird.band_id == data.band_id.strip(),
                Bird.is_active.is_(True),
            )
        )
        if dup:
            raise FlockError("Band ID already in use", "DUPLICATE_BAND")

    hatch = derive_hatch_date(
        hatch_date=data.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        dob_confidence=data.dob_confidence,
    )
    bird = Bird(
        owner_account_id=ctx.owner_account_id,
        shed_id=flock.shed_id,
        flock_id=flock.id,
        band_id=data.band_id.strip() if data.band_id else None,
        display_code=data.band_id.strip() if data.band_id else None,
        hatch_date=hatch or flock.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        dob_confidence=data.dob_confidence,
        breed=data.breed or flock.breed,
        sex=data.sex,
        notes=data.notes,
        lifecycle_status=BirdLifecycleStatus.active,
        is_active=True,
    )
    db.add(bird)
    await db.flush()

    if bird.band_id:
        if flock.tracking_mode == TrackingMode.mixed and flock.unbanded_count > 0:
            flock.unbanded_count -= 1
        elif flock.tracking_mode == TrackingMode.individual:
            flock.current_count = flock.current_count  # reconciled below
        if flock.tracking_mode == TrackingMode.mixed:
            pass
        flock.current_count = max(flock.current_count, flock.banded_count + 1)
    await reconcile_flock_counts(db, flock)
    if flock.tracking_mode == TrackingMode.mixed:
        flock.current_count = flock.banded_count + flock.unbanded_count
        flock.count_mismatch = False
    elif flock.tracking_mode == TrackingMode.individual:
        flock.current_count = flock.banded_count

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="bird.create",
            entity_type="bird",
            entity_id=bird.id,
            after={"band_id": bird.band_id},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise FlockError("Band ID conflict", "DUPLICATE_BAND") from exc
    await db.refresh(bird)
    return bird


async def list_birds(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> list[Bird]:
    flock = await get_flock(db, ctx, flock_id)
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="bird.view")
    rows = await db.scalars(
        select(Bird).where(Bird.flock_id == flock_id, Bird.is_active.is_(True)).order_by(Bird.band_id)
    )
    return list(rows)


async def get_bird(db: AsyncSession, ctx: AuthContext, bird_id: UUID) -> Bird:
    bird = await db.scalar(
        select(Bird).where(Bird.id == bird_id, Bird.owner_account_id == ctx.owner_account_id)
    )
    if bird is None:
        raise FlockError("Bird not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, bird.shed_id, permission_code="bird.view")
    return bird


async def bulk_import_birds(db: AsyncSession, ctx: AuthContext, data) -> dict:
    flock = await get_flock(db, ctx, data.flock_id)
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="bird.create")
    if data.idempotency_key:
        existing = await db.scalar(
            select(LifecycleEvent).where(LifecycleEvent.idempotency_key == data.idempotency_key)
        )
        if existing:
            birds = await list_birds(db, ctx, flock.id)
            return {
                "created": len(birds),
                "failed": 0,
                "errors": [],
                "bird_ids": [b.id for b in birds],
                "idempotent_replay": True,
            }

    if flock.tracking_mode == TrackingMode.batch:
        flock.tracking_mode = TrackingMode.mixed

    created_ids: list[UUID] = []
    errors: list[dict] = []
    seen_bands: set[str] = set()

    for idx, row in enumerate(data.rows):
        band = row.band_id.strip()
        if band in seen_bands:
            errors.append({"row": idx, "band_id": band, "error": "Duplicate in upload"})
            continue
        seen_bands.add(band)
        dup = await db.scalar(
            select(Bird.id).where(
                Bird.owner_account_id == ctx.owner_account_id,
                Bird.band_id == band,
                Bird.is_active.is_(True),
            )
        )
        if dup:
            errors.append({"row": idx, "band_id": band, "error": "Band already exists"})
            continue
        hatch = derive_hatch_date(
            hatch_date=row.hatch_date,
            estimated_age_days=row.estimated_age_days,
            age_reported_on=date.today(),
            dob_confidence=data.dob_confidence,
        )
        bird = Bird(
            owner_account_id=ctx.owner_account_id,
            shed_id=flock.shed_id,
            flock_id=flock.id,
            band_id=band,
            display_code=band,
            hatch_date=hatch or flock.hatch_date,
            estimated_age_days=row.estimated_age_days,
            dob_confidence=data.dob_confidence,
            breed=row.breed or flock.breed,
            sex=row.sex,
            notes=row.notes,
            lifecycle_status=BirdLifecycleStatus.active,
            is_active=True,
        )
        db.add(bird)
        await db.flush()
        created_ids.append(bird.id)
        if flock.unbanded_count > 0:
            flock.unbanded_count -= 1

    await reconcile_flock_counts(db, flock)
    flock.current_count = flock.banded_count + flock.unbanded_count
    flock.count_mismatch = False

    db.add(
        LifecycleEvent(
            owner_account_id=ctx.owner_account_id,
            shed_id=flock.shed_id,
            flock_id=flock.id,
            event_type=LifecycleEventType.band_assignment,
            effective_date=date.today(),
            quantity=len(created_ids),
            reason="Bulk bird import",
            recorded_by_user_id=ctx.user.id,
            idempotency_key=data.idempotency_key or f"bulk-{uuid4()}",
        )
    )
    await db.commit()
    return {
        "created": len(created_ids),
        "failed": len(errors),
        "errors": errors,
        "bird_ids": created_ids,
    }


async def record_lifecycle(db: AsyncSession, ctx: AuthContext, data) -> LifecycleEvent:
    assert ctx.owner_account_id is not None
    if data.idempotency_key:
        existing = await db.scalar(
            select(LifecycleEvent).where(LifecycleEvent.idempotency_key == data.idempotency_key)
        )
        if existing:
            return existing

    flock: Flock | None = None
    bird: Bird | None = None
    shed_id: UUID | None = None

    if data.bird_id:
        bird = await get_bird(db, ctx, data.bird_id)
        await assert_shed_access(db, ctx, bird.shed_id, permission_code="lifecycle.record")
        flock = await get_flock(db, ctx, bird.flock_id)
        shed_id = bird.shed_id
    elif data.flock_id:
        flock = await get_flock(db, ctx, data.flock_id)
        await assert_shed_access(db, ctx, flock.shed_id, permission_code="lifecycle.record")
        shed_id = flock.shed_id
    else:
        raise FlockError("flock_id or bird_id required", "INVALID")

    qty = data.quantity
    if data.event_type in {
        LifecycleEventType.mortality,
        LifecycleEventType.sale,
        LifecycleEventType.transfer,
    }:
        if bird:
            bird.lifecycle_status = {
                LifecycleEventType.mortality: BirdLifecycleStatus.dead,
                LifecycleEventType.sale: BirdLifecycleStatus.sold,
                LifecycleEventType.transfer: BirdLifecycleStatus.transferred_out,
            }[data.event_type]
            bird.is_active = False
            qty = 1
            if flock and flock.current_count > 0:
                flock.current_count -= 1
        elif flock:
            if qty > flock.current_count:
                raise FlockError("Quantity exceeds current flock count", "NEGATIVE_COUNT")
            flock.current_count -= qty
            if flock.tracking_mode in {TrackingMode.batch, TrackingMode.mixed}:
                flock.unbanded_count = max(0, flock.unbanded_count - qty)
        await reconcile_flock_counts(db, flock)  # type: ignore[arg-type]

    if data.event_type == LifecycleEventType.flock_closure and flock:
        flock.status = FlockStatus.closed

    event = LifecycleEvent(
        owner_account_id=ctx.owner_account_id,
        shed_id=shed_id,
        flock_id=flock.id if flock else None,
        bird_id=bird.id if bird else None,
        event_type=data.event_type,
        effective_date=data.effective_date,
        quantity=qty,
        reason=data.reason,
        recorded_by_user_id=ctx.user.id,
        idempotency_key=data.idempotency_key,
    )
    db.add(event)
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="lifecycle.record",
            entity_type="lifecycle_event",
            entity_id=None,
            after={"type": data.event_type.value, "quantity": qty},
        )
    )
    await db.commit()
    await db.refresh(event)
    return event
