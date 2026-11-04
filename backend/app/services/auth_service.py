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
from app.services.schedule_engine import DEFAULT_FARM_TIMEZONE


class AuthError(Exception):
    def __init__(self, message: str, code: str = "AUTH_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def _create_owner_account_core(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
    organization_name: str,
    actor_user_id: UUID | None,
    audit_action: str,
    must_change_password: bool = False,
) -> tuple[User, OwnerAccount, OwnerMembership]:
    """Create farm owner user + owner_account + owner membership (caller manages bypass/tx)."""
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
        must_change_password=must_change_password,
    )
    session.add(user)
    await session.flush()

    owner = OwnerAccount(
        name=organization_name,
        created_by_user_id=actor_user_id or user.id,
        is_active=True,
        timezone=DEFAULT_FARM_TIMEZONE,
    )
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
            actor_user_id=actor_user_id or user.id,
            action=audit_action,
            entity_type="owner_account",
            entity_id=owner.id,
            after={"name": organization_name, "email": user.email},
        )
    )
    await session.flush()
    return user, owner, membership


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
        user, owner, membership = await _create_owner_account_core(
            session,
            email=email,
            password=password,
            full_name=full_name,
            organization_name=organization_name,
            actor_user_id=None,
            audit_action="owner.register",
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


async def create_owner_account_as_super_admin(
    session: AsyncSession,
    *,
    actor_user_id: UUID,
    email: str,
    password: str,
    full_name: str,
    organization_name: str,
) -> tuple[User, OwnerAccount, OwnerMembership]:
    """Platform super admin provisions a farm and its owner login (no session for new user)."""
    await set_rls_bypass(session, True)
    try:
        user, owner, membership = await _create_owner_account_core(
            session,
            email=email,
            password=password,
            full_name=full_name,
            organization_name=organization_name,
            actor_user_id=actor_user_id,
            audit_action="owner.create_by_super_admin",
            must_change_password=True,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    await set_rls_bypass(session, True)
    await session.refresh(user)
    await session.refresh(owner)
    await session.refresh(membership)
    return user, owner, membership


async def change_password(
    session: AsyncSession,
    *,
    user_id: UUID,
    current_password: str,
    new_password: str,
) -> User:
    await set_rls_bypass(session, True)
    user = await session.get(User, user_id)
    if not user or not user.is_active:
        raise AuthError("Account is deactivated", "ACCOUNT_INACTIVE")
    ok = await asyncio.to_thread(verify_password, current_password, user.password_hash)
    if not ok:
        raise AuthError("Current password is incorrect", "INVALID_CREDENTIALS")
    if current_password == new_password:
        raise AuthError("New password must be different", "PASSWORD_UNCHANGED")
    user.password_hash = await asyncio.to_thread(hash_password, new_password)
    user.must_change_password = False
    await session.commit()
    await session.refresh(user)
    return user


async def update_profile(
    session: AsyncSession,
    *,
    user_id: UUID,
    full_name: str,
) -> User:
    await set_rls_bypass(session, True)
    user = await session.get(User, user_id)
    if not user or not user.is_active:
        raise AuthError("Account is deactivated", "ACCOUNT_INACTIVE")
    user.full_name = full_name.strip()
    await session.commit()
    await session.refresh(user)
    return user


async def update_farm_owner_as_super_admin(
    session: AsyncSession,
    *,
    owner_account_id: UUID,
    full_name: str | None,
    password: str | None,
) -> User:
    """Update the primary owner of a farm (name and/or password)."""
    if full_name is None and password is None:
        raise AuthError("Nothing to update", "INVALID")
    await set_rls_bypass(session, True)
    membership = await session.scalar(
        select(OwnerMembership)
        .where(
            OwnerMembership.owner_account_id == owner_account_id,
            OwnerMembership.role == MembershipRole.owner,
            OwnerMembership.is_active.is_(True),
        )
        .options(selectinload(OwnerMembership.user))
    )
    if membership is None or membership.user is None:
        raise AuthError("Farm owner not found", "NOT_FOUND")
    user = membership.user
    if full_name is not None:
        user.full_name = full_name.strip()
    if password is not None:
        user.password_hash = await asyncio.to_thread(hash_password, password)
        user.must_change_password = True
    await session.commit()
    await session.refresh(user)
    return user


async def list_owner_accounts_for_super_admin(
    session: AsyncSession,
) -> list[tuple[OwnerAccount, User | None]]:
    """All farms with their primary owner user (role=owner), newest first."""
    await set_rls_bypass(session, True)
    owners = list(
        await session.scalars(select(OwnerAccount).order_by(OwnerAccount.created_at.desc()))
    )
    if not owners:
        return []

    owner_ids = [o.id for o in owners]
    memberships = list(
        await session.scalars(
            select(OwnerMembership)
            .where(
                OwnerMembership.owner_account_id.in_(owner_ids),
                OwnerMembership.role == MembershipRole.owner,
                OwnerMembership.is_active.is_(True),
            )
            .options(selectinload(OwnerMembership.user))
        )
    )
    owner_user_by_farm: dict[UUID, User] = {}
    for m in memberships:
        if m.owner_account_id not in owner_user_by_farm and m.user is not None:
            owner_user_by_farm[m.owner_account_id] = m.user

    return [(o, owner_user_by_farm.get(o.id)) for o in owners]


async def login(session: AsyncSession, *, email: str, password: str) -> tuple[User, str, str]:
    await set_rls_bypass(session, True)
    # Eager-load memberships so /login can return the full user without a second query.
    user = await session.scalar(
        select(User)
        .where(User.email == email.lower())
        .options(selectinload(User.memberships).selectinload(OwnerMembership.owner_account))
    )
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
