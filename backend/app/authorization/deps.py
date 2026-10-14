from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db, set_rls_bypass, set_rls_context
from app.core.security import decode_access_token
from app.models.enums import MembershipRole
from app.models.membership import OwnerMembership
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user: User
    membership: OwnerMembership | None
    owner_account_id: UUID | None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    # Bootstrap read of the authenticated principal under RLS.
    await set_rls_context(db, user_id=user_id)
    user = await db.get(User, user_id)
    if user is None:
        await set_rls_bypass(db, True)
        user = await db.get(User, user_id)
        await set_rls_bypass(db, False)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    return user


async def get_auth_context(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_owner_account_id: str | None = Header(default=None, alias="X-Owner-Account-Id"),
) -> AuthContext:
    """Resolve optional active organization from header; verify membership server-side."""
    membership: OwnerMembership | None = None
    owner_id: UUID | None = None

    if x_owner_account_id:
        try:
            owner_id = UUID(x_owner_account_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid X-Owner-Account-Id") from exc

        membership = await db.scalar(
            select(OwnerMembership)
            .where(
                OwnerMembership.user_id == user.id,
                OwnerMembership.owner_account_id == owner_id,
                OwnerMembership.is_active.is_(True),
            )
            .options(selectinload(OwnerMembership.owner_account))
        )
        if membership is None and not user.is_platform_super_admin:
            raise HTTPException(status_code=403, detail="No active membership for this organization")

    await set_rls_context(
        db,
        user_id=user.id,
        owner_account_id=owner_id,
        role=membership.role.value if membership else ("platform_super_admin" if user.is_platform_super_admin else None),
    )
    return AuthContext(user=user, membership=membership, owner_account_id=owner_id)


def require_owner_or_admin(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    if ctx.user.is_platform_super_admin:
        return ctx
    if ctx.membership is None or ctx.membership.role not in {
        MembershipRole.owner,
        MembershipRole.org_admin,
    }:
        raise HTTPException(status_code=403, detail="Owner or org admin required")
    return ctx
