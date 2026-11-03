"""Shed auto-vaccination schedules setting + manual vaccination recording."""

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
        "owner_id": owner_id,
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
    }


async def _shed(
    client: AsyncClient,
    headers: dict,
    code: str,
    *,
    name: str = "Shed",
    auto: bool = True,
) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={
            "name": name,
            "code": code,
            "is_owner_managed": True,
            "auto_vaccination_schedules_enabled": auto,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _vaccine(client: AsyncClient, headers: dict, *, name: str, age: int = 7) -> dict:
    r = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": name,
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": age,
                    "grace_period_days": 3,
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
        json={"shed_id": shed_id, "band_id": band, "hatch_date": hatch.isoformat()},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _doses(client: AsyncClient, headers: dict, flock_id: str) -> list[dict]:
    r = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"flock_id": flock_id, "limit": 200},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _generate(client: AsyncClient, headers: dict, flock_id: str) -> list[dict]:
    r = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=headers,
        json={"flock_id": flock_id},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_create_shed_auto_schedules_default_on(client: AsyncClient) -> None:
    a = await _owner(client, f"auto-on-{uuid4().hex[:8]}@ex.com", "Auto On Farm")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "Holding Shed", "code": f"HON{uuid4().hex[:4].upper()}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    assert shed.json()["auto_vaccination_schedules_enabled"] is True
    assert shed.json()["name"] == "Holding Shed"


@pytest.mark.asyncio
async def test_create_shed_auto_schedules_disabled(client: AsyncClient) -> None:
    a = await _owner(client, f"auto-off-{uuid4().hex[:8]}@ex.com", "Auto Off Farm")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Holding Shed",
            "code": f"HOF{uuid4().hex[:4].upper()}",
            "is_owner_managed": True,
            "auto_vaccination_schedules_enabled": False,
        },
    )
    assert shed.status_code == 201, shed.text
    assert shed.json()["auto_vaccination_schedules_enabled"] is False


@pytest.mark.asyncio
async def test_disable_schedules_suppresses_open_doses_and_blocks_generation(
    client: AsyncClient,
) -> None:
    a = await _owner(client, f"auto-dis-{uuid4().hex[:8]}@ex.com", "Disable Farm")
    h = a["headers"]
    sid = await _shed(client, h, f"DIS{uuid4().hex[:4].upper()}")
    await _vaccine(client, h, name=f"ND-{uuid4().hex[:4]}")
    hatch = date.today() - timedelta(days=14)
    bird = await _register(client, h, shed_id=sid, hatch=hatch, band=f"D-{uuid4().hex[:5].upper()}")
    fid = bird["flock_id"]

    # register-in-shed may already mint schedules; regenerate is idempotent.
    await _generate(client, h, fid)
    assert len(await _doses(client, h, fid)) >= 1

    disable = await client.patch(
        f"/api/v1/sheds/{sid}",
        headers=h,
        json={"auto_vaccination_schedules_enabled": False},
    )
    assert disable.status_code == 200, disable.text
    assert disable.json()["auto_vaccination_schedules_enabled"] is False

    # Active dose list excludes suppressed open tasks.
    assert await _doses(client, h, fid) == []

    # Catalogue / generate path must not mint new doses while disabled.
    assert await _generate(client, h, fid) == []


@pytest.mark.asyncio
async def test_reenable_schedules_does_not_duplicate_doses(client: AsyncClient) -> None:
    a = await _owner(client, f"auto-reen-{uuid4().hex[:8]}@ex.com", "Reen Farm")
    h = a["headers"]
    sid = await _shed(client, h, f"REN{uuid4().hex[:4].upper()}", auto=False)
    await _vaccine(client, h, name=f"IBD-{uuid4().hex[:4]}")
    hatch = date.today() - timedelta(days=10)
    bird = await _register(client, h, shed_id=sid, hatch=hatch, band=f"R-{uuid4().hex[:5].upper()}")
    fid = bird["flock_id"]

    # Disabled shed: no schedules even after generate.
    assert await _generate(client, h, fid) == []

    on = await client.patch(
        f"/api/v1/sheds/{sid}",
        headers=h,
        json={"auto_vaccination_schedules_enabled": True},
    )
    assert on.status_code == 200, on.text
    doses1 = await _doses(client, h, fid)
    assert len(doses1) >= 1
    keys1 = {(d["vaccine_definition_id"], d["dose_number"], d["due_date"]) for d in doses1}

    await client.patch(
        f"/api/v1/sheds/{sid}",
        headers=h,
        json={"auto_vaccination_schedules_enabled": False},
    )
    await client.patch(
        f"/api/v1/sheds/{sid}",
        headers=h,
        json={"auto_vaccination_schedules_enabled": True},
    )
    doses2 = await _doses(client, h, fid)
    keys2 = {(d["vaccine_definition_id"], d["dose_number"], d["due_date"]) for d in doses2}
    assert keys2 == keys1
    assert len(doses2) == len(keys2)


