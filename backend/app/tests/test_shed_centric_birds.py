"""Shed-centric registration: auto cohort flocks, exact DOB, count integrity."""

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


@pytest.mark.asyncio
async def test_register_banded_in_empty_shed(client: AsyncClient) -> None:
    owner = await _owner(client, f"sc-band-{uuid4().hex[:8]}@ex.com", "SC Band")
    h = owner["headers"]
    shed = await _shed(client, h, f"SB{uuid4().hex[:4].upper()}")
    hatch = (date.today() - timedelta(days=12)).isoformat()
    band = f"RB-{uuid4().hex[:5].upper()}"

    missing = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed, "band_id": band},
    )
    assert missing.status_code == 422

    future = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={
            "shed_id": shed,
            "band_id": band,
            "hatch_date": (date.today() + timedelta(days=2)).isoformat(),
        },
    )
    assert future.status_code == 422

    ok = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed, "band_id": band, "hatch_date": hatch},
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["band_id"] == band
    assert ok.json()["hatch_date"] == hatch
    assert ok.json()["dob_confidence"] == "exact"
    assert ok.json()["shed_id"] == shed

    listed = await client.get(
        "/api/v1/birds/in-shed",
        headers=h,
        params={"shed_id": shed},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    assert listed.json()["unbanded_total"] == 0

    overview = await client.get(f"/api/v1/sheds/{shed}/overview", headers=h)
    assert overview.status_code == 200
    pop = overview.json()["population"]
    assert pop["banded_birds"] == 1
    assert pop["unbanded_birds"] == 0
    assert pop["total_live_birds"] == 1


@pytest.mark.asyncio
async def test_add_unbanded_in_shed_reuses_dob_cohort(client: AsyncClient) -> None:
    owner = await _owner(client, f"sc-ub-{uuid4().hex[:8]}@ex.com", "SC Unbanded")
    h = owner["headers"]
    shed = await _shed(client, h, f"SU{uuid4().hex[:4].upper()}")
    hatch = (date.today() - timedelta(days=5)).isoformat()
    key = f"ub-{uuid4().hex}"

    first = await client.post(
        "/api/v1/birds/add-unbanded-in-shed",
        headers=h,
        json={"shed_id": shed, "quantity": 25, "hatch_date": hatch, "idempotency_key": key},
    )
    assert first.status_code == 201, first.text
    assert first.json()["created_cohort"] is True
    assert first.json()["quantity_added"] == 25
    assert first.json()["flock"]["unbanded_count"] == 25
    assert first.json()["flock"]["hatch_date"] == hatch
    flock_id = first.json()["flock"]["id"]

    replay = await client.post(
        "/api/v1/birds/add-unbanded-in-shed",
        headers=h,
        json={"shed_id": shed, "quantity": 25, "hatch_date": hatch, "idempotency_key": key},
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["idempotent_replay"] is True
    assert replay.json()["flock"]["unbanded_count"] == 25

    second = await client.post(
        "/api/v1/birds/add-unbanded-in-shed",
        headers=h,
        json={
            "shed_id": shed,
            "quantity": 10,
            "hatch_date": hatch,
            "idempotency_key": f"ub2-{uuid4().hex}",
        },
    )
    assert second.status_code == 201, second.text
    assert second.json()["created_cohort"] is False
    assert second.json()["flock"]["id"] == flock_id
    assert second.json()["flock"]["unbanded_count"] == 35

    other_dob = (date.today() - timedelta(days=40)).isoformat()
    third = await client.post(
        "/api/v1/birds/add-unbanded-in-shed",
        headers=h,
        json={
            "shed_id": shed,
            "quantity": 7,
            "hatch_date": other_dob,
            "idempotency_key": f"ub3-{uuid4().hex}",
        },
    )
    assert third.status_code == 201, third.text
    assert third.json()["created_cohort"] is True
    assert third.json()["flock"]["id"] != flock_id

    overview = await client.get(f"/api/v1/sheds/{shed}/overview", headers=h)
    pop = overview.json()["population"]
    assert pop["unbanded_birds"] == 42
    assert pop["total_live_birds"] == 42


@pytest.mark.asyncio
async def test_direct_register_does_not_consume_unbanded(client: AsyncClient) -> None:
    owner = await _owner(client, f"sc-mix-{uuid4().hex[:8]}@ex.com", "SC Mix")
    h = owner["headers"]
    shed = await _shed(client, h, f"SM{uuid4().hex[:4].upper()}")
    hatch = (date.today() - timedelta(days=8)).isoformat()

    await client.post(
        "/api/v1/birds/add-unbanded-in-shed",
        headers=h,
        json={
            "shed_id": shed,
            "quantity": 10,
            "hatch_date": hatch,
            "idempotency_key": f"mix-{uuid4().hex}",
        },
    )
    band = f"DR-{uuid4().hex[:5].upper()}"
    reg = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed, "band_id": band, "hatch_date": hatch},
    )
    assert reg.status_code == 201, reg.text

    overview = await client.get(f"/api/v1/sheds/{shed}/overview", headers=h)
    pop = overview.json()["population"]
    assert pop["banded_birds"] == 1
    assert pop["unbanded_birds"] == 10
    assert pop["total_live_birds"] == 11

    key = f"cnv-{uuid4().hex}"
    flocks = await client.get("/api/v1/flocks", headers=h, params={"shed_id": shed})
    flock_id = flocks.json()[0]["id"]
    cnv = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock_id, "band_id": f"CV-{uuid4().hex[:4]}", "idempotency_key": key},
    )
    assert cnv.status_code == 201, cnv.text
    assert cnv.json()["flock_unbanded_count"] == 9
    assert cnv.json()["flock_banded_count"] == 2
    assert cnv.json()["flock_current_count"] == 11

    overview2 = await client.get(f"/api/v1/sheds/{shed}/overview", headers=h)
    pop2 = overview2.json()["population"]
    assert pop2["total_live_birds"] == 11
    assert pop2["banded_birds"] == 2
    assert pop2["unbanded_birds"] == 9


