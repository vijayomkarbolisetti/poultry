from collections import defaultdict
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.models.audit import AuditLog
from app.models.enums import FlockStatus, MembershipRole
from app.models.flock import Flock
from app.models.membership import OwnerMembership
from app.models.owner import OwnerAccount
from app.models.shed import Shed, ShedMembership
from app.models.user import User
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import ScheduledDose
from app.schemas.search import ShedSearchHitOut, ShedSearchOut
from app.schemas.shed import (
    ShedAssignmentOut,
    ShedDependenciesOut,
    ShedListItemOut,
    ShedOut,
    ShedOverviewBatchOut,
    ShedOverviewOut,
    ShedOverviewPopulationOut,
    ShedOverviewVaccinationOut,
)
from app.services.schedule_engine import (
    STATUS_DUE_SOON,
    STATUS_DUE_TODAY,
    STATUS_NEEDS_REVIEW,
    STATUS_OVERDUE,
    STATUS_UPCOMING,
)


class ShedError(Exception):
    def __init__(self, message: str, code: str = "SHED_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def _resolve_farmer_membership(
    db: AsyncSession, ctx: AuthContext, owner_membership_id: UUID
) -> OwnerMembership:
    """Ensure membership belongs to this org, is active, and is a farmer."""
    membership = await db.scalar(
        select(OwnerMembership).where(
            OwnerMembership.id == owner_membership_id,
            OwnerMembership.owner_account_id == ctx.owner_account_id,
            OwnerMembership.is_active.is_(True),
        )
    )
    if membership is None:
        raise ShedError("Membership not found in this organization", "MEMBERSHIP_NOT_FOUND")
    if membership.role != MembershipRole.farmer:
        raise ShedError("Only farmer memberships can be assigned to a shed", "NOT_A_FARMER")
    return membership


async def _upsert_assignment(
    db: AsyncSession,
    ctx: AuthContext,
    shed: Shed,
    *,
    owner_membership_id: UUID,
    is_manager: bool,
) -> ShedMembership:
    """Create or reactivate a shed membership in the current transaction (no commit)."""
    await _resolve_farmer_membership(db, ctx, owner_membership_id)
    existing = await db.scalar(
        select(ShedMembership).where(
            ShedMembership.shed_id == shed.id,
            ShedMembership.owner_membership_id == owner_membership_id,
        )
    )
    if existing:
        existing.is_active = True
        existing.is_manager = is_manager
        return existing
    row = ShedMembership(
        owner_account_id=ctx.owner_account_id,
        shed_id=shed.id,
        owner_membership_id=owner_membership_id,
        is_manager=is_manager,
        is_active=True,
    )
    db.add(row)
    return row


async def _active_assignment_count(db: AsyncSession, shed_id: UUID) -> int:
    rows = await db.scalars(
        select(ShedMembership.id).where(
            ShedMembership.shed_id == shed_id,
            ShedMembership.is_active.is_(True),
        )
    )
    return len(list(rows))


