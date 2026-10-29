"""Regression: cohort growth reopen + shed-transfer vaccination reconciliation."""

from __future__ import annotations

from datetime import date, timedelta
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
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {reg.json()['access_token']}"},
    )
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "owner_id": owner_id,
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
    }


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _vaccine(
    client: AsyncClient,
    headers: dict,
    *,
    name: str,
    target_age_days: int,
    grace: int = 0,
) -> dict:
    r = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": name,
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": target_age_days,
                    "grace_period_days": grace,
                    "reminder_lead_days": 0,
                }
            ],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _register(
    client: AsyncClient,
    headers: dict,
    *,
    shed_id: str,
    hatch: date,
    band: str,
) -> dict:
    r = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=headers,
        json={
            "shed_id": shed_id,
            "band_id": band,
            "hatch_date": hatch.isoformat(),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _doses(
    client: AsyncClient,
    headers: dict,
    *,
    flock_id: str | None = None,
    shed_id: str | None = None,
) -> list[dict]:
    params: dict = {}
    if flock_id:
        params["flock_id"] = flock_id
    if shed_id:
        params["shed_id"] = shed_id
    r = await client.get("/api/v1/vaccines/scheduled-doses", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def _generate(client: AsyncClient, headers: dict, flock_id: str) -> None:
    r = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=headers,
        json={"flock_id": flock_id},
    )
    assert r.status_code == 200, r.text


def _remaining(row: dict) -> int:
    if row.get("remaining_count") is not None:
        return int(row["remaining_count"])
    return max(0, int(row["eligible_count"]) - int(row["completed_count"]))


def _pick_vaccine_dose(rows: list[dict], vaccine_id: str) -> dict:
    matches = [d for d in rows if d["vaccine_definition_id"] == vaccine_id and d.get("is_active", True)]
    assert matches, f"no dose for vaccine {vaccine_id} in {rows}"
    return matches[0]


@pytest.mark.asyncio
async def test_register_into_fully_completed_cohort_reopens_remaining(
    client: AsyncClient,
) -> None:
    """New bird in a completed cohort gets remaining=1; prior completed_count preserved."""
    owner = await _owner(client, f"recon-full-{uuid4().hex[:8]}@ex.com", "Recon Full")
    h = owner["headers"]
    shed = await _shed(client, h, f"RF{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=20)
    vax = await _vaccine(client, h, name=f"IBD-F-{uuid4().hex[:4]}", target_age_days=7)

    a = await _register(client, h, shed_id=shed, hatch=hatch, band=f"A-{uuid4().hex[:5].upper()}")
    b = await _register(client, h, shed_id=shed, hatch=hatch, band=f"B-{uuid4().hex[:5].upper()}")
    assert a["flock_id"] == b["flock_id"]
    flock_id = a["flock_id"]

    await _generate(client, h, flock_id)
    dose = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    assert dose["eligible_count"] == 2
    assert dose["completed_count"] == 0

    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose["id"],
            "birds_covered": 2,
            "administration_date": (hatch + timedelta(days=7)).isoformat(),
            "idempotency_key": f"recon-full-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text
    done = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    assert str(done["status"]).startswith("completed")
    assert done["completed_count"] == 2
    assert _remaining(done) == 0

    c = await _register(client, h, shed_id=shed, hatch=hatch, band=f"C-{uuid4().hex[:5].upper()}")
    assert c["flock_id"] == flock_id

    after = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    assert after["eligible_count"] == 3
    assert after["completed_count"] == 2
    assert _remaining(after) == 1
    assert not str(after["status"]).startswith("completed"), after["status"]
    assert after["due_date"] == done["due_date"]

    # Idempotent: sync again via generate must not duplicate active twins.
    await _generate(client, h, flock_id)
    twins = [
        d
        for d in await _doses(client, h, flock_id=flock_id)
        if d["vaccine_definition_id"] == vax["id"] and d.get("is_active", True)
    ]
    assert len(twins) == 1
    assert twins[0]["id"] == after["id"]


@pytest.mark.asyncio
async def test_register_into_partially_completed_cohort(client: AsyncClient) -> None:
    owner = await _owner(client, f"recon-part-{uuid4().hex[:8]}@ex.com", "Recon Part")
    h = owner["headers"]
    shed = await _shed(client, h, f"RP{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=15)
    vax = await _vaccine(client, h, name=f"ND-P-{uuid4().hex[:4]}", target_age_days=5)

    a = await _register(client, h, shed_id=shed, hatch=hatch, band=f"P1-{uuid4().hex[:5].upper()}")
    await _register(client, h, shed_id=shed, hatch=hatch, band=f"P2-{uuid4().hex[:5].upper()}")
    flock_id = a["flock_id"]
    await _generate(client, h, flock_id)
    dose = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])

    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose["id"],
            "bird_id": a["id"],
            "birds_covered": 1,
            "administration_date": (hatch + timedelta(days=5)).isoformat(),
            "idempotency_key": f"recon-part-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text

    await _register(client, h, shed_id=shed, hatch=hatch, band=f"P3-{uuid4().hex[:5].upper()}")
    after = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    assert after["eligible_count"] == 3
    assert after["completed_count"] == 1
    assert _remaining(after) == 2
    assert not str(after["status"]).startswith("completed")


@pytest.mark.asyncio
async def test_different_hatch_creates_independent_cohort_schedules(
    client: AsyncClient,
) -> None:
    owner = await _owner(client, f"recon-hatch-{uuid4().hex[:8]}@ex.com", "Recon Hatch")
    h = owner["headers"]
    shed = await _shed(client, h, f"RH{uuid4().hex[:4].upper()}")
    hatch_a = date.today() - timedelta(days=27)
    hatch_b = date.today() - timedelta(days=18)
    vax = await _vaccine(client, h, name=f"IBD-H-{uuid4().hex[:4]}", target_age_days=7)

    a = await _register(client, h, shed_id=shed, hatch=hatch_a, band=f"H1-{uuid4().hex[:5].upper()}")
    await _generate(client, h, a["flock_id"])
    dose_a = _pick_vaccine_dose(await _doses(client, h, flock_id=a["flock_id"]), vax["id"])
    await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose_a["id"],
            "birds_covered": dose_a["eligible_count"],
            "administration_date": (hatch_a + timedelta(days=7)).isoformat(),
            "idempotency_key": f"recon-hatch-a-{uuid4().hex}",
        },
    )

    b = await _register(client, h, shed_id=shed, hatch=hatch_b, band=f"H2-{uuid4().hex[:5].upper()}")
    assert b["flock_id"] != a["flock_id"]
    await _generate(client, h, b["flock_id"])

    src = _pick_vaccine_dose(await _doses(client, h, flock_id=a["flock_id"]), vax["id"])
    assert str(src["status"]).startswith("completed")
    assert _remaining(src) == 0

    dest = _pick_vaccine_dose(await _doses(client, h, flock_id=b["flock_id"]), vax["id"])
    assert dest["id"] != src["id"]
    assert dest["due_date"] == (hatch_b + timedelta(days=7)).isoformat()
    assert dest["eligible_count"] == 1
    assert dest["completed_count"] == 0
    assert _remaining(dest) == 1
    assert not str(dest["status"]).startswith("completed")


