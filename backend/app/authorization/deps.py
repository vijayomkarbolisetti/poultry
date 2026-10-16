from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, set_rls_bypass
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

    # JWT already verified — bootstrap user read under bypass (1 round-trip, no RLS GUC yet).
    await set_rls_bypass(db, True)
    user = await db.get(User, user_id)
    await set_rls_bypass(db, False)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    return user


async def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    x_owner_account_id: str | None = Header(default=None, alias="X-Owner-Account-Id"),
) -> AuthContext:
    """Resolve the user and org in one database round trip, then set RLS."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    owner_id: UUID | None = None
    if x_owner_account_id:
        try:
            owner_id = UUID(x_owner_account_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid X-Owner-Account-Id") from exc

    row = (
        await db.execute(
            text(
                """
                WITH prep AS (
                    SELECT set_config('app.rls_bypass', 'on', true) AS ok
                )
                SELECT
                    set_config('app.rls_bypass', 'off', true) AS bypass_off,
                    set_config('app.current_user_id', u.id::text, true) AS uid_set,
                    set_config('app.current_owner_id', :oid_text, true) AS oid_set,
                    set_config(
                        'app.current_role',
                        COALESCE(
                            m.role::text,
                            CASE WHEN u.is_platform_super_admin THEN 'platform_super_admin' ELSE '' END
                        ),
                        true
                    ) AS role_set,
                    u.id AS user_id,
                    u.email,
                    u.password_hash,
                    u.full_name,
                    u.is_active,
                    u.is_platform_super_admin,
                    u.created_at AS user_created_at,
                    u.updated_at AS user_updated_at,
                    m.id AS membership_id,
                    m.owner_account_id,
                    m.user_id AS membership_user_id,
                    m.role::text AS role,
                    m.is_active AS membership_active,
                    m.created_at AS membership_created_at,
                    m.updated_at AS membership_updated_at
                FROM prep
                JOIN users u ON u.id = CAST(:uid AS uuid)
                LEFT JOIN owner_memberships m
                    ON CAST(:oid_uuid AS uuid) IS NOT NULL
                   AND m.user_id = u.id
                   AND m.owner_account_id = CAST(:oid_uuid AS uuid)
                   AND m.is_active
                """
            ),
            {
                "uid": str(user_id),
                "oid_text": str(owner_id) if owner_id else "",
                "oid_uuid": str(owner_id) if owner_id else None,
            },
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")

    user = await db.merge(
        User(
            id=row["user_id"],
            email=row["email"],
            password_hash=row["password_hash"],
            full_name=row["full_name"],
            is_active=row["is_active"],
            is_platform_super_admin=row["is_platform_super_admin"],
            created_at=row["user_created_at"],
            updated_at=row["user_updated_at"],
        ),
        load=False,
    )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")

    membership: OwnerMembership | None = None
    if row["membership_id"] is not None:
        membership = await db.merge(
            OwnerMembership(
                id=row["membership_id"],
                owner_account_id=row["owner_account_id"],
                user_id=row["membership_user_id"],
                role=MembershipRole(row["role"]),
                is_active=row["membership_active"],
                created_at=row["membership_created_at"],
                updated_at=row["membership_updated_at"],
            ),
            load=False,
        )
    elif owner_id is not None and not user.is_platform_super_admin:
        raise HTTPException(status_code=403, detail="No active membership for this organization")

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
