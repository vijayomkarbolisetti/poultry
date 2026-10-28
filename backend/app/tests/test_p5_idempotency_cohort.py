"""P5: owner-scoped idempotency, payload conflicts, transfer replay integrity, cohort races."""

from __future__ import annotations

import asyncio
from datetime import date
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.enums import DobConfidence, FlockStatus
from app.models.flock import Flock


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


async def _flock_exact(
    client: AsyncClient,
    headers: dict,
    shed_id: str,
    code: str,
    *,
    hatch: date,
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
            "dob_confidence": "exact",
            "hatch_date": hatch.isoformat(),
            "unbanded_count": unbanded if mode != "individual" else 0,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _invite_farmer(
    client: AsyncClient,
    headers: dict,
    owner_id: str,
    email: str,
    shed_ids: str | list[str],
    *,
    permission_codes: list[str] | None = None,
) -> dict:
    sheds = [shed_ids] if isinstance(shed_ids, str) else list(shed_ids)
    created = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "email": email,
            "password": "password123",
            "full_name": "P5 Farmer",
            "role": "farmer",
            "shed_ids": sheds,
            "permission_codes": permission_codes
            or [
                "shed.view",
                "flock.view",
                "bird.view",
                "bird.create",
                "lifecycle.record",
            ],
        },
    )
    assert created.status_code == 201, created.text
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200, login.text
    return {
        "headers": {
            "Authorization": f"Bearer {login.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        }
    }


@pytest.mark.asyncio
async def test_transfer_replay_bird_ids_from_persisted_events(client: AsyncClient) -> None:
    owner = await _owner(client, f"p5-xfer-{uuid4().hex[:8]}@ex.com", "P5 Xfer")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"PA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"PB{uuid4().hex[:4].upper()}")
    hatch = date.today()
    src = await _flock_exact(client, h, shed_a, f"SRC-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=5)
    dest = await _flock_exact(client, h, shed_b, f"DST-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=0)

    birds = []
    for i in range(2):
        band = await client.post(
            "/api/v1/birds/band-from-unbanded",
            headers=h,
            json={
                "flock_id": src["id"],
                "band_id": f"P5X-{i}-{uuid4().hex[:4].upper()}",
                "idempotency_key": f"p5-bfu-{uuid4().hex}",
            },
        )
        assert band.status_code == 201, band.text
        birds.append(band.json()["bird"])

    bird_ids = [b["id"] for b in birds]
    key = f"p5-xfer-batch-{uuid4().hex}"
    first = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": hatch.isoformat(),
            "bird_ids": bird_ids,
            "idempotency_key": key,
        },
    )
    assert first.status_code == 201, first.text
    assert first.json()["idempotent_replay"] is False
    assert sorted(first.json()["bird_ids"]) == sorted(bird_ids)
    assert first.json()["moved"] == 2

    # Replay with reversed bird_ids order — response must still match persisted set.
    retry = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": hatch.isoformat(),
            "bird_ids": list(reversed(bird_ids)),
            "idempotency_key": key,
        },
    )
    assert retry.status_code == 201, retry.text
    body = retry.json()
    assert body["idempotent_replay"] is True
    assert sorted(body["bird_ids"]) == sorted(first.json()["bird_ids"])
    assert body["destination_flock_id"] == dest["id"]
    assert body["destination_shed_id"] == shed_b
    assert body["moved"] == 2

    for bid in bird_ids:
        profile = await client.get(f"/api/v1/birds/{bid}/profile", headers=h)
        assert profile.status_code == 200
        assert profile.json()["flock_id"] == dest["id"]
        assert profile.json()["shed_id"] == shed_b


@pytest.mark.asyncio
async def test_idempotency_changed_payload_conflict(client: AsyncClient) -> None:
    owner = await _owner(client, f"p5-conf-{uuid4().hex[:8]}@ex.com", "P5 Conflict")
    h = owner["headers"]
    shed = await _shed(client, h, f"PC{uuid4().hex[:4].upper()}")
    flock = await _flock_exact(
        client, h, shed, f"CFG-{uuid4().hex[:4].upper()}", hatch=date.today(), unbanded=3
    )
    key = f"p5-band-conflict-{uuid4().hex}"
    first = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock["id"], "band_id": f"C1-{uuid4().hex[:5].upper()}", "idempotency_key": key},
    )
    assert first.status_code == 201, first.text

    conflict = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock["id"], "band_id": f"C2-{uuid4().hex[:5].upper()}", "idempotency_key": key},
    )
    assert conflict.status_code == 409, conflict.text
    assert "idempotency" in conflict.json()["detail"].lower()

    # Lifecycle count-only conflict
    life_key = f"p5-life-conflict-{uuid4().hex}"
    mort = await client.post(
        "/api/v1/lifecycle-events",
        headers=h,
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "flock_id": flock["id"],
            "quantity": 1,
            "idempotency_key": life_key,
        },
    )
    assert mort.status_code == 201, mort.text
    life_conflict = await client.post(
        "/api/v1/lifecycle-events",
        headers=h,
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "flock_id": flock["id"],
            "quantity": 2,
            "idempotency_key": life_key,
        },
    )
    assert life_conflict.status_code == 409, life_conflict.text