@pytest.mark.asyncio
async def test_transfer_preserves_completed_history_and_credits_dest(
    client: AsyncClient,
) -> None:
    owner = await _owner(client, f"recon-xfer-c-{uuid4().hex[:8]}@ex.com", "Recon Xfer C")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"XA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"XB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=12)
    vax = await _vaccine(client, h, name=f"IBD-XC-{uuid4().hex[:4]}", target_age_days=3)

    bird = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"XC-{uuid4().hex[:5].upper()}"
    )
    flock_a = bird["flock_id"]
    await _generate(client, h, flock_a)
    dose = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_a), vax["id"])
    admin = (hatch + timedelta(days=3)).isoformat()
    lot = f"LOT-{uuid4().hex[:6].upper()}"
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose["id"],
            "bird_id": bird["id"],
            "birds_covered": 1,
            "administration_date": admin,
            "lot_number": lot,
            "idempotency_key": f"recon-xc-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text
    event_id = rec.json()["id"]

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": f"recon-xfer-c-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text
    dest_flock = xfer.json()["destination_flock_id"]
    assert xfer.json()["destination_shed_id"] == shed_b

    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=h)
    assert profile.status_code == 200, profile.text
    p = profile.json()
    assert p["shed_id"] == shed_b
    assert p["flock_id"] == dest_flock
    assert p["hatch_date"] == hatch.isoformat()
    assert len(p["individual_vaccinations"]) == 1
    assert p["individual_vaccinations"][0]["id"] == event_id
    assert p["individual_vaccinations"][0]["lot_number"] == lot
    assert p["individual_vaccinations"][0]["administration_date"] == admin

    # Source empty: open tasks deactivated; completed eligible zeroed.
    src_open = [
        d
        for d in await _doses(client, h, flock_id=flock_a)
        if d["vaccine_definition_id"] == vax["id"]
        and d.get("is_active", True)
        and not str(d["status"]).startswith("completed")
    ]
    assert src_open == []

    dest_dose = _pick_vaccine_dose(await _doses(client, h, shed_id=shed_b), vax["id"])
    assert dest_dose["flock_id"] == dest_flock
    assert dest_dose["due_date"] == (hatch + timedelta(days=3)).isoformat()
    assert dest_dose["eligible_count"] == 1
    assert dest_dose["completed_count"] == 1
    assert _remaining(dest_dose) == 0
    assert str(dest_dose["status"]).startswith("completed")


