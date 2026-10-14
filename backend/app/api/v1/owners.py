from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext, get_auth_context, require_owner_or_admin
from app.core.database import get_db, set_rls_context
from app.models.owner import OwnerAccount
from app.schemas.auth import OwnerAccountOut

router = APIRouter()


@router.get("/me", response_model=OwnerAccountOut)
async def get_my_owner(
    ctx: AuthContext = Depends(require_owner_or_admin),
    db: AsyncSession = Depends(get_db),
) -> OwnerAccountOut:
    if ctx.owner_account_id is None:
        raise HTTPException(status_code=400, detail="X-Owner-Account-Id header required")
    owner = await db.get(OwnerAccount, ctx.owner_account_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Owner account not found")
    return OwnerAccountOut.model_validate(owner)


@router.get("/{owner_id}", response_model=OwnerAccountOut)
async def get_owner_by_id(
    owner_id: UUID,
    ctx: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> OwnerAccountOut:
    """Fetch an owner account. Cross-tenant access must fail via membership + RLS."""
    if not ctx.user.is_platform_super_admin:
        if ctx.membership is None or ctx.membership.owner_account_id != owner_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    await set_rls_context(
        db,
        user_id=ctx.user.id,
        owner_account_id=owner_id if ctx.user.is_platform_super_admin else ctx.owner_account_id,
        role=ctx.membership.role.value if ctx.membership else None,
    )
    result = await db.scalar(select(OwnerAccount).where(OwnerAccount.id == owner_id))
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Owner account not found")
    return OwnerAccountOut.model_validate(result)
