"""Bulk bird lifecycle + batch count-only lifecycle rules."""

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
        },
        "owner_id": owner_id,
        "token": reg.json()["access_token"],
    }


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _mixed(client: AsyncClient, headers: dict, shed_id: str, code: str, unbanded: int = 10) -> dict:
    r = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": unbanded,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
            "unbanded_count": unbanded,
            "breed": "Layer",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _bird(client: AsyncClient, headers: dict, flock_id: str, band: str) -> dict:
    r = await client.post(
        "/api/v1/birds",
        headers=headers,
        json={"flock_id": flock_id, "band_id": band, "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _invite_farmer(
    client: AsyncClient, headers: dict, owner_id: str, email: str, shed_id: str
) -> dict:
    created = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "email": email,
            "password": "password123",
            "full_name": "Bulk Farmer",
            "role": "farmer",
            "shed_ids": [shed_id],
            "permission_codes": [
                "shed.view",
                "flock.view",
                "bird.view",
                "bird.create",
                "lifecycle.record",
            ],
        },
    )
    assert created.status_code == 201, created.text
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "password123"}
    )
    assert login.status_code == 200, login.text
    return {
        "headers": {
            "Authorization": f"Bearer {login.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        }
    }


@pytest.mark.asyncio
async def test_single_and_bulk_lifecycle_preserve_history(client: AsyncClient) -> None:
    a = await _owner(client, "bulk-life-1@example.com", "Bulk Farm 1")
    sid = await _shed(client, a["headers"], "BL1")
    flock = await _mixed(client, a["headers"], sid, "BX-BL1", 12)
    b1 = await _bird(client, a["headers"], flock["id"], "BL-A1")
    b2 = await _bird(client, a["headers"], flock["id"], "BL-A2")
    b3 = await _bird(client, a["headers"], flock["id"], "BL-A3")
    b4 = await _bird(client, a["headers"], flock["id"], "BL-A4")

    single = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": b1["id"],
            "quantity": 1,
            "idempotency_key": f"single-mort-{b1['id']}",
            "reason": "single",
        },
    )
    assert single.status_code == 201, single.text

    # Idempotent single replay (payload must match, including reason)
    again = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": b1["id"],
            "quantity": 1,
            "idempotency_key": f"single-mort-{b1['id']}",
            "reason": "single",
        },
    )
    assert again.status_code == 201
    assert again.json()["id"] == single.json()["id"]

    sale = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b2["id"], b3["id"]],
            "idempotency_key": "bulk-sale-1",
            "reason": "bulk sale",
        },
    )
    assert sale.status_code == 201, sale.text
    body = sale.json()
    assert body["applied"] == 2
    assert body["idempotent_replay"] is False
    assert {i["lifecycle_status"] for i in body["items"]} == {"sold"}

    xfer = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "transfer",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b4["id"]],
            "idempotency_key": "bulk-xfer-1",
        },
    )
    assert xfer.status_code == 201, xfer.text
    assert xfer.json()["items"][0]["lifecycle_status"] == "transferred_out"

    # History preserved on profile
    for bird_id, etype in (
        (b1["id"], "mortality"),
        (b2["id"], "sale"),
        (b4["id"], "transfer"),
    ):
        prof = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=a["headers"])
        assert prof.status_code == 200
        assert prof.json()["is_active"] is False
        assert any(e["event_type"] == etype for e in prof.json()["lifecycle_events"])


@pytest.mark.asyncio
async def test_bulk_all_or_nothing_mixed_eligibility_and_duplicates(client: AsyncClient) -> None:
    a = await _owner(client, "bulk-life-2@example.com", "Bulk Farm 2")
    sid = await _shed(client, a["headers"], "BL2")
    flock = await _mixed(client, a["headers"], sid, "BX-BL2", 8)
    live = await _bird(client, a["headers"], flock["id"], "BL-B1")
    dead = await _bird(client, a["headers"], flock["id"], "BL-B2")
    await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": dead["id"],
            "idempotency_key": f"pre-dead-{dead['id']}",
        },
    )

    mixed = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [live["id"], dead["id"]],
            "idempotency_key": "bulk-mixed-elig",
        },
    )
    assert mixed.status_code == 400
    # Live bird must remain active (all-or-nothing)
    prof = await client.get(f"/api/v1/birds/{live['id']}/profile", headers=a["headers"])
    assert prof.json()["lifecycle_status"] == "active"

    dup = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [live["id"], live["id"]],
            "idempotency_key": "bulk-dup-ids",
        },
    )
    assert dup.status_code == 400


