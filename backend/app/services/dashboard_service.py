from sqlalchemy import case, func, literal, select
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

    flock_filter = [
        Flock.owner_account_id == ctx.owner_account_id,
        Flock.status == FlockStatus.active,
    ]
    bird_filter = [
        Bird.owner_account_id == ctx.owner_account_id,
        Bird.is_active.is_(True),
        Bird.lifecycle_status == BirdLifecycleStatus.active,
    ]
    dose_filter = [
        ScheduledDose.owner_account_id == ctx.owner_account_id,
        ScheduledDose.is_active.is_(True),
    ]
    farmer_filter = [
        OwnerMembership.owner_account_id == ctx.owner_account_id,
        OwnerMembership.is_active.is_(True),
        OwnerMembership.role == MembershipRole.farmer,
    ]
    if assigned is not None:
        flock_filter.append(Flock.shed_id.in_(assigned))
        bird_filter.append(Bird.shed_id.in_(assigned))
        dose_filter.append(ScheduledDose.shed_id.in_(assigned))

    def _count(model, *filters):
        return select(func.count()).select_from(model).where(*filters).scalar_subquery()

    # One round trip for every home-screen number.
    totals = (
        await db.execute(
            select(
                _count(Shed, *shed_filter).label("active_sheds"),
                select(func.coalesce(func.sum(case((Shed.is_owner_managed.is_(True), 1), else_=0)), 0))
                .where(*shed_filter)
                .scalar_subquery()
                .label("owner_managed"),
                select(func.coalesce(func.sum(case((Shed.is_owner_managed.is_(False), 1), else_=0)), 0))
                .where(*shed_filter)
                .scalar_subquery()
                .label("farmer_managed"),
                (
                    _count(OwnerMembership, *farmer_filter)
                    if ctx.membership.role != MembershipRole.farmer
                    else select(literal(0)).scalar_subquery()
                ).label("active_farmers"),
                _count(Flock, *flock_filter).label("active_flocks"),
                _count(Bird, *bird_filter).label("active_birds"),
                _count(ScheduledDose, *dose_filter, ScheduledDose.status == STATUS_UPCOMING).label("upcoming"),
                _count(ScheduledDose, *dose_filter, ScheduledDose.status == STATUS_DUE_TODAY).label("due_today"),
                _count(ScheduledDose, *dose_filter, ScheduledDose.status == STATUS_OVERDUE).label("overdue"),
                _count(ScheduledDose, *dose_filter, ScheduledDose.status == STATUS_COMPLETED_ON_TIME).label("on_time"),
                _count(ScheduledDose, *dose_filter, ScheduledDose.status == STATUS_COMPLETED_LATE).label("late"),
            )
        )
    ).one()
    on_time = int(totals.on_time)
    late = int(totals.late)
    overdue = int(totals.overdue)
    due_today = int(totals.due_today)
    upcoming = int(totals.upcoming)
    num = on_time
    den = on_time + late + overdue

    return {
        "active_sheds": int(totals.active_sheds),
        "active_farmers": int(totals.active_farmers),
        "owner_managed_sheds": int(totals.owner_managed),
        "farmer_managed_sheds": int(totals.farmer_managed),
        "active_flocks": int(totals.active_flocks),
        "active_birds": int(totals.active_birds),
        "upcoming_doses": upcoming,
        "due_today": due_today,
        "overdue_doses": overdue,
        "compliance_numerator": num,
        "compliance_denominator": den,
    }