@pytest.mark.asyncio
async def test_concurrent_band_from_unbanded_cannot_oversubscribe(client: AsyncClient) -> None:
    """Parallel conversions must not drive unbanded below zero."""
    import asyncio

    owner = await _owner(client, f"sc-race-{uuid4().hex[:8]}@ex.com", "SC Race")
    h = owner["headers"]
    shed = await _shed(client, h, f"SR{uuid4().hex[:4].upper()}")
    hatch = (date.today() - timedelta(days=3)).isoformat()
    seeded = await client.post(
        "/api/v1/birds/add-unbanded-in-shed",
        headers=h,
        json={
            "shed_id": shed,
            "quantity": 2,
            "hatch_date": hatch,
            "idempotency_key": f"race-seed-{uuid4().hex}",
        },
    )
    assert seeded.status_code == 201, seeded.text
    flock_id = seeded.json()["flock"]["id"]

    async def convert(i: int):
        return await client.post(
            "/api/v1/birds/band-from-unbanded",
            headers=h,
            json={
                "flock_id": flock_id,
                "band_id": f"RACE-{i}-{uuid4().hex[:4]}",
                "idempotency_key": f"race-{i}-{uuid4().hex}",
            },
        )

    # Five parallel attempts against only two unbanded headcount.
    responses = await asyncio.gather(*[convert(i) for i in range(5)])
    successes = [r for r in responses if r.status_code == 201]
    failures = [r for r in responses if r.status_code != 201]
    assert len(successes) == 2, [r.status_code for r in responses]
    assert len(failures) == 3
    for r in failures:
        assert r.status_code == 400
        assert "unbanded" in r.json()["detail"].lower() or "zero" in r.json()["detail"].lower()

    flock = await client.get(f"/api/v1/flocks/{flock_id}", headers=h)
    body = flock.json()
    assert body["unbanded_count"] == 0
    assert body["banded_count"] == 2
    assert body["current_count"] == 2
    assert body["banded_count"] + body["unbanded_count"] == body["current_count"]
