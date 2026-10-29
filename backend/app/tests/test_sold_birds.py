"""Sold bird lifecycle, search, vaccination exclusion, tenant isolation."""

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


@pytest.mark.asyncio
async def test_sale_success_and_profile_details(client: AsyncClient) -> None:
    auth = await _owner(client, f"sold-ok-{uuid4().hex[:8]}@example.com", "Sold Org")
    shed = await _shed(client, auth["headers"], f"S{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"B-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], f"SB-{uuid4().hex[:5].upper()}")

    sale = await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_id": bird["id"],
            "buyer_name": "Ramesh Kumar",
            "buyer_mobile": "+919876543210",
            "reason": "Farm sale",
            "idempotency_key": f"sale-{uuid4().hex}",
        },
    )
    assert sale.status_code in {200, 201}, sale.text
    body = sale.json()
    assert body["event_type"] == "sale"
    assert body["buyer_name"] == "Ramesh Kumar"
    assert body["buyer_mobile"] == "+919876543210"

    active = await client.get(
        "/api/v1/birds/in-shed",
        headers=auth["headers"],
        params={"shed_id": shed},
    )
    assert active.status_code == 200
    assert all(i["id"] != bird["id"] for i in active.json()["items"])

    prof = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=auth["headers"])
    assert prof.status_code == 200, prof.text
    p = prof.json()
    assert p["lifecycle_status"] == "sold"
    assert p["is_active"] is False
    assert p["sale"]["buyer_name"] == "Ramesh Kumar"
    assert p["sale"]["buyer_mobile"] == "+919876543210"
    assert p["sale"]["sold_on"] == "2026-10-25"
    assert p["batch_upcoming_doses"] == []


@pytest.mark.asyncio
async def test_sale_validation_missing_and_invalid_mobile(client: AsyncClient) -> None:
    auth = await _owner(client, f"sold-val-{uuid4().hex[:8]}@example.com", "Sold Val")
    shed = await _shed(client, auth["headers"], f"V{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BV-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], f"SV-{uuid4().hex[:5].upper()}")

    missing = await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_id": bird["id"],
            "idempotency_key": f"sale-miss-{uuid4().hex}",
        },
    )
    assert missing.status_code == 422

    bad_mobile = await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_id": bird["id"],
            "buyer_name": "Buyer",
            "buyer_mobile": "123",
            "idempotency_key": f"sale-bad-{uuid4().hex}",
        },
    )
    assert bad_mobile.status_code == 422


@pytest.mark.asyncio
async def test_sale_duplicate_and_ineligible(client: AsyncClient) -> None:
    auth = await _owner(client, f"sold-dup-{uuid4().hex[:8]}@example.com", "Sold Dup")
    shed = await _shed(client, auth["headers"], f"D{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BD-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], f"SD-{uuid4().hex[:5].upper()}")
    key = f"sale-idem-{uuid4().hex}"
    payload = {
        "event_type": "sale",
        "effective_date": "2026-10-25",
        "bird_id": bird["id"],
        "buyer_name": "Buyer One",
        "buyer_mobile": "9876543210",
        "idempotency_key": key,
    }
    first = await client.post("/api/v1/lifecycle-events", headers=auth["headers"], json=payload)
    assert first.status_code in {200, 201}, first.text
    replay = await client.post("/api/v1/lifecycle-events", headers=auth["headers"], json=payload)
    assert replay.status_code in {200, 201}
    assert replay.json()["id"] == first.json()["id"]

    again = await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            **payload,
            "idempotency_key": f"sale-again-{uuid4().hex}",
        },
    )
    assert again.status_code == 400
    detail = again.json().get("detail", "")
    assert "eligible" in str(detail).lower()


@pytest.mark.asyncio
async def test_sale_unauthorized_bird_and_tenant_isolation(client: AsyncClient) -> None:
    a = await _owner(client, f"sold-a-{uuid4().hex[:8]}@example.com", "Org A")
    b = await _owner(client, f"sold-b-{uuid4().hex[:8]}@example.com", "Org B")
    shed_a = await _shed(client, a["headers"], f"A{uuid4().hex[:4].upper()}")
    flock_a = await _flock(client, a["headers"], shed_a, f"BA-{uuid4().hex[:6]}")
    bird_a = await _bird(client, a["headers"], flock_a["id"], f"SA-{uuid4().hex[:5].upper()}")

    foreign = await client.post(
        "/api/v1/lifecycle-events",
        headers=b["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_id": bird_a["id"],
            "buyer_name": "Hacker",
            "buyer_mobile": "9876543210",
            "idempotency_key": f"sale-x-{uuid4().hex}",
        },
    )
    assert foreign.status_code in {400, 403, 404}

    sold = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_id": bird_a["id"],
            "buyer_name": "Owner Buyer",
            "buyer_mobile": "9123456780",
            "idempotency_key": f"sale-own-{uuid4().hex}",
        },
    )
    assert sold.status_code in {200, 201}, sold.text

    leak = await client.get("/api/v1/birds/sold", headers=b["headers"], params={"q": "Owner"})
    assert leak.status_code == 200
    assert leak.json()["total"] == 0
    assert all(i["id"] != bird_a["id"] for i in leak.json()["items"])


