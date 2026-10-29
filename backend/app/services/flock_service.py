from datetime import date, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.models.audit import AuditLog
from app.models.enums import (
    BirdLifecycleStatus,
    BirdParentRole,
    DobConfidence,
    FlockStatus,
    LifecycleEventType,
    MembershipRole,
    TrackingMode,
)
from app.models.flock import Bird, Flock
from app.models.lifecycle import LifecycleEvent
from app.models.owner import OwnerAccount
from app.models.shed import Shed
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import ScheduledDose, VaccineDefinition
from app.schemas.flock import (
    BirdListItemOut,
    BirdListOut,
    BirdParentageOut,
    BirdParentRefOut,
    BirdProfileBatchDoseOut,
    BirdProfileLifecycleOut,
    BirdProfileOut,
    BirdProfileVaccinationEventOut,
    BirdSaleDetailsOut,
    BirdSearchHitOut,
    BirdSearchOut,
    BirdUnbandedBatchOut,
    SoldBirdHitOut,
    SoldBirdListOut,
)
from app.schemas.search import BatchSearchHitOut, BatchSearchOut
from app.services.schedule_engine import (
    STATUS_DUE_SOON,
    STATUS_DUE_TODAY,
    STATUS_NEEDS_REVIEW,
    STATUS_OVERDUE,
    STATUS_UPCOMING,
)

_OPEN_DOSE_STATUSES = {
    STATUS_UPCOMING,
    STATUS_DUE_SOON,
    STATUS_DUE_TODAY,
    STATUS_OVERDUE,
    STATUS_NEEDS_REVIEW,
}
_BATCH_DOSE_NOTE = "Shed hatch-date schedule — not confirmed as an individual vaccination"


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
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, data.shed_id)
    except shed_service.ShedError as exc:
        raise FlockError(exc.message, exc.code) from exc

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

    catalogue_override = getattr(data, "vaccination_catalogue_id", None)
    if catalogue_override is not None:
        from app.services import catalogue_service

        try:
            await catalogue_service.assert_catalogue_assignable(db, ctx, catalogue_override)
        except catalogue_service.CatalogueError as exc:
            raise FlockError(exc.message, exc.code) from exc

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
        vaccination_catalogue_id=catalogue_override,
    )
    await reconcile_flock_counts(db, flock)
    db.add(flock)
    try:
        await db.flush()
        db.add(
            LifecycleEvent(
                owner_account_id=ctx.owner_account_id,
                shed_id=flock.shed_id,
                flock_id=flock.id,
                event_type=LifecycleEventType.onboarding,
                effective_date=date.today(),
                quantity=flock.initial_count,
                reason="Birds onboarded",
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
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        detail = str(getattr(exc, "orig", exc))
        if "uq_flocks_active_exact_cohort" in detail or "uq_flocks_active_estimated_cohort" in detail:
            raise FlockError(
                "An active population with this age key already exists in this shed",
                "DUPLICATE_COHORT",
            ) from exc
        raise FlockError("Population code already exists", "DUPLICATE_BATCH") from exc
    await db.refresh(flock)
    from app.services import catalogue_service

    await catalogue_service.ensure_schedules_for_flock(db, ctx, flock.id)
    return flock


async def list_flocks(db: AsyncSession, ctx: AuthContext, shed_id: UUID | None = None) -> list[Flock]:
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(Flock).where(
        Flock.owner_account_id == ctx.owner_account_id,
        Flock.status == FlockStatus.active,
    )
    if shed_id:
        await assert_shed_access(db, ctx, shed_id, permission_code="flock.view")
        stmt = stmt.where(Flock.shed_id == shed_id)
    elif ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return []
        stmt = stmt.where(Flock.shed_id.in_(assigned))
    return list(await db.scalars(stmt.order_by(Flock.created_at.desc()).limit(200)))


async def get_flock(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> Flock:
    flock = await db.scalar(
        select(Flock).where(Flock.id == flock_id, Flock.owner_account_id == ctx.owner_account_id)
    )
    if flock is None:
        raise FlockError("Population not found", "NOT_FOUND")
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
    if getattr(data, "add_unbanded", None) is not None:
        if data.current_count is not None:
            raise FlockError(
                "Send either current_count or add_unbanded, not both",
                "CONFLICTING_COUNT_UPDATE",
            )
        add_n = int(data.add_unbanded)
        if flock.status != FlockStatus.active:
            raise FlockError("This population is not active", "INACTIVE_BATCH")
        if flock.tracking_mode == TrackingMode.individual:
            flock.tracking_mode = TrackingMode.mixed
        flock.unbanded_count += add_n
        flock.current_count += add_n
        db.add(
            LifecycleEvent(
                owner_account_id=ctx.owner_account_id,
                shed_id=flock.shed_id,
                flock_id=flock.id,
                event_type=LifecycleEventType.count_adjustment,
                effective_date=date.today(),
                quantity=add_n,
                reason=f"Added {add_n} unbanded birds",
                recorded_by_user_id=ctx.user.id,
            )
        )
    hatch_corrected = False
    if getattr(data, "hatch_date", None) is not None:
        if data.hatch_date > date.today():
            raise FlockError("Hatch date cannot be in the future", "INVALID_DOB")
        flock.hatch_date = data.hatch_date
        flock.dob_confidence = DobConfidence.exact
        flock.estimated_age_days = None
        flock.age_reported_on = None
        hatch_corrected = True
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="flock.hatch_correct",
                entity_type="flock",
                entity_id=flock.id,
                after={"hatch_date": data.hatch_date.isoformat()},
            )
        )
    catalogue_changed = False
    from app.services import catalogue_service, vaccine_service

    if getattr(data, "clear_vaccination_catalogue_override", False):
        flock.vaccination_catalogue_id = None
        catalogue_changed = True
    elif getattr(data, "vaccination_catalogue_id", None) is not None:
        try:
            await catalogue_service.assert_catalogue_assignable(db, ctx, data.vaccination_catalogue_id)
        except catalogue_service.CatalogueError as exc:
            raise FlockError(exc.message, exc.code) from exc
        flock.vaccination_catalogue_id = data.vaccination_catalogue_id
        catalogue_changed = True

    await reconcile_flock_counts(db, flock)

    if hatch_corrected:
        await catalogue_service.recalculate_open_doses_for_hatch(db, ctx, flock.id)
        try:
            await vaccine_service.generate_schedules_for_flock(db, ctx, flock.id, commit=False)
        except vaccine_service.VaccineError:
            pass
    elif catalogue_changed:
        await db.flush()
        await catalogue_service.ensure_schedules_for_flock(db, ctx, flock.id)
    elif data.current_count is not None or getattr(data, "add_unbanded", None) is not None:
        await catalogue_service.refresh_open_dose_eligibility(db, flock.id)
    await db.commit()
    await db.refresh(flock)
    return flock


def _validate_bird_dob_or_raise(data, flock: Flock) -> None:
    """Enforce exact hatch date for net-new banded birds; inherit path copies flock DOB."""
    inherit = bool(getattr(data, "inherit_flock_dob", False))
    if data.hatch_date is not None and data.hatch_date > date.today():
        raise FlockError("Hatch date cannot be in the future", "INVALID_DOB")
    if inherit:
        return
    if not data.band_id:
        return
    # Net-new banded registration requires an exact date — no estimated-age shortcuts.
    if data.hatch_date is None:
        raise FlockError("Hatch date is required for banded birds", "MISSING_DOB")
    if data.dob_confidence != DobConfidence.exact:
        raise FlockError(
            "Exact hatch date is required for banded birds (estimated age is not allowed)",
            "INVALID_DOB",
        )


async def find_or_create_cohort_flock(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    shed_id: UUID,
    tracking_mode: TrackingMode,
    hatch_date: date | None = None,
    estimated_age_days: int | None = None,
    age_reported_on: date | None = None,
    initial_unbanded: int = 0,
    commit: bool = True,
    access_permission: str = "flock.create",
) -> tuple[Flock, bool]:
    """Delegate to cohort_ops (savepoint-safe; permission-parameterized)."""
    from app.services import cohort_ops

    return await cohort_ops.find_or_create_cohort_flock(
        db,
        ctx,
        shed_id=shed_id,
        tracking_mode=tracking_mode,
        access_permission=access_permission,
        hatch_date=hatch_date,
        estimated_age_days=estimated_age_days,
        age_reported_on=age_reported_on,
        initial_unbanded=initial_unbanded,
        commit=commit,
    )


async def register_banded_in_shed(db: AsyncSession, ctx: AuthContext, data) -> Bird:
    """Register a banded bird in a shed; auto-provisions a hidden DOB cohort when needed."""
    await assert_shed_access(db, ctx, data.shed_id, permission_code="bird.create")
    flock, _ = await find_or_create_cohort_flock(
        db,
        ctx,
        shed_id=data.shed_id,
        hatch_date=data.hatch_date,
        tracking_mode=TrackingMode.individual,
        initial_unbanded=0,
        commit=True,
        access_permission="bird.create",
    )
    from app.schemas.flock import BirdCreate

    body = BirdCreate(
        flock_id=flock.id,
        band_id=data.band_id,
        hatch_date=data.hatch_date,
        dob_confidence=DobConfidence.exact,
        breed=data.breed,
        sex=data.sex,
        notes=data.notes,
        sire=getattr(data, "sire", None),
        dam=getattr(data, "dam", None),
    )
    return await create_bird(db, ctx, body)


async def add_unbanded_in_shed(db: AsyncSession, ctx: AuthContext, data) -> dict:
    """Add unbanded headcount for an exact DOB cohort in a shed (find-or-create, idempotent)."""
    assert ctx.owner_account_id is not None
    if data.idempotency_key:
        existing_evt = await db.scalar(
            select(LifecycleEvent).where(LifecycleEvent.idempotency_key == data.idempotency_key)
        )
        if existing_evt and existing_evt.flock_id:
            flock = await get_flock(db, ctx, existing_evt.flock_id)
            from app.schemas.flock import FlockOut

            return {
                "flock": FlockOut.model_validate(flock),
                "created_cohort": False,
                "quantity_added": existing_evt.quantity,
                "idempotent_replay": True,
            }

    flock, created = await find_or_create_cohort_flock(
        db,
        ctx,
        shed_id=data.shed_id,
        hatch_date=data.hatch_date,
        tracking_mode=TrackingMode.batch,
        initial_unbanded=data.quantity,
        commit=True,
        access_permission="flock.create",
    )

    # Newly created cohort already received the quantity as initial_unbanded.
    if created:
        from app.schemas.flock import FlockOut

        if data.idempotency_key:
            # Stamp idempotency on the onboarding event when possible.
            onboarding = await db.scalar(
                select(LifecycleEvent)
                .where(
                    LifecycleEvent.flock_id == flock.id,
                    LifecycleEvent.event_type == LifecycleEventType.onboarding,
                )
                .order_by(LifecycleEvent.created_at.desc())
                .limit(1)
            )
            if onboarding and onboarding.idempotency_key is None:
                onboarding.idempotency_key = data.idempotency_key
                await db.commit()
                await db.refresh(flock)

        from app.services.dose_reconciliation import sync_flock_vaccination_tasks

        await sync_flock_vaccination_tasks(db, ctx, flock.id, ensure_schedules=True, commit=True)
        return {
            "flock": FlockOut.model_validate(flock),
            "created_cohort": True,
            "quantity_added": data.quantity,
            "idempotent_replay": False,
        }

    # Existing cohort — increment unbanded (and promote individual → mixed).
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="flock.update")
    if flock.status != FlockStatus.active:
        raise FlockError("This population is not active", "INACTIVE_BATCH")
    if flock.tracking_mode == TrackingMode.individual:
        flock.tracking_mode = TrackingMode.mixed
    elif flock.tracking_mode == TrackingMode.batch:
        pass
    flock.unbanded_count += data.quantity
    flock.current_count += data.quantity
    db.add(
        LifecycleEvent(
            owner_account_id=ctx.owner_account_id,
            shed_id=flock.shed_id,
            flock_id=flock.id,
            event_type=LifecycleEventType.count_adjustment,
            effective_date=date.today(),
            quantity=data.quantity,
            reason=f"Added {data.quantity} unbanded birds",
            recorded_by_user_id=ctx.user.id,
            idempotency_key=data.idempotency_key,
        )
    )
    await reconcile_flock_counts(db, flock)
    if flock.tracking_mode == TrackingMode.mixed:
        flock.current_count = flock.banded_count + flock.unbanded_count
        flock.count_mismatch = False
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if data.idempotency_key:
            replay = await db.scalar(
                select(LifecycleEvent).where(LifecycleEvent.idempotency_key == data.idempotency_key)
            )
            if replay and replay.flock_id:
                flock = await get_flock(db, ctx, replay.flock_id)
                from app.schemas.flock import FlockOut

                return {
                    "flock": FlockOut.model_validate(flock),
                    "created_cohort": False,
                    "quantity_added": replay.quantity,
                    "idempotent_replay": True,
                }
        raise FlockError("Could not add unbanded birds", "CONFLICT") from exc
    await db.refresh(flock)
    from app.schemas.flock import FlockOut
    from app.services.dose_reconciliation import sync_flock_vaccination_tasks

    await sync_flock_vaccination_tasks(db, ctx, flock.id, ensure_schedules=True, commit=True)

    return {
        "flock": FlockOut.model_validate(flock),
        "created_cohort": False,
        "quantity_added": data.quantity,
        "idempotent_replay": False,
    }


