"""Dead bird list: mortality history, search, tenant isolation."""

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
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
        "owner_id": owner_id,
    }


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _flock(client: AsyncClient, headers: dict, shed_id: str, code: str) -> dict:
    r = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": 5,
            "tracking_mode": "mixed",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-15",
            "unbanded_count": 3,
            "breed": "Aseel",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _bird(client: AsyncClient, headers: dict, flock_id: str, band: str) -> dict:
    r = await client.post(
        "/api/v1/birds",
        headers=headers,
        json={
            "flock_id": flock_id,
            "band_id": band,
            "dob_confidence": "exact",
            "hatch_date": "2026-01-15",
            "breed": "Aseel",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _mortality(
    client: AsyncClient, headers: dict, bird_id: str, *, day: str = "2026-10-20", reason: str = "Illness"
) -> None:
    r = await client.post(
        "/api/v1/lifecycle-events",
        headers=headers,
        json={
            "event_type": "mortality",
            "effective_date": day,
            "bird_id": bird_id,
            "reason": reason,
            "idempotency_key": f"mortality-{uuid4().hex}",
        },
    )
    assert r.status_code in {200, 201}, r.text


@pytest.mark.asyncio
async def test_dead_birds_list_after_mortality(client: AsyncClient) -> None:
    auth = await _owner(client, f"dead-ok-{uuid4().hex[:8]}@example.com", "Dead Org")
    shed = await _shed(client, auth["headers"], f"D{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"B-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], f"DB-{uuid4().hex[:5].upper()}")

    await _mortality(client, auth["headers"], bird["id"], day="2026-10-20", reason="Respiratory")

    active = await client.get(
        "/api/v1/birds/in-shed",
        headers=auth["headers"],
        params={"shed_id": shed},
    )
    assert active.status_code == 200
    assert all(i["id"] != bird["id"] for i in active.json()["items"])

    listed = await client.get("/api/v1/birds/dead-birds", headers=auth["headers"])
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] == 1
    hit = body["items"][0]
    assert hit["id"] == bird["id"]
    assert hit["lifecycle_status"] == "dead"
    assert hit["is_active"] is False
    assert hit["died_on"] == "2026-10-20"
    assert hit["reason"] == "Respiratory"


@pytest.mark.asyncio
async def test_dead_birds_search(client: AsyncClient) -> None:
    auth = await _owner(client, f"dead-q-{uuid4().hex[:8]}@example.com", "Dead Search")
    shed = await _shed(client, auth["headers"], f"Q{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BQ-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], "BAND-DEAD-1")
    await _mortality(client, auth["headers"], bird["id"], reason="Heat stress")

    by_band = await client.get(
        "/api/v1/birds/dead-birds", headers=auth["headers"], params={"q": "BAND-DEAD"}
    )
    assert by_band.status_code == 200
    assert by_band.json()["total"] == 1

    by_reason = await client.get(
        "/api/v1/birds/dead-birds", headers=auth["headers"], params={"q": "Heat"}
    )
    assert by_reason.status_code == 200
    assert by_reason.json()["total"] == 1

    miss = await client.get(
        "/api/v1/birds/dead-birds", headers=auth["headers"], params={"q": "no-such-band"}
    )
    assert miss.status_code == 200
    assert miss.json()["total"] == 0


@pytest.mark.asyncio
async def test_dead_birds_tenant_isolation(client: AsyncClient) -> None:
    a = await _owner(client, f"dead-a-{uuid4().hex[:8]}@example.com", "Org A Dead")
    b = await _owner(client, f"dead-b-{uuid4().hex[:8]}@example.com", "Org B Dead")
    shed = await _shed(client, a["headers"], f"A{uuid4().hex[:4].upper()}")
    flock = await _flock(client, a["headers"], shed, f"BA-{uuid4().hex[:6]}")
    bird = await _bird(client, a["headers"], flock["id"], f"ISO-{uuid4().hex[:5].upper()}")
    await _mortality(client, a["headers"], bird["id"])

    leak = await client.get("/api/v1/birds/dead-birds", headers=b["headers"])
    assert leak.status_code == 200
    assert leak.json()["total"] == 0
    assert all(i["id"] != bird["id"] for i in leak.json()["items"])


@pytest.mark.asyncio
async def test_dead_birds_date_filter(client: AsyncClient) -> None:
    auth = await _owner(client, f"dead-dt-{uuid4().hex[:8]}@example.com", "Dead Dates")
    shed = await _shed(client, auth["headers"], f"T{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BT-{uuid4().hex[:6]}")
    early = await _bird(client, auth["headers"], flock["id"], f"E-{uuid4().hex[:5].upper()}")
    late = await _bird(client, auth["headers"], flock["id"], f"L-{uuid4().hex[:5].upper()}")
    await _mortality(client, auth["headers"], early["id"], day="2026-09-01")
    await _mortality(client, auth["headers"], late["id"], day="2026-11-01")

    filtered = await client.get(
        "/api/v1/birds/dead-birds",
        headers=auth["headers"],
        params={"died_from": "2026-10-01", "died_to": "2026-11-30"},
    )
    assert filtered.status_code == 200
    body = filtered.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == late["id"]