@pytest.mark.asyncio
async def test_transfer_into_disabled_shed_skips_destination_schedules(
    client: AsyncClient,
) -> None:
    a = await _owner(client, f"xfer-auto-{uuid4().hex[:8]}@ex.com", "Xfer Farm")
    h = a["headers"]
    await _vaccine(client, h, name=f"XVac-{uuid4().hex[:4]}")
    src_id = await _shed(client, h, f"XS{uuid4().hex[:4].upper()}", name="Source")
    dest_id = await _shed(
        client, h, f"XD{uuid4().hex[:4].upper()}", name="Holding Shed", auto=False
    )

    hatch = date.today() - timedelta(days=20)
    bird = await _register(
        client, h, shed_id=src_id, hatch=hatch, band=f"X-{uuid4().hex[:5].upper()}"
    )

    dest_flock = await client.post(
        "/api/v1/flocks",
        headers=h,
        json={
            "shed_id": dest_id,
            "batch_code": f"DST-{uuid4().hex[:4].upper()}",
            "initial_count": 0,
            "unbanded_count": 0,
            "tracking_mode": "individual",
            "hatch_date": hatch.isoformat(),
            "dob_confidence": "exact",
        },
    )
    assert dest_flock.status_code == 201, dest_flock.text
    dest_fid = dest_flock.json()["id"]

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest_fid,
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "idempotency_key": f"xfer-auto-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text

    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=h)
    assert profile.status_code == 200, profile.text
    assert profile.json()["is_active"] is True
    assert profile.json()["shed_id"] == dest_id
    assert profile.json()["band_id"] == bird["band_id"]

    assert await _doses(client, h, dest_fid) == []


@pytest.mark.asyncio
async def test_manual_vaccination_custom_name_multi_bird_and_history(
    client: AsyncClient,
) -> None:
    a = await _owner(client, f"manual-vax-{uuid4().hex[:8]}@ex.com", "Manual Farm")
    h = a["headers"]
    sid = await _shed(client, h, f"MV{uuid4().hex[:4].upper()}", name="Holding Shed", auto=False)
    hatch = date.today() - timedelta(days=30)
    b1 = await _register(client, h, shed_id=sid, hatch=hatch, band=f"MV1-{uuid4().hex[:4].upper()}")
    b2 = await _register(client, h, shed_id=sid, hatch=hatch, band=f"MV2-{uuid4().hex[:4].upper()}")
    assert b1["flock_id"] == b2["flock_id"]
    fid = b1["flock_id"]

    single = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "flock_id": fid,
            "bird_id": b1["id"],
            "custom_vaccine_name": "Custom Marek",
            "administration_date": date.today().isoformat(),
            "manufacturer_or_brand": "Acme",
            "lot_number": "LOT-9",
            "vaccine_type_or_strain": "HVT",
            "notes": "Field dose",
            "idempotency_key": f"manual-single-{uuid4().hex}",
        },
    )
    assert single.status_code == 201, single.text
    ev = single.json()
    assert ev["recording_kind"] == "manual"
    assert ev["scheduled_dose_id"] is None
    assert ev["vaccine_definition_id"] is None
    assert ev["custom_vaccine_name"] == "Custom Marek"
    assert ev["vaccine_name"] == "Custom Marek"

    key = f"manual-batch-{uuid4().hex}"
    batch = await client.post(
        "/api/v1/vaccination-events/manual-batch",
        headers=h,
        json={
            "bird_ids": [b1["id"], b2["id"]],
            "flock_id": fid,
            "custom_vaccine_name": "Custom ND",
            "administration_date": date.today().isoformat(),
            "manufacturer_or_brand": "BrandX",
            "lot_number": "LOT-ND",
            "idempotency_key": key,
        },
    )
    assert batch.status_code == 201, batch.text
    body = batch.json()
    assert body["success_count"] == 2
    assert body["failed_count"] == 0
    assert all(r["status"] == "success" and r["event_id"] for r in body["results"])

    replay = await client.post(
        "/api/v1/vaccination-events/manual-batch",
        headers=h,
        json={
            "bird_ids": [b1["id"], b2["id"]],
            "flock_id": fid,
            "custom_vaccine_name": "Custom ND",
            "administration_date": date.today().isoformat(),
            "idempotency_key": key,
        },
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["success_count"] == 2

    profile = await client.get(f"/api/v1/birds/{b2['id']}/profile", headers=h)
    assert profile.status_code == 200, profile.text
    history = profile.json().get("individual_vaccinations") or []
    manual = [row for row in history if row.get("recording_kind") == "manual"]
    assert any(row.get("vaccine_name") == "Custom ND" for row in manual)
    assert all(row.get("scheduled_dose_id") is None for row in manual)

    compliance = await client.get("/api/v1/reports/compliance", headers=h)
    assert compliance.status_code == 200
    assert compliance.json()["compliance_denominator"] == 0


@pytest.mark.asyncio
async def test_manual_vaccination_does_not_complete_scheduled_dose(
    client: AsyncClient,
) -> None:
    a = await _owner(client, f"manual-comp-{uuid4().hex[:8]}@ex.com", "Comp Farm")
    h = a["headers"]
    sid = await _shed(client, h, f"CP{uuid4().hex[:4].upper()}")
    vac = await _vaccine(client, h, name=f"CompVac-{uuid4().hex[:4]}")
    hatch = date.today() - timedelta(days=14)
    bird = await _register(
        client, h, shed_id=sid, hatch=hatch, band=f"C-{uuid4().hex[:5].upper()}"
    )
    fid = bird["flock_id"]
    await _generate(client, h, fid)
    open_doses = await _doses(client, h, fid)
    assert open_doses
    target = open_doses[0]
    before_completed = target["completed_count"]

    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "flock_id": fid,
            "bird_id": bird["id"],
            "vaccine_definition_id": vac["id"],
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"manual-no-credit-{uuid4().hex}",
        },
    )
    assert rec.status_code == 201, rec.text
    assert rec.json()["recording_kind"] == "manual"
    assert rec.json()["scheduled_dose_id"] is None

    after = next(d for d in await _doses(client, h, fid) if d["id"] == target["id"])
    assert after["completed_count"] == before_completed
    assert not str(after["status"]).startswith("completed")
