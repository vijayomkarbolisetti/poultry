from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext, get_auth_context
from app.core.database import get_db
from app.models.enums import MembershipRole
from app.models.permission import MembershipPermission
from app.models.shed import ShedMembership


async def membership_has_permission(
    db: AsyncSession,
    *,
    membership_id: UUID,
    permission_code: str,
    shed_id: UUID | None = None,
) -> bool:
    stmt = select(MembershipPermission.id).where(
        MembershipPermission.owner_membership_id == membership_id,
        MembershipPermission.permission_code == permission_code,
    )
    if shed_id is None:
        stmt = stmt.where(MembershipPermission.shed_id.is_(None))
    else:
        stmt = stmt.where(
            or_(
                MembershipPermission.shed_id.is_(None),
                MembershipPermission.shed_id == shed_id,
            )
        )
    return (await db.scalar(stmt.limit(1))) is not None


async def require_org_context(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    if ctx.owner_account_id is None or ctx.membership is None:
        raise HTTPException(status_code=400, detail="X-Owner-Account-Id header required")
    return ctx


def require_permission(permission_code: str):
    async def _dep(
        ctx: AuthContext = Depends(require_org_context),
        db: AsyncSession = Depends(get_db),
    ) -> AuthContext:
        if ctx.membership is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        if ctx.membership.role == MembershipRole.owner:
            return ctx
        ok = await membership_has_permission(
            db, membership_id=ctx.membership.id, permission_code=permission_code
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {permission_code}",
            )
        return ctx

    return _dep


async def list_assigned_shed_ids(db: AsyncSession, membership_id: UUID) -> list[UUID]:
    rows = await db.scalars(
        select(ShedMembership.shed_id).where(
            ShedMembership.owner_membership_id == membership_id,
            ShedMembership.is_active.is_(True),
        )
    )
    return list(rows)


async def assert_shed_access(
    db: AsyncSession,
    ctx: AuthContext,
    shed_id: UUID,
    *,
    permission_code: str = "shed.view",
) -> None:
    if ctx.membership is None or ctx.owner_account_id is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if ctx.membership.role == MembershipRole.owner:
        return
    if ctx.membership.role in {MembershipRole.org_admin, MembershipRole.read_only}:
        ok = await membership_has_permission(
            db, membership_id=ctx.membership.id, permission_code=permission_code, shed_id=shed_id
        )
        if not ok:
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission_code}")
        return
    # farmer: must be assigned + have permission
    assigned = await db.scalar(
        select(ShedMembership.id).where(
            ShedMembership.shed_id == shed_id,
            ShedMembership.owner_membership_id == ctx.membership.id,
            ShedMembership.is_active.is_(True),
        )
    )
    if assigned is None:
        raise HTTPException(status_code=403, detail="Shed not assigned to this farmer")
    ok = await membership_has_permission(
        db, membership_id=ctx.membership.id, permission_code=permission_code, shed_id=shed_id
    )
    if not ok:
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission_code}")