@pytest.mark.asyncio
async def test_sold_birds_search(client: AsyncClient) -> None:
    auth = await _owner(client, f"sold-q-{uuid4().hex[:8]}@example.com", "Sold Search")
    shed = await _shed(client, auth["headers"], f"Q{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BQ-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], "BAND-SOLD-99")
    await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": str(date.today()),
            "bird_id": bird["id"],
            "buyer_name": "Priya Sharma",
            "buyer_mobile": "9988776655",
            "idempotency_key": f"sale-q-{uuid4().hex}",
        },
    )

    by_band = await client.get(
        "/api/v1/birds/sold", headers=auth["headers"], params={"q": "BAND-SOLD"}
    )
    assert by_band.status_code == 200
    assert by_band.json()["total"] >= 1
    assert any(i["band_id"] == "BAND-SOLD-99" for i in by_band.json()["items"])

    by_buyer = await client.get(
        "/api/v1/birds/sold", headers=auth["headers"], params={"q": "Priya"}
    )
    assert by_buyer.status_code == 200
    assert any(i["buyer_name"] == "Priya Sharma" for i in by_buyer.json()["items"])

    by_mobile = await client.get(
        "/api/v1/birds/sold", headers=auth["headers"], params={"q": "998877"}
    )
    assert by_mobile.status_code == 200
    assert any(i["buyer_mobile"] == "9988776655" for i in by_mobile.json()["items"])


@pytest.mark.asyncio
async def test_vaccination_rejected_for_sold_bird(client: AsyncClient) -> None:
    auth = await _owner(client, f"sold-vax-{uuid4().hex[:8]}@example.com", "Sold Vax")
    shed = await _shed(client, auth["headers"], f"X{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BX-{uuid4().hex[:6]}")
    bird = await _bird(client, auth["headers"], flock["id"], f"SX-{uuid4().hex[:5].upper()}")
    await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-20",
            "bird_id": bird["id"],
            "buyer_name": "Buyer",
            "buyer_mobile": "9000011111",
            "idempotency_key": f"sale-vax-{uuid4().hex}",
        },
    )

    # Need a vaccine definition — list catalogues / definitions used in other tests
    vax_def = await client.post(
        "/api/v1/vaccines",
        headers=auth["headers"],
        json={
            "name": f"SoldBirdVax-{uuid4().hex[:6]}",
            "category": "vaccine",
            "description": "Sold bird rejection probe",
            "rules": [{"dose_number": 1, "target_age_days": 0, "grace_period_days": 0}],
        },
    )
    assert vax_def.status_code == 201, vax_def.text
    vaccine_id = vax_def.json()["id"]

    vax = await client.post(
        "/api/v1/vaccination-events",
        headers=auth["headers"],
        json={
            "flock_id": flock["id"],
            "bird_id": bird["id"],
            "vaccine_definition_id": vaccine_id,
            "birds_covered": 1,
            "administration_date": str(date.today()),
            "idempotency_key": f"vax-sold-{uuid4().hex}",
        },
    )
    assert vax.status_code in {400, 409, 422}, vax.text
    detail_txt = str(vax.json()).lower()
    assert "active" in detail_txt or "sold" in detail_txt or "inactive" in detail_txt


@pytest.mark.asyncio
async def test_bulk_sale_requires_buyer_and_refreshes(client: AsyncClient) -> None:
    auth = await _owner(client, f"sold-bulk-{uuid4().hex[:8]}@example.com", "Sold Bulk")
    shed = await _shed(client, auth["headers"], f"U{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BU-{uuid4().hex[:6]}")
    b1 = await _bird(client, auth["headers"], flock["id"], f"U1-{uuid4().hex[:4].upper()}")
    b2 = await _bird(client, auth["headers"], flock["id"], f"U2-{uuid4().hex[:4].upper()}")

    missing = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_ids": [b1["id"], b2["id"]],
            "idempotency_key": f"bulk-sale-miss-{uuid4().hex}",
        },
    )
    assert missing.status_code == 422

    ok = await client.post(
        "/api/v1/lifecycle-events/bulk",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-25",
            "bird_ids": [b1["id"], b2["id"]],
            "buyer_name": "Bulk Buyer",
            "buyer_mobile": "9111122222",
            "idempotency_key": f"bulk-sale-ok-{uuid4().hex}",
        },
    )
    assert ok.status_code in {200, 201}, ok.text
    assert ok.json()["applied"] == 2

    listed = await client.get("/api/v1/birds/sold", headers=auth["headers"], params={"q": "Bulk Buyer"})
    assert listed.status_code == 200
    ids = {i["id"] for i in listed.json()["items"]}
    assert b1["id"] in ids and b2["id"] in ids