async def assert_shed_accepts_new_records(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> Shed:
    """Block new batches/birds/schedules on inactive sheds. History remains readable."""
    shed = await db.scalar(
        select(Shed).where(Shed.id == shed_id, Shed.owner_account_id == ctx.owner_account_id)
    )
    if shed is None:
        raise ShedError("Shed not found", "NOT_FOUND")
    if not shed.is_active:
        raise ShedError(
            "This shed is inactive. Reactivate it before adding batches, birds, or schedules.",
            "SHED_INACTIVE",
        )
    return shed


async def _demote_other_managers(
    db: AsyncSession, shed_id: UUID, *, keep_membership_id: UUID
) -> None:
    rows = await db.scalars(
        select(ShedMembership).where(
            ShedMembership.shed_id == shed_id,
            ShedMembership.is_active.is_(True),
            ShedMembership.is_manager.is_(True),
            ShedMembership.owner_membership_id != keep_membership_id,
        )
    )
    for row in rows:
        row.is_manager = False


async def _revoke_all_assignments(db: AsyncSession, shed_id: UUID) -> int:
    """Deactivate every active shed membership (owner-managed transition)."""
    rows = list(
        await db.scalars(
            select(ShedMembership).where(
                ShedMembership.shed_id == shed_id,
                ShedMembership.is_active.is_(True),
            )
        )
    )
    for row in rows:
        row.is_active = False
        row.is_manager = False
    return len(rows)


def _task_bucket(status: str) -> str | None:
    if status == STATUS_OVERDUE:
        return "overdue"
    if status == STATUS_DUE_TODAY:
        return "due_today"
    if status in {STATUS_UPCOMING, STATUS_DUE_SOON}:
        return "upcoming"
    if status == STATUS_NEEDS_REVIEW:
        return "needs_review"
    return None


async def create_shed(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    name: str,
    code: str,
    location_notes: str | None,
    is_owner_managed: bool,
    initial_farmer_membership_id: UUID | None = None,
) -> Shed:
    """Create a shed; farmer-managed creates require an initial assignment in the same commit."""
    assert ctx.owner_account_id is not None
    if is_owner_managed and initial_farmer_membership_id is not None:
        raise ShedError(
            "Do not assign a farmer when creating an owner-managed shed",
            "FARMER_NOT_ALLOWED",
        )
    if not is_owner_managed and initial_farmer_membership_id is None:
        raise ShedError(
            "A farmer assignment is required for farmer-managed sheds",
            "FARMER_REQUIRED",
        )

    shed = Shed(
        owner_account_id=ctx.owner_account_id,
        name=name.strip(),
        code=code.strip().upper(),
        location_notes=location_notes,
        is_owner_managed=is_owner_managed,
        is_active=True,
    )
    db.add(shed)
    try:
        # Unique (owner, code) can fail on flush before commit — catch both.
        await db.flush()  # obtain shed.id before assignment

        after: dict = {"name": name, "code": code, "is_owner_managed": is_owner_managed}
        if initial_farmer_membership_id is not None:
            await _upsert_assignment(
                db,
                ctx,
                shed,
                owner_membership_id=initial_farmer_membership_id,
                is_manager=True,
            )
            after["initial_farmer_membership_id"] = str(initial_farmer_membership_id)

        db.add(
            AuditLog(
                owner_account_id=ctx.owner_account_id,
                actor_user_id=ctx.user.id,
                action="shed.create",
                entity_type="shed",
                entity_id=shed.id,
                after=after,
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ShedError("Shed code already exists for this organization", "DUPLICATE_CODE") from exc
    await db.refresh(shed)
    return shed


async def list_sheds(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    include_inactive: bool = False,
) -> list[ShedListItemOut]:
    """Authorized sheds with one-shot population/vax aggregates (no N+1 overview calls)."""
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(Shed).where(Shed.owner_account_id == ctx.owner_account_id)

    if ctx.membership.role == MembershipRole.farmer:
        # Farmers: assigned sheds only (active membership). Inactive sheds remain visible
        # for historical access when still assigned — never via include_inactive alone.
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return []
        stmt = stmt.where(Shed.id.in_(assigned))
    else:
        # Owners / org roles: default active-only; include_inactive requires shed.view (route).
        if not include_inactive:
            stmt = stmt.where(Shed.is_active.is_(True))
        elif ctx.membership.role not in {
            MembershipRole.owner,
            MembershipRole.org_admin,
            MembershipRole.read_only,
        }:
            raise ShedError("Not allowed to list inactive sheds", "FORBIDDEN")

    sheds = list(await db.scalars(stmt.order_by(Shed.name).limit(200)))
    if not sheds:
        return []

    shed_ids = [s.id for s in sheds]
    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    org_name = owner.name if owner else None

    # Population: same rule as overview — active batches only, sum current_count / banded / unbanded.
    pop_rows = await db.execute(
        select(
            Flock.shed_id,
            func.count(Flock.id),
            func.coalesce(func.sum(Flock.current_count), 0),
            func.coalesce(func.sum(Flock.banded_count), 0),
            func.coalesce(func.sum(Flock.unbanded_count), 0),
            func.bool_or(Flock.count_mismatch),
        )
        .where(
            Flock.owner_account_id == ctx.owner_account_id,
            Flock.shed_id.in_(shed_ids),
            Flock.status == FlockStatus.active,
        )
        .group_by(Flock.shed_id)
    )
    pop_by_shed: dict[UUID, tuple[int, int, int, int, bool]] = {
        row[0]: (int(row[1]), int(row[2]), int(row[3]), int(row[4]), bool(row[5]))
        for row in pop_rows
    }

    # One org-scoped status refresh (same SQL as overview / POST refresh-statuses) so
    # list dose-task buckets match overview without N+1 per-shed refreshes.
    from app.services import vaccine_service

    await vaccine_service.refresh_dose_statuses(db, ctx, commit=False)

    # Dose-task counts (not birds) — same _task_bucket rules as overview.
    dose_rows = await db.execute(
        select(ScheduledDose.shed_id, ScheduledDose.status, func.count(ScheduledDose.id))
        .where(
            ScheduledDose.owner_account_id == ctx.owner_account_id,
            ScheduledDose.shed_id.in_(shed_ids),
            ScheduledDose.is_active.is_(True),
        )
        .group_by(ScheduledDose.shed_id, ScheduledDose.status)
    )
    vax_by_shed: dict[UUID, dict[str, int]] = defaultdict(
        lambda: {"overdue": 0, "due_today": 0, "upcoming": 0, "needs_review": 0}
    )
    for shed_id, status, cnt in dose_rows:
        bucket = _task_bucket(status)
        if bucket:
            vax_by_shed[shed_id][bucket] += int(cnt)

    # Active manager names
    mgr_rows = await db.execute(
        select(ShedMembership.shed_id, User.full_name)
        .join(OwnerMembership, OwnerMembership.id == ShedMembership.owner_membership_id)
        .join(User, User.id == OwnerMembership.user_id)
        .where(
            ShedMembership.shed_id.in_(shed_ids),
            ShedMembership.is_active.is_(True),
            ShedMembership.is_manager.is_(True),
        )
        .order_by(User.full_name)
    )
    managers: dict[UUID, list[str]] = defaultdict(list)
    for shed_id, full_name in mgr_rows:
        if full_name:
            managers[shed_id].append(full_name)

    items: list[ShedListItemOut] = []
    for shed in sheds:
        active_n, live, banded, unbanded, mismatch = pop_by_shed.get(
            shed.id, (0, 0, 0, 0, False)
        )
        vax = vax_by_shed[shed.id]
        base = ShedOut.model_validate(shed)
        items.append(
            ShedListItemOut(
                **base.model_dump(),
                organization_name=org_name,
                manager_names=managers.get(shed.id, []),
                active_batch_count=active_n,
                total_live_birds=live,
                banded_birds=banded,
                unbanded_birds=unbanded,
                count_mismatch=mismatch,
                overdue_tasks=vax["overdue"],
                due_today_tasks=vax["due_today"],
                upcoming_tasks=vax["upcoming"],
                needs_review_tasks=vax["needs_review"],
            )
        )
    return items


async def search_sheds(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    query: str,
    limit: int = 10,
    include_inactive: bool = True,
) -> ShedSearchOut:
    """Org-scoped shed name/code search. Farmers limited to assigned sheds."""
    assert ctx.owner_account_id is not None and ctx.membership is not None
    q = (query or "").strip()
    if not q:
        raise ShedError("Search query is required", "INVALID")
    if len(q) > 64:
        raise ShedError("Search query is too long", "INVALID")
    limit = max(1, min(limit, 25))
    pattern = f"%{q}%"

    filters = [
        Shed.owner_account_id == ctx.owner_account_id,
        or_(Shed.name.ilike(pattern), Shed.code.ilike(pattern)),
    ]
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return ShedSearchOut(query=q, total=0, limit=limit, exact_count=0, items=[])
        filters.append(Shed.id.in_(assigned))
    elif not include_inactive:
        filters.append(Shed.is_active.is_(True))

    total = int(await db.scalar(select(func.count()).select_from(Shed).where(*filters)) or 0)
    sheds = list(await db.scalars(select(Shed).where(*filters).order_by(Shed.name).limit(limit)))
    sheds.sort(
        key=lambda s: (
            0
            if s.name.lower() == q.lower() or s.code.lower() == q.lower()
            else 1,
            0 if s.is_active else 1,
            s.name.lower(),
        )
    )

    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    org_name = owner.name if owner else None
    shed_ids = [s.id for s in sheds]
    pop_by_shed: dict[UUID, int] = {}
    managers: dict[UUID, list[str]] = defaultdict(list)
    if shed_ids:
        pop_rows = await db.execute(
            select(Flock.shed_id, func.coalesce(func.sum(Flock.current_count), 0))
            .where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.shed_id.in_(shed_ids),
                Flock.status == FlockStatus.active,
            )
            .group_by(Flock.shed_id)
        )
        pop_by_shed = {row[0]: int(row[1]) for row in pop_rows}
        mgr_rows = await db.execute(
            select(ShedMembership.shed_id, User.full_name)
            .join(OwnerMembership, OwnerMembership.id == ShedMembership.owner_membership_id)
            .join(User, User.id == OwnerMembership.user_id)
            .where(
                ShedMembership.shed_id.in_(shed_ids),
                ShedMembership.is_active.is_(True),
                ShedMembership.is_manager.is_(True),
            )
            .order_by(User.full_name)
        )
        for shed_id, full_name in mgr_rows:
            if full_name:
                managers[shed_id].append(full_name)

    exact_count = 0
    items: list[ShedSearchHitOut] = []
    for shed in sheds:
        exact = shed.name.lower() == q.lower() or shed.code.lower() == q.lower()
        if exact:
            exact_count += 1
        items.append(
            ShedSearchHitOut(
                id=shed.id,
                name=shed.name,
                code=shed.code,
                organization_name=org_name,
                manager_names=managers.get(shed.id, []),
                is_active=shed.is_active,
                total_live_birds=pop_by_shed.get(shed.id, 0),
                match_kind="exact" if exact else "partial",
            )
        )
    return ShedSearchOut(
        query=q, total=total, limit=limit, exact_count=exact_count, items=items
    )


async def get_shed(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> Shed:
    await assert_shed_access(db, ctx, shed_id, permission_code="shed.view")
    shed = await db.scalar(
        select(Shed).where(Shed.id == shed_id, Shed.owner_account_id == ctx.owner_account_id)
    )
    if shed is None:
        raise ShedError("Shed not found", "NOT_FOUND")
    return shed


async def update_shed(
    db: AsyncSession,
    ctx: AuthContext,
    shed_id: UUID,
    *,
    name: str | None,
    code: str | None = None,
    location_notes: str | None,
    is_owner_managed: bool | None,
    is_active: bool | None,
    initial_farmer_membership_id: UUID | None = None,
) -> Shed:
    """Update shed fields and management mode atomically (single commit)."""
    shed = await get_shed(db, ctx, shed_id)
    before = {
        "name": shed.name,
        "code": shed.code,
        "is_active": shed.is_active,
        "is_owner_managed": shed.is_owner_managed,
    }
    if name is not None:
        shed.name = name.strip()
    if code is not None:
        shed.code = code.strip().upper()
    if location_notes is not None:
        shed.location_notes = location_notes
    # Prefer dedicated deactivate/reactivate endpoints for lifecycle; still allow PATCH.
    if is_active is not None:
        shed.is_active = is_active

    switching_to_owner = is_owner_managed is True
    switching_to_farmer = is_owner_managed is False
    target_owner_managed = (
        is_owner_managed if is_owner_managed is not None else shed.is_owner_managed
    )

    revoked = 0
    if switching_to_owner:
        if initial_farmer_membership_id is not None:
            raise ShedError(
                "Do not assign a farmer when switching to owner-managed",
                "FARMER_NOT_ALLOWED",
            )
        revoked = await _revoke_all_assignments(db, shed.id)
        shed.is_owner_managed = True
        target_owner_managed = True
    else:
        if initial_farmer_membership_id is not None:
            await _upsert_assignment(
                db,
                ctx,
                shed,
                owner_membership_id=initial_farmer_membership_id,
                is_manager=True,
            )
            await _demote_other_managers(
                db, shed.id, keep_membership_id=initial_farmer_membership_id
            )
            if is_owner_managed is None:
                target_owner_managed = False

        if not target_owner_managed:
            assigned = await _active_assignment_count(db, shed.id)
            if assigned < 1:
                raise ShedError(
                    "Assign a farmer before saving a farmer-managed shed",
                    "FARMER_REQUIRED",
                )

        if switching_to_farmer or (
            initial_farmer_membership_id is not None and is_owner_managed is None
        ):
            shed.is_owner_managed = False
        elif is_owner_managed is not None:
            shed.is_owner_managed = target_owner_managed

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="shed.update",
            entity_type="shed",
            entity_id=shed.id,
            before=before,
            after={
                "name": shed.name,
                "code": shed.code,
                "is_active": shed.is_active,
                "is_owner_managed": shed.is_owner_managed,
                "initial_farmer_membership_id": (
                    str(initial_farmer_membership_id) if initial_farmer_membership_id else None
                ),
                "assignments_revoked": revoked,
            },
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ShedError("Shed code already exists for this organization", "DUPLICATE_CODE") from exc
    await db.refresh(shed)
    return shed


async def assign_farmer(
    db: AsyncSession,
    ctx: AuthContext,
    shed_id: UUID,
    *,
    owner_membership_id: UUID,
    is_manager: bool,
) -> ShedMembership:
    shed = await get_shed(db, ctx, shed_id)
    row = await _upsert_assignment(
        db,
        ctx,
        shed,
        owner_membership_id=owner_membership_id,
        is_manager=is_manager,
    )

    if is_manager:
        await _demote_other_managers(db, shed.id, keep_membership_id=owner_membership_id)
        if shed.is_owner_managed:
            shed.is_owner_managed = False

    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="shed.assign",
            entity_type="shed_membership",
            entity_id=shed.id,
            after={"owner_membership_id": str(owner_membership_id), "is_manager": is_manager},
        )
    )
    await db.commit()
    await db.refresh(row)
    return row


async def list_assignments(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> list[dict]:
    await get_shed(db, ctx, shed_id)
    rows = await db.scalars(
        select(ShedMembership)
        .where(ShedMembership.shed_id == shed_id, ShedMembership.is_active.is_(True))
        .options(selectinload(ShedMembership.shed))
    )
    out: list[dict] = []
    for row in rows:
        membership = await db.scalar(
            select(OwnerMembership)
            .where(OwnerMembership.id == row.owner_membership_id)
            .options(selectinload(OwnerMembership.user))
        )
        user: User | None = membership.user if membership else None
        out.append(
            {
                "id": row.id,
                "shed_id": row.shed_id,
                "owner_membership_id": row.owner_membership_id,
                "is_manager": row.is_manager,
                "is_active": row.is_active,
                "farmer_name": user.full_name if user else None,
                "farmer_email": user.email if user else None,
            }
        )
    return out


async def unassign_farmer(
    db: AsyncSession, ctx: AuthContext, shed_id: UUID, assignment_id: UUID
) -> None:
    await get_shed(db, ctx, shed_id)
    row = await db.scalar(
        select(ShedMembership).where(
            ShedMembership.id == assignment_id,
            ShedMembership.shed_id == shed_id,
            ShedMembership.owner_account_id == ctx.owner_account_id,
        )
    )
    if row is None:
        raise ShedError("Assignment not found", "NOT_FOUND")
    row.is_active = False
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="shed.unassign",
            entity_type="shed_membership",
            entity_id=row.id,
            after={"is_active": False},
        )
    )
    await db.commit()


