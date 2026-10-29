"""Shed-wide / multi-population vaccination batch confirm."""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _setup(client: AsyncClient) -> dict:
    email = f"batch-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Batch Owner",
            "organization_name": "Batch Farm",
        },
    )
    assert reg.status_code == 201, reg.text
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {reg.json()['access_token']}"},
    )
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    headers = {
        "Authorization": f"Bearer {reg.json()['access_token']}",
        "X-Owner-Account-Id": owner_id,
    }
    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "Batch Shed", "code": f"BS-{uuid4().hex[:4].upper()}"},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    flocks = []
    for code, hatch, count in (
        ("H1", "2026-10-10", 500),
        ("H2", "2026-10-15", 300),
    ):
        flock = await client.post(
            "/api/v1/flocks",
            headers=headers,
            json={
                "shed_id": shed_id,
                "batch_code": code,
                "initial_count": count,
                "tracking_mode": "batch",
                "dob_confidence": "exact",
                "hatch_date": hatch,
            },
        )
        assert flock.status_code == 201, flock.text
        flocks.append(flock.json())

    vax = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": "IBD",
            "category": "vaccine",
            "description": "Infectious bursal disease vaccine",
            "rules": [{"dose_number": 1, "target_age_days": 0, "grace_period_days": 0}],
        },
    )
    assert vax.status_code == 201, vax.text
    def_id = vax.json()["id"]

    dose_ids = []
    for flock in flocks:
        gen = await client.post(
            "/api/v1/vaccines/generate-schedules",
            headers=headers,
            json={"flock_id": flock["id"], "vaccine_definition_ids": [def_id]},
        )
        assert gen.status_code == 200, gen.text
        dose_ids.append(gen.json()[0]["id"])

    return {
        "headers": headers,
        "dose_ids": dose_ids,
        "shed_id": shed_id,
        "flock_ids": [f["id"] for f in flocks],
        "owner_id": owner_id,
    }


@pytest.mark.asyncio
async def test_batch_records_multiple_populations_atomically(client: AsyncClient) -> None:
    f = await _setup(client)
    key = f"batch-{uuid4().hex}"
    res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": key,
            "items": [
                {"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 500},
                {"scheduled_dose_id": f["dose_ids"][1], "birds_covered": 300},
            ],
        },
    )
    assert res.status_code == 201, res.text
    assert len(res.json()) == 2
    assert sum(e["birds_covered"] for e in res.json()) == 800

    # Replay same batch key
    again = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": key,
            "items": [
                {"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 500},
                {"scheduled_dose_id": f["dose_ids"][1], "birds_covered": 300},
            ],
        },
    )
    assert again.status_code == 201
    assert {e["id"] for e in again.json()} == {e["id"] for e in res.json()}

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=f["headers"],
        params={"shed_id": f["shed_id"]},
    )
    assert doses.status_code == 200
    by_id = {d["id"]: d for d in doses.json()}
    assert by_id[f["dose_ids"][0]]["completed_count"] == 500
    assert by_id[f["dose_ids"][1]]["completed_count"] == 300
    assert by_id[f["dose_ids"][0]]["remaining_count"] == 0
    assert by_id[f["dose_ids"][1]]["remaining_count"] == 0
    assert str(by_id[f["dose_ids"][0]]["status"]).startswith("completed")
    assert str(by_id[f["dose_ids"][1]]["status"]).startswith("completed")
    # Shed overview overdue must clear once all open doses for the shed are completed.
    overview = await client.get(f"/api/v1/sheds/{f['shed_id']}/overview", headers=f["headers"])
    assert overview.status_code == 200, overview.text
    assert overview.json()["vaccination"]["overdue"] == 0


@pytest.mark.asyncio
async def test_batch_partial_and_stale_remaining(client: AsyncClient) -> None:
    f = await _setup(client)
    # Partial first population
    first = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": f"batch-partial-{uuid4().hex}",
            "items": [{"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 100}],
        },
    )
    assert first.status_code == 201, first.text

    # Over-request remaining → reject
    stale = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": f"batch-stale-{uuid4().hex}",
            "items": [{"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 500}],
        },
    )
    assert stale.status_code == 400
    assert "remaining" in stale.json()["detail"].lower()


