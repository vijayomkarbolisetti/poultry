from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import list_assigned_shed_ids
from app.models.enums import BirdLifecycleStatus, FlockStatus, MembershipRole
from app.models.flock import Bird, Flock
from app.models.membership import OwnerMembership
from app.models.shed import Shed
from app.models.vaccine import ScheduledDose
from app.services.schedule_engine import (
    STATUS_COMPLETED_LATE,
    STATUS_COMPLETED_ON_TIME,
    STATUS_DUE_TODAY,
    STATUS_OVERDUE,
    STATUS_UPCOMING,
)


async def summary(db: AsyncSession, ctx: AuthContext) -> dict:
    assert ctx.owner_account_id is not None and ctx.membership is not None

    assigned: list | None = None
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return {
                "active_sheds": 0,
                "active_farmers": 0,
                "owner_managed_sheds": 0,
                "farmer_managed_sheds": 0,
                "active_flocks": 0,
                "active_birds": 0,
                "upcoming_doses": 0,
                "due_today": 0,
                "overdue_doses": 0,
                "compliance_numerator": 0,
                "compliance_denominator": 0,
            }

    shed_filter = [Shed.owner_account_id == ctx.owner_account_id, Shed.is_active.is_(True)]
    if assigned is not None:
        shed_filter.append(Shed.id.in_(assigned))

    # One round-trip for shed metrics instead of three COUNT queries.
    shed_row = (
        await db.execute(
            select(
                func.count().label("active_sheds"),
                func.coalesce(func.sum(case((Shed.is_owner_managed.is_(True), 1), else_=0)), 0).label(
                    "owner_managed"
                ),
                func.coalesce(func.sum(case((Shed.is_owner_managed.is_(False), 1), else_=0)), 0).label(
                    "farmer_managed"
                ),
            ).where(*shed_filter)
        )
    ).one()

    active_farmers = 0
    if ctx.membership.role != MembershipRole.farmer:
        active_farmers = (
            await db.scalar(
                select(func.count())
                .select_from(OwnerMembership)
                .where(
                    OwnerMembership.owner_account_id == ctx.owner_account_id,
                    OwnerMembership.is_active.is_(True),
                    OwnerMembership.role == MembershipRole.farmer,
                )
            )
            or 0
        )

    flock_filter = [
        Flock.owner_account_id == ctx.owner_account_id,
        Flock.status == FlockStatus.active,
    ]
    bird_filter = [
        Bird.owner_account_id == ctx.owner_account_id,
        Bird.is_active.is_(True),
        Bird.lifecycle_status == BirdLifecycleStatus.active,
    ]
    if assigned is not None:
        flock_filter.append(Flock.shed_id.in_(assigned))
        bird_filter.append(Bird.shed_id.in_(assigned))

    active_flocks = await db.scalar(select(func.count()).select_from(Flock).where(*flock_filter)) or 0
    active_birds = await db.scalar(select(func.count()).select_from(Bird).where(*bird_filter)) or 0

    dose_filter = [
        ScheduledDose.owner_account_id == ctx.owner_account_id,
        ScheduledDose.is_active.is_(True),
    ]
    if assigned is not None:
        dose_filter.append(ScheduledDose.shed_id.in_(assigned))

    # Aggregate in SQL — never pull every dose row into Python.
    dose_rows = (
        await db.execute(
            select(ScheduledDose.status, func.count().label("n"))
            .where(*dose_filter)
            .group_by(ScheduledDose.status)
        )
    ).all()
    by_status = {row.status: int(row.n) for row in dose_rows}
    on_time = by_status.get(STATUS_COMPLETED_ON_TIME, 0)
    late = by_status.get(STATUS_COMPLETED_LATE, 0)
    overdue = by_status.get(STATUS_OVERDUE, 0)
    due_today = by_status.get(STATUS_DUE_TODAY, 0)
    upcoming = by_status.get(STATUS_UPCOMING, 0)
    num = on_time
    den = on_time + late + overdue

    return {
        "active_sheds": int(shed_row.active_sheds),
        "active_farmers": int(active_farmers),
        "owner_managed_sheds": int(shed_row.owner_managed),
        "farmer_managed_sheds": int(shed_row.farmer_managed),
        "active_flocks": int(active_flocks),
        "active_birds": int(active_birds),
        "upcoming_doses": upcoming,
        "due_today": due_today,
        "overdue_doses": overdue,
        "compliance_numerator": num,
        "compliance_denominator": den,
    }