async def create_bird(db: AsyncSession, ctx: AuthContext, data) -> Bird:
    flock = await get_flock(db, ctx, data.flock_id)
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="bird.create")
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, flock.shed_id)
    except shed_service.ShedError as exc:
        raise FlockError(exc.message, exc.code) from exc
    _validate_bird_dob_or_raise(data, flock)
    # Align with bulk import: banding a bird promotes pure batch tracking to mixed.
    if flock.tracking_mode == TrackingMode.batch and data.band_id:
        flock.tracking_mode = TrackingMode.mixed
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
    inherit = bool(getattr(data, "inherit_flock_dob", False))
    bird = Bird(
        owner_account_id=ctx.owner_account_id,
        shed_id=flock.shed_id,
        flock_id=flock.id,
        band_id=data.band_id.strip() if data.band_id else None,
        display_code=data.band_id.strip() if data.band_id else None,
        hatch_date=hatch or flock.hatch_date,
        estimated_age_days=(
            flock.estimated_age_days if inherit and data.estimated_age_days is None else data.estimated_age_days
        ),
        age_reported_on=(
            flock.age_reported_on if inherit and data.age_reported_on is None else data.age_reported_on
        ),
        dob_confidence=flock.dob_confidence if inherit else data.dob_confidence,
        breed=data.breed or flock.breed,
        sex=data.sex,
        notes=data.notes,
        lifecycle_status=BirdLifecycleStatus.active,
        is_active=True,
    )
    db.add(bird)
    await db.flush()

    from app.services.parentage_helpers import ParentageError, upsert_parentage

    try:
        await upsert_parentage(db, ctx, child=bird, role=BirdParentRole.sire, data=getattr(data, "sire", None))
        await upsert_parentage(db, ctx, child=bird, role=BirdParentRole.dam, data=getattr(data, "dam", None))
    except ParentageError as exc:
        await db.rollback()
        raise FlockError(exc.message, exc.code) from exc

    # Direct registration adds a banded bird without converting unbanded headcount.
    # Conversion must use band_from_unbanded so population stays stable.
    await reconcile_flock_counts(db, flock)
    if flock.tracking_mode == TrackingMode.mixed:
        flock.current_count = flock.banded_count + flock.unbanded_count
        flock.count_mismatch = False
    elif flock.tracking_mode == TrackingMode.individual:
        flock.current_count = flock.banded_count
    elif flock.tracking_mode == TrackingMode.batch:
        flock.current_count = flock.unbanded_count

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
    from app.services.dose_reconciliation import sync_flock_vaccination_tasks

    await sync_flock_vaccination_tasks(db, ctx, flock.id, ensure_schedules=True, commit=True)
    return bird


