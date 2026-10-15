from collections.abc import AsyncGenerator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(
    settings.runtime_database_url,
    echo=settings.debug and settings.environment == "local",
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def set_rls_context(
    session: AsyncSession,
    *,
    user_id: UUID | None = None,
    owner_account_id: UUID | None = None,
    role: str | None = None,
) -> None:
    """Set transaction-local GUCs used by RLS policies. Must be called inside a transaction.

    One statement (one DB round trip) instead of three — matters when the DB is remote.
    """
    await session.execute(
        text(
            "SELECT set_config('app.current_user_id', :uid, true),"
            " set_config('app.current_owner_id', :oid, true),"
            " set_config('app.current_role', :role, true)"
        ),
        {
            "uid": str(user_id) if user_id else "",
            "oid": str(owner_account_id) if owner_account_id else "",
            "role": role or "",
        },
    )


async def clear_rls_context(session: AsyncSession) -> None:
    await set_rls_context(session, user_id=None, owner_account_id=None, role=None)


async def set_rls_bypass(session: AsyncSession, enabled: bool) -> None:
    """Trusted server-side bootstrap only (auth register/login). Never expose to clients."""
    await session.execute(
        text("SELECT set_config('app.rls_bypass', :flag, true)"),
        {"flag": "on" if enabled else "off"},
    )