@pytest.mark.asyncio
async def test_transfer_due_overdue_moves_outstanding_to_dest(client: AsyncClient) -> None:
    owner = await _owner(client, f"recon-xfer-d-{uuid4().hex[:8]}@ex.com", "Recon Xfer D")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"DA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"DB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=30)
    due = hatch + timedelta(days=7)  # overdue
    vax = await _vaccine(client, h, name=f"IBD-XD-{uuid4().hex[:4]}", target_age_days=7)

    keep = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"DK-{uuid4().hex[:5].upper()}"
    )
    move = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"DM-{uuid4().hex[:5].upper()}"
    )
    assert keep["flock_id"] == move["flock_id"]
    flock_a = keep["flock_id"]
    await _generate(client, h, flock_a)
    before = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_a), vax["id"])
    assert before["due_date"] == due.isoformat()
    assert before["eligible_count"] == 2
    assert _remaining(before) == 2
    assert before["status"] in {"overdue", "due_today", "due_soon"}

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [move["id"]],
            "idempotency_key": f"recon-xfer-d-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text
    dest_flock = xfer.json()["destination_flock_id"]

    src = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_a), vax["id"])
    assert src["eligible_count"] == 1
    assert src["completed_count"] == 0
    assert _remaining(src) == 1
    assert src["due_date"] == due.isoformat()
    assert src.get("is_active", True) is True

    dest = _pick_vaccine_dose(await _doses(client, h, shed_id=shed_b), vax["id"])
    assert dest["flock_id"] == dest_flock
    assert dest["due_date"] == due.isoformat()
    assert dest["eligible_count"] == 1
    assert dest["completed_count"] == 0
    assert _remaining(dest) == 1
    assert not str(dest["status"]).startswith("completed")
    assert dest["id"] != src["id"]


