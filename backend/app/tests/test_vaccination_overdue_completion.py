"""Regression: overdue clears only when eligible population is fully covered."""

from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _owner_unbanded_overdue(client: AsyncClient, *, count: int = 50) -> dict:
    email = f"od-comp-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Overdue Completion Owner",
            "organization_name": f"OD Farm {uuid4().hex[:4]}",
        },
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    headers = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner_id}

    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "OD Shed", "code": f"OD-{uuid4().hex[:4].upper()}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    hatch = (date.today() - timedelta(days=21)).isoformat()
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": f"UB-{uuid4().hex[:4].upper()}",
            "initial_count": count,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": hatch,
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]

    vax = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": f"OD Vax {uuid4().hex[:4]}",
            "category": "vaccine",
            "rules": [{"dose_number": 1, "target_age_days": 0, "grace_period_days": 0}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=headers,
        json={"flock_id": flock_id, "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    dose = gen.json()[0]
    assert dose["eligible_count"] == count
    assert dose["completed_count"] == 0
    assert dose["status"] == "overdue"
    return {
        "headers": headers,
        "shed_id": shed_id,
        "flock_id": flock_id,
        "dose_id": dose["id"],
        "count": count,
        "owner_id": owner_id,
        "token": token,
    }


@pytest.mark.asyncio
async def test_unbanded_all_remaining_completes_overdue_dose(client: AsyncClient) -> None:
    ctx = await _owner_unbanded_overdue(client, count=50)
    res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=ctx["headers"],
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"all-{uuid4().hex}",
            "items": [{"scheduled_dose_id": ctx["dose_id"], "birds_covered": 50}],
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()[0]["birds_covered"] == 50

    after = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"shed_id": ctx["shed_id"]},
    )
    row = next(d for d in after.json() if d["id"] == ctx["dose_id"])
    assert row["completed_count"] == 50
    assert row["eligible_count"] == 50
    assert row["remaining_count"] == 0
    assert str(row["status"]).startswith("completed")
    assert row["needs_review"] is False

    overview = await client.get(f"/api/v1/sheds/{ctx['shed_id']}/overview", headers=ctx["headers"])
    assert overview.status_code == 200
    assert overview.json()["vaccination"]["overdue"] == 0


@pytest.mark.asyncio
async def test_partial_coverage_keeps_overdue_and_remaining(client: AsyncClient) -> None:
    ctx = await _owner_unbanded_overdue(client, count=50)
    res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=ctx["headers"],
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"part-{uuid4().hex}",
            "items": [{"scheduled_dose_id": ctx["dose_id"], "birds_covered": 20}],
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()[0]["birds_covered"] == 20

    after = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"shed_id": ctx["shed_id"]},
    )
    row = next(d for d in after.json() if d["id"] == ctx["dose_id"])
    assert row["completed_count"] == 20
    assert row["eligible_count"] == 50
    assert row["remaining_count"] == 30
    assert row["status"] == "overdue"

    overview = await client.get(f"/api/v1/sheds/{ctx['shed_id']}/overview", headers=ctx["headers"])
    assert overview.status_code == 200
    assert overview.json()["vaccination"]["overdue"] == 1


@pytest.mark.asyncio
async def test_batch_zero_birds_rejected(client: AsyncClient) -> None:
    ctx = await _owner_unbanded_overdue(client, count=10)
    res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=ctx["headers"],
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"zero-{uuid4().hex}",
            "items": [{"scheduled_dose_id": ctx["dose_id"], "birds_covered": 0}],
        },
    )
    # Schema or service should reject non-positive coverage.
    assert res.status_code in (400, 422), res.text


