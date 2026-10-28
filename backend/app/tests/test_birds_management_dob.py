"""DOB rules, band-from-unbanded conversion, and population integrity."""

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
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"}
    )
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        }
    }


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _flock_unbanded(
    client: AsyncClient,
    headers: dict,
    shed_id: str,
    code: str,
    *,
    unbanded: int,
    dob_confidence: str = "estimated",
    estimated_age_days: int | None = 7,
    hatch_date: str | None = None,
) -> dict:
    body: dict = {
        "shed_id": shed_id,
        "batch_code": code,
        "initial_count": unbanded,
        "tracking_mode": "batch",
        "dob_confidence": dob_confidence,
        "unbanded_count": unbanded,
    }
    if estimated_age_days is not None:
        body["estimated_age_days"] = estimated_age_days
        body["age_reported_on"] = date.today().isoformat()
    if hatch_date:
        body["hatch_date"] = hatch_date
    r = await client.post("/api/v1/flocks", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_banded_registration_requires_dob(client: AsyncClient) -> None:
    owner = await _owner(client, f"dob-{uuid4().hex[:8]}@ex.com", "DOB Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"D{uuid4().hex[:4].upper()}")
    # Individual flock with no age metadata and zero unbanded
    flock = await client.post(
        "/api/v1/flocks",
        headers=h,
        json={
            "shed_id": shed,
            "batch_code": f"I-{uuid4().hex[:4].upper()}",
            "initial_count": 0,
            "tracking_mode": "individual",
            "dob_confidence": "unknown",
            "unbanded_count": 0,
        },
    )
    assert flock.status_code == 201, flock.text
    fid = flock.json()["id"]

    missing = await client.post(
        "/api/v1/birds",
        headers=h,
        json={"flock_id": fid, "band_id": f"NODOB-{uuid4().hex[:4]}", "dob_confidence": "unknown"},
    )
    assert missing.status_code in (400, 422), missing.text

    estimated = await client.post(
        "/api/v1/birds",
        headers=h,
        json={
            "flock_id": fid,
            "band_id": f"EST-{uuid4().hex[:4]}",
            "dob_confidence": "estimated",
            "estimated_age_days": 14,
            "age_reported_on": date.today().isoformat(),
        },
    )
    assert estimated.status_code in (400, 422), estimated.text

    future = (date.today() + timedelta(days=3)).isoformat()
    fut = await client.post(
        "/api/v1/birds",
        headers=h,
        json={
            "flock_id": fid,
            "band_id": f"FUT-{uuid4().hex[:4]}",
            "dob_confidence": "exact",
            "hatch_date": future,
        },
    )
    assert fut.status_code == 422 or fut.status_code == 400

    ok = await client.post(
        "/api/v1/birds",
        headers=h,
        json={
            "flock_id": fid,
            "band_id": f"OK-{uuid4().hex[:4]}",
            "dob_confidence": "exact",
            "hatch_date": (date.today() - timedelta(days=10)).isoformat(),
        },
    )
    assert ok.status_code == 201, ok.text


@pytest.mark.asyncio
async def test_exact_dob_required_for_banded(client: AsyncClient) -> None:
    owner = await _owner(client, f"est-{uuid4().hex[:8]}@ex.com", "Est Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"E{uuid4().hex[:4].upper()}")
    flock = await _flock_unbanded(client, h, shed, f"EG-{uuid4().hex[:4].upper()}", unbanded=5)

    est = await client.post(
        "/api/v1/birds",
        headers=h,
        json={
            "flock_id": flock["id"],
            "band_id": f"EST-{uuid4().hex[:4]}",
            "dob_confidence": "estimated",
            "estimated_age_days": 14,
            "age_reported_on": date.today().isoformat(),
        },
    )
    assert est.status_code in (400, 422), est.text

    exact_day = (date.today() - timedelta(days=21)).isoformat()
    exact = await client.post(
        "/api/v1/birds",
        headers=h,
        json={
            "flock_id": flock["id"],
            "band_id": f"EX-{uuid4().hex[:4]}",
            "dob_confidence": "exact",
            "hatch_date": exact_day,
        },
    )
    assert exact.status_code == 201, exact.text
    assert exact.json()["hatch_date"] == exact_day
    # Direct registration does not convert unbanded headcount.
    after = await client.get(f"/api/v1/flocks/{flock['id']}", headers=h)
    assert after.json()["unbanded_count"] == 5
    assert after.json()["banded_count"] == 1
    assert after.json()["current_count"] == 6


@pytest.mark.asyncio
async def test_band_from_unbanded_conversion(client: AsyncClient) -> None:
    owner = await _owner(client, f"bfu-{uuid4().hex[:8]}@ex.com", "BFU Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"B{uuid4().hex[:4].upper()}")
    flock = await _flock_unbanded(client, h, shed, f"BG-{uuid4().hex[:4].upper()}", unbanded=10)
    before = flock["current_count"]
    key = f"bfu-{uuid4().hex}"
    band = f"CNV-{uuid4().hex[:5].upper()}"

    r1 = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock["id"], "band_id": band, "idempotency_key": key},
    )
    assert r1.status_code == 201, r1.text
    body = r1.json()
    assert body["idempotent_replay"] is False
    assert body["bird"]["band_id"] == band
    assert body["bird"]["is_active"] is True
    assert body["flock_unbanded_count"] == 9
    assert body["flock_banded_count"] == 1
    assert body["flock_current_count"] == before  # population unchanged

    r2 = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock["id"], "band_id": band, "idempotency_key": key},
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["idempotent_replay"] is True
    assert r2.json()["bird"]["id"] == body["bird"]["id"]
    assert r2.json()["flock_unbanded_count"] == 9

    zero = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={
            "flock_id": flock["id"],
            "band_id": f"DUP-{uuid4().hex[:4]}",
            "idempotency_key": f"bfu-z-{uuid4().hex}",
        },
    )
    # still has 9 unbanded — should succeed; drain to zero then fail
    for i in range(9):
        await client.post(
            "/api/v1/birds/band-from-unbanded",
            headers=h,
            json={
                "flock_id": flock["id"],
                "band_id": f"X{i}-{uuid4().hex[:4]}",
                "idempotency_key": f"bfu-d-{uuid4().hex}",
            },
        )
    empty = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={
            "flock_id": flock["id"],
            "band_id": f"EMPTY-{uuid4().hex[:4]}",
            "idempotency_key": f"bfu-e-{uuid4().hex}",
        },
    )
    assert empty.status_code == 400, empty.text

    # duplicate band — distinct estimated age key (P5 active-cohort uniqueness)
    flock2 = await _flock_unbanded(
        client,
        h,
        shed,
        f"BG2-{uuid4().hex[:4].upper()}",
        unbanded=2,
        estimated_age_days=14,
    )
    dup = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={
            "flock_id": flock2["id"],
            "band_id": band,
            "idempotency_key": f"bfu-dup-{uuid4().hex}",
        },
    )
    assert dup.status_code == 400, dup.text
    assert zero.status_code in (201, 400)


@pytest.mark.asyncio
async def test_unbanded_cohort_with_unknown_age_allowed(client: AsyncClient) -> None:
    owner = await _owner(client, f"unk-{uuid4().hex[:8]}@ex.com", "Unk Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"U{uuid4().hex[:4].upper()}")
    flock = await client.post(
        "/api/v1/flocks",
        headers=h,
        json={
            "shed_id": shed,
            "batch_code": f"UNK-{uuid4().hex[:4].upper()}",
            "initial_count": 20,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
            "unbanded_count": 20,
        },
    )
    assert flock.status_code == 201, flock.text
    # Documented exception: Unknown is allowed for unbanded cohorts.
    assert flock.json()["dob_confidence"] == "unknown"
    assert flock.json()["unbanded_count"] == 20