async def band_from_unbanded(db: AsyncSession, ctx: AuthContext, data) -> dict:
    """Atomically convert one unbanded headcount into a banded bird (population unchanged)."""
    assert ctx.owner_account_id is not None
    from app.services.idempotency_helpers import (
        IdempotencyConflictError,
        assert_payload_matches,
        payload_hash,
    )

    req_hash = payload_hash(
        {
            "op": "band_from_unbanded",
            "flock_id": data.flock_id,
            "band_id": data.band_id.strip(),
            "breed": data.breed,
            "sex": data.sex,
            "notes": data.notes,
        }
    )
    existing = await db.scalar(
        select(LifecycleEvent).where(
            LifecycleEvent.idempotency_key == data.idempotency_key,
            LifecycleEvent.owner_account_id == ctx.owner_account_id,
        )
    )
    if existing and existing.bird_id:
        if existing.shed_id is None:
            raise FlockError("Bird not found", "NOT_FOUND")
        await assert_shed_access(db, ctx, existing.shed_id, permission_code="bird.create")
        try:
            assert_payload_matches(existing.idempotency_payload_hash, req_hash)
        except IdempotencyConflictError as exc:
            raise FlockError(exc.message, exc.code) from exc
        if existing.idempotency_payload_hash is None:
            existing.idempotency_payload_hash = req_hash
            await db.commit()
        bird = await get_bird(db, ctx, existing.bird_id)
        flock = await get_flock(db, ctx, bird.flock_id)
        from app.schemas.flock import BirdOut

        return {
            "bird": BirdOut.model_validate(bird),
            "idempotent_replay": True,
            "flock_unbanded_count": flock.unbanded_count,
            "flock_banded_count": flock.banded_count,
            "flock_current_count": flock.current_count,
        }

    # Lock the flock row so concurrent conversions cannot oversubscribe unbanded_count.
    flock = await db.scalar(
        select(Flock)
        .where(Flock.id == data.flock_id, Flock.owner_account_id == ctx.owner_account_id)
        .with_for_update()
    )
    if flock is None:
        raise FlockError("Population not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="bird.create")
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, flock.shed_id)
    except shed_service.ShedError as exc:
        raise FlockError(exc.message, exc.code) from exc
    if flock.status != FlockStatus.active:
        raise FlockError("This population is not active", "INACTIVE_BATCH")
    if flock.unbanded_count < 1:
        raise FlockError("No unbanded birds available to band", "ZERO_UNBANDED")

    band = data.band_id.strip()
    dup = await db.scalar(
        select(Bird.id).where(
            Bird.owner_account_id == ctx.owner_account_id,
            Bird.band_id == band,
            Bird.is_active.is_(True),
        )
    )
    if dup:
        raise FlockError("Band ID already in use", "DUPLICATE_BAND")

    if flock.tracking_mode == TrackingMode.batch:
        flock.tracking_mode = TrackingMode.mixed

    before_current = flock.current_count
    flock.unbanded_count -= 1
    bird = Bird(
        owner_account_id=ctx.owner_account_id,
        shed_id=flock.shed_id,
        flock_id=flock.id,
        band_id=band,
        display_code=band,
        hatch_date=flock.hatch_date,
        estimated_age_days=flock.estimated_age_days,
        age_reported_on=flock.age_reported_on,
        dob_confidence=flock.dob_confidence,
        breed=data.breed or flock.breed,
        sex=data.sex,
        notes=data.notes,
        lifecycle_status=BirdLifecycleStatus.active,
        is_active=True,
    )
    db.add(bird)
    await db.flush()
    await reconcile_flock_counts(db, flock)
    flock.current_count = flock.banded_count + flock.unbanded_count
    flock.count_mismatch = False
    if flock.current_count != before_current:
        # Guard: conversion must not change live population.
        flock.current_count = before_current
        flock.count_mismatch = flock.banded_count + flock.unbanded_count != before_current

    db.add(
        LifecycleEvent(
            owner_account_id=ctx.owner_account_id,
            shed_id=flock.shed_id,
            flock_id=flock.id,
            bird_id=bird.id,
            event_type=LifecycleEventType.count_adjustment,
            effective_date=date.today(),
            quantity=1,
            reason=f"[band-from-unbanded] {band}",
            recorded_by_user_id=ctx.user.id,
            idempotency_key=data.idempotency_key,
            idempotency_payload_hash=req_hash,
        )
    )
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="bird.band_from_unbanded",
            entity_type="bird",
            entity_id=bird.id,
            after={"band_id": band, "flock_id": str(flock.id)},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # Concurrent duplicate band OR concurrent same idempotency key.
        replay = await db.scalar(
            select(LifecycleEvent).where(
                LifecycleEvent.idempotency_key == data.idempotency_key,
                LifecycleEvent.owner_account_id == ctx.owner_account_id,
            )
        )
        if replay and replay.bird_id:
            if replay.shed_id is None:
                raise FlockError("Bird not found", "NOT_FOUND") from exc
            await assert_shed_access(db, ctx, replay.shed_id, permission_code="bird.create")
            try:
                assert_payload_matches(replay.idempotency_payload_hash, req_hash)
            except IdempotencyConflictError as conflict:
                raise FlockError(conflict.message, conflict.code) from conflict
            bird = await get_bird(db, ctx, replay.bird_id)
            flock = await get_flock(db, ctx, bird.flock_id)
            from app.schemas.flock import BirdOut

            return {
                "bird": BirdOut.model_validate(bird),
                "idempotent_replay": True,
                "flock_unbanded_count": flock.unbanded_count,
                "flock_banded_count": flock.banded_count,
                "flock_current_count": flock.current_count,
            }
        raise FlockError("Band ID conflict", "DUPLICATE_BAND") from exc
    await db.refresh(bird)
    await db.refresh(flock)
    from app.schemas.flock import BirdOut

    return {
        "bird": BirdOut.model_validate(bird),
        "idempotent_replay": False,
        "flock_unbanded_count": flock.unbanded_count,
        "flock_banded_count": flock.banded_count,
        "flock_current_count": flock.current_count,
    }


async def list_birds(db: AsyncSession, ctx: AuthContext, flock_id: UUID) -> list[Bird]:
    flock = await get_flock(db, ctx, flock_id)
    await assert_shed_access(db, ctx, flock.shed_id, permission_code="bird.view")
    rows = await db.scalars(
        select(Bird).where(Bird.flock_id == flock_id, Bird.is_active.is_(True)).order_by(Bird.band_id)
    )
    return list(rows)


async def list_birds_in_shed(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    shed_id: UUID,
    flock_id: UUID | None = None,
    query: str | None = None,
    lifecycle_status: BirdLifecycleStatus | None = None,
    limit: int = 20,
    offset: int = 0,
    include_inactive: bool = False,
) -> BirdListOut:
    """Paginated registered birds across batches in one shed. Unbanded counts are summary-only."""
    assert ctx.owner_account_id is not None and ctx.membership is not None
    await assert_shed_access(db, ctx, shed_id, permission_code="bird.view")
    shed = await db.scalar(
        select(Shed).where(Shed.id == shed_id, Shed.owner_account_id == ctx.owner_account_id)
    )
    if shed is None:
        raise FlockError("Shed not found", "NOT_FOUND")

    limit = max(1, min(limit, 50))
    offset = max(0, offset)

    filters = [
        Bird.owner_account_id == ctx.owner_account_id,
        Bird.shed_id == shed_id,
        Bird.band_id.is_not(None),
    ]
    if flock_id is not None:
        flock = await get_flock(db, ctx, flock_id)
        if flock.shed_id != shed_id:
            raise FlockError("These birds are not in this shed", "INVALID")
        filters.append(Bird.flock_id == flock_id)
    if lifecycle_status is not None:
        filters.append(Bird.lifecycle_status == lifecycle_status)
    elif not include_inactive:
        filters.append(Bird.is_active.is_(True))
        filters.append(Bird.lifecycle_status == BirdLifecycleStatus.active)
    q = (query or "").strip()
    if q:
        if len(q) > 64:
            raise FlockError("Search query is too long", "INVALID")
        pattern = f"%{q}%"
        filters.append(or_(Bird.band_id.ilike(pattern), Bird.display_code.ilike(pattern)))

    total = int(await db.scalar(select(func.count()).select_from(Bird).where(*filters)) or 0)

    vacc_count = (
        select(func.count())
        .select_from(VaccinationEvent)
        .where(VaccinationEvent.bird_id == Bird.id)
        .correlate(Bird)
        .scalar_subquery()
    )

    rows = list(
        await db.execute(
            select(Bird, Flock, vacc_count.label("vacc_count"))
            .join(Flock, Flock.id == Bird.flock_id)
            .where(*filters)
            .order_by(func.lower(Bird.band_id).asc(), Bird.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    )

    items = [
        BirdListItemOut(
            id=bird.id,
            band_id=bird.band_id,
            display_code=bird.display_code,
            breed=bird.breed or flock.breed,
            sex=bird.sex,
            hatch_date=bird.hatch_date,
            estimated_age_days=bird.estimated_age_days,
            dob_confidence=bird.dob_confidence,
            lifecycle_status=bird.lifecycle_status,
            is_active=bird.is_active,
            flock_id=flock.id,
            batch_code=flock.batch_code,
            shed_id=bird.shed_id,
            individual_vaccination_count=int(vacc or 0),
            notes=bird.notes,
        )
        for bird, flock, vacc in rows
    ]

    unbanded_flocks = list(
        await db.scalars(
            select(Flock)
            .where(
                Flock.shed_id == shed_id,
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
                Flock.unbanded_count > 0,
            )
            .order_by(Flock.batch_code.asc())
        )
    )
    unbanded_batches = [
        BirdUnbandedBatchOut(
            flock_id=f.id,
            batch_code=f.batch_code,
            unbanded_count=f.unbanded_count,
            tracking_mode=f.tracking_mode,
            status=f.status,
        )
        for f in unbanded_flocks
    ]
    unbanded_total = sum(f.unbanded_count for f in unbanded_flocks)

    return BirdListOut(
        shed_id=shed_id,
        total=total,
        limit=limit,
        offset=offset,
        items=items,
        unbanded_total=unbanded_total,
        unbanded_batches=unbanded_batches,
    )


async def update_bird(db: AsyncSession, ctx: AuthContext, bird_id: UUID, data) -> Bird:
    """Update editable identity fields. Does not change lifecycle, shed, or batch placement."""
    bird = await get_bird(db, ctx, bird_id)
    await assert_shed_access(db, ctx, bird.shed_id, permission_code="bird.update")

    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return bird

    if "band_id" in payload:
        new_band = (payload["band_id"] or "").strip() or None
        if new_band is None:
            raise FlockError("Band number is required for registered birds", "INVALID")
        if new_band != bird.band_id:
            dup = await db.scalar(
                select(Bird.id).where(
                    Bird.owner_account_id == ctx.owner_account_id,
                    Bird.band_id == new_band,
                    Bird.is_active.is_(True),
                    Bird.id != bird.id,
                )
            )
            if dup:
                raise FlockError("Band ID already in use", "DUPLICATE_BAND")
            bird.band_id = new_band
            bird.display_code = new_band

    if "breed" in payload:
        bird.breed = payload["breed"]
    if "sex" in payload:
        bird.sex = payload["sex"]
    if "notes" in payload:
        bird.notes = payload["notes"]
    if "dob_confidence" in payload and payload["dob_confidence"] is not None:
        bird.dob_confidence = payload["dob_confidence"]
    if "estimated_age_days" in payload:
        bird.estimated_age_days = payload["estimated_age_days"]
    if "age_reported_on" in payload:
        bird.age_reported_on = payload["age_reported_on"]
    if "hatch_date" in payload:
        bird.hatch_date = payload["hatch_date"]

    if "sire" in payload or "dam" in payload:
        from app.services.parentage_helpers import ParentageError, upsert_parentage

        try:
            if "sire" in payload:
                await upsert_parentage(
                    db, ctx, child=bird, role=BirdParentRole.sire, data=getattr(data, "sire", None)
                )
            if "dam" in payload:
                await upsert_parentage(
                    db, ctx, child=bird, role=BirdParentRole.dam, data=getattr(data, "dam", None)
                )
        except ParentageError as exc:
            raise FlockError(exc.message, exc.code) from exc

    if bird.dob_confidence == DobConfidence.exact and bird.hatch_date is None:
        raise FlockError("hatch_date required when dob_confidence is exact", "INVALID")
    if bird.dob_confidence == DobConfidence.estimated and bird.estimated_age_days is None:
        raise FlockError("estimated_age_days required when dob_confidence is estimated", "INVALID")

    derived = derive_hatch_date(
        hatch_date=bird.hatch_date,
        estimated_age_days=bird.estimated_age_days,
        age_reported_on=bird.age_reported_on,
        dob_confidence=bird.dob_confidence,
    )
    if derived and bird.dob_confidence == DobConfidence.estimated:
        bird.hatch_date = derived

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="bird.update",
            entity_type="bird",
            entity_id=bird.id,
            after={"band_id": bird.band_id, "fields": sorted(payload.keys())},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise FlockError("Band ID conflict", "DUPLICATE_BAND") from exc
    await db.refresh(bird)
    return bird


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
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, flock.shed_id)
    except shed_service.ShedError as exc:
        raise FlockError(exc.message, exc.code) from exc
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
    from app.services.idempotency_helpers import (
        IdempotencyConflictError,
        assert_payload_matches,
        payload_hash,
    )

    buyer_name = getattr(data, "buyer_name", None)
    buyer_mobile = getattr(data, "buyer_mobile", None)
    req_hash = payload_hash(
        {
            "op": "lifecycle",
            "event_type": data.event_type.value if hasattr(data.event_type, "value") else str(data.event_type),
            "effective_date": data.effective_date,
            "flock_id": data.flock_id,
            "bird_id": data.bird_id,
            "quantity": data.quantity,
            "reason": data.reason,
            "buyer_name": buyer_name,
            "buyer_mobile": buyer_mobile,
        }
    )
    if data.idempotency_key:
        existing = await db.scalar(
            select(LifecycleEvent).where(
                LifecycleEvent.idempotency_key == data.idempotency_key,
                LifecycleEvent.owner_account_id == ctx.owner_account_id,
            )
        )
        if existing:
            if existing.shed_id is None:
                raise FlockError("Not found", "NOT_FOUND")
            await assert_shed_access(db, ctx, existing.shed_id, permission_code="lifecycle.record")
            try:
                assert_payload_matches(existing.idempotency_payload_hash, req_hash)
            except IdempotencyConflictError as exc:
                raise FlockError(exc.message, exc.code) from exc
            if existing.idempotency_payload_hash is None:
                existing.idempotency_payload_hash = req_hash
                await db.commit()
                await db.refresh(existing)
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
        # Lock flock for count-only mutations.
        flock = await db.scalar(
            select(Flock)
            .where(Flock.id == data.flock_id, Flock.owner_account_id == ctx.owner_account_id)
            .with_for_update()
        )
        if flock is None:
            raise FlockError("Population not found", "NOT_FOUND")
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
            if bird.lifecycle_status != BirdLifecycleStatus.active or not bird.is_active:
                raise FlockError("Bird is not eligible for this lifecycle action", "INELIGIBLE")
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
            # Count-only ops affect unbanded population — never fabricate individual bird events.
            if flock.tracking_mode == TrackingMode.individual:
                raise FlockError(
                    "Select individual birds for this hatch-date population; count-only lifecycle is not supported",
                    "SELECT_BIRDS",
                )
            if flock.status != FlockStatus.active:
                raise FlockError("This population is not active", "INACTIVE_BATCH")
            if qty > flock.unbanded_count:
                raise FlockError(
                    "Quantity exceeds eligible unbanded population",
                    "EXCEEDS_UNBANDED",
                )
            flock.current_count = max(0, flock.current_count - qty)
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
        buyer_name=buyer_name if data.event_type == LifecycleEventType.sale else None,
        buyer_mobile=buyer_mobile if data.event_type == LifecycleEventType.sale else None,
        recorded_by_user_id=ctx.user.id,
        idempotency_key=data.idempotency_key,
        idempotency_payload_hash=req_hash if data.idempotency_key else None,
    )
    db.add(event)
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="lifecycle.record",
            entity_type="lifecycle_event",
            entity_id=None,
            after={
                "type": data.event_type.value,
                "quantity": qty,
                "buyer_name": buyer_name if data.event_type == LifecycleEventType.sale else None,
            },
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if data.idempotency_key:
            raced = await db.scalar(
                select(LifecycleEvent).where(
                    LifecycleEvent.idempotency_key == data.idempotency_key,
                    LifecycleEvent.owner_account_id == ctx.owner_account_id,
                )
            )
            if raced:
                if raced.shed_id is None:
                    raise FlockError("Not found", "NOT_FOUND") from exc
                await assert_shed_access(db, ctx, raced.shed_id, permission_code="lifecycle.record")
                from app.services.idempotency_helpers import (
                    IdempotencyConflictError,
                    assert_payload_matches,
                )

                try:
                    assert_payload_matches(raced.idempotency_payload_hash, req_hash)
                except IdempotencyConflictError as conflict:
                    raise FlockError(conflict.message, conflict.code) from conflict
                return raced
        raise FlockError("Lifecycle conflict", "CONFLICT") from exc
    await db.refresh(event)
    if flock is not None:
        from app.services import catalogue_service

        await catalogue_service.refresh_open_dose_eligibility(db, flock.id)
        await db.commit()
    return event


