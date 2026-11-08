"""Bird sickness episodes: recording, recovery, history, and reporting."""

from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import and_, case, distinct, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.authorization.deps import AuthContext
from app.authorization.permissions import (
    assert_shed_access,
    list_assigned_shed_ids,
    membership_has_permission,
)
from app.models.audit import AuditLog
from app.models.enums import (
    BirdLifecycleStatus,
    MembershipRole,
    SicknessSeverity,
    SicknessStatus,
)
from app.models.flock import Bird, Flock
from app.models.shed import Shed
from app.models.sickness import BirdSicknessRecord
from app.schemas.sickness import (
    BirdHealthOverviewOut,
    SicknessBulkCreate,
    SicknessBulkResultOut,
    SicknessCreate,
    SicknessEpisodeOut,
    SicknessHistoryOut,
    SicknessListOut,
    SicknessRecover,
    SicknessRecordOut,
    SicknessShedBreakdownOut,
    SicknessSummaryOut,
    SicknessUpdate,
)
from app.services.idempotency_helpers import (
    IdempotencyConflictError,
    assert_payload_matches,
    payload_hash,
)

MAX_PAGE_SIZE = 50
FOLLOW_UP_DUE_DAYS = 7


class SicknessError(Exception):
    def __init__(self, message: str, code: str = "INVALID") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _today() -> date:
    return date.today()


