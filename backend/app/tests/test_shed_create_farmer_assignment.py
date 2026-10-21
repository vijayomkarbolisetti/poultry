"""Shed creation with mandatory farmer assignment for farmer-managed sheds."""

import pytest
from httpx import AsyncClient


async def _owner(client: AsyncClient, email: str, org: str) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Owner",
            "organization_name": org,
        },
    )
    assert reg.status_code == 201, reg.text
    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"}
    )
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "owner_id": owner_id,
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
    }


async def _farmer(client: AsyncClient, headers: dict, email: str, shed_ids: list | None = None) -> dict:
    res = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "email": email,
            "password": "password123",
            "full_name": "Test Farmer",
            "role": "farmer",
            "permission_codes": ["shed.view", "flock.view", "vaccination.view"],
            "shed_ids": shed_ids or [],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
async def test_owner_managed_create_without_farmer(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner@example.com", "SCM Farm")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "Owner Shed", "code": "OM1", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    assert shed.json()["is_owner_managed"] is True
    assigns = await client.get(
        f"/api/v1/sheds/{shed.json()['id']}/assignments", headers=a["headers"]
    )
    assert assigns.status_code == 200
    assert assigns.json() == []


@pytest.mark.asyncio
async def test_owner_managed_rejects_farmer_id(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner2@example.com", "SCM Farm 2")
    farmer = await _farmer(client, a["headers"], "scm-f2@example.com")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Bad",
            "code": "OMX",
            "is_owner_managed": True,
            "initial_farmer_membership_id": farmer["membership_id"],
        },
    )
    assert shed.status_code == 422


@pytest.mark.asyncio
async def test_farmer_managed_requires_farmer(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner3@example.com", "SCM Farm 3")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "Need Farmer", "code": "FM0", "is_owner_managed": False},
    )
    assert shed.status_code == 422


@pytest.mark.asyncio
async def test_farmer_managed_creates_assignment_atomically(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner4@example.com", "SCM Farm 4")
    farmer = await _farmer(client, a["headers"], "scm-f4@example.com")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Farmer Shed",
            "code": "FM1",
            "is_owner_managed": False,
            "initial_farmer_membership_id": farmer["membership_id"],
        },
    )
    assert shed.status_code == 201, shed.text
    assert shed.json()["is_owner_managed"] is False
    shed_id = shed.json()["id"]

    assigns = await client.get(f"/api/v1/sheds/{shed_id}/assignments", headers=a["headers"])
    assert assigns.status_code == 200
    assert len(assigns.json()) == 1
    assert assigns.json()[0]["owner_membership_id"] == farmer["membership_id"]
    assert assigns.json()[0]["is_manager"] is True

    # Farmer can see the shed immediately
    login = await client.post(
        "/api/v1/auth/login", json={"email": "scm-f4@example.com", "password": "password123"}
    )
    f_headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": a["owner_id"],
    }
    sheds = await client.get("/api/v1/sheds", headers=f_headers)
    assert sheds.status_code == 200
    assert any(s["id"] == shed_id for s in sheds.json())
    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=f_headers)
    assert overview.status_code == 200


@pytest.mark.asyncio
async def test_farmer_managed_rejects_invalid_membership(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner5@example.com", "SCM Farm 5")
    fake = "00000000-0000-0000-0000-000000000099"
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Bad Farmer",
            "code": "FMX",
            "is_owner_managed": False,
            "initial_farmer_membership_id": fake,
        },
    )
    assert shed.status_code == 400
    # No shed with that code should exist
    listed = await client.get("/api/v1/sheds", headers=a["headers"])
    assert all(s["code"] != "FMX" for s in listed.json())


@pytest.mark.asyncio
async def test_farmer_managed_rejects_cross_org_farmer(client: AsyncClient) -> None:
    a = await _owner(client, "scm-ownerA@example.com", "SCM Org A")
    b = await _owner(client, "scm-ownerB@example.com", "SCM Org B")
    farmer_b = await _farmer(client, b["headers"], "scm-farmerB@example.com")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Cross",
            "code": "FMC",
            "is_owner_managed": False,
            "initial_farmer_membership_id": farmer_b["membership_id"],
        },
    )
    assert shed.status_code == 400


@pytest.mark.asyncio
async def test_unauthorized_cannot_create_shed(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner6@example.com", "SCM Farm 6")
    farmer = await _farmer(client, a["headers"], "scm-f6@example.com")
    login = await client.post(
        "/api/v1/auth/login", json={"email": "scm-f6@example.com", "password": "password123"}
    )
    f_headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": a["owner_id"],
    }
    denied = await client.post(
        "/api/v1/sheds",
        headers=f_headers,
        json={
            "name": "Hack",
            "code": "HACK",
            "is_owner_managed": False,
            "initial_farmer_membership_id": farmer["membership_id"],
        },
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_switch_to_farmer_managed_requires_assignment(client: AsyncClient) -> None:
    a = await _owner(client, "scm-owner7@example.com", "SCM Farm 7")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "Flip", "code": "FLP", "is_owner_managed": True},
    )
    shed_id = shed.json()["id"]
    bad = await client.patch(
        f"/api/v1/sheds/{shed_id}",
        headers=a["headers"],
        json={"is_owner_managed": False},
    )
    assert bad.status_code == 400

    farmer = await _farmer(client, a["headers"], "scm-f7@example.com")
    ok = await client.patch(
        f"/api/v1/sheds/{shed_id}",
        headers=a["headers"],
        json={"is_owner_managed": False, "initial_farmer_membership_id": farmer["membership_id"]},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["is_owner_managed"] is False
    assigns = await client.get(f"/api/v1/sheds/{shed_id}/assignments", headers=a["headers"])
    assert len(assigns.json()) == 1
