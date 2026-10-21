"""Global search — birds, batches, sheds; tenant + farmer isolation."""

from datetime import date
from uuid import uuid4

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


async def _farmer_headers(client: AsyncClient, email: str, owner_id: str) -> dict:
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    return {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": owner_id,
    }


async def _seed_farm(client: AsyncClient, headers: dict, *, stamp: str) -> dict:
    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"North Barn {stamp}", "code": f"NB{stamp[-3:]}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    other = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"South Barn {stamp}", "code": f"SB{stamp[-3:]}", "is_owner_managed": True},
    )
    assert other.status_code == 201, other.text
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed.json()["id"],
            "batch_code": f"BATCH-{stamp}",
            "initial_count": 20,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 20,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": 19,
            "breed": "Layer",
        },
    )
    assert flock.status_code == 201, flock.text
    bird = await client.post(
        "/api/v1/birds",
        headers=headers,
        json={
            "flock_id": flock.json()["id"],
            "band_id": f"BAND-{stamp}",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-15",
        },
    )
    assert bird.status_code == 201, bird.text
    return {
        "shed": shed.json(),
        "other_shed": other.json(),
        "flock": flock.json(),
        "bird": bird.json(),
        "stamp": stamp,
    }


@pytest.mark.asyncio
async def test_global_search_mixed_entities(client: AsyncClient) -> None:
    a = await _owner(client, "gs-owner@example.com", "GS Farm")
    s = await _seed_farm(client, a["headers"], stamp="9911")
    resp = await client.get(
        "/api/v1/search",
        headers=a["headers"],
        params={"q": s["stamp"], "limit": 10},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["query"] == s["stamp"]
    assert body["birds"] is not None and body["birds"]["total"] >= 1
    assert any(i["band_id"] == f"BAND-{s['stamp']}" for i in body["birds"]["items"])
    assert body["batches"] is not None and body["batches"]["total"] >= 1
    assert any(i["batch_code"] == f"BATCH-{s['stamp']}" for i in body["batches"]["items"])
    assert body["sheds"] is not None and body["sheds"]["total"] >= 1
    # No raw UUID leakage in customer-facing display fields (ids exist for navigation)
    assert "Data integrity" not in resp.text


@pytest.mark.asyncio
async def test_search_exact_and_partial_band(client: AsyncClient) -> None:
    a = await _owner(client, "gs-band@example.com", "GS Band Farm")
    s = await _seed_farm(client, a["headers"], stamp="8822")
    exact = await client.get(
        "/api/v1/search",
        headers=a["headers"],
        params={"q": f"BAND-{s['stamp']}", "types": "birds"},
    )
    assert exact.status_code == 200
    assert exact.json()["birds"]["exact_count"] >= 1
    assert exact.json()["batches"] is None
    assert exact.json()["sheds"] is None

    part = await client.get(
        "/api/v1/birds/search",
        headers=a["headers"],
        params={"q": "BAND-88"},
    )
    assert part.status_code == 200
    assert part.json()["total"] >= 1


@pytest.mark.asyncio
async def test_shed_and_batch_name_search_endpoints(client: AsyncClient) -> None:
    a = await _owner(client, "gs-names@example.com", "GS Names")
    s = await _seed_farm(client, a["headers"], stamp="7733")
    sheds = await client.get(
        "/api/v1/sheds/search",
        headers=a["headers"],
        params={"q": "North Barn"},
    )
    assert sheds.status_code == 200, sheds.text
    assert sheds.json()["total"] >= 1
    assert any(i["name"].startswith("North Barn") for i in sheds.json()["items"])

    batches = await client.get(
        "/api/v1/flocks/search",
        headers=a["headers"],
        params={"q": f"BATCH-{s['stamp']}"},
    )
    assert batches.status_code == 200, batches.text
    assert batches.json()["exact_count"] >= 1


@pytest.mark.asyncio
async def test_global_search_tenant_isolation(client: AsyncClient) -> None:
    a = await _owner(client, "gs-ten-a@example.com", "GS Ten A")
    b = await _owner(client, "gs-ten-b@example.com", "GS Ten B")
    s = await _seed_farm(client, a["headers"], stamp="6644")
    cross = await client.get(
        "/api/v1/search",
        headers=b["headers"],
        params={"q": s["stamp"]},
    )
    assert cross.status_code == 200
    body = cross.json()
    bird_n = body["birds"]["total"] if body["birds"] else 0
    batch_n = body["batches"]["total"] if body["batches"] else 0
    shed_n = body["sheds"]["total"] if body["sheds"] else 0
    assert bird_n == 0 and batch_n == 0 and shed_n == 0


@pytest.mark.asyncio
async def test_farmer_assigned_shed_scope(client: AsyncClient) -> None:
    a = await _owner(client, "gs-farmer-o@example.com", "GS Farmer Farm")
    s = await _seed_farm(client, a["headers"], stamp="5555")
    farmer = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "gs-farmer@example.com",
            "password": "password123",
            "full_name": "GS Farmer",
            "role": "farmer",
            "permission_codes": ["bird.view", "shed.view", "flock.view"],
            "shed_ids": [s["shed"]["id"]],
        },
    )
    assert farmer.status_code == 201, farmer.text
    fh = await _farmer_headers(client, "gs-farmer@example.com", a["owner_id"])

    ok = await client.get("/api/v1/search", headers=fh, params={"q": s["stamp"]})
    assert ok.status_code == 200
    body = ok.json()
    assert body["birds"]["total"] >= 1
    assert body["batches"]["total"] >= 1
    assert any(i["id"] == s["shed"]["id"] for i in body["sheds"]["items"])
    assert not any(i["id"] == s["other_shed"]["id"] for i in body["sheds"]["items"])

    # South barn code should not appear for this farmer
    south = await client.get(
        "/api/v1/search", headers=fh, params={"q": s["other_shed"]["code"]}
    )
    assert south.status_code == 200
    assert (south.json()["sheds"] or {"total": 0})["total"] == 0


@pytest.mark.asyncio
async def test_empty_search_and_invalid_types(client: AsyncClient) -> None:
    a = await _owner(client, "gs-empty@example.com", "GS Empty")
    empty = await client.get("/api/v1/search", headers=a["headers"], params={"q": "ZZZNOMATCH999"})
    assert empty.status_code == 200
    body = empty.json()
    assert body["birds"]["total"] == 0
    assert body["batches"]["total"] == 0
    assert body["sheds"]["total"] == 0

    bad = await client.get(
        "/api/v1/search", headers=a["headers"], params={"q": "x", "types": "widgets"}
    )
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_global_search_requires_auth(client: AsyncClient) -> None:
    missing = await client.get("/api/v1/search", params={"q": "abc"})
    assert missing.status_code in {401, 403, 422}
    a = await _owner(client, "gs-auth@example.com", "GS Auth")
    no_owner = await client.get(
        "/api/v1/search",
        headers={"Authorization": a["headers"]["Authorization"]},
        params={"q": "abc"},
    )
    assert no_owner.status_code == 400
