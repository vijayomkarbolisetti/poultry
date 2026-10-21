"""Shed-scoped bird list, update, lifecycle from shed management flows."""

from datetime import date

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


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _mixed_flock(client: AsyncClient, headers: dict, shed_id: str, code: str, unbanded: int = 10) -> dict:
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": unbanded,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 20,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": unbanded,
            "breed": "Layer",
        },
    )
    assert flock.status_code == 201, flock.text
    return flock.json()


async def _bird(client: AsyncClient, headers: dict, flock_id: str, band: str) -> dict:
    r = await client.post(
        "/api/v1/birds",
        headers=headers,
        json={"flock_id": flock_id, "band_id": band, "dob_confidence": "exact", "hatch_date": "2026-01-15", "sex": "F"},
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_shed_bird_list_filter_pagination_and_unbanded(client: AsyncClient) -> None:
    a = await _owner(client, "shed-birds-list@example.com", "List Farm")
    sid = await _shed(client, a["headers"], "SBL1")
    other = await _shed(client, a["headers"], "SBL2")
    f1 = await _mixed_flock(client, a["headers"], sid, "BX-A", 8)
    f2 = await _mixed_flock(client, a["headers"], sid, "BX-B", 5)
    f_other = await _mixed_flock(client, a["headers"], other, "BX-X", 3)

    for band in ("SB-01", "SB-02", "SB-10", "OTHER-1"):
        flock_id = f_other["id"] if band.startswith("OTHER") else (f1["id"] if band != "SB-10" else f2["id"])
        await _bird(client, a["headers"], flock_id, band)

    listed = await client.get(
        "/api/v1/birds/in-shed",
        headers=a["headers"],
        params={"shed_id": sid, "limit": 2, "offset": 0},
    )
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert body["unbanded_total"] >= 1
    assert all(i["shed_id"] == sid for i in body["items"])
    assert "OTHER-1" not in [i["band_id"] for i in body["items"]]

    page2 = await client.get(
        "/api/v1/birds/in-shed",
        headers=a["headers"],
        params={"shed_id": sid, "limit": 2, "offset": 2},
    )
    assert page2.json()["total"] == 3
    assert len(page2.json()["items"]) == 1

    filtered = await client.get(
        "/api/v1/birds/in-shed",
        headers=a["headers"],
        params={"shed_id": sid, "flock_id": f2["id"]},
    )
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["band_id"] == "SB-10"

    q = await client.get(
        "/api/v1/birds/in-shed",
        headers=a["headers"],
        params={"shed_id": sid, "q": "SB-0"},
    )
    assert q.json()["total"] == 2

    wrong_flock = await client.get(
        "/api/v1/birds/in-shed",
        headers=a["headers"],
        params={"shed_id": sid, "flock_id": f_other["id"]},
    )
    assert wrong_flock.status_code == 400


@pytest.mark.asyncio
async def test_add_bird_duplicate_and_batch_promotes_to_mixed(client: AsyncClient) -> None:
    a = await _owner(client, "shed-birds-add@example.com", "Add Farm")
    sid = await _shed(client, a["headers"], "SBA1")
    batch = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid,
            "batch_code": "PURE",
            "initial_count": 12,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
            "unbanded_count": 12,
        },
    )
    assert batch.status_code == 201
    fid = batch.json()["id"]

    created = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": fid, "band_id": "ADD-1", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert created.status_code == 201, created.text

    flock = await client.get(f"/api/v1/flocks/{fid}", headers=a["headers"])
    assert flock.json()["tracking_mode"] == "mixed"

    dup = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": fid, "band_id": "ADD-1", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert dup.status_code == 400
    assert "Band" in dup.json()["detail"]

    listed = await client.get(
        "/api/v1/birds/in-shed", headers=a["headers"], params={"shed_id": sid}
    )
    assert listed.json()["total"] == 1


