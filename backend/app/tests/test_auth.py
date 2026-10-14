import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_login_me_refresh_logout(client: AsyncClient) -> None:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": "owner1@example.com",
            "password": "password123",
            "full_name": "Owner One",
            "organization_name": "Farm One",
        },
    )
    assert reg.status_code == 201, reg.text
    tokens = reg.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]

    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "owner1@example.com"
    assert len(body["memberships"]) == 1
    assert body["memberships"][0]["role"] == "owner"

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "owner1@example.com", "password": "password123"},
    )
    assert login.status_code == 200

    refreshed = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refreshed.status_code == 200
    new_refresh = refreshed.json()["refresh_token"]

    # Old refresh should no longer work after rotation
    reuse = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert reuse.status_code == 401

    logout = await client.post("/api/v1/auth/logout", json={"refresh_token": new_refresh})
    assert logout.status_code == 204


@pytest.mark.asyncio
async def test_duplicate_email_rejected(client: AsyncClient) -> None:
    payload = {
        "email": "dup@example.com",
        "password": "password123",
        "full_name": "Dup",
        "organization_name": "Dup Farm",
    }
    assert (await client.post("/api/v1/auth/register-owner", json=payload)).status_code == 201
    again = await client.post("/api/v1/auth/register-owner", json=payload)
    assert again.status_code == 400


@pytest.mark.asyncio
async def test_invalid_login(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "wrongpass1"},
    )
    assert res.status_code == 401
