"""Shed-to-shed transfer + add_unbanded count integrity."""

from __future__ import annotations

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


async def _flock(
    client: AsyncClient,
    headers: dict,
    shed_id: str,
    code: str,
    *,
    unbanded: int,
    mode: str = "mixed",
) -> dict:
    r = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": unbanded,
            "tracking_mode": mode,
            "dob_confidence": "unknown",
            "unbanded_count": unbanded if mode != "individual" else 0,
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
            "hatch_date": date.today().isoformat(),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _band_from_unbanded(
    client: AsyncClient, headers: dict, flock_id: str, band: str
) -> dict:
    r = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=headers,
        json={
            "flock_id": flock_id,
            "band_id": band,
            "idempotency_key": f"bfu-{uuid4().hex}",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["bird"]


@pytest.mark.asyncio
async def test_add_unbanded_and_banded_counts(client: AsyncClient) -> None:
    owner = await _owner(client, f"xfer-owner-{uuid4().hex[:8]}@ex.com", "Xfer Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"XS{uuid4().hex[:4].upper()}")
    flock = await _flock(client, h, shed, f"G-{uuid4().hex[:4].upper()}", unbanded=0, mode="batch")

    add = await client.patch(
        f"/api/v1/flocks/{flock['id']}",
        headers=h,
        json={"add_unbanded": 20},
    )
    assert add.status_code == 200, add.text
    assert add.json()["unbanded_count"] == 20
    assert add.json()["current_count"] == 20
    assert add.json()["banded_count"] == 0

    # Direct registration adds banded without consuming unbanded.
    b1 = await _bird(client, h, flock["id"], f"B1-{uuid4().hex[:5].upper()}")
    b2 = await _bird(client, h, flock["id"], f"B2-{uuid4().hex[:5].upper()}")
    assert b1["is_active"] and b2["is_active"]

    after = await client.get(f"/api/v1/flocks/{flock['id']}", headers=h)
    assert after.status_code == 200
    body = after.json()
    assert body["tracking_mode"] == "mixed"
    assert body["banded_count"] == 2
    assert body["unbanded_count"] == 20
    assert body["current_count"] == 22
    assert body["banded_count"] + body["unbanded_count"] == body["current_count"]

    # Conversion is the only path that reduces unbanded while adding banded.
    await _band_from_unbanded(client, h, flock["id"], f"C1-{uuid4().hex[:5].upper()}")
    after_cnv = (await client.get(f"/api/v1/flocks/{flock['id']}", headers=h)).json()
    assert after_cnv["banded_count"] == 3
    assert after_cnv["unbanded_count"] == 19
    assert after_cnv["current_count"] == 22


@pytest.mark.asyncio
async def test_band_correction_same_bird(client: AsyncClient) -> None:
    owner = await _owner(client, f"band-fix-{uuid4().hex[:8]}@ex.com", "Band Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"BF{uuid4().hex[:4].upper()}")
    flock = await _flock(client, h, shed, f"BFG-{uuid4().hex[:4].upper()}", unbanded=5)
    bird = await _bird(client, h, flock["id"], f"OLD-{uuid4().hex[:5].upper()}")
    new_band = f"NEW-{uuid4().hex[:5].upper()}"
    upd = await client.patch(
        f"/api/v1/birds/{bird['id']}",
        headers=h,
        json={"band_id": new_band},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["id"] == bird["id"]
    assert upd.json()["band_id"] == new_band
    assert upd.json()["is_active"] is True


@pytest.mark.asyncio
async def test_banded_and_unbanded_shed_transfer(client: AsyncClient) -> None:
    owner = await _owner(client, f"move-owner-{uuid4().hex[:8]}@ex.com", "Move Org")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"MA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"MB{uuid4().hex[:4].upper()}")
    src = await _flock(client, h, shed_a, f"SRC-{uuid4().hex[:4].upper()}", unbanded=10)
    dest = await _flock(client, h, shed_b, f"DST-{uuid4().hex[:4].upper()}", unbanded=0)
    bird = await _band_from_unbanded(client, h, src["id"], f"MV-{uuid4().hex[:5].upper()}")

    src_before = (await client.get(f"/api/v1/flocks/{src['id']}", headers=h)).json()
    # Conversion: banded=1 unbanded=9 current=10
    assert src_before["banded_count"] == 1
    assert src_before["unbanded_count"] == 9
    assert src_before["current_count"] == 10

    key = f"idem-xfer-{uuid4().hex}"
    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": key,
        },
    )
    assert xfer.status_code == 201, xfer.text
    assert xfer.json()["moved"] == 1
    assert xfer.json()["idempotent_replay"] is False

    # Retry must not move twice
    retry = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": key,
        },
    )
    assert retry.status_code == 201, retry.text
    assert retry.json()["idempotent_replay"] is True
    assert retry.json()["bird_ids"] == [bird["id"]]
    assert retry.json()["moved"] == 1
    assert retry.json()["destination_flock_id"] == dest["id"]

    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=h)
    assert profile.status_code == 200
    p = profile.json()
    assert p["shed_id"] == shed_b
    assert p["flock_id"] == dest["id"]
    assert p["is_active"] is True
    assert p["lifecycle_status"] == "active"
    assert p["band_id"] == bird["band_id"]

    src_after = (await client.get(f"/api/v1/flocks/{src['id']}", headers=h)).json()
    dest_after = (await client.get(f"/api/v1/flocks/{dest['id']}", headers=h)).json()
    assert src_after["banded_count"] == 0
    assert src_after["unbanded_count"] == 9
    assert src_after["current_count"] == 9
    assert dest_after["banded_count"] == 1
    assert dest_after["current_count"] == 1

    # Unbanded count transfer
    key2 = f"idem-unb-{uuid4().hex}"
    unb = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": date.today().isoformat(),
            "source_flock_id": src["id"],
            "quantity": 3,
            "idempotency_key": key2,
        },
    )
    assert unb.status_code == 201, unb.text
    assert unb.json()["moved"] == 3

    retry_unb = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": date.today().isoformat(),
            "source_flock_id": src["id"],
            "quantity": 3,
            "idempotency_key": key2,
        },
    )
    assert retry_unb.json()["idempotent_replay"] is True

    src_final = (await client.get(f"/api/v1/flocks/{src['id']}", headers=h)).json()
    dest_final = (await client.get(f"/api/v1/flocks/{dest['id']}", headers=h)).json()
    assert src_final["unbanded_count"] == 6
    assert src_final["current_count"] == 6
    assert dest_final["unbanded_count"] == 3
    assert dest_final["banded_count"] == 1
    assert dest_final["current_count"] == 4


