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
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"})
    assert me.status_code == 200
    return {
        "access": reg.json()["access_token"],
        "owner_id": me.json()["memberships"][0]["owner_account_id"],
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": me.json()["memberships"][0]["owner_account_id"],
        },
    }


@pytest.mark.asyncio
async def test_owner_shed_and_farmer_flow(client: AsyncClient) -> None:
    a = await _owner(client, "p2owner@example.com", "Phase2 Farm")

    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "North Shed", "code": "N1", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    farmer = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "farmer1@example.com",
            "password": "password123",
            "full_name": "Farmer One",
            "role": "farmer",
            "permission_codes": ["shed.view", "report.view", "vaccination.view"],
            "shed_ids": [shed_id],
        },
    )
    assert farmer.status_code == 201, farmer.text
    assert "shed.view" in farmer.json()["permission_codes"]
    assert shed_id in farmer.json()["assigned_shed_ids"]

    dash = await client.get("/api/v1/dashboard/summary", headers=a["headers"])
    assert dash.status_code == 200
    assert dash.json()["active_sheds"] == 1
    assert dash.json()["active_farmers"] == 1

    # Farmer login — sees only assigned shed
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "farmer1@example.com", "password": "password123"},
    )
    assert login.status_code == 200
    f_headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": a["owner_id"],
    }
    sheds = await client.get("/api/v1/sheds", headers=f_headers)
    assert sheds.status_code == 200
    assert len(sheds.json()) == 1
    assert sheds.json()[0]["code"] == "N1"

    # Farmer cannot create shed
    denied = await client.post(
        "/api/v1/sheds",
        headers=f_headers,
        json={"name": "Hack", "code": "H1"},
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_owner_isolation_sheds(client: AsyncClient) -> None:
    a = await _owner(client, "isoA@example.com", "Iso A")
    b = await _owner(client, "isoB@example.com", "Iso B")

    shed_b = await client.post(
        "/api/v1/sheds",
        headers=b["headers"],
        json={"name": "B Shed", "code": "B1"},
    )
    assert shed_b.status_code == 201
    b_id = shed_b.json()["id"]

    # Owner A cannot read Owner B shed
    res = await client.get(f"/api/v1/sheds/{b_id}", headers=a["headers"])
    assert res.status_code in {403, 404}

    list_a = await client.get("/api/v1/sheds", headers=a["headers"])
    assert list_a.status_code == 200
    assert all(s["id"] != b_id for s in list_a.json())


@pytest.mark.asyncio
async def test_org_admin_needs_explicit_permissions(client: AsyncClient) -> None:
    a = await _owner(client, "adminowner@example.com", "Admin Farm")
    admin = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "orgadmin@example.com",
            "password": "password123",
            "full_name": "Org Admin",
            "role": "org_admin",
            "permission_codes": [],  # D6: empty until granted
            "shed_ids": [],
        },
    )
    assert admin.status_code == 201
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "orgadmin@example.com", "password": "password123"},
    )
    headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": a["owner_id"],
    }
    # No shed.view → forbidden
    assert (await client.get("/api/v1/sheds", headers=headers)).status_code == 403

    # Grant shed.view
    mid = admin.json()["membership_id"]
    granted = await client.put(
        f"/api/v1/farmers/{mid}/permissions",
        headers=a["headers"],
        json={"permission_codes": ["shed.view"]},
    )
    assert granted.status_code == 200
    assert (await client.get("/api/v1/sheds", headers=headers)).status_code == 200
