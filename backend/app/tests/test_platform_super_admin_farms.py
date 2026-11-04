"""Platform super admin: create farms, list all farms, operate without membership."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password


async def _make_super_admin(db: AsyncSession, *, email: str, password: str, full_name: str) -> None:
    await db.execute(text("SELECT set_config('app.rls_bypass', 'on', true)"))
    await db.execute(
        text(
            """
            INSERT INTO users (id, email, full_name, password_hash, is_active, is_platform_super_admin)
            VALUES (:id, :email, :full_name, :password_hash, true, true)
            """
        ),
        {
            "id": str(uuid4()),
            "email": email.lower(),
            "full_name": full_name,
            "password_hash": hash_password(password),
        },
    )
    await db.commit()


async def _login(client: AsyncClient, email: str, password: str) -> dict[str, str]:
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    body = res.json()
    return {"Authorization": f"Bearer {body['access_token']}"}


@pytest.mark.asyncio
async def test_public_register_disabled_when_setting_off(client: AsyncClient, monkeypatch):
    monkeypatch.setenv("ALLOW_PUBLIC_OWNER_REGISTRATION", "false")
    get_settings.cache_clear()
    try:
        res = await client.post(
            "/api/v1/auth/register-owner",
            json={
                "email": f"blocked-{uuid4().hex[:8]}@example.com",
                "password": "password123",
                "full_name": "Blocked",
                "organization_name": "Blocked Farm",
            },
        )
        assert res.status_code == 403
        assert "disabled" in res.json()["detail"].lower()
    finally:
        monkeypatch.setenv("ALLOW_PUBLIC_OWNER_REGISTRATION", "true")
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_non_super_cannot_list_or_create_farms(client: AsyncClient):
    email = f"owner-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Regular Owner",
            "organization_name": "Solo Farm",
        },
    )
    assert reg.status_code == 201, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    listed = await client.get("/api/v1/owners", headers=headers)
    assert listed.status_code == 403

    created = await client.post(
        "/api/v1/owners",
        headers=headers,
        json={
            "email": f"new-{uuid4().hex[:8]}@example.com",
            "password": "password123",
            "full_name": "Someone",
            "organization_name": "Other Farm",
        },
    )
    assert created.status_code == 403


@pytest.mark.asyncio
async def test_super_admin_creates_lists_and_opens_farm(client: AsyncClient, db_session: AsyncSession):
    super_email = f"super-{uuid4().hex[:8]}@example.com"
    await _make_super_admin(
        db_session, email=super_email, password="password123", full_name="Platform Admin"
    )
    headers = await _login(client, super_email, "password123")

    farm_email = f"farm-owner-{uuid4().hex[:8]}@example.com"
    created = await client.post(
        "/api/v1/owners",
        headers=headers,
        json={
            "email": farm_email,
            "password": "password123",
            "full_name": "Farm Owner",
            "organization_name": "Green Acres",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    owner_id = body["owner"]["id"]
    assert body["owner"]["name"] == "Green Acres"
    assert body["owner_user"]["email"] == farm_email
    assert body["owner_user"]["must_change_password"] is True
    assert body["owner_user"]["password"] == "password123"

    listed = await client.get("/api/v1/owners", headers=headers)
    assert listed.status_code == 200, listed.text
    farms = listed.json()
    assert any(f["id"] == owner_id for f in farms)
    match = next(f for f in farms if f["id"] == owner_id)
    assert match["owner_email"] == farm_email
    assert "owner_password" not in match
    assert match["owner_must_change_password"] is True

    # Only the bcrypt hash is stored — no plain-text copy anywhere on users.
    await db_session.execute(text("SELECT set_config('app.rls_bypass', 'on', true)"))
    user_cols = (
        await db_session.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")
        )
    ).scalars().all()
    assert "admin_visible_password" not in user_cols
    stored_hash = (
        await db_session.execute(
            text("SELECT password_hash FROM users WHERE email = :e"), {"e": farm_email}
        )
    ).scalar_one()
    assert stored_hash != "password123"

    detail = await client.get(f"/api/v1/owners/{owner_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["name"] == "Green Acres"

    # Super admin can hit farm-scoped APIs with header and no membership.
    sheds = await client.get(
        "/api/v1/sheds",
        headers={**headers, "X-Owner-Account-Id": owner_id},
    )
    assert sheds.status_code == 200, sheds.text
    assert sheds.json() == []

    # New farm owner can log in and must change password.
    owner_login = await client.post(
        "/api/v1/auth/login",
        json={"email": farm_email, "password": "password123"},
    )
    assert owner_login.status_code == 200
    owner_user = owner_login.json()["user"]
    assert owner_user["is_platform_super_admin"] is False
    assert owner_user["must_change_password"] is True

    owner_token = owner_login.json()["access_token"]
    changed = await client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"current_password": "password123", "new_password": "newpass456"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["must_change_password"] is False

    # The owner's chosen password is never exposed to the super admin.
    listed_after = await client.get("/api/v1/owners", headers=headers)
    match_after = next(f for f in listed_after.json() if f["id"] == owner_id)
    assert "newpass456" not in listed_after.text
    assert match_after["owner_must_change_password"] is False

    # Super admin can rename owner and reset password.
    patched = await client.patch(
        f"/api/v1/owners/{owner_id}/owner-user",
        headers=headers,
        json={"full_name": "Renamed Owner", "password": "resetpass789"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["full_name"] == "Renamed Owner"
    assert patched.json()["password"] == "resetpass789"
    assert patched.json()["must_change_password"] is True

    # Owner can update their own display name.
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": farm_email, "password": "resetpass789"},
    )
    assert relogin.status_code == 200
    profile = await client.patch(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {relogin.json()['access_token']}"},
        json={"full_name": "Self Renamed"},
    )
    assert profile.status_code == 200
    assert profile.json()["full_name"] == "Self Renamed"