@pytest.mark.asyncio
async def test_same_payload_replay_band_and_lifecycle(client: AsyncClient) -> None:
    owner = await _owner(client, f"p5-replay-{uuid4().hex[:8]}@ex.com", "P5 Replay")
    h = owner["headers"]
    shed = await _shed(client, h, f"PR{uuid4().hex[:4].upper()}")
    flock = await _flock_exact(
        client, h, shed, f"RPG-{uuid4().hex[:4].upper()}", hatch=date.today(), unbanded=4
    )
    band = f"RP-{uuid4().hex[:5].upper()}"
    key = f"p5-band-replay-{uuid4().hex}"
    first = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock["id"], "band_id": band, "idempotency_key": key},
    )
    assert first.status_code == 201, first.text
    retry = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={"flock_id": flock["id"], "band_id": band, "idempotency_key": key},
    )
    assert retry.status_code == 201, retry.text
    assert retry.json()["idempotent_replay"] is True
    assert retry.json()["bird"]["id"] == first.json()["bird"]["id"]
    assert retry.json()["bird"]["band_id"] == band

    life_key = f"p5-life-replay-{uuid4().hex}"
    payload = {
        "event_type": "sale",
        "effective_date": date.today().isoformat(),
        "flock_id": flock["id"],
        "quantity": 1,
        "idempotency_key": life_key,
    }
    a = await client.post("/api/v1/lifecycle-events", headers=h, json=payload)
    assert a.status_code == 201, a.text
    b = await client.post("/api/v1/lifecycle-events", headers=h, json=payload)
    assert b.status_code == 201, b.text
    assert a.json()["id"] == b.json()["id"]


@pytest.mark.asyncio
async def test_unauthorized_replay_denied(client: AsyncClient) -> None:
    owner = await _owner(client, f"p5-auth-{uuid4().hex[:8]}@ex.com", "P5 Auth")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"AA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"BB{uuid4().hex[:4].upper()}")
    hatch = date.today()
    src = await _flock_exact(client, h, shed_a, f"AS-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=3)
    dest = await _flock_exact(client, h, shed_b, f"AD-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=0)
    farmer = await _invite_farmer(
        client, h, owner["owner_id"], f"p5-farmer-{uuid4().hex[:8]}@ex.com", shed_a
    )

    band = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={
            "flock_id": src["id"],
            "band_id": f"AU-{uuid4().hex[:5].upper()}",
            "idempotency_key": f"p5-auth-bfu-{uuid4().hex}",
        },
    )
    assert band.status_code == 201, band.text
    bird_id = band.json()["bird"]["id"]
    key = f"p5-auth-xfer-{uuid4().hex}"
    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "effective_date": hatch.isoformat(),
            "bird_ids": [bird_id],
            "idempotency_key": key,
        },
    )
    assert xfer.status_code == 201, xfer.text

    # Farmer assigned only to source shed cannot replay dest-shed transfer marker.
    denied = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=farmer["headers"],
        json={
            "destination_flock_id": dest["id"],
            "effective_date": hatch.isoformat(),
            "bird_ids": [bird_id],
            "idempotency_key": key,
        },
    )
    assert denied.status_code in (403, 404), denied.text


