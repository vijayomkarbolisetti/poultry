import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.database import set_rls_bypass, set_rls_context
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.audit import AuditLog
from app.models.enums import MembershipRole
from app.models.membership import OwnerMembership
from app.models.owner import OwnerAccount
from app.models.token import RefreshToken
from app.models.user import User


class AuthError(Exception):
    def __init__(self, message: str, code: str = "AUTH_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def register_owner(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
    organization_name: str,
) -> tuple[User, OwnerAccount, OwnerMembership, str, str]:
    await set_rls_bypass(session, True)
    try:
        existing = await session.scalar(select(User).where(User.email == email.lower()))
        if existing:
            raise AuthError("Email already registered", "EMAIL_EXISTS")

        # bcrypt is CPU-bound — run off the event loop so the API stays responsive.
        password_hash = await asyncio.to_thread(hash_password, password)
        user = User(
            email=email.lower(),
            password_hash=password_hash,
            full_name=full_name,
            is_active=True,
        )
        session.add(user)
        await session.flush()

        owner = OwnerAccount(name=organization_name, created_by_user_id=user.id, is_active=True)
        session.add(owner)
        await session.flush()

        membership = OwnerMembership(
            owner_account_id=owner.id,
            user_id=user.id,
            role=MembershipRole.owner,
            is_active=True,
        )
        session.add(membership)

        session.add(
            AuditLog(
                owner_account_id=owner.id,
                actor_user_id=user.id,
                action="owner.register",
                entity_type="owner_account",
                entity_id=owner.id,
                after={"name": organization_name, "email": user.email},
            )
        )

        access, refresh = await _issue_tokens(session, user)
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    await set_rls_bypass(session, True)
    await session.refresh(user)
    await session.refresh(owner)
    await session.refresh(membership)
    return user, owner, membership, access, refresh


async def login(session: AsyncSession, *, email: str, password: str) -> tuple[User, str, str]:
    await set_rls_bypass(session, True)
    user = await session.scalar(select(User).where(User.email == email.lower()))
    if not user:
        raise AuthError("Invalid email or password", "INVALID_CREDENTIALS")
    ok = await asyncio.to_thread(verify_password, password, user.password_hash)
    if not ok:
        raise AuthError("Invalid email or password", "INVALID_CREDENTIALS")
    if not user.is_active:
        raise AuthError("Account is deactivated", "ACCOUNT_INACTIVE")
    access, refresh = await _issue_tokens(session, user)
    await session.commit()
    return user, access, refresh


async def refresh_session(session: AsyncSession, *, refresh_token: str) -> tuple[User, str, str]:
    await set_rls_bypass(session, True)
    token_hash = hash_token(refresh_token)
    row = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if not row or row.revoked_at is not None:
        raise AuthError("Invalid refresh token", "INVALID_REFRESH")
    if row.expires_at < datetime.now(UTC):
        raise AuthError("Refresh token expired", "REFRESH_EXPIRED")

    user = await session.get(User, row.user_id)
    if not user or not user.is_active:
        raise AuthError("Account is deactivated", "ACCOUNT_INACTIVE")

    row.revoked_at = datetime.now(UTC)
    access, new_refresh = await _issue_tokens(session, user)
    new_row = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(new_refresh))
    )
    if new_row:
        row.replaced_by_id = new_row.id
    await session.commit()
    return user, access, new_refresh


async def logout(session: AsyncSession, *, refresh_token: str) -> None:
    await set_rls_bypass(session, True)
    token_hash = hash_token(refresh_token)
    row = await session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if row and row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        await session.commit()


async def get_user_with_memberships(session: AsyncSession, user_id: UUID) -> User | None:
    await set_rls_context(session, user_id=user_id)
    return await session.scalar(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.memberships).selectinload(OwnerMembership.owner_account))
    )


async def _issue_tokens(session: AsyncSession, user: User) -> tuple[str, str]:
    settings = get_settings()
    access = create_access_token(user_id=user.id)
    raw_refresh = generate_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    await session.flush()
    return access, raw_refresh