_BULK_LIFECYCLE_TYPES = {
    LifecycleEventType.mortality,
    LifecycleEventType.sale,
    LifecycleEventType.transfer,
}


def _bulk_bird_idempotency_key(bulk_key: str, bird_id: UUID) -> str:
    return f"{bulk_key}:{bird_id}"


async def _bulk_child_events(
    db: AsyncSession, ctx: AuthContext, bulk_key: str
) -> list[LifecycleEvent]:
    assert ctx.owner_account_id is not None
    prefix = f"{bulk_key}:"
    rows = await db.scalars(
        select(LifecycleEvent)
        .where(
            LifecycleEvent.owner_account_id == ctx.owner_account_id,
            LifecycleEvent.bird_id.is_not(None),
            LifecycleEvent.idempotency_key.startswith(prefix),
        )
        .order_by(LifecycleEvent.created_at.asc(), LifecycleEvent.id.asc())
    )
    return list(rows)


async def _bulk_replay_from_persisted(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    bulk_key: str,
    req_hash: str,
    children: list[LifecycleEvent],
    parent: LifecycleEvent | None,
) -> dict:
    """Auth → hash check → response from persisted per-bird lifecycle rows."""
    from app.services.idempotency_helpers import IdempotencyConflictError, assert_payload_matches

    if not children:
        raise FlockError(
            "Partial bulk lifecycle already committed; contact support before retrying",
            "PARTIAL_IDEMPOTENCY",
        )

    shed_ids = {ev.shed_id for ev in children if ev.shed_id is not None}
    if parent and parent.shed_id is not None:
        shed_ids.add(parent.shed_id)
    if not shed_ids:
        raise FlockError("Not found", "NOT_FOUND")
    for sid in shed_ids:
        await assert_shed_access(db, ctx, sid, permission_code="lifecycle.record")

    stored_hash = parent.idempotency_payload_hash if parent else children[0].idempotency_payload_hash
    # Legacy rows without hash: require every child to agree before backfill.
    if stored_hash is None and parent is None:
        for ev in children[1:]:
            if ev.idempotency_payload_hash not in (None, children[0].idempotency_payload_hash):
                raise FlockError(
                    "Idempotency key already used with a different payload",
                    "IDEMPOTENCY_KEY_CONFLICT",
                )
        stored_hash = children[0].idempotency_payload_hash

    try:
        assert_payload_matches(stored_hash, req_hash)
    except IdempotencyConflictError as exc:
        raise FlockError(exc.message, exc.code) from exc

    if stored_hash is None:
        if parent is not None:
            parent.idempotency_payload_hash = req_hash
        for ev in children:
            if ev.idempotency_payload_hash is None:
                ev.idempotency_payload_hash = req_hash
        await db.commit()

    items: list[dict] = []
    for ev in children:
        assert ev.bird_id is not None
        bird = await get_bird(db, ctx, ev.bird_id)
        items.append(
            {
                "bird_id": ev.bird_id,
                "event_id": ev.id,
                "lifecycle_status": bird.lifecycle_status,
                "band_id": bird.band_id,
                "idempotent_replay": True,
            }
        )
    persisted_type = parent.event_type if parent is not None else children[0].event_type
    return {
        "applied": len(items),
        "event_type": persisted_type,
        "items": items,
        "idempotent_replay": True,
    }


