import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.database import set_rls_bypass, set_rls_context


async def _register(client: AsyncClient, email: str, org: str) -> dict:
    res = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": email.split("@")[0],
            "organization_name": org,
        },
    )
    assert res.status_code == 201, res.text
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {res.json()['access_token']}"},
    )
    assert me.status_code == 200
    data = me.json()
    return {
        "access": res.json()["access_token"],
        "user_id": data["id"],
        "owner_id": data["memberships"][0]["owner_account_id"],
    }


@pytest.mark.asyncio
async def test_owner_a_cannot_fetch_owner_b_via_api(client: AsyncClient) -> None:
    a = await _register(client, "ownera@example.com", "Farm A")
    b = await _register(client, "ownerb@example.com", "Farm B")

    # Owner A with A's org header asking for B's id
    denied = await client.get(
        f"/api/v1/owners/{b['owner_id']}",
        headers={
            "Authorization": f"Bearer {a['access']}",
            "X-Owner-Account-Id": a["owner_id"],
        },
    )
    assert denied.status_code == 403

    # Spoofing B's owner id in header without membership
    spoof = await client.get(
        f"/api/v1/owners/{b['owner_id']}",
        headers={
            "Authorization": f"Bearer {a['access']}",
            "X-Owner-Account-Id": b["owner_id"],
        },
    )
    assert spoof.status_code == 403

    # Owner B can fetch own account
    ok = await client.get(
        f"/api/v1/owners/{b['owner_id']}",
        headers={
            "Authorization": f"Bearer {b['access']}",
            "X-Owner-Account-Id": b["owner_id"],
        },
    )
    assert ok.status_code == 200
    assert ok.json()["name"] == "Farm B"


@pytest.mark.asyncio
async def test_rls_hides_other_owner_rows(db_session: AsyncSession, client: AsyncClient) -> None:
    """RLS must be verified as a non-superuser role (superusers bypass RLS)."""
    a = await _register(client, "rlsa@example.com", "RLS Farm A")
    b = await _register(client, "rlsb@example.com", "RLS Farm B")

    # Ensure non-superuser app_user exists (Docker init may have created it).
    await db_session.execute(
        text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
                CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS;
              END IF;
            END $$;
            """
        )
    )
    await db_session.commit()
    await db_session.execute(text("GRANT USAGE ON SCHEMA public TO app_user"))
    await db_session.execute(
        text("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user")
    )
    await db_session.commit()

    app_engine = create_async_engine(
        "postgresql+asyncpg://app_user:app_user@localhost:5433/poultry_tracker_test",
        pool_pre_ping=True,
    )
    try:
        async with app_engine.connect() as conn:
            trans = await conn.begin()
            await set_rls_bypass(conn, False)  # type: ignore[arg-type]
            await set_rls_context(
                conn,  # type: ignore[arg-type]
                user_id=a["user_id"],
                owner_account_id=a["owner_id"],
                role="owner",
            )
            visible = (
                await conn.execute(text("SELECT id::text, name FROM owner_accounts ORDER BY name"))
            ).all()
            names = [row[1] for row in visible]
            assert "RLS Farm A" in names
            assert "RLS Farm B" not in names

            row = await conn.scalar(
                text("SELECT name FROM owner_accounts WHERE id = CAST(:id AS uuid)"),
                {"id": b["owner_id"]},
            )
            assert row is None

            await set_rls_bypass(conn, True)  # type: ignore[arg-type]
            count = await conn.scalar(text("SELECT count(*) FROM owner_accounts"))
            assert count >= 2
            await trans.commit()
    finally:
        await app_engine.dispose()