def _clean(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _bird_label(bird: Bird) -> str:
    return bird.band_id or bird.display_code or str(bird.id)[:8]


def _follow_up_state(follow_up_date: date | None, today: date) -> str:
    if follow_up_date is None:
        return "none"
    if follow_up_date < today:
        return "overdue"
    if follow_up_date <= today + timedelta(days=FOLLOW_UP_DUE_DAYS):
        return "due"
    return "upcoming"


def _days_sick(record: BirdSicknessRecord, today: date) -> int:
    end = record.recovery_date or today
    return max(0, (end - record.sick_date).days)


def _record_hash(
    *,
    bird_id: UUID,
    sick_date: date,
    symptoms: str,
    severity: SicknessSeverity,
    notes: str | None,
    treatment: str | None,
    follow_up_date: date | None,
) -> str:
    return payload_hash(
        {
            "bird_id": bird_id,
            "sick_date": sick_date,
            "symptoms": symptoms,
            "severity": severity.value,
            "notes": notes,
            "treatment": treatment,
            "follow_up_date": follow_up_date,
        }
    )


def _audit_payload(record: BirdSicknessRecord) -> dict[str, object]:
    return {
        "bird_id": str(record.bird_id),
        "sick_date": record.sick_date.isoformat(),
        "severity": record.severity.value,
        "symptoms": record.symptoms,
        "notes": record.notes,
        "treatment": record.treatment,
        "follow_up_date": record.follow_up_date.isoformat() if record.follow_up_date else None,
        "status": record.status.value,
        "recovery_date": record.recovery_date.isoformat() if record.recovery_date else None,
    }


def _assert_org(ctx: AuthContext) -> None:
    if ctx.owner_account_id is None:
        raise SicknessError("X-Owner-Account-Id header required", "FORBIDDEN")


async def can_view_sickness(db: AsyncSession, ctx: AuthContext) -> bool:
    if ctx.owner_account_id is None:
        return False
    if ctx.user.is_platform_super_admin:
        return True
    if ctx.membership is None:
        return False
    if ctx.membership.role == MembershipRole.owner:
        return True
    return await membership_has_permission(
        db,
        membership_id=ctx.membership.id,
        permission_code="sickness.view",
    )


async def _load_bird(
    db: AsyncSession,
    ctx: AuthContext,
    bird_id: UUID,
    *,
    permission_code: str,
) -> Bird:
    _assert_org(ctx)
    bird = await db.scalar(
        select(Bird).where(
            Bird.id == bird_id,
            Bird.owner_account_id == ctx.owner_account_id,
        )
    )
    if bird is None:
        raise SicknessError("Bird not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, bird.shed_id, permission_code=permission_code)
    return bird


async def _load_record_for_update(
    db: AsyncSession,
    ctx: AuthContext,
    record_id: UUID,
    *,
    permission_code: str,
) -> tuple[BirdSicknessRecord, Bird]:
    _assert_org(ctx)
    record = await db.scalar(
        select(BirdSicknessRecord)
        .where(
            BirdSicknessRecord.id == record_id,
            BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
        )
        .with_for_update()
    )
    if record is None:
        raise SicknessError("Sickness record not found", "NOT_FOUND")
    bird = await db.get(Bird, record.bird_id)
    if bird is None or bird.owner_account_id != ctx.owner_account_id:
        raise SicknessError("Sickness record not found", "NOT_FOUND")
    await assert_shed_access(db, ctx, bird.shed_id, permission_code=permission_code)
    return record, bird


def _validate_new_dates(
    sick_date: date,
    follow_up_date: date | None,
    *,
    today: date | None = None,
) -> None:
    now = today or _today()
    if sick_date > now:
        raise SicknessError("Sick date cannot be in the future", "INVALID")
    if follow_up_date is not None and follow_up_date < sick_date:
        raise SicknessError(
            "Follow-up date must be on or after the sick date", "INVALID"
        )


def _validate_recovery_date(
    recovery_date: date,
    sick_date: date,
    *,
    today: date | None = None,
) -> None:
    now = today or _today()
    if recovery_date > now:
        raise SicknessError("Recovery date cannot be in the future", "INVALID")
    if recovery_date < sick_date:
        raise SicknessError(
            "Recovery date must be on or after the sick date", "INVALID"
        )


def _assert_bird_active(bird: Bird) -> None:
    if not bird.is_active or bird.lifecycle_status != BirdLifecycleStatus.active:
        raise SicknessError(
            "Bird is not active; sickness can only be recorded for active birds",
            "BIRD_INACTIVE",
        )


async def _serialize_record(
    db: AsyncSession,
    record: BirdSicknessRecord,
    bird: Bird,
    *,
    current_shed: Shed | None = None,
    flock: Flock | None = None,
    recorded_shed: Shed | None = None,
) -> SicknessRecordOut:
    if current_shed is None:
        current_shed = await db.get(Shed, bird.shed_id)
    if flock is None:
        flock = await db.get(Flock, bird.flock_id)
    if recorded_shed is None:
        recorded_shed = await db.get(Shed, record.shed_id)
    if flock is None:
        raise SicknessError("Bird placement not found", "NOT_FOUND")
    today = _today()
    return SicknessRecordOut(
        id=record.id,
        bird_id=record.bird_id,
        band_id=bird.band_id,
        display_code=bird.display_code,
        breed=bird.breed or flock.breed,
        batch_code=flock.batch_code,
        current_shed_id=bird.shed_id,
        current_shed_name=current_shed.name if current_shed else None,
        recorded_shed_id=record.shed_id,
        recorded_shed_name=recorded_shed.name if recorded_shed else None,
        sick_date=record.sick_date,
        symptoms=record.symptoms,
        severity=record.severity,
        notes=record.notes,
        treatment=record.treatment,
        follow_up_date=record.follow_up_date,
        recovery_date=record.recovery_date,
        status=record.status,
        bird_is_active=bird.is_active,
        bird_lifecycle_status=bird.lifecycle_status,
        created_by_user_id=record.created_by_user_id,
        recovered_by_user_id=record.recovered_by_user_id,
        created_at=record.created_at,
        updated_at=record.updated_at,
        follow_up_state=_follow_up_state(record.follow_up_date, today),
        days_sick=_days_sick(record, today),
    )


async def _serialize_by_id(
    db: AsyncSession,
    record: BirdSicknessRecord,
    bird: Bird | None = None,
) -> SicknessRecordOut:
    if bird is None:
        bird = await db.get(Bird, record.bird_id)
    if bird is None:
        raise SicknessError("Bird not found", "NOT_FOUND")
    return await _serialize_record(db, record, bird)


async def _serialize_many(
    db: AsyncSession,
    records: list[BirdSicknessRecord],
    birds: dict[UUID, Bird],
) -> list[SicknessRecordOut]:
    if not records:
        return []
    shed_ids = {r.shed_id for r in records} | {b.shed_id for b in birds.values()}
    flock_ids = {b.flock_id for b in birds.values()}
    sheds = {
        shed.id: shed
        for shed in await db.scalars(select(Shed).where(Shed.id.in_(shed_ids)))
    }
    flocks = {
        flock.id: flock
        for flock in await db.scalars(select(Flock).where(Flock.id.in_(flock_ids)))
    }
    items: list[SicknessRecordOut] = []
    for record in records:
        bird = birds.get(record.bird_id)
        if bird is None:
            continue
        items.append(
            await _serialize_record(
                db,
                record,
                bird,
                current_shed=sheds.get(bird.shed_id),
                flock=flocks.get(bird.flock_id),
                recorded_shed=sheds.get(record.shed_id),
            )
        )
    return items


async def create_sickness(
    db: AsyncSession,
    ctx: AuthContext,
    bird_id: UUID,
    body: SicknessCreate,
    *,
    today: date | None = None,
) -> SicknessRecordOut:
    now = today or _today()
    _validate_new_dates(body.sick_date, body.follow_up_date, today=now)
    bird = await _load_bird(
        db, ctx, bird_id, permission_code="sickness.record"
    )
    _assert_bird_active(bird)

    notes = _clean(body.notes)
    treatment = _clean(body.treatment)
    key = _clean(body.idempotency_key)
    request_hash = _record_hash(
        bird_id=bird.id,
        sick_date=body.sick_date,
        symptoms=body.symptoms,
        severity=body.severity,
        notes=notes,
        treatment=treatment,
        follow_up_date=body.follow_up_date,
    )

    if key:
        existing = await db.scalar(
            select(BirdSicknessRecord).where(
                BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
                BirdSicknessRecord.idempotency_key == key,
            )
        )
        if existing is not None:
            try:
                assert_payload_matches(existing.idempotency_payload_hash, request_hash)
            except IdempotencyConflictError as exc:
                raise SicknessError(exc.message, "IDEMPOTENCY_CONFLICT") from exc
            return await _serialize_by_id(db, existing, bird)

    active = await db.scalar(
        select(BirdSicknessRecord.id)
        .where(
            BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
            BirdSicknessRecord.bird_id == bird.id,
            BirdSicknessRecord.status == SicknessStatus.active,
        )
        .limit(1)
    )
    if active is not None:
        raise SicknessError(
            "This bird already has an active sickness episode",
            "ACTIVE_SICKNESS_EXISTS",
        )

    record = BirdSicknessRecord(
        owner_account_id=ctx.owner_account_id,
        bird_id=bird.id,
        shed_id=bird.shed_id,
        sick_date=body.sick_date,
        symptoms=body.symptoms,
        severity=body.severity,
        notes=notes,
        treatment=treatment,
        follow_up_date=body.follow_up_date,
        status=SicknessStatus.active,
        created_by_user_id=ctx.user.id,
        idempotency_key=key,
        idempotency_payload_hash=request_hash if key else None,
    )
    db.add(record)
    try:
        await db.flush()
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="sickness.record",
                entity_type="bird_sickness_record",
                entity_id=record.id,
                after=_audit_payload(record),
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if key:
            existing = await db.scalar(
                select(BirdSicknessRecord).where(
                    BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
                    BirdSicknessRecord.idempotency_key == key,
                )
            )
            if existing is not None:
                try:
                    assert_payload_matches(
                        existing.idempotency_payload_hash, request_hash
                    )
                except IdempotencyConflictError:
                    raise SicknessError(
                        "Idempotency key already used with a different payload",
                        "IDEMPOTENCY_CONFLICT",
                    ) from exc
                return await _serialize_by_id(db, existing, bird)
        raise SicknessError(
            "This bird already has an active sickness episode",
            "ACTIVE_SICKNESS_EXISTS",
        ) from exc

    await db.refresh(record)
    return await _serialize_by_id(db, record, bird)


async def bulk_create_sickness(
    db: AsyncSession,
    ctx: AuthContext,
    body: SicknessBulkCreate,
    *,
    today: date | None = None,
) -> SicknessBulkResultOut:
    now = today or _today()
    _validate_new_dates(body.sick_date, body.follow_up_date, today=now)
    _assert_org(ctx)

    bird_ids = list(dict.fromkeys(body.bird_ids))
    birds = list(
        await db.scalars(
            select(Bird).where(
                Bird.owner_account_id == ctx.owner_account_id,
                Bird.id.in_(bird_ids),
            )
        )
    )
    if len(birds) != len(bird_ids):
        raise SicknessError(
            "One or more selected birds were not found", "NOT_FOUND"
        )
    birds_by_id = {bird.id: bird for bird in birds}

    inactive = [
        _bird_label(bird)
        for bird in birds
        if not bird.is_active or bird.lifecycle_status != BirdLifecycleStatus.active
    ]
    if inactive:
        raise SicknessError(
            "These birds are not active: " + ", ".join(inactive[:10]),
            "BIRD_INACTIVE",
        )
    for bird in birds:
        await assert_shed_access(
            db, ctx, bird.shed_id, permission_code="sickness.record"
        )

    notes = _clean(body.notes)
    treatment = _clean(body.treatment)
    key = _clean(body.idempotency_key)
    keys_by_bird: dict[UUID, str] = {}
    hashes_by_bird: dict[UUID, str] = {}
    for bird in birds:
        hashes_by_bird[bird.id] = _record_hash(
            bird_id=bird.id,
            sick_date=body.sick_date,
            symptoms=body.symptoms,
            severity=body.severity,
            notes=notes,
            treatment=treatment,
            follow_up_date=body.follow_up_date,
        )
        if key:
            keys_by_bird[bird.id] = f"{key}:{bird.id}"

    if key:
        existing = list(
            await db.scalars(
                select(BirdSicknessRecord).where(
                    BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
                    BirdSicknessRecord.idempotency_key.in_(list(keys_by_bird.values())),
                )
            )
        )
        if existing:
            existing_by_bird = {
                record.bird_id: record for record in existing if record.bird_id in birds_by_id
            }
            if len(existing_by_bird) != len(bird_ids):
                raise SicknessError(
                    "This bulk request was partially recorded; start a new request",
                    "PARTIAL_IDEMPOTENCY",
                )
            for bird_id, record in existing_by_bird.items():
                try:
                    assert_payload_matches(
                        record.idempotency_payload_hash, hashes_by_bird[bird_id]
                    )
                except IdempotencyConflictError as exc:
                    raise SicknessError(
                        "Idempotency key already used with a different payload",
                        "IDEMPOTENCY_CONFLICT",
                    ) from exc
            return SicknessBulkResultOut(
                success_count=len(existing_by_bird),
                recorded=await _serialize_many(db, list(existing_by_bird.values()), birds_by_id),
                idempotent_replay=True,
            )

    existing_active = list(
        await db.scalars(
            select(BirdSicknessRecord).where(
                BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
                BirdSicknessRecord.bird_id.in_(bird_ids),
                BirdSicknessRecord.status == SicknessStatus.active,
            )
        )
    )
    if existing_active:
        labels = [
            _bird_label(birds_by_id[record.bird_id])
            for record in existing_active
            if record.bird_id in birds_by_id
        ]
        raise SicknessError(
            "These birds already have an active sickness episode: "
            + ", ".join(labels[:10]),
            "ACTIVE_SICKNESS_EXISTS",
        )

    records = [
        BirdSicknessRecord(
            owner_account_id=ctx.owner_account_id,
            bird_id=bird.id,
            shed_id=bird.shed_id,
            sick_date=body.sick_date,
            symptoms=body.symptoms,
            severity=body.severity,
            notes=notes,
            treatment=treatment,
            follow_up_date=body.follow_up_date,
            status=SicknessStatus.active,
            created_by_user_id=ctx.user.id,
            idempotency_key=keys_by_bird.get(bird.id),
            idempotency_payload_hash=hashes_by_bird[bird.id] if key else None,
        )
        for bird in birds
    ]
    db.add_all(records)
    try:
        await db.flush()
        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="sickness.record_bulk",
                entity_type="bird_sickness_record",
                entity_id=None,
                after={
                    "bird_ids": [str(bird.id) for bird in birds],
                    "record_ids": [str(record.id) for record in records],
                    "sick_date": body.sick_date.isoformat(),
                    "severity": body.severity.value,
                },
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if key:
            existing = list(
                await db.scalars(
                    select(BirdSicknessRecord).where(
                        BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
                        BirdSicknessRecord.idempotency_key.in_(list(keys_by_bird.values())),
                    )
                )
            )
            if len(existing) == len(bird_ids):
                return SicknessBulkResultOut(
                    success_count=len(existing),
                    recorded=await _serialize_many(db, existing, birds_by_id),
                    idempotent_replay=True,
                )
        raise SicknessError(
            "One or more birds already have an active sickness episode",
            "ACTIVE_SICKNESS_EXISTS",
        ) from exc

    for record in records:
        await db.refresh(record)
    return SicknessBulkResultOut(
        success_count=len(records),
        recorded=await _serialize_many(db, records, birds_by_id),
        idempotent_replay=False,
    )


async def list_sickness(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    query: str | None = None,
    status: SicknessStatus | None = None,
    severity: SicknessSeverity | None = None,
    bird_id: UUID | None = None,
    shed_id: UUID | None = None,
    sick_from: date | None = None,
    sick_to: date | None = None,
    follow_up_from: date | None = None,
    follow_up_to: date | None = None,
    follow_up_state: str | None = None,
    include_inactive: bool = False,
    limit: int = 20,
    offset: int = 0,
    max_page_size: int = MAX_PAGE_SIZE,
) -> SicknessListOut:
    _assert_org(ctx)
    if sick_from and sick_to and sick_from > sick_to:
        raise SicknessError("sick_from must be on or before sick_to", "INVALID")
    if follow_up_from and follow_up_to and follow_up_from > follow_up_to:
        raise SicknessError(
            "follow_up_from must be on or before follow_up_to", "INVALID"
        )
    cap = max(1, max_page_size)
    limit = max(1, min(limit, cap))
    offset = max(0, offset)
    q = (query or "").strip()
    if len(q) > 64:
        raise SicknessError("Search query is too long", "INVALID")

    current_shed = aliased(Shed)
    recorded_shed = aliased(Shed)
    filters: list[object] = [
        BirdSicknessRecord.owner_account_id == ctx.owner_account_id
    ]
    if not include_inactive:
        filters.extend(
            [
                Bird.is_active.is_(True),
                Bird.lifecycle_status == BirdLifecycleStatus.active,
            ]
        )
    if ctx.membership is not None and ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return SicknessListOut(total=0, limit=limit, offset=offset, items=[])
        filters.append(Bird.shed_id.in_(assigned))
    if bird_id is not None:
        filters.append(BirdSicknessRecord.bird_id == bird_id)
    if shed_id is not None:
        filters.append(Bird.shed_id == shed_id)
    if status is not None:
        filters.append(BirdSicknessRecord.status == status)
    if severity is not None:
        filters.append(BirdSicknessRecord.severity == severity)
    if sick_from is not None:
        filters.append(BirdSicknessRecord.sick_date >= sick_from)
    if sick_to is not None:
        filters.append(BirdSicknessRecord.sick_date <= sick_to)
    if follow_up_from is not None:
        filters.append(BirdSicknessRecord.follow_up_date >= follow_up_from)
    if follow_up_to is not None:
        filters.append(BirdSicknessRecord.follow_up_date <= follow_up_to)
    today = _today()
    if follow_up_state == "overdue":
        filters.append(BirdSicknessRecord.follow_up_date < today)
    elif follow_up_state == "due":
        filters.extend(
            [
                BirdSicknessRecord.follow_up_date >= today,
                BirdSicknessRecord.follow_up_date
                <= today + timedelta(days=FOLLOW_UP_DUE_DAYS),
            ]
        )
    elif follow_up_state == "upcoming":
        filters.append(
            BirdSicknessRecord.follow_up_date
            > today + timedelta(days=FOLLOW_UP_DUE_DAYS)
        )
    elif follow_up_state == "none":
        filters.append(BirdSicknessRecord.follow_up_date.is_(None))
    if q:
        pattern = f"%{q}%"
        filters.append(
            or_(
                Bird.band_id.ilike(pattern),
                Bird.display_code.ilike(pattern),
                Bird.breed.ilike(pattern),
                Flock.breed.ilike(pattern),
                Flock.batch_code.ilike(pattern),
                current_shed.name.ilike(pattern),
                recorded_shed.name.ilike(pattern),
                BirdSicknessRecord.symptoms.ilike(pattern),
            )
        )

    base_select = (
        select(BirdSicknessRecord)
        .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
        .join(current_shed, current_shed.id == Bird.shed_id)
        .join(Flock, Flock.id == Bird.flock_id)
        .join(recorded_shed, recorded_shed.id == BirdSicknessRecord.shed_id)
        .where(*filters)
    )
    total = int(
        await db.scalar(
            select(func.count())
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .join(current_shed, current_shed.id == Bird.shed_id)
            .join(Flock, Flock.id == Bird.flock_id)
            .join(recorded_shed, recorded_shed.id == BirdSicknessRecord.shed_id)
            .where(*filters)
        )
        or 0
    )
    rows = list(
        await db.execute(
            base_select.add_columns(Bird, current_shed, Flock, recorded_shed)
            .order_by(
                case(
                    (BirdSicknessRecord.status == SicknessStatus.active, 0),
                    else_=1,
                ),
                BirdSicknessRecord.sick_date.desc(),
                BirdSicknessRecord.created_at.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
    )
    items = [
        await _serialize_record(
            db,
            record,
            bird,
            current_shed=current,
            flock=flock,
            recorded_shed=recorded,
        )
        for record, bird, current, flock, recorded in rows
    ]
    return SicknessListOut(total=total, limit=limit, offset=offset, items=items)


async def get_sickness_summary(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
) -> SicknessSummaryOut:
    _assert_org(ctx)
    if from_date and to_date and from_date > to_date:
        raise SicknessError("from_date must be on or before to_date", "INVALID")
    today = _today()
    scope: list[object] = [
        BirdSicknessRecord.owner_account_id == ctx.owner_account_id
    ]
    if ctx.membership is not None and ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return SicknessSummaryOut(
                as_of=today,
                from_date=from_date,
                to_date=to_date,
                currently_sick_birds=0,
                active_episodes=0,
                follow_ups_due=0,
                follow_ups_overdue=0,
                recovered_birds=0,
                recovered_episodes=0,
                new_episodes=0,
                new_unique_birds=0,
                unresolved_inactive_episodes=0,
                severity_breakdown={"mild": 0, "moderate": 0, "severe": 0},
                new_severity_breakdown={"mild": 0, "moderate": 0, "severe": 0},
                shed_breakdown=[],
            )
        scope.append(Bird.shed_id.in_(assigned))

    active_filters = [
        *scope,
        BirdSicknessRecord.status == SicknessStatus.active,
        Bird.is_active.is_(True),
        Bird.lifecycle_status == BirdLifecycleStatus.active,
    ]

    async def _count(*where: object) -> int:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(BirdSicknessRecord)
                .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
                .where(*where)
            )
            or 0
        )

    active_episodes = await _count(*active_filters)
    currently_sick_birds = int(
        await db.scalar(
            select(func.count(distinct(BirdSicknessRecord.bird_id)))
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .where(*active_filters)
        )
        or 0
    )
    follow_ups_due = await _count(
        *active_filters,
        BirdSicknessRecord.follow_up_date >= today,
        BirdSicknessRecord.follow_up_date
        <= today + timedelta(days=FOLLOW_UP_DUE_DAYS),
    )
    follow_ups_overdue = await _count(
        *active_filters,
        BirdSicknessRecord.follow_up_date < today,
    )

    new_filters = [*scope, Bird.is_active.is_(True)]
    if from_date is not None:
        new_filters.append(BirdSicknessRecord.sick_date >= from_date)
    if to_date is not None:
        new_filters.append(BirdSicknessRecord.sick_date <= to_date)
    new_episodes = await _count(*new_filters)
    new_unique_birds = int(
        await db.scalar(
            select(func.count(distinct(BirdSicknessRecord.bird_id)))
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .where(*new_filters)
        )
        or 0
    )

    recovered_filters = [
        *scope,
        BirdSicknessRecord.status == SicknessStatus.recovered,
        BirdSicknessRecord.recovery_date.is_not(None),
        Bird.is_active.is_(True),
    ]
    if from_date is not None:
        recovered_filters.append(BirdSicknessRecord.recovery_date >= from_date)
    if to_date is not None:
        recovered_filters.append(BirdSicknessRecord.recovery_date <= to_date)
    recovered_episodes = await _count(*recovered_filters)
    recovered_birds = int(
        await db.scalar(
            select(func.count(distinct(BirdSicknessRecord.bird_id)))
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .where(*recovered_filters)
        )
        or 0
    )

    unresolved_inactive_episodes = await _count(
        *scope,
        BirdSicknessRecord.status == SicknessStatus.active,
        or_(
            Bird.is_active.is_(False),
            Bird.lifecycle_status != BirdLifecycleStatus.active,
        ),
    )

    def _severity_map(rows: list[tuple[SicknessSeverity, int]]) -> dict[str, int]:
        out = {"mild": 0, "moderate": 0, "severe": 0}
        for severity, count in rows:
            out[severity.value] = int(count)
        return out

    active_severity_rows = list(
        await db.execute(
            select(BirdSicknessRecord.severity, func.count(BirdSicknessRecord.id))
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .where(*active_filters)
            .group_by(BirdSicknessRecord.severity)
        )
    )
    new_severity_rows = list(
        await db.execute(
            select(BirdSicknessRecord.severity, func.count(BirdSicknessRecord.id))
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .where(*new_filters)
            .group_by(BirdSicknessRecord.severity)
        )
    )

    shed_rows = list(
        await db.execute(
            select(
                Bird.shed_id,
                Shed.name,
                func.count(distinct(BirdSicknessRecord.bird_id)),
                func.count(BirdSicknessRecord.id),
                func.sum(
                    case(
                        (
                            and_(
                                BirdSicknessRecord.follow_up_date >= today,
                                BirdSicknessRecord.follow_up_date
                                <= today + timedelta(days=FOLLOW_UP_DUE_DAYS),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (BirdSicknessRecord.follow_up_date < today, 1),
                        else_=0,
                    )
                ),
            )
            .select_from(BirdSicknessRecord)
            .join(Bird, Bird.id == BirdSicknessRecord.bird_id)
            .join(Shed, Shed.id == Bird.shed_id)
            .where(*active_filters)
            .group_by(Bird.shed_id, Shed.name)
            .order_by(Shed.name.asc())
        )
    )
    shed_breakdown = [
        SicknessShedBreakdownOut(
            shed_id=shed_id,
            shed_name=shed_name,
            active_birds=int(active_birds or 0),
            active_episodes=int(active_episodes_count or 0),
            due=int(due or 0),
            overdue=int(overdue or 0),
        )
        for shed_id, shed_name, active_birds, active_episodes_count, due, overdue in shed_rows
    ]

    return SicknessSummaryOut(
        as_of=today,
        from_date=from_date,
        to_date=to_date,
        currently_sick_birds=currently_sick_birds,
        active_episodes=active_episodes,
        follow_ups_due=follow_ups_due,
        follow_ups_overdue=follow_ups_overdue,
        recovered_birds=recovered_birds,
        recovered_episodes=recovered_episodes,
        new_episodes=new_episodes,
        new_unique_birds=new_unique_birds,
        unresolved_inactive_episodes=unresolved_inactive_episodes,
        severity_breakdown=_severity_map(active_severity_rows),
        new_severity_breakdown=_severity_map(new_severity_rows),
        shed_breakdown=shed_breakdown,
    )


async def get_bird_sickness_history(
    db: AsyncSession,
    ctx: AuthContext,
    bird_id: UUID,
    *,
    bird: Bird | None = None,
) -> SicknessHistoryOut:
    if bird is None:
        bird = await _load_bird(
            db, ctx, bird_id, permission_code="sickness.view"
        )
    else:
        await assert_shed_access(
            db, ctx, bird.shed_id, permission_code="sickness.view"
        )
    records = list(
        await db.scalars(
            select(BirdSicknessRecord)
            .where(
                BirdSicknessRecord.owner_account_id == ctx.owner_account_id,
                BirdSicknessRecord.bird_id == bird.id,
            )
            .order_by(
                BirdSicknessRecord.sick_date.desc(),
                BirdSicknessRecord.created_at.desc(),
            )
        )
    )
    shed_ids = {record.shed_id for record in records}
    sheds = {
        shed.id: shed
        for shed in await db.scalars(select(Shed).where(Shed.id.in_(shed_ids)))
    }
    today = _today()
    episodes = [
        SicknessEpisodeOut(
            id=record.id,
            bird_id=record.bird_id,
            sick_date=record.sick_date,
            symptoms=record.symptoms,
            severity=record.severity,
            notes=record.notes,
            treatment=record.treatment,
            follow_up_date=record.follow_up_date,
            recovery_date=record.recovery_date,
            status=record.status,
            recorded_shed_id=record.shed_id,
            recorded_shed_name=sheds[record.shed_id].name
            if record.shed_id in sheds
            else None,
            created_by_user_id=record.created_by_user_id,
            recovered_by_user_id=record.recovered_by_user_id,
            created_at=record.created_at,
            updated_at=record.updated_at,
            follow_up_state=_follow_up_state(record.follow_up_date, today),
        )
        for record in records
    ]
    active = next(
        (record for record in records if record.status == SicknessStatus.active),
        None,
    )
    if bird.is_active and bird.lifecycle_status == BirdLifecycleStatus.active:
        health_status = "sick" if active is not None else "healthy"
    else:
        health_status = "unresolved_inactive" if active is not None else "not_applicable"
    last_sickness = max((record.sick_date for record in records), default=None)
    recovery_dates = [record.recovery_date for record in records if record.recovery_date]
    last_recovery = max(recovery_dates, default=None)
    active_episode = next(
        (episode for episode in episodes if episode.id == active.id),
        None,
    ) if active is not None else None
    return SicknessHistoryOut(
        bird_id=bird.id,
        band_id=bird.band_id,
        display_code=bird.display_code,
        current_health_status=health_status,
        total_episodes=len(records),
        last_sickness_date=last_sickness,
        last_recovery_date=last_recovery,
        active_episode=active_episode,
        episodes=episodes,
    )


async def recover_sickness(
    db: AsyncSession,
    ctx: AuthContext,
    record_id: UUID,
    body: SicknessRecover,
    *,
    today: date | None = None,
) -> SicknessRecordOut:
    now = today or _today()
    record, bird = await _load_record_for_update(
        db, ctx, record_id, permission_code="sickness.recover"
    )
    if record.status != SicknessStatus.active:
        raise SicknessError(
            "This sickness episode is already recovered", "ALREADY_RECOVERED"
        )
    if not bird.is_active or bird.lifecycle_status != BirdLifecycleStatus.active:
        raise SicknessError(
            "Bird is no longer active; sickness cannot be marked recovered",
            "BIRD_INACTIVE",
        )
    _validate_recovery_date(body.recovery_date, record.sick_date, today=now)

    before = _audit_payload(record)
    record.status = SicknessStatus.recovered
    record.recovery_date = body.recovery_date
    record.recovered_by_user_id = ctx.user.id
    note = _clean(body.notes)
    if note:
        record.notes = f"{record.notes}\n{note}" if record.notes else note
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="sickness.recover",
            entity_type="bird_sickness_record",
            entity_id=record.id,
            before=before,
            after=_audit_payload(record),
        )
    )
    await db.commit()
    await db.refresh(record)
    return await _serialize_by_id(db, record, bird)


async def update_sickness(
    db: AsyncSession,
    ctx: AuthContext,
    record_id: UUID,
    body: SicknessUpdate,
) -> SicknessRecordOut:
    record, bird = await _load_record_for_update(
        db, ctx, record_id, permission_code="sickness.record"
    )
    if record.status != SicknessStatus.active:
        raise SicknessError(
            "Only active sickness episodes can be edited", "ALREADY_RECOVERED"
        )
    if not bird.is_active or bird.lifecycle_status != BirdLifecycleStatus.active:
        raise SicknessError(
            "Bird is no longer active; sickness cannot be edited", "BIRD_INACTIVE"
        )

    payload = body.model_dump(exclude_unset=True)
    sick_date = payload.get("sick_date", record.sick_date)
    follow_up_date = (
        payload["follow_up_date"]
        if "follow_up_date" in payload
        else record.follow_up_date
    )
    _validate_new_dates(sick_date, follow_up_date)

    before = _audit_payload(record)
    if "sick_date" in payload:
        record.sick_date = sick_date
    if "symptoms" in payload:
        record.symptoms = payload["symptoms"]
    if "severity" in payload:
        record.severity = payload["severity"]
    if "notes" in payload:
        record.notes = _clean(payload["notes"])
    if "treatment" in payload:
        record.treatment = _clean(payload["treatment"])
    if "follow_up_date" in payload:
        record.follow_up_date = follow_up_date
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="sickness.update",
            entity_type="bird_sickness_record",
            entity_id=record.id,
            before=before,
            after=_audit_payload(record),
        )
    )
    await db.commit()
    await db.refresh(record)
    return await _serialize_by_id(db, record, bird)


def health_overview(history: SicknessHistoryOut) -> BirdHealthOverviewOut:
    return BirdHealthOverviewOut(
        status=history.current_health_status,
        total_episodes=history.total_episodes,
        last_sickness_date=history.last_sickness_date,
        last_recovery_date=history.last_recovery_date,
        active_episode_id=history.active_episode.id
        if history.active_episode is not None
        else None,
    )
