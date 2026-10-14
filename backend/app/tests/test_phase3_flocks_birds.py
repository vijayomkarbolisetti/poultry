from datetime import date

import pytest
from httpx import AsyncClient


async def _setup(client: AsyncClient) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": "p3owner@example.com",
            "password": "password123",
            "full_name": "P3 Owner",
            "organization_name": "P3 Farm",
        },
    )
    assert reg.status_code == 201, reg.text
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}", "X-Owner-Account-Id": owner_id}
    shed = await client.post("/api/v1/sheds", headers=headers, json={"name": "S1", "code": "S1"})
    assert shed.status_code == 201, shed.text
    return {"headers": headers, "shed_id": shed.json()["id"]}


@pytest.mark.asyncio
async def test_flock_bird_bulk_lifecycle(client: AsyncClient) -> None:
    s = await _setup(client)
    flock = await client.post(
        "/api/v1/flocks",
        headers=s["headers"],
        json={
            "shed_id": s["shed_id"],
            "batch_code": "B100",
            "initial_count": 100,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 45,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": 100,
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]
    assert flock.json()["current_count"] == 100
    assert flock.json()["dob_confidence"] == "estimated"

    bird = await client.post(
        "/api/v1/birds",
        headers=s["headers"],
        json={"flock_id": flock_id, "band_id": "BAND-1", "dob_confidence": "exact", "hatch_date": "2026-01-01"},
    )
    assert bird.status_code == 201, bird.text

    dup = await client.post(
        "/api/v1/birds",
        headers=s["headers"],
        json={"flock_id": flock_id, "band_id": "BAND-1"},
    )
    assert dup.status_code == 400

    bulk = await client.post(
        "/api/v1/birds/bulk-import",
        headers=s["headers"],
        json={
            "flock_id": flock_id,
            "idempotency_key": "bulk-1",
            "rows": [{"band_id": "B2"}, {"band_id": "B3"}, {"band_id": "BAND-1"}],
        },
    )
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["created"] == 2
    assert bulk.json()["failed"] == 1

    # Idempotent retry
    again = await client.post(
        "/api/v1/birds/bulk-import",
        headers=s["headers"],
        json={"flock_id": flock_id, "idempotency_key": "bulk-1", "rows": [{"band_id": "B9"}]},
    )
    assert again.status_code == 200
    assert again.json().get("created", 0) >= 2

    life = await client.post(
        "/api/v1/lifecycle-events",
        headers=s["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": bird.json()["id"],
            "quantity": 1,
            "reason": "test",
        },
    )
    assert life.status_code == 201, life.text

    dash = await client.get("/api/v1/dashboard/summary", headers=s["headers"])
    assert dash.status_code == 200
    assert dash.json()["active_flocks"] >= 1