async def record_lifecycle_bulk(db: AsyncSession, ctx: AuthContext, data) -> dict:
    """Apply mortality/sale/transfer to many banded birds atomically (all-or-nothing)."""
    assert ctx.owner_account_id is not None
    from app.services.idempotency_helpers import payload_hash

    if data.event_type not in _BULK_LIFECYCLE_TYPES:
        raise FlockError("Unsupported bulk lifecycle event type", "INVALID_TYPE")

    # Preserve order while rejecting duplicate IDs in the request.
    seen: set[UUID] = set()
    ordered_ids: list[UUID] = []
    for bid in data.bird_ids:
        if bid in seen:
            raise FlockError("Duplicate bird IDs in request", "DUPLICATE_IDS")
        seen.add(bid)
        ordered_ids.append(bid)

    buyer_name = getattr(data, "buyer_name", None)
    buyer_mobile = getattr(data, "buyer_mobile", None)
    req_hash = payload_hash(
        {
            "op": "lifecycle_bulk",
            "event_type": data.event_type.value if hasattr(data.event_type, "value") else str(data.event_type),
            "effective_date": data.effective_date,
            "bird_ids": sorted(str(b) for b in ordered_ids),
            "reason": data.reason,
            "buyer_name": buyer_name,
            "buyer_mobile": buyer_mobile,
        }
    )

    parent = await db.scalar(
        select(LifecycleEvent).where(
            LifecycleEvent.idempotency_key == data.idempotency_key,
            LifecycleEvent.owner_account_id == ctx.owner_account_id,
            LifecycleEvent.bird_id.is_(None),
        )
    )
    children = await _bulk_child_events(db, ctx, data.idempotency_key)

    if parent is not None or children:
        # Same bulk key with a different bird set (or partial write) must not create more events.
        if children and {ev.bird_id for ev in children} != set(ordered_ids):
            if parent is not None or any(ev.idempotency_payload_hash for ev in children):
                raise FlockError(
                    "Idempotency key already used with a different payload",
                    "IDEMPOTENCY_KEY_CONFLICT",
                )
            raise FlockError(
                "Partial bulk lifecycle already committed; contact support before retrying",
                "PARTIAL_IDEMPOTENCY",
            )
        if parent is not None and not children:
            raise FlockError(
                "Partial bulk lifecycle already committed; contact support before retrying",
                "PARTIAL_IDEMPOTENCY",
            )
        return await _bulk_replay_from_persisted(
            db,
            ctx,
            bulk_key=data.idempotency_key,
            req_hash=req_hash,
            children=children,
            parent=parent,
        )

    birds = (
        await db.scalars(
            select(Bird).where(
                Bird.owner_account_id == ctx.owner_account_id,
                Bird.id.in_(ordered_ids),
            )
        )
    ).all()
    by_id = {b.id: b for b in birds}
    if len(by_id) != len(ordered_ids):
        # Do not reveal which IDs belong to other tenants.
        raise FlockError("One or more birds were not found or are not accessible", "NOT_FOUND")

    shed_ids = {b.shed_id for b in birds}
    for sid in shed_ids:
        await assert_shed_access(db, ctx, sid, permission_code="lifecycle.record")

    ineligible = [
        b
        for b in birds
        if b.lifecycle_status != BirdLifecycleStatus.active or not b.is_active
    ]
    if ineligible:
        raise FlockError(
            f"{len(ineligible)} selected bird(s) are not eligible for this lifecycle action",
            "INELIGIBLE",
        )

    status_map = {
        LifecycleEventType.mortality: BirdLifecycleStatus.dead,
        LifecycleEventType.sale: BirdLifecycleStatus.sold,
        LifecycleEventType.transfer: BirdLifecycleStatus.transferred_out,
    }
    new_status = status_map[data.event_type]
    flock_cache: dict[UUID, Flock] = {}
    items: list[dict] = []

    for bid in ordered_ids:
        bird = by_id[bid]
        flock = flock_cache.get(bird.flock_id)
        if flock is None:
            flock = await get_flock(db, ctx, bird.flock_id)
            flock_cache[bird.flock_id] = flock

        bird.lifecycle_status = new_status
        bird.is_active = False
        if flock.current_count > 0:
            flock.current_count -= 1

        event = LifecycleEvent(
            owner_account_id=ctx.owner_account_id,
            shed_id=bird.shed_id,
            flock_id=bird.flock_id,
            bird_id=bird.id,
            event_type=data.event_type,
            effective_date=data.effective_date,
            quantity=1,
            reason=data.reason,
            buyer_name=buyer_name if data.event_type == LifecycleEventType.sale else None,
            buyer_mobile=buyer_mobile if data.event_type == LifecycleEventType.sale else None,
            recorded_by_user_id=ctx.user.id,
            idempotency_key=_bulk_bird_idempotency_key(data.idempotency_key, bird.id),
            idempotency_payload_hash=req_hash,
        )
        db.add(event)
        await db.flush()
        items.append(
            {
                "bird_id": bird.id,
                "event_id": event.id,
                "lifecycle_status": bird.lifecycle_status,
                "band_id": bird.band_id,
                "idempotent_replay": False,
            }
        )

    # Parent marker anchors the bulk key so a changed bird set cannot create a second batch.
    first_shed = next(iter(shed_ids))
    db.add(
        LifecycleEvent(
            owner_account_id=ctx.owner_account_id,
            shed_id=first_shed,
            flock_id=None,
            bird_id=None,
            event_type=data.event_type,
            effective_date=data.effective_date,
            quantity=len(items),
            reason=f"[bulk-lifecycle] {data.reason or data.event_type.value}",
            buyer_name=buyer_name if data.event_type == LifecycleEventType.sale else None,
            buyer_mobile=buyer_mobile if data.event_type == LifecycleEventType.sale else None,
            recorded_by_user_id=ctx.user.id,
            idempotency_key=data.idempotency_key,
            idempotency_payload_hash=req_hash,
        )
    )

    for flock in flock_cache.values():
        await reconcile_flock_counts(db, flock)

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="lifecycle.record_bulk",
            entity_type="lifecycle_event",
            entity_id=None,
            after={
                "type": data.event_type.value,
                "count": len(items),
                "idempotency_key": data.idempotency_key,
                "bird_ids": [str(i) for i in ordered_ids],
            },
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raced_parent = await db.scalar(
            select(LifecycleEvent).where(
                LifecycleEvent.idempotency_key == data.idempotency_key,
                LifecycleEvent.owner_account_id == ctx.owner_account_id,
                LifecycleEvent.bird_id.is_(None),
            )
        )
        raced_children = await _bulk_child_events(db, ctx, data.idempotency_key)
        if raced_parent is not None or raced_children:
            return await _bulk_replay_from_persisted(
                db,
                ctx,
                bulk_key=data.idempotency_key,
                req_hash=req_hash,
                children=raced_children,
                parent=raced_parent,
            )
        raise FlockError("Bulk lifecycle conflict", "CONFLICT") from exc
    from app.services import catalogue_service

    for flock in flock_cache.values():
        await catalogue_service.refresh_open_dose_eligibility(db, flock.id)
    await db.commit()
    return {
        "applied": len(items),
        "event_type": data.event_type,
        "items": items,
        "idempotent_replay": False,
    }


def _transfer_bird_key(batch_key: str, bird_id: UUID) -> str:
    from app.services.idempotency_helpers import transfer_bird_idempotency_key

    return transfer_bird_idempotency_key(batch_key, bird_id)


async def _persisted_transfer_bird_ids(
    db: AsyncSession, ctx: AuthContext, parent: LifecycleEvent
) -> list[UUID]:
    """Reconstruct moved bird IDs from per-bird lifecycle rows under the batch key."""
    assert ctx.owner_account_id is not None
    key = parent.idempotency_key
    if not key:
        return []
    prefix = f"{key}:"
    rows = await db.scalars(
        select(LifecycleEvent)
        .where(
            LifecycleEvent.owner_account_id == ctx.owner_account_id,
            LifecycleEvent.event_type == LifecycleEventType.transfer,
            LifecycleEvent.bird_id.is_not(None),
            LifecycleEvent.idempotency_key.startswith(prefix),
        )
        .order_by(LifecycleEvent.created_at.asc(), LifecycleEvent.id.asc())
    )
    return [row.bird_id for row in rows if row.bird_id is not None]