async def get_shed_dependencies(
    db: AsyncSession, ctx: AuthContext, shed_id: UUID
) -> ShedDependenciesOut:
    shed = await get_shed(db, ctx, shed_id)
    active_batches = list(
        await db.scalars(
            select(Flock).where(
                Flock.shed_id == shed_id,
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.status == FlockStatus.active,
            )
        )
    )
    closed_n = await db.scalar(
        select(func.count(Flock.id)).where(
            Flock.shed_id == shed_id,
            Flock.owner_account_id == ctx.owner_account_id,
            Flock.status == FlockStatus.closed,
        )
    )
    pop = _population_from_batches(active_batches)
    open_tasks = await db.scalar(
        select(func.count(ScheduledDose.id)).where(
            ScheduledDose.shed_id == shed_id,
            ScheduledDose.owner_account_id == ctx.owner_account_id,
            ScheduledDose.is_active.is_(True),
            ScheduledDose.status.in_(
                [
                    STATUS_OVERDUE,
                    STATUS_DUE_TODAY,
                    STATUS_UPCOMING,
                    STATUS_DUE_SOON,
                    STATUS_NEEDS_REVIEW,
                ]
            ),
        )
    )
    vax_events = await db.scalar(
        select(func.count(VaccinationEvent.id)).where(
            VaccinationEvent.shed_id == shed_id,
            VaccinationEvent.owner_account_id == ctx.owner_account_id,
        )
    )
    return ShedDependenciesOut(
        shed_id=shed.id,
        is_active=shed.is_active,
        active_batch_count=pop.active_batch_count,
        closed_batch_count=int(closed_n or 0),
        total_live_birds=pop.total_live_birds,
        banded_birds=pop.banded_birds,
        unbanded_birds=pop.unbanded_birds,
        count_mismatch=any(b.count_mismatch for b in active_batches),
        open_dose_tasks=int(open_tasks or 0),
        vaccination_event_count=int(vax_events or 0),
        active_assignment_count=await _active_assignment_count(db, shed.id),
        can_deactivate=shed.is_active,
        can_reactivate=not shed.is_active,
    )


