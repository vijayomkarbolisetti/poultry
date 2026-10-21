from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import list_assigned_shed_ids
from app.models.enums import FlockStatus, MembershipRole
from app.models.flock import Flock
from app.models.membership import OwnerMembership
from app.models.shed import Shed


async def summary(db: AsyncSession, ctx: AuthContext) -> dict:
    """Farm snapshot. Vaccination dose metrics are zeroed while vaccines are unmounted."""
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
    farmer_filter = [
        OwnerMembership.owner_account_id == ctx.owner_account_id,
        OwnerMembership.is_active.is_(True),
        OwnerMembership.role == MembershipRole.farmer,
    ]
    if assigned is not None:
        flock_filter.append(Flock.shed_id.in_(assigned))

    def _count(model, *filters):
        return select(func.count()).select_from(model).where(*filters).scalar_subquery()

    live_birds = (
        select(func.coalesce(func.sum(Flock.current_count), 0))
        .where(*flock_filter)
        .scalar_subquery()
        .label("active_birds")
    )

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
                live_birds,
            )
        )
    ).one()

    return {
        "active_sheds": int(totals.active_sheds),
        "active_farmers": int(totals.active_farmers),
        "owner_managed_sheds": int(totals.owner_managed),
        "farmer_managed_sheds": int(totals.farmer_managed),
        "active_flocks": int(totals.active_flocks),
        "active_birds": int(totals.active_birds),
        # Vaccination phase paused — keep keys for mobile type compatibility.
        "upcoming_doses": 0,
        "due_today": 0,
        "overdue_doses": 0,
        "compliance_numerator": 0,
        "compliance_denominator": 0,
    }
