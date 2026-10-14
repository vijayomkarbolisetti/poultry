from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    MembershipOut,
    RefreshRequest,
    RegisterOwnerRequest,
    TokenResponse,
    UserOut,
)
from app.services import auth_service

router = APIRouter()


@router.post("/register-owner", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_owner(body: RegisterOwnerRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        _user, _owner, _membership, access, refresh = await auth_service.register_owner(
            db,
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            organization_name=body.organization_name,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        _user, access, refresh = await auth_service.login(db, email=body.email, password=body.password)
    except auth_service.AuthError as exc:
        code = status.HTTP_401_UNAUTHORIZED if exc.code == "INVALID_CREDENTIALS" else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        _user, access, refresh_tok = await auth_service.refresh_session(db, refresh_token=body.refresh_token)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message) from exc
    return TokenResponse(access_token=access, refresh_token=refresh_tok)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> None:
    await auth_service.logout(db, refresh_token=body.refresh_token)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserOut:
    loaded = await auth_service.get_user_with_memberships(db, user.id)
    assert loaded is not None
    memberships = [
        MembershipOut(
            id=m.id,
            owner_account_id=m.owner_account_id,
            role=m.role,
            is_active=m.is_active,
            organization_name=m.owner_account.name if m.owner_account else None,
        )
        for m in loaded.memberships
        if m.is_active
    ]
    return UserOut(
        id=loaded.id,
        email=loaded.email,
        full_name=loaded.full_name,
        is_active=loaded.is_active,
        is_platform_super_admin=loaded.is_platform_super_admin,
        created_at=loaded.created_at,
        memberships=memberships,
    )