@pytest.mark.asyncio
async def test_bulk_lost_response_retry_no_duplicate_events(client: AsyncClient) -> None:
    """Simulate committed request + lost client response, then identical retry."""
    a = await _owner(client, "bulk-life-lost@example.com", "Bulk Lost Farm")
    sid = await _shed(client, a["headers"], "BLL")
    flock = await _mixed(client, a["headers"], sid, "BX-BLL", 6)
    b1 = await _bird(client, a["headers"], flock["id"], "BL-L1")
    b2 = await _bird(client, a["headers"], flock["id"], "BL-L2")
    b3 = await _bird(client, a["headers"], flock["id"], "BL-L3")

    payload = {
        "event_type": "sale",
        "effective_date": date.today().isoformat(),
        "bird_ids": [b1["id"], b2["id"]],
        "idempotency_key": "lost-resp-sale-1",
        "reason": "lost-response simulation",
    }

    first = await client.post("/api/v1/lifecycle-events/bulk", headers=a["headers"], json=payload)
    assert first.status_code == 201, first.text
    # Client never persisted first.json() — only the idempotency key + payload (lost response).
    first_items = {i["bird_id"]: i["event_id"] for i in first.json()["items"]}

    async def event_count(bird_id: str) -> int:
        prof = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=a["headers"])
        assert prof.status_code == 200
        return len([e for e in prof.json()["lifecycle_events"] if e["event_type"] == "sale"])

    c1 = await event_count(b1["id"])
    c2 = await event_count(b2["id"])
    assert c1 == 1 and c2 == 1

    # Identical retry after "lost" response — must not create duplicates.
    retry = await client.post("/api/v1/lifecycle-events/bulk", headers=a["headers"], json=payload)
    assert retry.status_code == 201, retry.text
    body = retry.json()
    assert body["idempotent_replay"] is True
    assert {i["bird_id"]: i["event_id"] for i in body["items"]} == first_items
    assert await event_count(b1["id"]) == 1
    assert await event_count(b2["id"]) == 1

    # Genuine new operation must use a new key and create new events.
    new_payload = {
        **payload,
        "bird_ids": [b3["id"]],
        "idempotency_key": "lost-resp-sale-2-new-op",
    }
    fresh = await client.post("/api/v1/lifecycle-events/bulk", headers=a["headers"], json=new_payload)
    assert fresh.status_code == 201, fresh.text
    assert fresh.json()["idempotent_replay"] is False
    assert await event_count(b3["id"]) == 1
    # Prior birds unchanged
    assert await event_count(b1["id"]) == 1
    assert await event_count(b2["id"]) == 1


@pytest.mark.asyncio
async def test_bulk_idempotent_replay_and_foreign_ids(client: AsyncClient) -> None:
    a = await _owner(client, "bulk-life-3@example.com", "Bulk Farm 3")
    b = await _owner(client, "bulk-life-other@example.com", "Other Org")
    sid = await _shed(client, a["headers"], "BL3")
    other_shed = await _shed(client, b["headers"], "BLO")
    flock = await _mixed(client, a["headers"], sid, "BX-BL3", 5)
    other_flock = await _mixed(client, b["headers"], other_shed, "BX-O", 5)
    b1 = await _bird(client, a["headers"], flock["id"], "BL-C1")
    b2 = await _bird(client, a["headers"], flock["id"], "BL-C2")
    foreign = await _bird(client, b["headers"], other_flock["id"], "FOREIGN-1")

    first = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b1["id"], b2["id"]],
            "idempotency_key": "bulk-replay-key",
        },
    )
    assert first.status_code == 201, first.text
    event_ids = {i["event_id"] for i in first.json()["items"]}

    replay = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b1["id"], b2["id"]],
            "idempotency_key": "bulk-replay-key",
        },
    )
    assert replay.status_code == 201
    assert replay.json()["idempotent_replay"] is True
    assert {i["event_id"] for i in replay.json()["items"]} == event_ids

    cross = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [foreign["id"]],
            "idempotency_key": "bulk-cross-tenant",
        },
    )
    assert cross.status_code == 400
    # Foreign bird unchanged
    other_prof = await client.get(
        f"/api/v1/birds/{foreign['id']}/profile", headers=b["headers"]
    )
    assert other_prof.json()["lifecycle_status"] == "active"

    missing = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [str(uuid4())],
            "idempotency_key": "bulk-missing",
        },
    )
    assert missing.status_code == 400


