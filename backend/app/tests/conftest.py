import os
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://poultry:poultry@localhost:5433/poultry_tracker_test",
)
os.environ.setdefault(
    "DATABASE_URL_SYNC",
    "postgresql+psycopg2://poultry:poultry@localhost:5433/poultry_tracker_test",
)

from app.core.config import get_settings  # noqa: E402
from app.core.database import Base, get_db  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
import app.models  # noqa: E402, F401 — register all models on Base.metadata

get_settings.cache_clear()
settings = get_settings()

_RLS_SQL = """
ALTER TABLE owner_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_accounts_select ON owner_accounts;
CREATE POLICY owner_accounts_select ON owner_accounts
  FOR SELECT TO PUBLIC
  USING (
    id::text = NULLIF(current_setting('app.current_owner_id', true), '')
    OR EXISTS (
      SELECT 1 FROM owner_memberships m
      WHERE m.owner_account_id = owner_accounts.id
        AND m.user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
        AND m.is_active = true
    )
    OR current_setting('app.current_role', true) = 'platform_super_admin'
    OR current_setting('app.rls_bypass', true) = 'on'
  );
DROP POLICY IF EXISTS owner_accounts_insert ON owner_accounts;
CREATE POLICY owner_accounts_insert ON owner_accounts
  FOR INSERT TO PUBLIC
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR created_by_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  );

ALTER TABLE owner_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_select ON owner_memberships;
CREATE POLICY memberships_select ON owner_memberships
  FOR SELECT TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
    OR current_setting('app.current_role', true) = 'platform_super_admin'
  );
DROP POLICY IF EXISTS memberships_write ON owner_memberships;
CREATE POLICY memberships_write ON owner_memberships
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  );

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
    OR current_setting('app.current_role', true) = 'platform_super_admin'
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR id::text = NULLIF(current_setting('app.current_user_id', true), '')
    OR current_setting('app.current_role', true) = 'platform_super_admin'
  );
DROP POLICY IF EXISTS users_insert_register ON users;
CREATE POLICY users_insert_register ON users FOR INSERT TO PUBLIC WITH CHECK (true);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_self ON refresh_tokens;
CREATE POLICY refresh_self ON refresh_tokens
  FOR ALL TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  );
DROP POLICY IF EXISTS refresh_insert ON refresh_tokens;
CREATE POLICY refresh_insert ON refresh_tokens FOR INSERT TO PUBLIC WITH CHECK (true);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs
  FOR SELECT TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
    OR current_setting('app.current_role', true) = 'platform_super_admin'
  );
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT TO PUBLIC
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id IS NULL
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
    OR actor_user_id::text = NULLIF(current_setting('app.current_user_id', true), '')
  );

ALTER TABLE sheds ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheds_tenant ON sheds;
CREATE POLICY sheds_tenant ON sheds FOR ALL TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  );

ALTER TABLE shed_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE shed_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shed_memberships_tenant ON shed_memberships;
CREATE POLICY shed_memberships_tenant ON shed_memberships FOR ALL TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  );

ALTER TABLE membership_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_permissions_tenant ON membership_permissions;
CREATE POLICY membership_permissions_tenant ON membership_permissions FOR ALL TO PUBLIC
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
  );

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permissions_read ON permissions;
CREATE POLICY permissions_read ON permissions FOR SELECT TO PUBLIC USING (true);
DROP POLICY IF EXISTS permissions_write ON permissions;
CREATE POLICY permissions_write ON permissions FOR ALL TO PUBLIC
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE flocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flocks_tenant ON flocks;
CREATE POLICY flocks_tenant ON flocks FOR ALL TO PUBLIC
  USING (current_setting('app.rls_bypass', true) = 'on' OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), ''))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), ''));

ALTER TABLE birds ENABLE ROW LEVEL SECURITY;
ALTER TABLE birds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS birds_tenant ON birds;
CREATE POLICY birds_tenant ON birds FOR ALL TO PUBLIC
  USING (current_setting('app.rls_bypass', true) = 'on' OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), ''))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), ''));

ALTER TABLE lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifecycle_events_tenant ON lifecycle_events;
CREATE POLICY lifecycle_events_tenant ON lifecycle_events FOR ALL TO PUBLIC
  USING (current_setting('app.rls_bypass', true) = 'on' OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), ''))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), ''));
"""

_PHASE48_TABLES = (
    "vaccine_definitions",
    "vaccine_schedule_versions",
    "schedule_rules",
    "scheduled_doses",
    "vaccination_events",
    "vaccination_corrections",
    "notifications",
    "animal_media",
)


@pytest_asyncio.fixture
async def engine():
    admin_url = settings.database_url.replace("/poultry_tracker_test", "/poultry_tracker")
    admin_engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = 'poultry_tracker_test'")
        )
        if not exists:
            await conn.execute(text("CREATE DATABASE poultry_tracker_test"))
    await admin_engine.dispose()

    eng = create_async_engine(settings.database_url, pool_pre_ping=True)
    async with eng.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        # Cascade drop avoids RLS policy dependency errors between tests.
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("GRANT ALL ON SCHEMA public TO poultry"))
        await conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _RLS_SQL.split(";"):
            chunk = stmt.strip()
            if chunk:
                await conn.execute(text(chunk))
        for table in _PHASE48_TABLES:
            await conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
            await conn.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
            await conn.execute(text(f"DROP POLICY IF EXISTS {table}_tenant ON {table}"))
            await conn.execute(
                text(
                    f"""
                    CREATE POLICY {table}_tenant ON {table} FOR ALL TO PUBLIC
                      USING (
                        current_setting('app.rls_bypass', true) = 'on'
                        OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
                      )
                      WITH CHECK (
                        current_setting('app.rls_bypass', true) = 'on'
                        OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
                      )
                    """
                )
            )
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(engine) -> AsyncGenerator[AsyncClient, None]:
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with Session() as session:
            yield session

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    fastapi_app.dependency_overrides.clear()
