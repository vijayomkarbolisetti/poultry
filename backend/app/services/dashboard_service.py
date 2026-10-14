from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import list_assigned_shed_ids
from app.models.enums import BirdLifecycleStatus, FlockStatus, MembershipRole
from app.models.flock import Bird, Flock
from app.models.membership import OwnerMembership
from app.models.shed import Shed
from app.models.vaccine import ScheduledDose
from app.services.schedule_engine import (
    STATUS_DUE_TODAY,
    STATUS_OVERDUE,
    STATUS_UPCOMING,
    compliance_counts,
)


async def summary(db: AsyncSession, ctx: AuthContext) -> dict:
    assert ctx.owner_account_id is not None and ctx.membership is not None

    shed_filter = [Shed.owner_account_id == ctx.owner_account_id, Shed.is_active.is_(True)]
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
        shed_filter.append(Shed.id.in_(assigned))

    active_sheds = await db.scalar(select(func.count()).select_from(Shed).where(*shed_filter)) or 0
    owner_managed = (
        await db.scalar(
            select(func.count()).select_from(Shed).where(*shed_filter, Shed.is_owner_managed.is_(True))
        )
        or 0
    )
    farmer_managed = (
        await db.scalar(
            select(func.count()).select_from(Shed).where(*shed_filter, Shed.is_owner_managed.is_(False))
        )
        or 0
    )

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

    flock_stmt = select(func.count()).select_from(Flock).where(
        Flock.owner_account_id == ctx.owner_account_id,
        Flock.status == FlockStatus.active,
    )
    bird_stmt = select(func.count()).select_from(Bird).where(
        Bird.owner_account_id == ctx.owner_account_id,
        Bird.is_active.is_(True),
        Bird.lifecycle_status == BirdLifecycleStatus.active,
    )
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        flock_stmt = flock_stmt.where(Flock.shed_id.in_(assigned))
        bird_stmt = bird_stmt.where(Bird.shed_id.in_(assigned))

    active_flocks = await db.scalar(flock_stmt) or 0
    active_birds = await db.scalar(bird_stmt) or 0

    dose_stmt = select(ScheduledDose).where(
        ScheduledDose.owner_account_id == ctx.owner_account_id,
        ScheduledDose.is_active.is_(True),
    )
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        dose_stmt = dose_stmt.where(ScheduledDose.shed_id.in_(assigned))
    doses = list(await db.scalars(dose_stmt))
    statuses = [d.status for d in doses]
    num, den = compliance_counts(statuses)

    return {
        "active_sheds": int(active_sheds),
        "active_farmers": int(active_farmers),
        "owner_managed_sheds": int(owner_managed),
        "farmer_managed_sheds": int(farmer_managed),
        "active_flocks": int(active_flocks),
        "active_birds": int(active_birds),
        "upcoming_doses": sum(1 for s in statuses if s == STATUS_UPCOMING),
        "due_today": sum(1 for s in statuses if s == STATUS_DUE_TODAY),
        "overdue_doses": sum(1 for s in statuses if s == STATUS_OVERDUE),
        "compliance_numerator": num,
        "compliance_denominator": den,
    }