async def deactivate_shed(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> Shed:
    """Soft-deactivate: preserves flocks, birds, doses, and vaccination history."""
    shed = await get_shed(db, ctx, shed_id)
    if not shed.is_active:
        return shed
    before = {"is_active": True}
    shed.is_active = False
    # Keep farmer assignments so authorized farmers retain historical view access.
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="shed.deactivate",
            entity_type="shed",
            entity_id=shed.id,
            before=before,
            after={"is_active": False},
        )
    )
    await db.commit()
    await db.refresh(shed)
    return shed


async def reactivate_shed(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> Shed:
    """Restore an inactive shed. Does not recreate memberships or schedules."""
    shed = await get_shed(db, ctx, shed_id)
    if shed.is_active:
        return shed
    if not shed.is_owner_managed:
        assigned = await _active_assignment_count(db, shed.id)
        if assigned < 1:
            raise ShedError(
                "Assign a farmer before reactivating a farmer-managed shed",
                "FARMER_REQUIRED",
            )
    before = {"is_active": False}
    shed.is_active = True
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="shed.reactivate",
            entity_type="shed",
            entity_id=shed.id,
            before=before,
            after={"is_active": True},
        )
    )
    await db.commit()
    await db.refresh(shed)
    return shed


def _population_from_batches(batches: list[Flock]) -> ShedOverviewPopulationOut:
    """Live population = sum(current_count). Banded/unbanded use flock fields (no Bird-row double-count).

    Equality ``banded + unbanded == total`` holds for reconciled batch/individual/mixed
    flocks. For ``mixed`` with ``count_mismatch=True``, the sum of banded/unbanded may
    diverge from ``current_count`` until counts are corrected — that is intentional.
    """
    total = sum(int(b.current_count) for b in batches)
    banded = sum(int(b.banded_count) for b in batches)
    unbanded = sum(int(b.unbanded_count) for b in batches)
    return ShedOverviewPopulationOut(
        total_live_birds=total,
        active_batch_count=len(batches),
        banded_birds=banded,
        unbanded_birds=unbanded,
    )