@pytest.mark.asyncio
async def test_alias_cohort_band_and_lifecycle(client: AsyncClient) -> None:
    owner = await _owner(client, f"p5-alias-{uuid4().hex[:8]}@ex.com", "P5 Alias")
    h = owner["headers"]
    shed = await _shed(client, h, f"AL{uuid4().hex[:4].upper()}")
    hatch = date.today()
    flock = await _flock_exact(
        client, h, shed, f"ALG-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=5
    )
    key = f"p5-alias-band-{uuid4().hex}"
    band = await client.post(
        "/api/v1/birds/band-from-unbanded-by-cohort",
        headers=h,
        json={
            "shed_id": shed,
            "hatch_date": hatch.isoformat(),
            "band_id": f"ALB-{uuid4().hex[:5].upper()}",
            "idempotency_key": key,
        },
    )
    assert band.status_code == 201, band.text
    assert band.json()["bird"]["flock_id"] == flock["id"]

    replay = await client.post(
        "/api/v1/birds/band-from-unbanded-by-cohort",
        headers=h,
        json={
            "shed_id": shed,
            "hatch_date": hatch.isoformat(),
            "band_id": band.json()["bird"]["band_id"],
            "idempotency_key": key,
        },
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["idempotent_replay"] is True

    life_key = f"p5-alias-life-{uuid4().hex}"
    life = await client.post(
        "/api/v1/lifecycle-events/unbanded-by-cohort",
        headers=h,
        json={
            "shed_id": shed,
            "hatch_date": hatch.isoformat(),
            "event_type": "mortality",
            "effective_date": hatch.isoformat(),
            "quantity": 1,
            "idempotency_key": life_key,
        },
    )
    assert life.status_code == 201, life.text
    life_retry = await client.post(
        "/api/v1/lifecycle-events/unbanded-by-cohort",
        headers=h,
        json={
            "shed_id": shed,
            "hatch_date": hatch.isoformat(),
            "event_type": "mortality",
            "effective_date": hatch.isoformat(),
            "quantity": 1,
            "idempotency_key": life_key,
        },
    )
    assert life_retry.status_code == 201, life_retry.text
    assert life_retry.json()["id"] == life.json()["id"]


@pytest.mark.asyncio
async def test_concurrent_cohort_create_via_transfer_alias(
    client: AsyncClient, engine
) -> None:
    """Two parallel by-cohort unbanded transfers must share one dest exact cohort."""
    owner = await _owner(client, f"p5-race-{uuid4().hex[:8]}@ex.com", "P5 Race")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"RA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"RB{uuid4().hex[:4].upper()}")
    hatch = date.today()
    await _flock_exact(client, h, shed_a, f"RS-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=10)

    async def _xfer(qty: int, key: str):
        return await client.post(
            "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
            headers=h,
            json={
                "destination_shed_id": shed_b,
                "source_shed_id": shed_a,
                "hatch_date": hatch.isoformat(),
                "effective_date": hatch.isoformat(),
                "quantity": qty,
                "idempotency_key": key,
            },
        )

    r1, r2 = await asyncio.gather(
        _xfer(2, f"p5-race-a-{uuid4().hex}"),
        _xfer(3, f"p5-race-b-{uuid4().hex}"),
    )
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        n = await session.scalar(
            select(func.count())
            .select_from(Flock)
            .where(
                Flock.shed_id == shed_b,
                Flock.status == FlockStatus.active,
                Flock.dob_confidence == DobConfidence.exact,
                Flock.hatch_date == hatch,
            )
        )
    assert n == 1

    dest_id = r1.json()["destination_flock_id"]
    assert r2.json()["destination_flock_id"] == dest_id
    dest = await client.get(f"/api/v1/flocks/{dest_id}", headers=h)
    assert dest.status_code == 200
    assert dest.json()["unbanded_count"] == 5
    assert dest.json()["current_count"] == 5


@pytest.mark.asyncio
async def test_transfer_changed_payload_conflict(client: AsyncClient) -> None:
    owner = await _owner(client, f"p5-txc-{uuid4().hex[:8]}@ex.com", "P5 Tx Conflict")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"TA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"TB{uuid4().hex[:4].upper()}")
    hatch = date.today()
    src = await _flock_exact(client, h, shed_a, f"TS-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=6)
    dest = await _flock_exact(client, h, shed_b, f"TD-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=0)
    key = f"p5-tx-conflict-{uuid4().hex}"
    first = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "source_flock_id": src["id"],
            "quantity": 2,
            "effective_date": hatch.isoformat(),
            "idempotency_key": key,
        },
    )
    assert first.status_code == 201, first.text
    conflict = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=h,
        json={
            "destination_flock_id": dest["id"],
            "source_flock_id": src["id"],
            "quantity": 3,
            "effective_date": hatch.isoformat(),
            "idempotency_key": key,
        },
    )
    assert conflict.status_code == 409, conflict.text


@pytest.mark.asyncio
async def test_farmer_lifecycle_record_without_flock_create_empty_dest(
    client: AsyncClient, engine
) -> None:
    """Farmer with lifecycle.record (no flock.create) may create dest cohort on empty shed."""
    owner = await _owner(client, f"p5-farm-empty-{uuid4().hex[:8]}@ex.com", "P5 Farmer Empty")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"FE{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"FD{uuid4().hex[:4].upper()}")
    hatch = date.today()
    await _flock_exact(client, h, shed_a, f"FS-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=8)

    farmer = await _invite_farmer(
        client,
        h,
        owner["owner_id"],
        f"p5-empty-farmer-{uuid4().hex[:8]}@ex.com",
        [shed_a, shed_b],
        permission_codes=[
            "shed.view",
            "flock.view",
            "bird.view",
            "lifecycle.record",
            # Explicitly omit flock.create — empty dest cohort must use lifecycle.record.
        ],
    )
    fh = farmer["headers"]

    # Confirm farmer cannot create flocks directly.
    denied = await client.post(
        "/api/v1/flocks",
        headers=fh,
        json={
            "shed_id": shed_b,
            "batch_code": f"NO-{uuid4().hex[:4].upper()}",
            "initial_count": 1,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": hatch.isoformat(),
            "unbanded_count": 1,
        },
    )
    assert denied.status_code == 403, denied.text

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=fh,
        json={
            "destination_shed_id": shed_b,
            "source_shed_id": shed_a,
            "hatch_date": hatch.isoformat(),
            "effective_date": hatch.isoformat(),
            "quantity": 3,
            "idempotency_key": f"p5-farmer-empty-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text
    body = xfer.json()
    assert body["moved"] == 3
    assert body["destination_shed_id"] == shed_b
    dest_id = body["destination_flock_id"]
    assert dest_id

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        n = await session.scalar(
            select(func.count())
            .select_from(Flock)
            .where(
                Flock.shed_id == shed_b,
                Flock.status == FlockStatus.active,
                Flock.dob_confidence == DobConfidence.exact,
                Flock.hatch_date == hatch,
            )
        )
    assert n == 1

    dest = await client.get(f"/api/v1/flocks/{dest_id}", headers=h)
    assert dest.status_code == 200, dest.text
    assert dest.json()["shed_id"] == shed_b
    assert dest.json()["unbanded_count"] == 3
    assert dest.json()["current_count"] == 3


@pytest.mark.asyncio
async def test_individual_vaccination_history_survives_cohort_transfer(
    client: AsyncClient,
) -> None:
    """Individual vaccination events stay on the bird profile after by-cohort transfer."""
    owner = await _owner(client, f"p5-vax-xfer-{uuid4().hex[:8]}@ex.com", "P5 Vax Xfer")
    h = owner["headers"]
    shed_a = await _shed(client, h, f"VA{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, h, f"VB{uuid4().hex[:4].upper()}")
    hatch = date.today()
    src = await _flock_exact(
        client, h, shed_a, f"VX-{uuid4().hex[:4].upper()}", hatch=hatch, unbanded=4
    )

    band = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=h,
        json={
            "flock_id": src["id"],
            "band_id": f"VX-{uuid4().hex[:5].upper()}",
            "idempotency_key": f"p5-vax-bfu-{uuid4().hex}",
        },
    )
    assert band.status_code == 201, band.text
    bird_id = band.json()["bird"]["id"]

    vax = await client.post(
        "/api/v1/vaccines",
        headers=h,
        json={
            "name": f"P5 ND {uuid4().hex[:4]}",
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": 1,
                    "grace_period_days": 0,
                    "reminder_lead_days": 0,
                }
            ],
        },
    )
    assert vax.status_code == 201, vax.text
    lot = f"LOT-P5-{uuid4().hex[:6].upper()}"
    ind = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "flock_id": src["id"],
            "bird_id": bird_id,
            "vaccine_definition_id": vax.json()["id"],
            "birds_covered": 1,
            "administration_date": hatch.isoformat(),
            "lot_number": lot,
        },
    )
    assert ind.status_code == 201, ind.text
    event_id = ind.json()["id"]

    before = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=h)
    assert before.status_code == 200, before.text
    assert len(before.json()["individual_vaccinations"]) == 1
    assert before.json()["individual_vaccinations"][0]["lot_number"] == lot

    xfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed-by-cohort",
        headers=h,
        json={
            "destination_shed_id": shed_b,
            "hatch_date": hatch.isoformat(),
            "effective_date": hatch.isoformat(),
            "bird_ids": [bird_id],
            "idempotency_key": f"p5-vax-xfer-{uuid4().hex}",
        },
    )
    assert xfer.status_code == 201, xfer.text
    assert xfer.json()["moved"] == 1
    assert xfer.json()["destination_shed_id"] == shed_b
    dest_flock_id = xfer.json()["destination_flock_id"]

    after = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=h)
    assert after.status_code == 200, after.text
    p = after.json()
    assert p["shed_id"] == shed_b
    assert p["flock_id"] == dest_flock_id
    assert len(p["individual_vaccinations"]) == 1
    assert p["individual_vaccinations"][0]["lot_number"] == lot
    assert p["individual_vaccinations"][0]["id"] == event_id
    assert p["individual_vaccinations"][0]["vaccine_name"] == vax.json()["name"]