@pytest.mark.asyncio
async def test_select_birds_does_not_cover_unbanded_population(client: AsyncClient) -> None:
    ctx = await _owner_unbanded_overdue(client, count=10)
    # Add one banded bird (increments live count / eligibility via lifecycle hooks).
    bird = await client.post(
        "/api/v1/birds",
        headers=ctx["headers"],
        json={
            "flock_id": ctx["flock_id"],
            "band_id": f"B-{uuid4().hex[:6]}",
            "hatch_date": (date.today() - timedelta(days=21)).isoformat(),
            "dob_confidence": "exact",
        },
    )
    assert bird.status_code in (200, 201), bird.text
    bird_id = bird.json()["id"]

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"flock_id": ctx["flock_id"]},
    )
    dose = next(d for d in doses.json() if d["id"] == ctx["dose_id"])
    eligible_before = dose["eligible_count"]
    assert eligible_before >= 10

    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=ctx["headers"],
        json={
            "scheduled_dose_id": ctx["dose_id"],
            "bird_id": bird_id,
            "birds_covered": 1,
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"one-bird-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text

    after = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"flock_id": ctx["flock_id"]},
    )
    updated = next(d for d in after.json() if d["id"] == ctx["dose_id"])
    assert updated["completed_count"] == 1
    assert updated["eligible_count"] >= eligible_before
    assert updated["remaining_count"] == updated["eligible_count"] - 1
    assert not str(updated["status"]).startswith("completed")
    assert updated["status"] == "overdue"


@pytest.mark.asyncio
async def test_nd_named_unbanded_same_task_id_after_full_coverage(client: AsyncClient) -> None:
    """S5DeviceShed2-style: ND overdue on unbanded flock completes; same dose id on refetch."""
    email = f"nd-s5-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "ND S5 Owner",
            "organization_name": f"ND Farm {uuid4().hex[:4]}",
        },
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    headers = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner_id}

    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={
            "name": "S5DeviceShed2-Regression",
            "code": f"S5R-{uuid4().hex[:4].upper()}",
            "is_owner_managed": True,
            "capacity": 50,
        },
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    hatch = (date.today() - timedelta(days=11)).isoformat()
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": f"C-S5R-{uuid4().hex[:4].upper()}",
            "initial_count": 50,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": hatch,
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]

    # Named ND so list/filter by vaccine name cannot pick a different shed's dose.
    vax = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": "ND",
            "category": "vaccine",
            "rules": [{"dose_number": 1, "target_age_days": 7, "grace_period_days": 0}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=headers,
        json={"flock_id": flock_id, "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    dose = gen.json()[0]
    dose_id = dose["id"]
    assert dose["status"] == "overdue"
    assert dose["eligible_count"] == 50
    assert dose["completed_count"] == 0

    # Stale needs_review must not keep a completed dose in the open queue.
    # Force flag via a second list/refresh path after recording is asserted below.
    batch = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"nd-all-{uuid4().hex}",
            "items": [{"scheduled_dose_id": dose_id, "birds_covered": 50}],
        },
    )
    assert batch.status_code == 201, batch.text
    assert batch.json()[0]["scheduled_dose_id"] == dose_id
    assert batch.json()[0]["birds_covered"] == 50

    listed = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"shed_id": shed_id, "limit": 50},
    )
    assert listed.status_code == 200
    nd_rows = [d for d in listed.json() if (d.get("vaccine_name") or "").upper() == "ND"]
    assert len(nd_rows) == 1
    row = nd_rows[0]
    assert row["id"] == dose_id
    assert row["completed_count"] == 50
    assert row["remaining_count"] == 0
    assert str(row["status"]).startswith("completed")
    assert row["needs_review"] is False

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["vaccination"]["overdue"] == 0


@pytest.mark.asyncio
async def test_farmer_without_record_permission_cannot_vaccinate(client: AsyncClient) -> None:
    ctx = await _owner_unbanded_overdue(client, count=5)
    # Create farmer with view-only shed perms (AddFarmerModal defaults).
    farmer_email = f"od-farmer-{uuid4().hex[:6]}@example.com"
    farmer = await client.post(
        "/api/v1/farmers",
        headers=ctx["headers"],
        json={
            "email": farmer_email,
            "password": "password123",
            "full_name": "OD Farmer",
            "role": "farmer",
            "permission_codes": ["shed.view", "flock.view", "bird.view", "report.view"],
            "shed_ids": [ctx["shed_id"]],
        },
    )
    assert farmer.status_code in (200, 201), farmer.text

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": farmer_email, "password": "password123"},
    )
    assert login.status_code == 200, login.text
    f_headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": ctx["owner_id"],
    }
    denied = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f_headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"deny-{uuid4().hex}",
            "items": [{"scheduled_dose_id": ctx["dose_id"], "birds_covered": 5}],
        },
    )
    assert denied.status_code in (401, 403), denied.text