@pytest.mark.asyncio
async def test_transfer_future_dose_keeps_due_date(client: AsyncClient) -> None:
    owner = await _owner(client, f"recon-xfer-f-{uuid4().hex[:8]}@ex.com", "Recon Xfer F")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"FA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"FB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=2)
    target_age = 20
    due = hatch + timedelta(days=target_age)
    assert due > date.today()
    vax = await _vaccine(
        client, h, name=f"IBD-XF-{uuid4().hex[:4]}", target_age_days=target_age
    )

    bird = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"FF-{uuid4().hex[:5].upper()}"
    )
    await _generate(client, h, bird["flock_id"])
    before = _pick_vaccine_dose(await _doses(client, h, flock_id=bird["flock_id"]), vax["id"])
    assert before["due_date"] == due.isoformat()
    assert before["status"] == "upcoming"

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": f"recon-xfer-f-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text

    dest = _pick_vaccine_dose(await _doses(client, h, shed_id=shed_b), vax["id"])
    assert dest["due_date"] == due.isoformat()
    assert dest["status"] == "upcoming"
    assert _remaining(dest) == 1


@pytest.mark.asyncio
async def test_transfer_last_bird_deactivates_source_open_doses(client: AsyncClient) -> None:
    owner = await _owner(client, f"recon-last-{uuid4().hex[:8]}@ex.com", "Recon Last")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"LA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"LB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=25)
    vax = await _vaccine(client, h, name=f"IBD-L-{uuid4().hex[:4]}", target_age_days=7)

    bird = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"LL-{uuid4().hex[:5].upper()}"
    )
    flock_a = bird["flock_id"]
    await _generate(client, h, flock_a)
    assert _pick_vaccine_dose(await _doses(client, h, flock_id=flock_a), vax["id"])

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": f"recon-last-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text

    src_active_open = [
        d
        for d in await _doses(client, h, flock_id=flock_a)
        if d["vaccine_definition_id"] == vax["id"]
        and d.get("is_active", True)
        and not str(d["status"]).startswith("completed")
    ]
    assert src_active_open == []

    dest = _pick_vaccine_dose(await _doses(client, h, shed_id=shed_b), vax["id"])
    assert dest["eligible_count"] == 1
    assert _remaining(dest) == 1


@pytest.mark.asyncio
async def test_transfer_idempotent_replay_no_duplicate_dest_doses(client: AsyncClient) -> None:
    owner = await _owner(client, f"recon-idem-{uuid4().hex[:8]}@ex.com", "Recon Idem")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"IA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"IB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=10)
    vax = await _vaccine(client, h, name=f"IBD-I-{uuid4().hex[:4]}", target_age_days=3)

    bird = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"II-{uuid4().hex[:5].upper()}"
    )
    await _generate(client, h, bird["flock_id"])
    key = f"recon-idem-{uuid4().hex}"
    body = {
        "destination_shed_id": shed_b,
        "hatch_date": hatch.isoformat(),
        "effective_date": date.today().isoformat(),
        "bird_ids": [bird["id"]],
        "idempotency_key": key,
    }
    first = await client.post("/api/v1/lifecycle-events/transfer-to-shed-by-cohort", headers=h, json=body)
    assert first.status_code == 201, first.text
    second = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort", headers=h, json=body
    )
    assert second.status_code == 201, second.text
    assert second.json()["idempotent_replay"] is True

    dest_rows = [
        d
        for d in await _doses(client, h, shed_id=shed_b)
        if d["vaccine_definition_id"] == vax["id"] and d.get("is_active", True)
    ]
    assert len(dest_rows) == 1


@pytest.mark.asyncio
async def test_tenant_isolation_on_scheduled_doses(client: AsyncClient) -> None:
    a = await _owner(client, f"recon-ten-a-{uuid4().hex[:8]}@ex.com", "Tenant A")
    b = await _owner(client, f"recon-ten-b-{uuid4().hex[:8]}@ex.com", "Tenant B")
    hatch = date.today() - timedelta(days=8)
    vax = await _vaccine(client, a["headers"], name=f"ISO-{uuid4().hex[:4]}", target_age_days=2)
    shed = await _shed(client, a["headers"], f"TA{uuid4().hex[:4].upper()}")
    bird = await _register(
        client, a["headers"], shed_id=shed, hatch=hatch, band=f"TT-{uuid4().hex[:5].upper()}"
    )
    await _generate(client, a["headers"], bird["flock_id"])
    dose = _pick_vaccine_dose(await _doses(client, a["headers"], flock_id=bird["flock_id"]), vax["id"])

    spoof = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=b["headers"],
        params={"flock_id": bird["flock_id"]},
    )
    assert spoof.status_code == 200
    assert spoof.json() == []

    other = await client.get(
        f"/api/v1/birds/{bird['id']}/profile",
        headers=b["headers"],
    )
    assert other.status_code in (403, 404)

    # Owner A still sees the dose.
    mine = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=a["headers"],
        params={"shed_id": shed},
    )
    assert mine.status_code == 200
    assert any(d["id"] == dose["id"] for d in mine.json())