@pytest.mark.asyncio
async def test_bulk_changed_payload_conflicts(client: AsyncClient) -> None:
    """Same bulk idempotency key with a different payload must 409, not re-apply."""
    a = await _owner(client, f"bulk-life-conflict-{uuid4().hex[:8]}@example.com", "Bulk Conflict")
    sid = await _shed(client, a["headers"], f"BC{uuid4().hex[:4].upper()}")
    flock = await _mixed(client, a["headers"], sid, f"BX-BC-{uuid4().hex[:4].upper()}", 6)
    b1 = await _bird(client, a["headers"], flock["id"], f"BC-1-{uuid4().hex[:4].upper()}")
    b2 = await _bird(client, a["headers"], flock["id"], f"BC-2-{uuid4().hex[:4].upper()}")
    b3 = await _bird(client, a["headers"], flock["id"], f"BC-3-{uuid4().hex[:4].upper()}")
    key = f"bulk-conflict-{uuid4().hex}"

    first = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b1["id"], b2["id"]],
            "idempotency_key": key,
            "reason": "first",
        },
    )
    assert first.status_code == 201, first.text

    type_conflict = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b1["id"], b2["id"]],
            "idempotency_key": key,
            "reason": "first",
        },
    )
    assert type_conflict.status_code == 409, type_conflict.text

    birds_conflict = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_ids": [b3["id"]],
            "idempotency_key": key,
            "reason": "first",
        },
    )
    assert birds_conflict.status_code == 409, birds_conflict.text

    # Unchanged birds must still be dead from the first apply only.
    for bid in (b1["id"], b2["id"]):
        prof = await client.get(f"/api/v1/birds/{bid}/profile", headers=a["headers"])
        assert prof.json()["lifecycle_status"] == "dead"
    live = await client.get(f"/api/v1/birds/{b3['id']}/profile", headers=a["headers"])
    assert live.json()["lifecycle_status"] == "active"


@pytest.mark.asyncio
async def test_batch_count_ops_unbanded_only(client: AsyncClient) -> None:
    a = await _owner(client, "bulk-life-4@example.com", "Bulk Farm 4")
    sid = await _shed(client, a["headers"], "BL4")
    flock = await _mixed(client, a["headers"], sid, "BX-BL4", 6)
    await _bird(client, a["headers"], flock["id"], "BL-D1")  # reduces unbanded

    flock_get = await client.get(f"/api/v1/flocks/{flock['id']}", headers=a["headers"])
    unbanded = flock_get.json()["unbanded_count"]
    assert unbanded >= 1

    over = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "flock_id": flock["id"],
            "quantity": unbanded + 5,
            "idempotency_key": "count-over",
        },
    )
    assert over.status_code == 400

    ok = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "flock_id": flock["id"],
            "quantity": 2,
            "idempotency_key": "count-ok",
            "reason": "unbanded mortality",
        },
    )
    assert ok.status_code == 201, ok.text
    after = await client.get(f"/api/v1/flocks/{flock['id']}", headers=a["headers"])
    assert after.json()["unbanded_count"] == unbanded - 2

    # Individual-tracked batch rejects count-only
    indiv = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid,
            "batch_code": "BX-IND",
            "initial_count": 0,
            "tracking_mode": "individual",
            "dob_confidence": "unknown",
            "unbanded_count": 0,
        },
    )
    assert indiv.status_code == 201
    reject = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "flock_id": indiv.json()["id"],
            "quantity": 1,
            "idempotency_key": "count-indiv",
        },
    )
    assert reject.status_code == 400


@pytest.mark.asyncio
async def test_farmer_bulk_permissions(client: AsyncClient) -> None:
    a = await _owner(client, "bulk-life-5@example.com", "Bulk Farm 5")
    sid = await _shed(client, a["headers"], "BL5")
    other = await _shed(client, a["headers"], "BL5B")
    flock = await _mixed(client, a["headers"], sid, "BX-BL5", 4)
    other_flock = await _mixed(client, a["headers"], other, "BX-BL5O", 4)
    assigned_bird = await _bird(client, a["headers"], flock["id"], "BL-E1")
    other_bird = await _bird(client, a["headers"], other_flock["id"], "BL-E2")
    farmer = await _invite_farmer(
        client, a["headers"], a["owner_id"], "bulk-farmer-5@example.com", sid
    )

    ok = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=farmer["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_ids": [assigned_bird["id"]],
            "idempotency_key": "farmer-bulk-ok",
        },
    )
    assert ok.status_code == 201, ok.text

    denied = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=farmer["headers"],
        json={
            "event_type": "sale",
            "effective_date": date.today().isoformat(),
            "bird_ids": [other_bird["id"]],
            "idempotency_key": "farmer-bulk-deny",
        },
    )
    assert denied.status_code in (400, 403)