@pytest.mark.asyncio
async def test_mortality_banded_and_unbanded(client: AsyncClient) -> None:
    owner = await _owner(client, f"mort-{uuid4().hex[:8]}@ex.com", "Mort Org")
    h = owner["headers"]
    shed = await _shed(client, h, f"MO{uuid4().hex[:4].upper()}")
    flock = await _flock(client, h, shed, f"MG-{uuid4().hex[:4].upper()}", unbanded=5)
    bird = await _bird(client, h, flock["id"], f"MD-{uuid4().hex[:5].upper()}")

    mort = await client.post(
        "/api/v1/lifecycle-events",
        headers=h,
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": bird["id"],
            "quantity": 1,
            "idempotency_key": f"mort-b-{uuid4().hex}",
        },
    )
    assert mort.status_code == 201, mort.text
    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=h)
    assert profile.json()["lifecycle_status"] == "dead"
    assert profile.json()["is_active"] is False

    count_mort = await client.post(
        "/api/v1/lifecycle-events",
        headers=h,
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "flock_id": flock["id"],
            "quantity": 2,
            "idempotency_key": f"mort-u-{uuid4().hex}",
        },
    )
    assert count_mort.status_code == 201, count_mort.text
    after = (await client.get(f"/api/v1/flocks/{flock['id']}", headers=h)).json()
    # Started 5 unbanded; direct banded add → unbanded 5 banded 1 current 6;
    # bird mortality → banded 0 unbanded 5 current 5; count mort 2 → unbanded 3 current 3
    assert after["unbanded_count"] == 3
    assert after["banded_count"] == 0
    assert after["current_count"] == 3


@pytest.mark.asyncio
async def test_vaccines_unmounted_outside_test_is_n_a_here(client: AsyncClient) -> None:
    """In pytest ENVIRONMENT=test, vaccine routes are remounted for legacy coverage."""
    owner = await _owner(client, f"vax-check-{uuid4().hex[:8]}@ex.com", "Vax Check")
    r = await client.get("/api/v1/vaccines", headers=owner["headers"])
    # Test env remounts vaccines — expect authz success or empty list, not 404
    assert r.status_code in (200, 403), r.text
