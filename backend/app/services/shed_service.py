from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.authorization.deps import AuthContext
from app.authorization.permissions import assert_shed_access, list_assigned_shed_ids
from app.models.audit import AuditLog
from app.models.enums import MembershipRole
from app.models.membership import OwnerMembership
from app.models.shed import Shed, ShedMembership
from app.models.user import User


class ShedError(Exception):
    def __init__(self, message: str, code: str = "SHED_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def create_shed(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    name: str,
    code: str,
    location_notes: str | None,
    is_owner_managed: bool,
) -> Shed:
    assert ctx.owner_account_id is not None
    shed = Shed(
        owner_account_id=ctx.owner_account_id,
        name=name.strip(),
        code=code.strip().upper(),
        location_notes=location_notes,
        is_owner_managed=is_owner_managed,
        is_active=True,
    )
    db.add(shed)
    db.add(
        AuditLog(
            owner_account_id=ctx.owner_account_id,
            actor_user_id=ctx.user.id,
            action="shed.create",
            entity_type="shed",
            entity_id=None,
            after={"name": name, "code": code},
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ShedError("Shed code already exists for this organization", "DUPLICATE_CODE") from exc
    await db.refresh(shed)
    return shed


async def list_sheds(db: AsyncSession, ctx: AuthContext) -> list[Shed]:
    assert ctx.owner_account_id is not None and ctx.membership is not None
    stmt = select(Shed).where(
        Shed.owner_account_id == ctx.owner_account_id,
        Shed.is_active.is_(True),
    )
    if ctx.membership.role == MembershipRole.farmer:
        assigned = await list_assigned_shed_ids(db, ctx.membership.id)
        if not assigned:
            return []
        stmt = stmt.where(Shed.id.in_(assigned))
    elif ctx.membership.role != MembershipRole.owner:
        # org_admin / read_only: org-wide view if they have shed.view (checked by route)
        pass
    result = await db.scalars(stmt.order_by(Shed.name))
    return list(result)


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
    location_notes: str | None,
    is_owner_managed: bool | None,
    is_active: bool | None,
) -> Shed:
    shed = await get_shed(db, ctx, shed_id)
    before = {"name": shed.name, "is_active": shed.is_active, "is_owner_managed": shed.is_owner_managed}
    if name is not None:
        shed.name = name.strip()
    if location_notes is not None:
        shed.location_notes = location_notes
    if is_owner_managed is not None:
        shed.is_owner_managed = is_owner_managed
    if is_active is not None:
        shed.is_active = is_active
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
                "is_active": shed.is_active,
                "is_owner_managed": shed.is_owner_managed,
            },
        )
    )
    await db.commit()
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
    membership = await db.scalar(
        select(OwnerMembership).where(
            OwnerMembership.id == owner_membership_id,
            OwnerMembership.owner_account_id == ctx.owner_account_id,
            OwnerMembership.is_active.is_(True),
        )
    )
    if membership is None:
        raise ShedError("Membership not found in this organization", "MEMBERSHIP_NOT_FOUND")

    existing = await db.scalar(
        select(ShedMembership).where(
            ShedMembership.shed_id == shed.id,
            ShedMembership.owner_membership_id == owner_membership_id,
        )
    )
    if existing:
        existing.is_active = True
        existing.is_manager = is_manager
        row = existing
    else:
        row = ShedMembership(
            owner_account_id=ctx.owner_account_id,
            shed_id=shed.id,
            owner_membership_id=owner_membership_id,
            is_manager=is_manager,
            is_active=True,
        )
        db.add(row)

    if not shed.is_owner_managed:
        pass
    else:
        # Assigning a farmer manager marks shed as farmer-managed operationally when requested
        if is_manager:
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