async def _transfer_replay_response(
    db: AsyncSession, ctx: AuthContext, existing: LifecycleEvent, *, req_hash: str
) -> dict:
    """Auth → hash check → response built only from persisted transfer rows."""
    from app.services.idempotency_helpers import IdempotencyConflictError, assert_payload_matches

    if existing.shed_id is None or existing.flock_id is None:
        raise FlockError("Not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, existing.shed_id, permission_code="lifecycle.record")
    try:
        assert_payload_matches(existing.idempotency_payload_hash, req_hash)
    except IdempotencyConflictError as exc:
        raise FlockError(exc.message, exc.code) from exc
    if existing.idempotency_payload_hash is None:
        existing.idempotency_payload_hash = req_hash
        await db.commit()
    bird_ids = await _persisted_transfer_bird_ids(db, ctx, existing)
    return {
        "moved": int(existing.quantity),
        "destination_flock_id": existing.flock_id,
        "destination_shed_id": existing.shed_id,
        "bird_ids": bird_ids,
        "idempotent_replay": True,
    }


async def transfer_to_shed(db: AsyncSession, ctx: AuthContext, data) -> dict:
    """Move banded birds or an unbanded headcount into a destination flock in another shed.

    Unlike lifecycle ``transfer`` (exit / transferred_out), birds remain ``active`` and keep
    band identity. Counts are adjusted on source and destination flocks.
    """
    assert ctx.owner_account_id is not None
    from app.services.cohort_ops import lock_flocks_ordered
    from app.services.idempotency_helpers import payload_hash

    req_hash = payload_hash(
        {
            "op": "transfer_to_shed",
            "destination_flock_id": data.destination_flock_id,
            "effective_date": data.effective_date,
            "bird_ids": sorted(str(b) for b in (data.bird_ids or [])),
            "source_flock_id": data.source_flock_id,
            "quantity": data.quantity,
            "reason": data.reason,
        }
    )
    existing = await db.scalar(
        select(LifecycleEvent).where(
            LifecycleEvent.idempotency_key == data.idempotency_key,
            LifecycleEvent.owner_account_id == ctx.owner_account_id,
        )
    )
    if existing:
        return await _transfer_replay_response(db, ctx, existing, req_hash=req_hash)

    dest = await get_flock(db, ctx, data.destination_flock_id)
    await assert_shed_access(db, ctx, dest.shed_id, permission_code="lifecycle.record")
    from app.services import shed_service

    try:
        await shed_service.assert_shed_accepts_new_records(db, ctx, dest.shed_id)
    except shed_service.ShedError as exc:
        raise FlockError(exc.message, exc.code) from exc
    if dest.status != FlockStatus.active:
        raise FlockError("Destination shed population is not active", "INACTIVE_DEST")

    moved_ids: list[UUID] = []
    qty = 0
    source_flock: Flock | None = None
    source_flock_ids: list[UUID] = []

    if data.bird_ids:
        seen: set[UUID] = set()
        for bid in data.bird_ids:
            if bid in seen:
                raise FlockError("Duplicate bird IDs in request", "DUPLICATE_IDS")
            seen.add(bid)
        birds: list[Bird] = []
        for bid in data.bird_ids:
            bird = await get_bird(db, ctx, bid)
            if bird.lifecycle_status != BirdLifecycleStatus.active or not bird.is_active:
                raise FlockError("Bird is not eligible for shed transfer", "INELIGIBLE")
            if bird.shed_id == dest.shed_id and bird.flock_id == dest.id:
                raise FlockError("Bird is already in the destination shed", "SAME_DEST")
            await assert_shed_access(db, ctx, bird.shed_id, permission_code="lifecycle.record")
            birds.append(bird)

        lock_ids = [dest.id] + [b.flock_id for b in birds]
        locked = await lock_flocks_ordered(db, ctx, lock_ids)
        dest = locked[dest.id]
        flock_cache: dict[UUID, Flock] = {}
        for bird in birds:
            src = locked[bird.flock_id]
            flock_cache[bird.flock_id] = src
            if src.banded_count > 0:
                src.banded_count -= 1
            if src.current_count > 0:
                src.current_count -= 1
            bird.flock_id = dest.id
            bird.shed_id = dest.shed_id
            if dest.tracking_mode == TrackingMode.batch:
                dest.tracking_mode = TrackingMode.mixed
            dest.banded_count += 1
            dest.current_count += 1
            moved_ids.append(bird.id)
            qty += 1
            note = data.reason or "Transferred to destination shed"
            db.add(
                LifecycleEvent(
                    owner_account_id=ctx.owner_account_id,
                    shed_id=dest.shed_id,
                    flock_id=dest.id,
                    bird_id=bird.id,
                    event_type=LifecycleEventType.transfer,
                    effective_date=data.effective_date,
                    quantity=1,
                    reason=f"[shed-move] {note}",
                    recorded_by_user_id=ctx.user.id,
                    idempotency_key=_transfer_bird_key(data.idempotency_key, bird.id),
                )
            )
        # Parent idempotency marker (no bird_id) so retries short-circuit.
        db.add(
            LifecycleEvent(
                owner_account_id=ctx.owner_account_id,
                shed_id=dest.shed_id,
                flock_id=dest.id,
                bird_id=None,
                event_type=LifecycleEventType.transfer,
                effective_date=data.effective_date,
                quantity=qty,
                reason=f"[shed-move-batch] {data.reason or f'Moved {qty} birds to destination shed'}",
                recorded_by_user_id=ctx.user.id,
                idempotency_key=data.idempotency_key,
                idempotency_payload_hash=req_hash,
            )
        )
        source_flock_ids = list(flock_cache.keys())
        for flock in flock_cache.values():
            await reconcile_flock_counts(db, flock)
        await reconcile_flock_counts(db, dest)
    else:
        source_flock = await get_flock(db, ctx, data.source_flock_id)
        await assert_shed_access(db, ctx, source_flock.shed_id, permission_code="lifecycle.record")
        if source_flock.id == dest.id:
            raise FlockError("Source and destination populations must differ", "SAME_DEST")
        if source_flock.shed_id == dest.shed_id:
            raise FlockError("Choose a destination in a different shed", "SAME_SHED")
        if source_flock.status != FlockStatus.active:
            raise FlockError("Source population is not active", "INACTIVE_SOURCE")
        if source_flock.tracking_mode == TrackingMode.individual:
            raise FlockError(
                "Select individual birds; count-only transfer is not supported",
                "SELECT_BIRDS",
            )
        locked = await lock_flocks_ordered(db, ctx, [source_flock.id, dest.id])
        source_flock = locked[source_flock.id]
        dest = locked[dest.id]
        qty = int(data.quantity)
        if qty > source_flock.unbanded_count:
            raise FlockError("Quantity exceeds eligible unbanded population", "EXCEEDS_UNBANDED")
        source_flock.unbanded_count -= qty
        source_flock.current_count = max(0, source_flock.current_count - qty)
        if dest.tracking_mode == TrackingMode.individual:
            dest.tracking_mode = TrackingMode.mixed
        dest.unbanded_count += qty
        dest.current_count += qty
        await reconcile_flock_counts(db, source_flock)
        await reconcile_flock_counts(db, dest)
        source_flock_ids = [source_flock.id]
        note = data.reason or f"Transferred {qty} unbanded to destination shed"
        db.add(
            LifecycleEvent(
                owner_account_id=ctx.owner_account_id,
                shed_id=dest.shed_id,
                flock_id=dest.id,
                bird_id=None,
                event_type=LifecycleEventType.transfer,
                effective_date=data.effective_date,
                quantity=qty,
                reason=f"[shed-move] {note}",
                recorded_by_user_id=ctx.user.id,
                idempotency_key=data.idempotency_key,
                idempotency_payload_hash=req_hash,
            )
        )

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="lifecycle.transfer_shed",
            entity_type="flock",
            entity_id=dest.id,
            after={
                "moved": qty,
                "destination_flock_id": str(dest.id),
                "bird_ids": [str(i) for i in moved_ids],
                "source_flock_id": str(source_flock.id) if source_flock else None,
                "idempotency_key": data.idempotency_key,
            },
        )
    )
    dest_flock_id = dest.id
    dest_shed_id = dest.shed_id
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raced = await db.scalar(
            select(LifecycleEvent).where(
                LifecycleEvent.idempotency_key == data.idempotency_key,
                LifecycleEvent.owner_account_id == ctx.owner_account_id,
            )
        )
        if raced:
            return await _transfer_replay_response(db, ctx, raced, req_hash=req_hash)
        raise FlockError("Transfer conflict", "CONFLICT") from exc

    import logging

    from app.services.dose_reconciliation import reconcile_shed_transfer_vaccination

    # Membership already committed — never fail the transfer response if schedule sync errors.
    try:
        await reconcile_shed_transfer_vaccination(
            db,
            ctx,
            source_flock_ids=source_flock_ids,
            destination_flock_id=dest_flock_id,
            commit=True,
        )
    except Exception:
        logging.getLogger(__name__).exception(
            "Vaccination reconcile after shed transfer failed dest=%s sources=%s",
            dest_flock_id,
            source_flock_ids,
        )
    return {
        "moved": qty,
        "destination_flock_id": dest_flock_id,
        "destination_shed_id": dest_shed_id,
        "bird_ids": moved_ids,
        "idempotent_replay": False,
    }


async def search_batches(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    query: str,
    limit: int = 10,
    include_inactive: bool = True,
) -> BatchSearchOut:
    """Org-scoped batch_code / breed search. Farmers limited to assigned sheds."""
    assert ctx.owner_account_id is not None and ctx.membership is not None
    q = (query or "").strip()
    if not q:
        raise FlockError("Search query is required", "INVALID")
    if len(q) > 64:
        raise FlockError("Search query is too long", "INVALID")
    limit = max(1, min(limit, 25))
    pattern = f"%{q}%"

    filters = [
        Flock.owner_account_id == ctx.owner_account_id,
        or_(Flock.batch_code.ilike(pattern), Flock.breed.ilike(pattern)),
    ]
    if not include_inactive:
        filters.append(Flock.status == FlockStatus.active)

    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return BatchSearchOut(query=q, total=0, limit=limit, exact_count=0, items=[])
        filters.append(Flock.shed_id.in_(assigned))

    total = int(await db.scalar(select(func.count()).select_from(Flock).where(*filters)) or 0)
    rows = list(
        await db.execute(
            select(Flock, Shed)
            .join(Shed, Shed.id == Flock.shed_id)
            .where(*filters)
            .order_by(Flock.batch_code.asc())
            .limit(limit)
        )
    )
    rows.sort(
        key=lambda r: (
            0 if r[0].batch_code.lower() == q.lower() else 1,
            0 if r[0].status == FlockStatus.active else 1,
            r[0].batch_code.lower(),
        )
    )

    exact_count = 0
    items: list[BatchSearchHitOut] = []
    for flock, shed in rows:
        exact = flock.batch_code.lower() == q.lower()
        if exact:
            exact_count += 1
        items.append(
            BatchSearchHitOut(
                id=flock.id,
                batch_code=flock.batch_code,
                breed=flock.breed,
                shed_id=shed.id,
                shed_name=shed.name,
                shed_code=shed.code,
                current_count=flock.current_count,
                status=flock.status,
                match_kind="exact" if exact else "partial",
            )
        )
    return BatchSearchOut(
        query=q, total=total, limit=limit, exact_count=exact_count, items=items
    )