@pytest.mark.asyncio
async def test_batch_persists_product_fields_and_label_media_association(client: AsyncClient) -> None:
    """Phase 5: product fields on batch + animal_media.vaccination_event_id association."""
    f = await _setup(client)
    key = f"batch-fields-{uuid4().hex}"
    res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": key,
            "lot_number": "LOT-99",
            "product_expiry": "2027-06-01",
            "manufacturer_or_brand": "Acme Vax",
            "vaccine_type_or_strain": "IBD-GM97",
            "dose_amount": "1 dose",
            "route": "Drinking water",
            "notes": "AM round",
            "items": [{"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 50}],
        },
    )
    assert res.status_code == 201, res.text
    event = res.json()[0]
    assert event["lot_number"] == "LOT-99"
    assert event["product_expiry"] == "2027-06-01"
    assert event["manufacturer_or_brand"] == "Acme Vax"
    assert event["vaccine_type_or_strain"] == "IBD-GM97"
    assert event["dose_amount"] == "1 dose"
    assert event["route"] == "Drinking water"
    assert event["notes"] == "AM round"

    # Idempotent replay returns the same event (duplicate-submit protection)
    again = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": key,
            "lot_number": "LOT-99",
            "product_expiry": "2027-06-01",
            "manufacturer_or_brand": "Acme Vax",
            "vaccine_type_or_strain": "IBD-GM97",
            "dose_amount": "1 dose",
            "route": "Drinking water",
            "notes": "AM round",
            "items": [{"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 50}],
        },
    )
    assert again.status_code == 201
    assert again.json()[0]["id"] == event["id"]

    # Register label photo metadata linked to the vaccination event (Cloudinary optional)
    media = await client.post(
        "/api/v1/media",
        headers=f["headers"],
        json={
            "public_id": f"poultry/{f['owner_id']}/vaccine-labels/label-1",
            "shed_id": f["shed_id"],
            "flock_id": f["flock_ids"][0],
            "vaccination_event_id": event["id"],
            "version": 1,
            "notes": "Vaccine label photo",
        },
    )
    assert media.status_code == 201, media.text
    body = media.json()
    assert body["vaccination_event_id"] == event["id"]
    assert body["shed_id"] == f["shed_id"]
    assert body["flock_id"] == f["flock_ids"][0]
    assert body["cloudinary_public_id"].endswith("label-1")

    listed = await client.get("/api/v1/media", headers=f["headers"])
    assert listed.status_code == 200
    assert any(m["id"] == body["id"] for m in listed.json())

    filtered = await client.get(
        "/api/v1/media",
        headers=f["headers"],
        params={"vaccination_event_id": event["id"]},
    )
    assert filtered.status_code == 200
    assert len(filtered.json()) == 1
    assert filtered.json()[0]["id"] == body["id"]
    assert filtered.json()[0]["vaccination_event_id"] == event["id"]


@pytest.mark.asyncio
async def test_media_label_isolated_across_tenants(client: AsyncClient) -> None:
    a = await _setup(client)
    b_email = f"other-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": b_email,
            "password": "password123",
            "full_name": "Other Owner",
            "organization_name": "Other Farm",
        },
    )
    assert reg.status_code == 201
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {reg.json()['access_token']}"},
    )
    other_headers = {
        "Authorization": f"Bearer {reg.json()['access_token']}",
        "X-Owner-Account-Id": me.json()["memberships"][0]["owner_account_id"],
    }

    batch = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=a["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": f"iso-{uuid4().hex}",
            "items": [{"scheduled_dose_id": a["dose_ids"][0], "birds_covered": 10}],
        },
    )
    assert batch.status_code == 201
    event_id = batch.json()[0]["id"]

    media = await client.post(
        "/api/v1/media",
        headers=a["headers"],
        json={
            "public_id": "tenant-a/label",
            "shed_id": a["shed_id"],
            "vaccination_event_id": event_id,
        },
    )
    assert media.status_code == 201
    mid = media.json()["id"]

    # Other tenant cannot list or mutate this media
    other_list = await client.get("/api/v1/media", headers=other_headers)
    assert other_list.status_code == 200
    assert all(m["id"] != mid for m in other_list.json())

    other_del = await client.delete(f"/api/v1/media/{mid}", headers=other_headers)
    assert other_del.status_code in (403, 404)


@pytest.mark.asyncio
async def test_batch_reused_key_different_dose_conflicts_not_silent_replay(
    client: AsyncClient,
) -> None:
    """S5CTA Marex bug: same client idempotency key across dose screens must not
    return the prior dose as a successful record for a different scheduled_dose_id.
    """
    f = await _setup(client)
    key = f"reuse-dose-{uuid4().hex}"

    first = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": key,
            "items": [{"scheduled_dose_id": f["dose_ids"][0], "birds_covered": 10}],
        },
    )
    assert first.status_code == 201, first.text
    assert first.json()[0]["scheduled_dose_id"] == f["dose_ids"][0]

    # Same batch key, different dose — must conflict, not silently return dose 0.
    second = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": key,
            "items": [{"scheduled_dose_id": f["dose_ids"][1], "birds_covered": 10}],
        },
    )
    assert second.status_code == 409, second.text
    assert "idempotency" in second.json()["detail"].lower()

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=f["headers"],
        params={"shed_id": f["shed_id"]},
    )
    by_id = {d["id"]: d for d in doses.json()}
    assert by_id[f["dose_ids"][0]]["completed_count"] == 10
    assert by_id[f["dose_ids"][1]]["completed_count"] == 0

    # Fresh key still records the second dose normally.
    ok = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=f["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": f"fresh-{uuid4().hex}",
            "items": [{"scheduled_dose_id": f["dose_ids"][1], "birds_covered": 10}],
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()[0]["scheduled_dose_id"] == f["dose_ids"][1]
