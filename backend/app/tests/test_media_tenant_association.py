"""DEF-SEC-1: media registration must not accept cross-tenant associations."""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _owner(client: AsyncClient, label: str) -> dict:
    email = f"media-{label}-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": f"Media {label}",
            "organization_name": f"Media Farm {label}",
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
    return {"headers": headers, "owner_id": owner_id, "email": email}


async def _farm_with_event(client: AsyncClient, label: str) -> dict:
    a = await _owner(client, label)
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": f"Shed {label}", "code": f"M{uuid4().hex[:4].upper()}"},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": f"F{label[:4].upper()}",
            "initial_count": 40,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-01",
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]

    vax = await client.post(
        "/api/v1/vaccines",
        headers=a["headers"],
        json={
            "name": f"Vax {label}",
            "category": "vaccine",
            "rules": [{"dose_number": 1, "target_age_days": 0, "grace_period_days": 0}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=a["headers"],
        json={"flock_id": flock_id, "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    dose_id = gen.json()[0]["id"]

    batch = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=a["headers"],
        json={
            "administration_date": "2026-10-23",
            "idempotency_key": f"media-{label}-{uuid4().hex}",
            "items": [{"scheduled_dose_id": dose_id, "birds_covered": 5}],
        },
    )
    assert batch.status_code == 201, batch.text
    event_id = batch.json()[0]["id"]

    return {
        **a,
        "shed_id": shed_id,
        "flock_id": flock_id,
        "event_id": event_id,
        "dose_id": dose_id,
    }


async def _media_count(client: AsyncClient, headers: dict) -> int:
    listed = await client.get("/api/v1/media", headers=headers)
    assert listed.status_code == 200
    return len(listed.json())


@pytest.mark.asyncio
async def test_same_tenant_media_registration_succeeds(client: AsyncClient) -> None:
    farm = await _farm_with_event(client, "same")
    before = await _media_count(client, farm["headers"])
    res = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={"public_id": "same/plain", "shed_id": farm["shed_id"], "version": 1},
    )
    assert res.status_code == 201, res.text
    assert res.json()["shed_id"] == farm["shed_id"]
    assert await _media_count(client, farm["headers"]) == before + 1


@pytest.mark.asyncio
async def test_same_tenant_vaccination_event_association_succeeds(client: AsyncClient) -> None:
    farm = await _farm_with_event(client, "vaxok")
    res = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={
            "public_id": "same/label",
            "shed_id": farm["shed_id"],
            "flock_id": farm["flock_id"],
            "vaccination_event_id": farm["event_id"],
            "notes": "Vaccine label photo",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["vaccination_event_id"] == farm["event_id"]
    assert body["shed_id"] == farm["shed_id"]
    assert body["flock_id"] == farm["flock_id"]

    filtered = await client.get(
        "/api/v1/media",
        headers=farm["headers"],
        params={"vaccination_event_id": farm["event_id"]},
    )
    assert filtered.status_code == 200
    assert len(filtered.json()) == 1
    assert filtered.json()[0]["id"] == body["id"]


@pytest.mark.asyncio
async def test_cross_tenant_vaccination_event_rejected(client: AsyncClient) -> None:
    a = await _farm_with_event(client, "evta")
    b = await _owner(client, "evtb")
    before_a = await _media_count(client, a["headers"])
    before_b = await _media_count(client, b["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=b["headers"],
        json={"public_id": "x/event", "vaccination_event_id": a["event_id"]},
    )
    assert denied.status_code == 404, denied.text
    assert "not found" in denied.json()["detail"].lower()
    # Do not echo the foreign event id in the error payload beyond generic wording
    assert a["event_id"] not in denied.text

    assert await _media_count(client, a["headers"]) == before_a
    assert await _media_count(client, b["headers"]) == before_b


@pytest.mark.asyncio
async def test_cross_tenant_shed_rejected(client: AsyncClient) -> None:
    a = await _farm_with_event(client, "sheda")
    b = await _owner(client, "shedb")
    before_b = await _media_count(client, b["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=b["headers"],
        json={"public_id": "x/shed", "shed_id": a["shed_id"]},
    )
    assert denied.status_code == 404, denied.text
    assert await _media_count(client, b["headers"]) == before_b


@pytest.mark.asyncio
async def test_cross_tenant_flock_rejected(client: AsyncClient) -> None:
    a = await _farm_with_event(client, "flka")
    b = await _owner(client, "flkb")
    before_b = await _media_count(client, b["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=b["headers"],
        json={"public_id": "x/flock", "flock_id": a["flock_id"]},
    )
    assert denied.status_code == 404, denied.text
    assert await _media_count(client, b["headers"]) == before_b


@pytest.mark.asyncio
async def test_event_shed_mismatch_rejected(client: AsyncClient) -> None:
    farm = await _farm_with_event(client, "mis")
    # Second shed in same tenant
    shed2 = await client.post(
        "/api/v1/sheds",
        headers=farm["headers"],
        json={"name": "Other Shed", "code": f"O{uuid4().hex[:4].upper()}"},
    )
    assert shed2.status_code == 201, shed2.text
    before = await _media_count(client, farm["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={
            "public_id": "mismatch/label",
            "shed_id": shed2.json()["id"],
            "vaccination_event_id": farm["event_id"],
        },
    )
    assert denied.status_code == 400, denied.text
    assert "mismatch" in denied.json()["detail"].lower()
    assert await _media_count(client, farm["headers"]) == before


@pytest.mark.asyncio
async def test_event_flock_mismatch_rejected(client: AsyncClient) -> None:
    farm = await _farm_with_event(client, "fmis")
    flock2 = await client.post(
        "/api/v1/flocks",
        headers=farm["headers"],
        json={
            "shed_id": farm["shed_id"],
            "batch_code": f"X{uuid4().hex[:4].upper()}",
            "initial_count": 10,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-05",
        },
    )
    assert flock2.status_code == 201, flock2.text
    before = await _media_count(client, farm["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={
            "public_id": "mismatch/flock",
            "shed_id": farm["shed_id"],
            "flock_id": flock2.json()["id"],
            "vaccination_event_id": farm["event_id"],
        },
    )
    assert denied.status_code == 400, denied.text
    assert await _media_count(client, farm["headers"]) == before


@pytest.mark.asyncio
async def test_rejected_association_leaves_no_media_row(client: AsyncClient) -> None:
    a = await _farm_with_event(client, "norow")
    b = await _owner(client, "norowb")
    before_a = await _media_count(client, a["headers"])
    before_b = await _media_count(client, b["headers"])

    for payload in (
        {"public_id": "bad1", "vaccination_event_id": a["event_id"]},
        {"public_id": "bad2", "shed_id": a["shed_id"]},
        {"public_id": "bad3", "flock_id": a["flock_id"]},
        {
            "public_id": "bad4",
            "shed_id": a["shed_id"],
            "vaccination_event_id": a["event_id"],
        },
    ):
        denied = await client.post("/api/v1/media", headers=b["headers"], json=payload)
        assert denied.status_code == 404, denied.text

    assert await _media_count(client, a["headers"]) == before_a
    assert await _media_count(client, b["headers"]) == before_b

    # Victim tenant still has no foreign media linked to the event
    filtered = await client.get(
        "/api/v1/media",
        headers=a["headers"],
        params={"vaccination_event_id": a["event_id"]},
    )
    assert filtered.status_code == 200
    assert filtered.json() == []


async def _farm_with_bird(client: AsyncClient, label: str) -> dict:
    """Owner + shed + mixed flock + banded bird (for bird_id association tests)."""
    a = await _owner(client, label)
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": f"Bird Shed {label}", "code": f"B{uuid4().hex[:4].upper()}"},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": f"BF{label[:3].upper()}",
            "initial_count": 20,
            "tracking_mode": "mixed",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-01",
            "unbanded_count": 20,
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]

    bird = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={
            "flock_id": flock_id,
            "band_id": f"MB-{uuid4().hex[:6].upper()}",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-01",
        },
    )
    assert bird.status_code == 201, bird.text
    return {
        **a,
        "shed_id": shed_id,
        "flock_id": flock_id,
        "bird_id": bird.json()["id"],
    }


@pytest.mark.asyncio
async def test_same_tenant_bird_association_succeeds(client: AsyncClient) -> None:
    farm = await _farm_with_bird(client, "birdok")
    before = await _media_count(client, farm["headers"])
    res = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={
            "public_id": "same/bird",
            "shed_id": farm["shed_id"],
            "flock_id": farm["flock_id"],
            "bird_id": farm["bird_id"],
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["bird_id"] == farm["bird_id"]
    assert body["shed_id"] == farm["shed_id"]
    assert body["flock_id"] == farm["flock_id"]
    assert await _media_count(client, farm["headers"]) == before + 1


@pytest.mark.asyncio
async def test_cross_tenant_bird_rejected(client: AsyncClient) -> None:
    a = await _farm_with_bird(client, "birda")
    b = await _owner(client, "birdb")
    before_b = await _media_count(client, b["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=b["headers"],
        json={"public_id": "x/bird", "bird_id": a["bird_id"]},
    )
    assert denied.status_code == 404, denied.text
    assert "not found" in denied.json()["detail"].lower()
    assert a["bird_id"] not in denied.text
    assert await _media_count(client, b["headers"]) == before_b


@pytest.mark.asyncio
async def test_nonexistent_bird_rejected(client: AsyncClient) -> None:
    farm = await _farm_with_bird(client, "nobird")
    before = await _media_count(client, farm["headers"])
    missing = str(uuid4())

    denied = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={"public_id": "missing/bird", "bird_id": missing, "shed_id": farm["shed_id"]},
    )
    assert denied.status_code == 404, denied.text
    assert await _media_count(client, farm["headers"]) == before


@pytest.mark.asyncio
async def test_bird_shed_mismatch_rejected(client: AsyncClient) -> None:
    farm = await _farm_with_bird(client, "bshed")
    shed2 = await client.post(
        "/api/v1/sheds",
        headers=farm["headers"],
        json={"name": "Other Bird Shed", "code": f"Y{uuid4().hex[:4].upper()}"},
    )
    assert shed2.status_code == 201, shed2.text
    before = await _media_count(client, farm["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={
            "public_id": "mismatch/bird-shed",
            "shed_id": shed2.json()["id"],
            "bird_id": farm["bird_id"],
        },
    )
    assert denied.status_code == 400, denied.text
    assert "mismatch" in denied.json()["detail"].lower()
    assert await _media_count(client, farm["headers"]) == before


@pytest.mark.asyncio
async def test_bird_flock_mismatch_rejected(client: AsyncClient) -> None:
    farm = await _farm_with_bird(client, "bflk")
    flock2 = await client.post(
        "/api/v1/flocks",
        headers=farm["headers"],
        json={
            "shed_id": farm["shed_id"],
            "batch_code": f"ZX{uuid4().hex[:3].upper()}",
            "initial_count": 10,
            "tracking_mode": "mixed",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-05",
            "unbanded_count": 10,
        },
    )
    assert flock2.status_code == 201, flock2.text
    before = await _media_count(client, farm["headers"])

    denied = await client.post(
        "/api/v1/media",
        headers=farm["headers"],
        json={
            "public_id": "mismatch/bird-flock",
            "shed_id": farm["shed_id"],
            "flock_id": flock2.json()["id"],
            "bird_id": farm["bird_id"],
        },
    )
    assert denied.status_code == 400, denied.text
    assert await _media_count(client, farm["headers"]) == before


@pytest.mark.asyncio
async def test_same_tenant_upload_signing_succeeds(client: AsyncClient) -> None:
    farm = await _farm_with_bird(client, "signok")
    res = await client.post(
        "/api/v1/media/sign",
        headers=farm["headers"],
        json={"shed_id": farm["shed_id"], "folder_suffix": "labels"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "folder" in body
    assert farm["owner_id"] in body["folder"]
    # Cloudinary may be disabled in tests; either path is legitimate for same-tenant.
    assert body.get("enabled") is False or body.get("signature")


@pytest.mark.asyncio
async def test_cross_tenant_shed_signing_rejected(client: AsyncClient) -> None:
    a = await _farm_with_bird(client, "signa")
    b = await _owner(client, "signb")

    denied = await client.post(
        "/api/v1/media/sign",
        headers=b["headers"],
        json={"shed_id": a["shed_id"], "folder_suffix": "labels"},
    )
    assert denied.status_code == 404, denied.text
    assert "not found" in denied.json()["detail"].lower()
    assert a["shed_id"] not in denied.text
    assert "signature" not in denied.json()
    assert "folder" not in denied.json()


@pytest.mark.asyncio
async def test_nonexistent_shed_signing_rejected(client: AsyncClient) -> None:
    farm = await _farm_with_bird(client, "signmiss")
    missing = str(uuid4())

    denied = await client.post(
        "/api/v1/media/sign",
        headers=farm["headers"],
        json={"shed_id": missing, "folder_suffix": "labels"},
    )
    assert denied.status_code == 404, denied.text
    assert "signature" not in denied.json()
    assert "folder" not in denied.json()
