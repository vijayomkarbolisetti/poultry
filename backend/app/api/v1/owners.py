from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import (
    AuthContext,
    get_auth_context,
    require_owner_or_admin,
    require_platform_super_admin,
)
from app.core.database import get_db, set_rls_context
from app.models.owner import OwnerAccount
from app.schemas.auth import (
    CreateOwnerAccountRequest,
    CreatedOwnerAccountOut,
    OwnerAccountListItem,
    OwnerAccountOut,
    OwnerUserSummary,
    UpdateOwnerUserRequest,
)
from app.services import auth_service

router = APIRouter()


@router.get("", response_model=list[OwnerAccountListItem])
async def list_owners(
    ctx: AuthContext = Depends(require_platform_super_admin),
    db: AsyncSession = Depends(get_db),
) -> list[OwnerAccountListItem]:
    """List every farm. Platform super admin only."""
    rows = await auth_service.list_owner_accounts_for_super_admin(db)
    return [
        OwnerAccountListItem(
            id=owner.id,
            name=owner.name,
            is_active=owner.is_active,
            created_at=owner.created_at,
            owner_user_id=user.id if user else None,
            owner_email=user.email if user else None,
            owner_full_name=user.full_name if user else None,
            owner_must_change_password=bool(user.must_change_password) if user else False,
        )
        for owner, user in rows
    ]


@router.post("", response_model=CreatedOwnerAccountOut, status_code=status.HTTP_201_CREATED)
async def create_owner_account(
    body: CreateOwnerAccountRequest,
    ctx: AuthContext = Depends(require_platform_super_admin),
    db: AsyncSession = Depends(get_db),
) -> CreatedOwnerAccountOut:
    """Provision a farm and its owner login. Platform super admin only."""
    try:
        user, owner, _membership = await auth_service.create_owner_account_as_super_admin(
            db,
            actor_user_id=ctx.user.id,
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            organization_name=body.organization_name,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc

    return CreatedOwnerAccountOut(
        owner=OwnerAccountOut.model_validate(owner),
        owner_user=OwnerUserSummary(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            password=body.password,
        ),
    )


@router.patch("/{owner_id}/owner-user", response_model=OwnerUserSummary)
async def update_owner_user(
    owner_id: UUID,
    body: UpdateOwnerUserRequest,
    ctx: AuthContext = Depends(require_platform_super_admin),
    db: AsyncSession = Depends(get_db),
) -> OwnerUserSummary:
    """Update farm owner display name and/or reset password (super admin)."""
    try:
        user = await auth_service.update_farm_owner_as_super_admin(
            db,
            owner_account_id=owner_id,
            full_name=body.full_name,
            password=body.password,
        )
    except auth_service.AuthError as exc:
        code = status.HTTP_404_NOT_FOUND if exc.code == "NOT_FOUND" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return OwnerUserSummary(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        password=body.password,
    )


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
        role=ctx.membership.role.value if ctx.membership else (
            "platform_super_admin" if ctx.user.is_platform_super_admin else None
        ),
    )
    result = await db.scalar(select(OwnerAccount).where(OwnerAccount.id == owner_id))
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Owner account not found")
    return OwnerAccountOut.model_validate(result)