async def get_shed_overview(db: AsyncSession, ctx: AuthContext, shed_id: UUID) -> ShedOverviewOut:
    """Authorized shed hub: population, batch cards, and shed-scoped dose-task counts."""
    from app.services import vaccine_service

    shed = await get_shed(db, ctx, shed_id)
    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    assignments_raw = await list_assignments(db, ctx, shed_id)
    batches = list(
        await db.scalars(
            select(Flock)
            .where(
                Flock.owner_account_id == ctx.owner_account_id,
                Flock.shed_id == shed_id,
                Flock.status == FlockStatus.active,
            )
            .order_by(Flock.created_at.desc())
        )
    )
    # Shed-scoped status refresh (farm-local today) so overview matches scheduled-dose reads
    # without an org-wide write. Does not touch completed/skipped/inactive rows.
    await vaccine_service.refresh_dose_statuses(db, ctx, shed_id=shed_id, commit=False)
    doses = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.owner_account_id == ctx.owner_account_id,
                ScheduledDose.shed_id == shed_id,
                ScheduledDose.is_active.is_(True),
            )
        )
    )

    vax = ShedOverviewVaccinationOut(overdue=0, due_today=0, upcoming=0, needs_review=0)
    per_batch: dict[UUID, dict[str, int]] = defaultdict(
        lambda: {"overdue": 0, "due_today": 0, "upcoming": 0, "needs_review": 0}
    )
    for dose in doses:
        bucket = _task_bucket(dose.status)
        if not bucket:
            continue
        setattr(vax, bucket, getattr(vax, bucket) + 1)
        per_batch[dose.flock_id][bucket] += 1

    batch_outs = [
        ShedOverviewBatchOut(
            id=b.id,
            batch_code=b.batch_code,
            breed=b.breed,
            hatch_date=b.hatch_date,
            estimated_age_days=b.estimated_age_days,
            dob_confidence=b.dob_confidence,
            current_count=b.current_count,
            banded_count=b.banded_count,
            unbanded_count=b.unbanded_count,
            tracking_mode=b.tracking_mode,
            status=b.status,
            count_mismatch=b.count_mismatch,
            overdue_tasks=per_batch[b.id]["overdue"],
            due_today_tasks=per_batch[b.id]["due_today"],
            upcoming_tasks=per_batch[b.id]["upcoming"],
            needs_review_tasks=per_batch[b.id]["needs_review"],
        )
        for b in batches
    ]

    return ShedOverviewOut(
        shed=ShedOut.model_validate(shed),
        organization_name=owner.name if owner else None,
        assignments=[ShedAssignmentOut.model_validate(a) for a in assignments_raw],
        population=_population_from_batches(batches),
        vaccination=vax,
        batches=batch_outs,
    )