@pytest.mark.asyncio
async def test_register_multiple_birds_into_completed_cohort(client: AsyncClient) -> None:
    """Two late birds after full completion → remaining=2, completed history kept."""
    owner = await _owner(client, f"recon-multi-{uuid4().hex[:8]}@ex.com", "Recon Multi")
    h = owner["headers"]
    shed = await _shed(client, h, f"RM{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=18)
    vax = await _vaccine(client, h, name=f"IBD-M-{uuid4().hex[:4]}", target_age_days=6)

    a = await _register(client, h, shed_id=shed, hatch=hatch, band=f"M1-{uuid4().hex[:5].upper()}")
    await _register(client, h, shed_id=shed, hatch=hatch, band=f"M2-{uuid4().hex[:5].upper()}")
    flock_id = a["flock_id"]
    await _generate(client, h, flock_id)
    dose = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose["id"],
            "birds_covered": 2,
            "administration_date": (hatch + timedelta(days=6)).isoformat(),
            "idempotency_key": f"recon-multi-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text

    await _register(client, h, shed_id=shed, hatch=hatch, band=f"M3-{uuid4().hex[:5].upper()}")
    mid = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    assert mid["eligible_count"] == 3
    assert mid["completed_count"] == 2
    assert _remaining(mid) == 1

    await _register(client, h, shed_id=shed, hatch=hatch, band=f"M4-{uuid4().hex[:5].upper()}")
    after = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_id), vax["id"])
    assert after["eligible_count"] == 4
    assert after["completed_count"] == 2
    assert _remaining(after) == 2
    assert after["id"] == dose["id"]


@pytest.mark.asyncio
async def test_void_individual_event_not_credited_after_transfer(client: AsyncClient) -> None:
    owner = await _owner(client, f"recon-void-{uuid4().hex[:8]}@ex.com", "Recon Void")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"VA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"VB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=14)
    vax = await _vaccine(client, h, name=f"IBD-V-{uuid4().hex[:4]}", target_age_days=4)

    bird = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"VV-{uuid4().hex[:5].upper()}"
    )
    await _generate(client, h, bird["flock_id"])
    dose = _pick_vaccine_dose(await _doses(client, h, flock_id=bird["flock_id"]), vax["id"])
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose["id"],
            "bird_id": bird["id"],
            "birds_covered": 1,
            "administration_date": (hatch + timedelta(days=4)).isoformat(),
            "lot_number": f"VOID-{uuid4().hex[:5].upper()}",
            "idempotency_key": f"recon-void-rec-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text
    event_id = rec.json()["id"]
    voided = await client.post(
        f"/api/v1/vaccination-events/{event_id}/correct",
        headers=h,
        json={"void": True, "reason": "entered in error"},
    )
    assert voided.status_code == 200, voided.text
    assert voided.json()["is_void"] is True

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": f"recon-void-xfer-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text

    dest = _pick_vaccine_dose(await _doses(client, h, shed_id=shed_b), vax["id"])
    assert dest["eligible_count"] == 1
    assert dest["completed_count"] == 0
    assert _remaining(dest) == 1
    assert not str(dest["status"]).startswith("completed")

    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=h)
    assert profile.status_code == 200
    # Voided events must not appear as active individual history (or must be marked void).
    active = [
        e
        for e in profile.json().get("individual_vaccinations", [])
        if e["id"] == event_id and not e.get("is_void", False)
    ]
    assert active == []