@pytest.mark.asyncio
async def test_update_bird_fields_and_duplicate_band(client: AsyncClient) -> None:
    a = await _owner(client, "shed-birds-edit@example.com", "Edit Farm")
    sid = await _shed(client, a["headers"], "SBE1")
    flock = await _mixed_flock(client, a["headers"], sid, "ED1")
    b1 = await _bird(client, a["headers"], flock["id"], "EDIT-A")
    await _bird(client, a["headers"], flock["id"], "EDIT-B")

    ok = await client.patch(
        f"/api/v1/birds/{b1['id']}",
        headers=a["headers"],
        json={"breed": "Rhode Island", "sex": "F", "notes": "updated"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["breed"] == "Rhode Island"
    assert ok.json()["notes"] == "updated"
    assert ok.json()["band_id"] == "EDIT-A"
    assert ok.json()["flock_id"] == flock["id"]

    rename = await client.patch(
        f"/api/v1/birds/{b1['id']}",
        headers=a["headers"],
        json={"band_id": "EDIT-A2"},
    )
    assert rename.status_code == 200
    assert rename.json()["band_id"] == "EDIT-A2"

    clash = await client.patch(
        f"/api/v1/birds/{b1['id']}",
        headers=a["headers"],
        json={"band_id": "EDIT-B"},
    )
    assert clash.status_code == 400


@pytest.mark.asyncio
async def test_lifecycle_preserves_history_and_updates_counts(client: AsyncClient) -> None:
    a = await _owner(client, "shed-birds-life@example.com", "Life Farm")
    sid = await _shed(client, a["headers"], "SBLF")
    flock = await _mixed_flock(client, a["headers"], sid, "LF1", unbanded=5)
    bird = await _bird(client, a["headers"], flock["id"], "LIFE-1")

    before = await client.get(f"/api/v1/flocks/{flock['id']}", headers=a["headers"])
    before_count = before.json()["current_count"]

    life = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": bird["id"],
            "quantity": 1,
            "reason": "Test mortality",
            "idempotency_key": f"mort-{bird['id']}",
        },
    )
    assert life.status_code == 201, life.text

    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=a["headers"])
    assert profile.status_code == 200
    assert profile.json()["lifecycle_status"] == "dead"
    assert profile.json()["is_active"] is False
    assert any(e["event_type"] == "mortality" for e in profile.json()["lifecycle_events"])

    after = await client.get(f"/api/v1/flocks/{flock['id']}", headers=a["headers"])
    assert after.json()["current_count"] == before_count - 1

    # Idempotent replay
    replay = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": bird["id"],
            "quantity": 1,
            "idempotency_key": f"mort-{bird['id']}",
        },
    )
    assert replay.status_code == 201
    after2 = await client.get(f"/api/v1/flocks/{flock['id']}", headers=a["headers"])
    assert after2.json()["current_count"] == after.json()["current_count"]

    active_list = await client.get(
        "/api/v1/birds/in-shed", headers=a["headers"], params={"shed_id": sid}
    )
    assert active_list.json()["total"] == 0

    inactive_list = await client.get(
        "/api/v1/birds/in-shed",
        headers=a["headers"],
        params={"shed_id": sid, "include_inactive": True, "lifecycle_status": "dead"},
    )
    assert inactive_list.json()["total"] == 1


@pytest.mark.asyncio
async def test_farmer_and_cross_org_access(client: AsyncClient) -> None:
    a = await _owner(client, "shed-birds-auth-a@example.com", "Auth A")
    b = await _owner(client, "shed-birds-auth-b@example.com", "Auth B")
    sid_a = await _shed(client, a["headers"], "AA1")
    sid_b = await _shed(client, b["headers"], "BB1")
    fa = await _mixed_flock(client, a["headers"], sid_a, "AAF")
    fb = await _mixed_flock(client, b["headers"], sid_b, "BBF")
    bird_a = await _bird(client, a["headers"], fa["id"], "AUTH-A")
    bird_b = await _bird(client, b["headers"], fb["id"], "AUTH-B")

    cross_list = await client.get(
        "/api/v1/birds/in-shed", headers=a["headers"], params={"shed_id": sid_b}
    )
    assert cross_list.status_code in (403, 404)

    cross_patch = await client.patch(
        f"/api/v1/birds/{bird_b['id']}",
        headers=a["headers"],
        json={"notes": "nope"},
    )
    assert cross_patch.status_code in (403, 404)

    farmer = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "shed-birds-farmer@example.com",
            "password": "password123",
            "full_name": "Farmer",
            "role": "farmer",
            "permission_codes": ["bird.view", "bird.create", "bird.update", "lifecycle.record", "shed.view"],
            "shed_ids": [sid_a],
        },
    )
    assert farmer.status_code == 201, farmer.text
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "shed-birds-farmer@example.com", "password": "password123"},
    )
    fh = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": a["owner_id"],
    }

    ok = await client.get("/api/v1/birds/in-shed", headers=fh, params={"shed_id": sid_a})
    assert ok.status_code == 200
    assert ok.json()["total"] == 1

    # Second shed in same org without assignment
    sid_a2 = await _shed(client, a["headers"], "AA2")
    denied = await client.get("/api/v1/birds/in-shed", headers=fh, params={"shed_id": sid_a2})
    assert denied.status_code in (403, 404)

    patch_ok = await client.patch(
        f"/api/v1/birds/{bird_a['id']}", headers=fh, json={"notes": "farmer note"}
    )
    assert patch_ok.status_code == 200


@pytest.mark.asyncio
async def test_inactive_shed_blocks_create(client: AsyncClient) -> None:
    a = await _owner(client, "shed-birds-inactive@example.com", "Inactive Farm")
    sid = await _shed(client, a["headers"], "IN1")
    flock = await _mixed_flock(client, a["headers"], sid, "INB")
    deact = await client.post(f"/api/v1/sheds/{sid}/deactivate", headers=a["headers"])
    assert deact.status_code == 200

    created = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": flock["id"], "band_id": "BLOCKED", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert created.status_code == 400
    assert "inactive" in created.json()["detail"].lower()

    # List still readable
    listed = await client.get(
        "/api/v1/birds/in-shed", headers=a["headers"], params={"shed_id": sid}
    )
    assert listed.status_code == 200