async def search_birds(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    query: str,
    limit: int = 20,
    offset: int = 0,
    include_inactive: bool = True,
) -> BirdSearchOut:
    """Org-scoped band search (exact + partial). Farmers limited to assigned sheds."""
    assert ctx.owner_account_id is not None and ctx.membership is not None
    q = (query or "").strip()
    if not q:
        raise FlockError("Search query is required", "INVALID")
    if len(q) > 64:
        raise FlockError("Search query is too long", "INVALID")
    limit = max(1, min(limit, 50))
    offset = max(0, offset)

    pattern = f"%{q}%"
    filters = [
        Bird.owner_account_id == ctx.owner_account_id,
        Bird.band_id.is_not(None),
        or_(Bird.band_id.ilike(pattern), Bird.display_code.ilike(pattern)),
    ]
    if not include_inactive:
        filters.append(Bird.is_active.is_(True))

    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return BirdSearchOut(query=q, total=0, limit=limit, offset=offset, exact_count=0, items=[])
        filters.append(Bird.shed_id.in_(assigned))

    total = int(await db.scalar(select(func.count()).select_from(Bird).where(*filters)) or 0)

    # Exact matches first, then active, then band_id
    rows = list(
        await db.execute(
            select(Bird, Shed, Flock)
            .join(Shed, Shed.id == Bird.shed_id)
            .join(Flock, Flock.id == Bird.flock_id)
            .where(*filters)
            .order_by(
                func.lower(Bird.band_id).asc(),
                Bird.is_active.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
    )
    # Prefer exact matches at the front of the page without a second query when possible
    rows.sort(
        key=lambda r: (
            0 if r[0].band_id and r[0].band_id.lower() == q.lower() else 1,
            0 if r[0].is_active else 1,
            (r[0].band_id or "").lower(),
        )
    )

    exact_count = 0
    items: list[BirdSearchHitOut] = []
    for bird, shed, flock in rows:
        exact = bool(bird.band_id and bird.band_id.lower() == q.lower())
        if exact:
            exact_count += 1
        items.append(
            BirdSearchHitOut(
                id=bird.id,
                band_id=bird.band_id,
                display_code=bird.display_code,
                shed_id=shed.id,
                shed_name=shed.name,
                shed_code=shed.code,
                flock_id=flock.id,
                batch_code=flock.batch_code,
                breed=bird.breed or flock.breed,
                lifecycle_status=bird.lifecycle_status,
                is_active=bird.is_active,
                match_kind="exact" if exact else "partial",
            )
        )

    return BirdSearchOut(
        query=q,
        total=total,
        limit=limit,
        offset=offset,
        exact_count=exact_count,
        items=items,
    )


async def get_bird_profile(db: AsyncSession, ctx: AuthContext, bird_id: UUID) -> BirdProfileOut:
    """Bird identity + individual vaccination events + labeled flock-level upcoming doses."""
    bird = await get_bird(db, ctx, bird_id)
    await assert_shed_access(db, ctx, bird.shed_id, permission_code="bird.view")

    shed = await db.get(Shed, bird.shed_id)
    flock = await db.get(Flock, bird.flock_id)
    owner = await db.get(OwnerAccount, ctx.owner_account_id) if ctx.owner_account_id else None
    if flock is None or shed is None:
        raise FlockError("Bird placement not found", "NOT_FOUND")

    from app.services.parentage_helpers import load_parent_descriptors

    descriptors = await load_parent_descriptors(db, ctx, bird.id)

    async def _linked_parent(parent_id: UUID | None) -> tuple[BirdParentRefOut | None, Bird | None]:
        if not parent_id:
            return None, None
        parent = await db.get(Bird, parent_id)
        if parent is None or parent.owner_account_id != ctx.owner_account_id:
            return None, None
        return BirdParentRefOut(id=parent.id, band_id=parent.band_id, display_code=parent.display_code), parent

    def _manual_parentage(role: BirdParentRole) -> BirdParentageOut:
        desc = descriptors.get(role)
        if desc is None:
            return BirdParentageOut()
        label_parts = [p for p in (desc.display_name, desc.band_number, desc.breed) if p]
        return BirdParentageOut(
            source="manual",
            bird_id=None,
            band_id=desc.band_number,
            display_name=desc.display_name,
            breed=desc.breed,
            notes=desc.notes,
            label=" · ".join(label_parts) if label_parts else "Recorded parent (no ID)",
        )

    def _linked_parentage(ref: BirdParentRefOut | None, parent: Bird | None) -> BirdParentageOut:
        if ref is None or parent is None:
            return BirdParentageOut()
        label = parent.band_id or parent.display_code or str(parent.id)[:8]
        return BirdParentageOut(
            source="linked",
            bird_id=parent.id,
            band_id=parent.band_id,
            display_name=parent.display_code,
            breed=parent.breed,
            notes=None,
            label=label,
        )

    sire_out, sire_bird = await _linked_parent(bird.sire_bird_id)
    dam_out, dam_bird = await _linked_parent(bird.dam_bird_id)
    sire_parentage = (
        _linked_parentage(sire_out, sire_bird)
        if sire_out
        else _manual_parentage(BirdParentRole.sire)
    )
    dam_parentage = (
        _linked_parentage(dam_out, dam_bird) if dam_out else _manual_parentage(BirdParentRole.dam)
    )

    from app.services.bird_vaccination_history import load_bird_vaccination_history

    individual = await load_bird_vaccination_history(
        db, ctx, bird, limit=200, ascending=False
    )

    dose_rows = list(
        await db.execute(
            select(ScheduledDose, VaccineDefinition.name)
            .outerjoin(
                VaccineDefinition,
                VaccineDefinition.id == ScheduledDose.vaccine_definition_id,
            )
            .where(
                ScheduledDose.owner_account_id == ctx.owner_account_id,
                ScheduledDose.flock_id == bird.flock_id,
                ScheduledDose.is_active.is_(True),
                ScheduledDose.status.in_(_OPEN_DOSE_STATUSES),
            )
            .order_by(ScheduledDose.due_date.asc())
            .limit(100)
        )
    )
    batch_doses = [
        BirdProfileBatchDoseOut(
            id=dose.id,
            vaccine_definition_id=dose.vaccine_definition_id,
            vaccine_name=name,
            dose_number=dose.dose_number,
            due_date=dose.due_date,
            status=dose.status,
            eligible_count=dose.eligible_count,
            completed_count=dose.completed_count,
            needs_review=dose.needs_review,
            attribution_note=_BATCH_DOSE_NOTE,
        )
        for dose, name in dose_rows
    ]

    life_rows = list(
        await db.scalars(
            select(LifecycleEvent)
            .where(
                LifecycleEvent.owner_account_id == ctx.owner_account_id,
                LifecycleEvent.bird_id == bird.id,
            )
            .order_by(LifecycleEvent.effective_date.desc(), LifecycleEvent.created_at.desc())
            .limit(50)
        )
    )
    lifecycle = [
        BirdProfileLifecycleOut(
            id=e.id,
            event_type=e.event_type,
            effective_date=e.effective_date,
            quantity=e.quantity,
            reason=e.reason,
            buyer_name=e.buyer_name,
            buyer_mobile=e.buyer_mobile,
            created_at=e.created_at,
        )
        for e in life_rows
    ]

    sale_out: BirdSaleDetailsOut | None = None
    if bird.lifecycle_status == BirdLifecycleStatus.sold:
        sale_ev = next((e for e in life_rows if e.event_type == LifecycleEventType.sale), None)
        if sale_ev is None:
            sale_ev = await db.scalar(
                select(LifecycleEvent)
                .where(
                    LifecycleEvent.owner_account_id == ctx.owner_account_id,
                    LifecycleEvent.bird_id == bird.id,
                    LifecycleEvent.event_type == LifecycleEventType.sale,
                )
                .order_by(LifecycleEvent.effective_date.desc(), LifecycleEvent.created_at.desc())
                .limit(1)
            )
        if sale_ev is not None:
            sale_out = BirdSaleDetailsOut(
                event_id=sale_ev.id,
                sold_on=sale_ev.effective_date,
                buyer_name=sale_ev.buyer_name,
                buyer_mobile=sale_ev.buyer_mobile,
                recorded_at=sale_ev.created_at,
            )

    # Sold/dead/exit birds must not surface open flock vaccination tasks as actionable.
    show_upcoming = bird.is_active and bird.lifecycle_status == BirdLifecycleStatus.active

    return BirdProfileOut(
        id=bird.id,
        band_id=bird.band_id,
        display_code=bird.display_code,
        breed=bird.breed or flock.breed,
        sex=bird.sex,
        hatch_date=bird.hatch_date or flock.hatch_date,
        estimated_age_days=bird.estimated_age_days if bird.estimated_age_days is not None else flock.estimated_age_days,
        dob_confidence=bird.dob_confidence,
        lifecycle_status=bird.lifecycle_status,
        is_active=bird.is_active,
        notes=bird.notes,
        created_at=bird.created_at,
        organization_name=owner.name if owner else None,
        shed_id=shed.id,
        shed_name=shed.name,
        shed_code=shed.code,
        flock_id=flock.id,
        batch_code=flock.batch_code,
        flock_tracking_mode=flock.tracking_mode,
        flock_status=flock.status,
        flock_unbanded_count=flock.unbanded_count,
        flock_banded_count=flock.banded_count,
        flock_current_count=flock.current_count,
        flock_count_mismatch=flock.count_mismatch,
        sire=sire_out,
        dam=dam_out,
        sire_parentage=sire_parentage,
        dam_parentage=dam_parentage,
        sale=sale_out,
        individual_vaccinations=individual,
        batch_upcoming_doses=batch_doses if show_upcoming else [],
        lifecycle_events=lifecycle,
    )


async def list_sold_birds(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    query: str | None = None,
    sold_from: date | None = None,
    sold_to: date | None = None,
    limit: int = 20,
    offset: int = 0,
) -> SoldBirdListOut:
    """Tenant-scoped sold birds with latest sale details (searchable)."""
    assert ctx.owner_account_id is not None and ctx.membership is not None
    limit = max(1, min(limit, 50))
    offset = max(0, offset)
    q = (query or "").strip()
    if len(q) > 64:
        raise FlockError("Search query is too long", "INVALID")

    # Latest sale event per bird via DISTINCT ON (PostgreSQL).
    latest_sale_subq = (
        select(
            LifecycleEvent.bird_id.label("bird_id"),
            LifecycleEvent.effective_date.label("sold_on"),
            LifecycleEvent.buyer_name.label("buyer_name"),
            LifecycleEvent.buyer_mobile.label("buyer_mobile"),
        )
        .where(
            LifecycleEvent.owner_account_id == ctx.owner_account_id,
            LifecycleEvent.event_type == LifecycleEventType.sale,
            LifecycleEvent.bird_id.is_not(None),
        )
        .distinct(LifecycleEvent.bird_id)
        .order_by(
            LifecycleEvent.bird_id,
            LifecycleEvent.effective_date.desc(),
            LifecycleEvent.created_at.desc(),
        )
        .subquery()
    )

    filters = [
        Bird.owner_account_id == ctx.owner_account_id,
        Bird.lifecycle_status == BirdLifecycleStatus.sold,
        Bird.is_active.is_(False),
    ]
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return SoldBirdListOut(total=0, limit=limit, offset=offset, items=[])
        filters.append(Bird.shed_id.in_(assigned))
    if sold_from is not None:
        filters.append(latest_sale_subq.c.sold_on >= sold_from)
    if sold_to is not None:
        filters.append(latest_sale_subq.c.sold_on <= sold_to)
    if q:
        pattern = f"%{q}%"
        filters.append(
            or_(
                Bird.band_id.ilike(pattern),
                Bird.display_code.ilike(pattern),
                Bird.breed.ilike(pattern),
                Flock.breed.ilike(pattern),
                Flock.batch_code.ilike(pattern),
                latest_sale_subq.c.buyer_name.ilike(pattern),
                latest_sale_subq.c.buyer_mobile.ilike(pattern),
            )
        )

    total = int(
        await db.scalar(
            select(func.count())
            .select_from(Bird)
            .join(Shed, Shed.id == Bird.shed_id)
            .join(Flock, Flock.id == Bird.flock_id)
            .outerjoin(latest_sale_subq, latest_sale_subq.c.bird_id == Bird.id)
            .where(*filters)
        )
        or 0
    )

    rows = list(
        await db.execute(
            select(
                Bird,
                Shed,
                Flock,
                latest_sale_subq.c.sold_on,
                latest_sale_subq.c.buyer_name,
                latest_sale_subq.c.buyer_mobile,
            )
            .join(Shed, Shed.id == Bird.shed_id)
            .join(Flock, Flock.id == Bird.flock_id)
            .outerjoin(latest_sale_subq, latest_sale_subq.c.bird_id == Bird.id)
            .where(*filters)
            .order_by(
                latest_sale_subq.c.sold_on.desc().nullslast(),
                Bird.band_id.asc().nullslast(),
            )
            .offset(offset)
            .limit(limit)
        )
    )

    items: list[SoldBirdHitOut] = []
    for bird, shed, flock, sold_on, buyer_name, buyer_mobile in rows:
        items.append(
            SoldBirdHitOut(
                id=bird.id,
                band_id=bird.band_id,
                display_code=bird.display_code,
                breed=bird.breed or flock.breed,
                batch_code=flock.batch_code,
                shed_id=shed.id,
                shed_name=shed.name,
                shed_code=shed.code,
                sold_on=sold_on or date.today(),
                buyer_name=buyer_name,
                buyer_mobile=buyer_mobile,
                lifecycle_status=bird.lifecycle_status,
                is_active=bird.is_active,
            )
        )
    return SoldBirdListOut(total=total, limit=limit, offset=offset, items=items)


async def band_from_unbanded_by_cohort(db: AsyncSession, ctx: AuthContext, data) -> dict:
    """Resolve shed cohort by age key, then band via legacy flock_id path."""
    from types import SimpleNamespace

    from app.services.cohort_ops import resolve_active_cohort

    await assert_shed_access(db, ctx, data.shed_id, permission_code="bird.create")
    flock = await resolve_active_cohort(
        db,
        ctx,
        shed_id=data.shed_id,
        hatch_date=data.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        for_update=False,
    )
    legacy = SimpleNamespace(
        flock_id=flock.id,
        band_id=data.band_id,
        idempotency_key=data.idempotency_key,
        breed=data.breed,
        sex=data.sex,
        notes=data.notes,
    )
    return await band_from_unbanded(db, ctx, legacy)


async def record_unbanded_lifecycle_by_cohort(db: AsyncSession, ctx: AuthContext, data) -> LifecycleEvent:
    """Count-only lifecycle for a shed cohort resolved by age key."""
    from types import SimpleNamespace

    from app.services.cohort_ops import resolve_active_cohort

    await assert_shed_access(db, ctx, data.shed_id, permission_code="lifecycle.record")
    flock = await resolve_active_cohort(
        db,
        ctx,
        shed_id=data.shed_id,
        hatch_date=data.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        for_update=False,
    )
    legacy = SimpleNamespace(
        event_type=data.event_type,
        effective_date=data.effective_date,
        flock_id=flock.id,
        bird_id=None,
        quantity=data.quantity,
        reason=data.reason,
        buyer_name=getattr(data, "buyer_name", None),
        buyer_mobile=getattr(data, "buyer_mobile", None),
        idempotency_key=data.idempotency_key,
    )
    return await record_lifecycle(db, ctx, legacy)


async def transfer_to_shed_by_cohort(db: AsyncSession, ctx: AuthContext, data) -> dict:
    """Shed-centric transfer; creates dest cohort under lifecycle.record when needed."""
    from types import SimpleNamespace

    from app.services.cohort_ops import find_or_create_cohort_flock, resolve_active_cohort

    await assert_shed_access(db, ctx, data.destination_shed_id, permission_code="lifecycle.record")

    if data.bird_ids:
        birds: list[Bird] = []
        for bid in data.bird_ids:
            bird = await get_bird(db, ctx, bid)
            await assert_shed_access(db, ctx, bird.shed_id, permission_code="lifecycle.record")
            birds.append(bird)
        for bird in birds:
            flock = await get_flock(db, ctx, bird.flock_id)
            if data.hatch_date is not None:
                bird_hatch = bird.hatch_date or flock.hatch_date
                if bird_hatch != data.hatch_date:
                    raise FlockError("Selected birds do not share the request hatch date", "AMBIGUOUS_HATCH")
            else:
                ead = (
                    bird.estimated_age_days
                    if bird.estimated_age_days is not None
                    else flock.estimated_age_days
                )
                aro = bird.age_reported_on or flock.age_reported_on
                if ead != data.estimated_age_days or aro != data.age_reported_on:
                    raise FlockError(
                        "Selected birds do not share the request estimated age key",
                        "AMBIGUOUS_HATCH",
                    )

        dest, _ = await find_or_create_cohort_flock(
            db,
            ctx,
            shed_id=data.destination_shed_id,
            hatch_date=data.hatch_date,
            estimated_age_days=data.estimated_age_days,
            age_reported_on=data.age_reported_on,
            tracking_mode=TrackingMode.mixed,
            initial_unbanded=0,
            commit=False,
            access_permission="lifecycle.record",
        )
        legacy = SimpleNamespace(
            destination_flock_id=dest.id,
            effective_date=data.effective_date,
            bird_ids=list(data.bird_ids),
            source_flock_id=None,
            quantity=None,
            reason=data.reason,
            idempotency_key=data.idempotency_key,
        )
        return await transfer_to_shed(db, ctx, legacy)

    if data.source_shed_id is None or data.quantity is None:
        raise FlockError("source_shed_id and quantity required for unbanded transfer", "INVALID")
    await assert_shed_access(db, ctx, data.source_shed_id, permission_code="lifecycle.record")
    source = await resolve_active_cohort(
        db,
        ctx,
        shed_id=data.source_shed_id,
        hatch_date=data.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        for_update=False,
    )
    dest, _ = await find_or_create_cohort_flock(
        db,
        ctx,
        shed_id=data.destination_shed_id,
        hatch_date=data.hatch_date,
        estimated_age_days=data.estimated_age_days,
        age_reported_on=data.age_reported_on,
        tracking_mode=TrackingMode.batch,
        initial_unbanded=0,
        commit=False,
        access_permission="lifecycle.record",
    )
    legacy = SimpleNamespace(
        destination_flock_id=dest.id,
        effective_date=data.effective_date,
        bird_ids=[],
        source_flock_id=source.id,
        quantity=data.quantity,
        reason=data.reason,
        idempotency_key=data.idempotency_key,
    )
    return await transfer_to_shed(db, ctx, legacy)