@pytest.mark.asyncio
async def test_bulk_null_bird_id_does_not_invent_dest_coverage(client: AsyncClient) -> None:
    """Flock-level bulk record without bird_id must not credit the transferred bird."""
    owner = await _owner(client, f"recon-bulk-{uuid4().hex[:8]}@ex.com", "Recon Bulk")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"BA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"BB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=16)
    vax = await _vaccine(client, h, name=f"IBD-B-{uuid4().hex[:4]}", target_age_days=5)

    keep = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"BK-{uuid4().hex[:5].upper()}"
    )
    move = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"BM-{uuid4().hex[:5].upper()}"
    )
    flock_a = keep["flock_id"]
    await _generate(client, h, flock_a)
    dose = _pick_vaccine_dose(await _doses(client, h, flock_id=flock_a), vax["id"])
    # Bulk coverage for both birds — no bird_id on the event.
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose["id"],
            "birds_covered": 2,
            "administration_date": (hatch + timedelta(days=5)).isoformat(),
            "idempotency_key": f"recon-bulk-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text
    assert rec.json().get("bird_id") in (None, "")

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [move["id"]],
            "idempotency_key": f"recon-bulk-xfer-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text

    dest = _pick_vaccine_dose(await _doses(client, h, shed_id=shed_b), vax["id"])
    assert dest["eligible_count"] == 1
    assert dest["completed_count"] == 0
    assert _remaining(dest) == 1

    profile = await client.get(f"/api/v1/birds/{move['id']}/profile", headers=h)
    assert profile.status_code == 200
    assert profile.json().get("individual_vaccinations") == []


@pytest.mark.asyncio
async def test_dose_number_two_credited_via_scheduled_dose_id(client: AsyncClient) -> None:
    """Events linked to dose_number=2 must not credit dose_number=1 after transfer."""
    owner = await _owner(client, f"recon-dn-{uuid4().hex[:8]}@ex.com", "Recon DoseNum")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"NA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"NB{uuid4().hex[:4].upper()}")
    hatch = date.today() - timedelta(days=40)
    vax = await client.post(
        "/api/v1/vaccines",
        headers=h,
        json={
            "name": f"ND-2x-{uuid4().hex[:4]}",
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": 7,
                    "grace_period_days": 0,
                    "reminder_lead_days": 0,
                },
                {
                    "dose_number": 2,
                    "target_age_days": 21,
                    "grace_period_days": 0,
                    "reminder_lead_days": 0,
                },
            ],
        },
    )
    assert vax.status_code == 201, vax.text
    vid = vax.json()["id"]

    bird = await _register(
        client, h, shed_id=shed_a, hatch=hatch, band=f"NN-{uuid4().hex[:5].upper()}"
    )
    await _generate(client, h, bird["flock_id"])
    rows = [
        d
        for d in await _doses(client, h, flock_id=bird["flock_id"])
        if d["vaccine_definition_id"] == vid and d.get("is_active", True)
    ]
    by_num = {int(d["dose_number"]): d for d in rows}
    assert 1 in by_num and 2 in by_num

    # Only dose 2 administered to this bird.
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": by_num[2]["id"],
            "bird_id": bird["id"],
            "birds_covered": 1,
            "administration_date": (hatch + timedelta(days=21)).isoformat(),
            "idempotency_key": f"recon-dn2-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": f"recon-dn-xfer-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text

    dest_rows = [
        d
        for d in await _doses(client, h, shed_id=shed_b)
        if d["vaccine_definition_id"] == vid and d.get("is_active", True)
    ]
    dest_by_num = {int(d["dose_number"]): d for d in dest_rows}
    assert dest_by_num[1]["completed_count"] == 0
    assert _remaining(dest_by_num[1]) == 1
    assert dest_by_num[2]["completed_count"] == 1
    assert _remaining(dest_by_num[2]) == 0
    assert str(dest_by_num[2]["status"]).startswith("completed")
