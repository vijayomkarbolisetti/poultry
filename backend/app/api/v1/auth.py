from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MembershipOut,
    RefreshRequest,
    RegisterOwnerRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserOut,
)
from app.services import auth_service, farmer_service

router = APIRouter()


async def _serialize_user(db: AsyncSession, loaded: User) -> UserOut:
    active = [m for m in loaded.memberships if m.is_active]
    perms_map = await farmer_service.permissions_for_memberships(db, [m.id for m in active])
    memberships = [
        MembershipOut(
            id=m.id,
            owner_account_id=m.owner_account_id,
            role=m.role,
            is_active=m.is_active,
            organization_name=m.owner_account.name if m.owner_account else None,
            permission_codes=perms_map.get(m.id, []),
        )
        for m in active
    ]
    return UserOut(
        id=loaded.id,
        email=loaded.email,
        full_name=loaded.full_name,
        is_active=loaded.is_active,
        is_platform_super_admin=loaded.is_platform_super_admin,
        must_change_password=bool(getattr(loaded, "must_change_password", False)),
        created_at=loaded.created_at,
        memberships=memberships,
    )


@router.post("/register-owner", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_owner(body: RegisterOwnerRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    if not get_settings().allow_public_owner_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public farm registration is disabled. Ask a platform admin to create your account.",
        )
    try:
        user, _owner, _membership, access, refresh = await auth_service.register_owner(
            db,
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            organization_name=body.organization_name,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    loaded = await auth_service.get_user_with_memberships(db, user.id)
    assert loaded is not None
    return TokenResponse(access_token=access, refresh_token=refresh, user=await _serialize_user(db, loaded))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        user, access, refresh = await auth_service.login(db, email=body.email, password=body.password)
    except auth_service.AuthError as exc:
        code = status.HTTP_401_UNAUTHORIZED if exc.code == "INVALID_CREDENTIALS" else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return TokenResponse(access_token=access, refresh_token=refresh, user=await _serialize_user(db, user))


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
    return await _serialize_user(db, loaded)


@router.post("/change-password", response_model=UserOut)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    # Read the id before expire(): touching an expired attribute triggers a sync
    # lazy load, which raises MissingGreenlet under AsyncSession.
    user_id = user.id
    try:
        await auth_service.change_password(
            db,
            user_id=user_id,
            current_password=body.current_password,
            new_password=body.new_password,
        )
    except auth_service.AuthError as exc:
        code = (
            status.HTTP_401_UNAUTHORIZED
            if exc.code == "INVALID_CREDENTIALS"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=exc.message) from exc
    # Drop identity-map cache so /me serialization cannot return a stale flag.
    db.expire(user)
    loaded = await auth_service.get_user_with_memberships(db, user_id)
    assert loaded is not None
    return await _serialize_user(db, loaded)


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    try:
        await auth_service.update_profile(db, user_id=user.id, full_name=body.full_name)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc
    loaded = await auth_service.get_user_with_memberships(db, user.id)
    assert loaded is not None
    return await _serialize_user(db, loaded)
