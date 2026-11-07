"""Sick-bird episodes: recording, recovery, history, reporting, and isolation."""

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


async def _flock(
    client: AsyncClient, headers: dict, shed_id: str, code: str, *, hatch: str | None = None
) -> dict:
    r = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": 8,
            "tracking_mode": "mixed",
            "dob_confidence": "exact" if hatch else "unknown",
            "hatch_date": hatch,
            "unbanded_count": 8,
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


async def _stack(client: AsyncClient, auth: dict, suffix: str | None = None):
    tag = suffix or uuid4().hex[:6].upper()
    shed = await _shed(client, auth["headers"], f"S{tag}"[:20])
    flock = await _flock(client, auth["headers"], shed, f"B{tag}"[:24], hatch="2026-01-15")
    bird = await _bird(client, auth["headers"], flock["id"], f"BIRD{tag}"[:24])
    return shed, flock, bird


def _payload(**overrides):
    today = date.today()
    payload = {
        "sick_date": today.isoformat(),
        "symptoms": "Reduced appetite, lethargy",
        "severity": "moderate",
        "notes": "Separated from the group",
        "treatment": "Electrolytes and vitamins",
        "follow_up_date": (today + timedelta(days=2)).isoformat(),
        "idempotency_key": f"sickness-{uuid4().hex}",
    }
    payload.update(overrides)
    return payload


async def _invite_farmer(
    client: AsyncClient,
    headers: dict,
    owner_id: str,
    *,
    email: str,
    shed_ids: list[str],
    permissions: list[str],
) -> dict:
    created = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "email": email,
            "password": "password123",
            "full_name": "Sickness Farmer",
            "role": "farmer",
            "shed_ids": shed_ids,
            "permission_codes": permissions,
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
        },
        "membership_id": created.json()["membership_id"],
    }


@pytest.mark.asyncio
async def test_single_record_duplicate_history_profile_and_list(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-single-{uuid4().hex[:8]}@example.com", "Sick Farm")
    _, _, bird = await _stack(client, auth)

    created = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(),
    )
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["bird_id"] == bird["id"]
    assert record["status"] == "active"
    assert record["severity"] == "moderate"
    assert record["bird_is_active"] is True
    assert record["follow_up_state"] in {"upcoming", "due"}

    duplicate = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(idempotency_key=None),
    )
    assert duplicate.status_code == 409, duplicate.text

    history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=auth["headers"]
    )
    assert history.status_code == 200, history.text
    body = history.json()
    assert body["current_health_status"] == "sick"
    assert body["total_episodes"] == 1
    assert body["active_episode"]["id"] == record["id"]
    assert body["episodes"][0]["id"] == record["id"]

    profile = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=auth["headers"])
    assert profile.status_code == 200, profile.text
    assert profile.json()["health"]["status"] == "sick"
    assert len(profile.json()["sickness_episodes"]) == 1

    listing = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active"}
    )
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] == 1
    assert listing.json()["items"][0]["bird_id"] == bird["id"]

    summary = await client.get("/api/v1/sickness/summary", headers=auth["headers"])
    assert summary.status_code == 200, summary.text
    assert summary.json()["currently_sick_birds"] == 1
    assert summary.json()["active_episodes"] == 1


@pytest.mark.asyncio
async def test_bulk_creates_one_record_per_bird_and_is_all_or_nothing(
    client: AsyncClient,
) -> None:
    auth = await _owner(client, f"sick-bulk-{uuid4().hex[:8]}@example.com", "Bulk Sick Farm")
    shed, flock, _ = await _stack(client, auth)
    birds = [
        await _bird(client, auth["headers"], flock["id"], f"BULK-{uuid4().hex[:6].upper()}")
        for _ in range(3)
    ]

    bulk = await client.post(
        "/api/v1/sickness/bulk",
        headers=auth["headers"],
        json={
            **_payload(),
            "bird_ids": [bird["id"] for bird in birds],
        },
    )
    assert bulk.status_code == 201, bulk.text
    result = bulk.json()
    assert result["success_count"] == 3
    assert {row["bird_id"] for row in result["recorded"]} == {bird["id"] for bird in birds}

    listing = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active", "limit": 50}
    )
    assert listing.json()["total"] == 3

    extra_birds = [
        await _bird(client, auth["headers"], flock["id"], f"MORE-{uuid4().hex[:6].upper()}")
        for _ in range(2)
    ]
    rejected = await client.post(
        "/api/v1/sickness/bulk",
        headers=auth["headers"],
        json={
            **_payload(),
            "bird_ids": [birds[0]["id"], extra_birds[0]["id"], extra_birds[1]["id"]],
        },
    )
    assert rejected.status_code == 409, rejected.text
    listing = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active", "limit": 50}
    )
    assert listing.json()["total"] == 3, "bulk failure must not commit partial rows"

    invalid = await client.post(
        "/api/v1/sickness/bulk",
        headers=auth["headers"],
        json={**_payload(), "bird_ids": [str(uuid4())]},
    )
    assert invalid.status_code in {400, 404}, invalid.text

    unbanded = await client.post(
        "/api/v1/sickness/bulk",
        headers=auth["headers"],
        json={**_payload(), "bird_ids": [flock["id"]]},
    )
    assert unbanded.status_code in {400, 404}, "flock/count IDs are not individual birds"

    duplicate_ids = await client.post(
        "/api/v1/sickness/bulk",
        headers=auth["headers"],
        json={**_payload(), "bird_ids": [birds[1]["id"], birds[1]["id"]]},
    )
    assert duplicate_ids.status_code == 422

    assert shed  # keep the stack explicit in the test setup


@pytest.mark.asyncio
async def test_recovery_repeat_episode_and_edit_rules(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-recover-{uuid4().hex[:8]}@example.com", "Recover Farm")
    _, _, bird = await _stack(client, auth)
    today = date.today()

    first = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(
            sick_date=(today - timedelta(days=3)).isoformat(),
            follow_up_date=(today - timedelta(days=1)).isoformat(),
        ),
    )
    assert first.status_code == 201, first.text
    record = first.json()

    invalid_recovery = await client.post(
        f"/api/v1/sickness/{record['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": (today - timedelta(days=4)).isoformat()},
    )
    assert invalid_recovery.status_code == 400

    recovered = await client.post(
        f"/api/v1/sickness/{record['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": (today - timedelta(days=1)).isoformat(), "notes": "Eating again"},
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["status"] == "recovered"
    assert recovered.json()["recovery_date"] == (today - timedelta(days=1)).isoformat()
    assert recovered.json()["recovered_by_user_id"]
    assert recovered.json()["symptoms"] == record["symptoms"]

    again = await client.post(
        f"/api/v1/sickness/{record['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": today.isoformat()},
    )
    assert again.status_code == 409

    edit_recovered = await client.patch(
        f"/api/v1/sickness/{record['id']}",
        headers=auth["headers"],
        json={"symptoms": "Changed"},
    )
    assert edit_recovered.status_code == 409

    second = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(sick_date=today.isoformat(), follow_up_date=None),
    )
    assert second.status_code == 201, second.text

    history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=auth["headers"]
    )
    body = history.json()
    assert body["total_episodes"] == 2
    assert body["episodes"][0]["sick_date"] == today.isoformat()
    assert body["episodes"][1]["status"] == "recovered"
    assert body["last_recovery_date"] == (today - timedelta(days=1)).isoformat()
    assert body["current_health_status"] == "sick"

    edit_active = await client.patch(
        f"/api/v1/sickness/{body['episodes'][0]['id']}",
        headers=auth["headers"],
        json={"symptoms": "Coughing", "severity": "severe"},
    )
    assert edit_active.status_code == 200, edit_active.text
    assert edit_active.json()["symptoms"] == "Coughing"
    assert edit_active.json()["severity"] == "severe"


@pytest.mark.asyncio
async def test_validation_dates_and_severity(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-valid-{uuid4().hex[:8]}@example.com", "Valid Farm")
    _, _, bird = await _stack(client, auth)
    today = date.today()

    future = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(sick_date=(today + timedelta(days=1)).isoformat()),
    )
    assert future.status_code == 400

    follow_up_before = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(
            sick_date=today.isoformat(),
            follow_up_date=(today - timedelta(days=1)).isoformat(),
        ),
    )
    assert follow_up_before.status_code == 400

    bad_severity = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(severity="critical"),
    )
    assert bad_severity.status_code == 422


@pytest.mark.asyncio
async def test_permissions_tenant_isolation_and_profile_redaction(client: AsyncClient) -> None:
    owner = await _owner(client, f"sick-owner-{uuid4().hex[:8]}@example.com", "Owner Farm")
    shed, _, bird = await _stack(client, owner)

    record_resp = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=owner["headers"],
        json=_payload(),
    )
    assert record_resp.status_code == 201, record_resp.text
    record = record_resp.json()

    farmer = await _invite_farmer(
        client,
        owner["headers"],
        owner["owner_id"],
        email=f"sick-farmer-{uuid4().hex[:8]}@example.com",
        shed_ids=[shed],
        permissions=[
            "bird.view",
            "sickness.view",
            "sickness.record",
            "sickness.recover",
        ],
    )
    farmer_history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=farmer["headers"]
    )
    assert farmer_history.status_code == 200, farmer_history.text

    farmer_without_codes = await _invite_farmer(
        client,
        owner["headers"],
        owner["owner_id"],
        email=f"sick-no-perm-{uuid4().hex[:8]}@example.com",
        shed_ids=[shed],
        permissions=["bird.view"],
    )
    denied = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=farmer_without_codes["headers"],
        json=_payload(),
    )
    assert denied.status_code == 403
    denied_list = await client.get("/api/v1/sickness", headers=farmer_without_codes["headers"])
    assert denied_list.status_code == 403

    profile_no_health = await client.get(
        f"/api/v1/birds/{bird['id']}/profile", headers=farmer_without_codes["headers"]
    )
    assert profile_no_health.status_code == 200, profile_no_health.text
    assert profile_no_health.json()["health"] is None
    assert profile_no_health.json()["sickness_episodes"] == []

    other_shed, _, other_bird = await _stack(client, owner)
    unassigned = await _invite_farmer(
        client,
        owner["headers"],
        owner["owner_id"],
        email=f"sick-other-shed-{uuid4().hex[:8]}@example.com",
        shed_ids=[other_shed],
        permissions=["bird.view", "sickness.view", "sickness.record"],
    )
    unassigned_create = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=unassigned["headers"],
        json=_payload(),
    )
    assert unassigned_create.status_code == 403

    stranger = await _owner(
        client, f"sick-stranger-{uuid4().hex[:8]}@example.com", "Stranger Farm"
    )
    foreign_history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=stranger["headers"]
    )
    assert foreign_history.status_code in {403, 404}
    foreign_recover = await client.post(
        f"/api/v1/sickness/{record['id']}/recover",
        headers=stranger["headers"],
        json={"recovery_date": date.today().isoformat()},
    )
    assert foreign_recover.status_code in {403, 404}
    foreign_bulk = await client.post(
        "/api/v1/sickness/bulk",
        headers=stranger["headers"],
        json={**_payload(), "bird_ids": [bird["id"], other_bird["id"]]},
    )
    assert foreign_bulk.status_code in {400, 403, 404}


@pytest.mark.asyncio
async def test_vaccination_unaffected_and_mortality_excludes_current_sick(
    client: AsyncClient,
) -> None:
    auth = await _owner(client, f"sick-life-{uuid4().hex[:8]}@example.com", "Life Farm")
    _, _, bird = await _stack(client, auth)
    today = date.today()

    vaccination = await client.post(
        "/api/v1/vaccination-events/manual-batch",
        headers=auth["headers"],
        json={
            "bird_ids": [bird["id"]],
            "custom_vaccine_name": "QA Vaccine",
            "administration_date": today.isoformat(),
            "idempotency_key": f"vax-{uuid4().hex}",
        },
    )
    assert vaccination.status_code == 201, vaccination.text
    before = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=auth["headers"])
    assert before.status_code == 200, before.text
    before_vax = before.json()["individual_vaccinations"]

    sickness = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(sick_date=today.isoformat()),
    )
    assert sickness.status_code == 201, sickness.text

    after = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=auth["headers"])
    assert after.json()["individual_vaccinations"] == before_vax
    assert after.json()["batch_upcoming_doses"] == before.json()["batch_upcoming_doses"]

    mortality = await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "mortality",
            "effective_date": today.isoformat(),
            "bird_id": bird["id"],
            "reason": "QA mortality after sickness",
            "idempotency_key": f"mort-{uuid4().hex}",
        },
    )
    assert mortality.status_code == 201, mortality.text

    history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=auth["headers"]
    )
    assert history.status_code == 200, history.text
    assert history.json()["total_episodes"] == 1
    assert history.json()["current_health_status"] == "unresolved_inactive"
    assert history.json()["active_episode"]["status"] == "active"

    listing = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active"}
    )
    assert listing.json()["total"] == 0, "dead birds are not currently sick"

    recover = await client.post(
        f"/api/v1/sickness/{history.json()['active_episode']['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": today.isoformat()},
    )
    assert recover.status_code == 409, "dead birds cannot be marked recovered"


@pytest.mark.asyncio
async def test_transfer_preserves_history_and_updates_current_shed_filter(
    client: AsyncClient,
) -> None:
    auth = await _owner(client, f"sick-transfer-{uuid4().hex[:8]}@example.com", "Transfer Farm")
    source_shed, _, bird = await _stack(client, auth)
    dest_shed = await _shed(client, auth["headers"], f"D{uuid4().hex[:6].upper()}")
    dest_flock = await _flock(
        client, auth["headers"], dest_shed, f"DF{uuid4().hex[:6]}", hatch="2026-01-15"
    )

    sickness = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(),
    )
    assert sickness.status_code == 201, sickness.text

    transfer = await client.post(
        "/api/v1/lifecycle-events/transfer-to-shed",
        headers=auth["headers"],
        json={
            "destination_flock_id": dest_flock["id"],
            "effective_date": date.today().isoformat(),
            "bird_ids": [bird["id"]],
            "reason": "QA shed move",
            "idempotency_key": f"move-{uuid4().hex}",
        },
    )
    assert transfer.status_code == 201, transfer.text

    dest_list = await client.get(
        "/api/v1/sickness",
        headers=auth["headers"],
        params={"status": "active", "shed_id": dest_shed},
    )
    assert dest_list.status_code == 200, dest_list.text
    assert dest_list.json()["total"] == 1
    item = dest_list.json()["items"][0]
    assert item["current_shed_id"] == dest_shed
    assert item["recorded_shed_id"] == source_shed

    source_list = await client.get(
        "/api/v1/sickness",
        headers=auth["headers"],
        params={"status": "active", "shed_id": source_shed},
    )
    assert source_list.json()["total"] == 0


@pytest.mark.asyncio
async def test_idempotency_replay_conflict_and_partial_bulk(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-idem-{uuid4().hex[:8]}@example.com", "Idem Farm")
    shed, flock, bird = await _stack(client, auth)
    payload = _payload()

    first = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=payload,
    )
    assert first.status_code == 201, first.text
    replay = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=payload,
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == first.json()["id"]

    conflict = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json={**payload, "symptoms": "Different symptoms"},
    )
    assert conflict.status_code == 409

    listing = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active"}
    )
    assert listing.json()["total"] == 1

    bulk_birds = [
        await _bird(client, auth["headers"], flock["id"], f"IDEM-{uuid4().hex[:5].upper()}")
        for _ in range(3)
    ]
    bulk_key = f"bulk-{uuid4().hex}"
    bulk_payload = {
        **_payload(idempotency_key=bulk_key),
        "bird_ids": [bulk_birds[0]["id"], bulk_birds[1]["id"]],
    }
    bulk = await client.post(
        "/api/v1/sickness/bulk", headers=auth["headers"], json=bulk_payload
    )
    assert bulk.status_code == 201, bulk.text
    assert bulk.json()["success_count"] == 2
    bulk_replay = await client.post(
        "/api/v1/sickness/bulk", headers=auth["headers"], json=bulk_payload
    )
    assert bulk_replay.status_code == 201, bulk_replay.text
    assert bulk_replay.json()["idempotent_replay"] is True
    assert {row["id"] for row in bulk_replay.json()["recorded"]} == {
        row["id"] for row in bulk.json()["recorded"]
    }

    partial = await client.post(
        "/api/v1/sickness/bulk",
        headers=auth["headers"],
        json={
            **_payload(idempotency_key=bulk_key),
            "bird_ids": [
                bulk_birds[0]["id"],
                bulk_birds[1]["id"],
                bulk_birds[2]["id"],
            ],
        },
    )
    assert partial.status_code == 409
    assert shed  # explicit stack use


@pytest.mark.asyncio
async def test_sale_preserves_history_and_excludes_current_sick(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-sale-{uuid4().hex[:8]}@example.com", "Sale Sick Farm")
    _, _, bird = await _stack(client, auth)
    today = date.today()

    sickness = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(sick_date=today.isoformat()),
    )
    assert sickness.status_code == 201, sickness.text

    sale = await client.post(
        "/api/v1/lifecycle-events",
        headers=auth["headers"],
        json={
            "event_type": "sale",
            "effective_date": today.isoformat(),
            "bird_id": bird["id"],
            "buyer_name": "QA Buyer",
            "buyer_mobile": "9876543210",
            "idempotency_key": f"sale-{uuid4().hex}",
        },
    )
    assert sale.status_code == 201, sale.text

    history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=auth["headers"]
    )
    assert history.status_code == 200, history.text
    assert history.json()["total_episodes"] == 1
    assert history.json()["current_health_status"] == "unresolved_inactive"

    listing = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active"}
    )
    assert listing.json()["total"] == 0

    sold = await client.get("/api/v1/birds/sold", headers=auth["headers"])
    assert sold.status_code == 200, sold.text
    assert sold.json()["total"] == 1

    recover = await client.post(
        f"/api/v1/sickness/{sickness.json()['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": today.isoformat()},
    )
    assert recover.status_code == 409


@pytest.mark.asyncio
async def test_band_change_preserves_history(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-band-{uuid4().hex[:8]}@example.com", "Band Sick Farm")
    _, _, bird = await _stack(client, auth)
    record = await client.post(
        f"/api/v1/birds/{bird['id']}/sickness",
        headers=auth["headers"],
        json=_payload(),
    )
    assert record.status_code == 201, record.text

    new_band = f"NEW-{uuid4().hex[:6].upper()}"
    updated = await client.patch(
        f"/api/v1/birds/{bird['id']}",
        headers=auth["headers"],
        json={"band_id": new_band},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["band_id"] == new_band

    history = await client.get(
        f"/api/v1/birds/{bird['id']}/sickness-history", headers=auth["headers"]
    )
    assert history.status_code == 200, history.text
    assert history.json()["total_episodes"] == 1
    assert history.json()["band_id"] == new_band
    assert history.json()["episodes"][0]["id"] == record.json()["id"]


@pytest.mark.asyncio
async def test_list_filters_search_and_status(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-filter-{uuid4().hex[:8]}@example.com", "Filter Farm")
    today = date.today()
    shed1, _, bird1 = await _stack(client, auth)
    shed2, _, bird2 = await _stack(client, auth)
    band1 = f"FILTER-A-{uuid4().hex[:5].upper()}"
    band2 = f"FILTER-B-{uuid4().hex[:5].upper()}"
    # Replace bands so search is deterministic.
    for bird, band in ((bird1, band1), (bird2, band2)):
        upd = await client.patch(
            f"/api/v1/birds/{bird['id']}", headers=auth["headers"], json={"band_id": band}
        )
        assert upd.status_code == 200, upd.text

    severe = await client.post(
        f"/api/v1/birds/{bird1['id']}/sickness",
        headers=auth["headers"],
        json=_payload(
            severity="severe",
            symptoms="Labored breathing",
            sick_date=(today - timedelta(days=4)).isoformat(),
            follow_up_date=(today - timedelta(days=2)).isoformat(),
        ),
    )
    assert severe.status_code == 201, severe.text
    moderate = await client.post(
        f"/api/v1/birds/{bird2['id']}/sickness",
        headers=auth["headers"],
        json=_payload(
            severity="moderate",
            symptoms="Reduced appetite",
            sick_date=today.isoformat(),
            follow_up_date=(today + timedelta(days=3)).isoformat(),
        ),
    )
    assert moderate.status_code == 201, moderate.text

    by_severity = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"severity": "severe"}
    )
    assert by_severity.json()["total"] == 1
    assert by_severity.json()["items"][0]["bird_id"] == bird1["id"]

    by_shed = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"shed_id": shed1}
    )
    assert by_shed.json()["total"] == 1
    assert by_shed.json()["items"][0]["bird_id"] == bird1["id"]

    by_search = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"q": band1}
    )
    assert by_search.json()["total"] == 1
    assert by_search.json()["items"][0]["band_id"] == band1

    overdue = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"follow_up_state": "overdue"}
    )
    assert overdue.json()["total"] == 1
    assert overdue.json()["items"][0]["bird_id"] == bird1["id"]

    recover = await client.post(
        f"/api/v1/sickness/{severe.json()['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": today.isoformat()},
    )
    assert recover.status_code == 200, recover.text
    recovered = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "recovered"}
    )
    assert recovered.json()["total"] == 1
    assert recovered.json()["items"][0]["bird_id"] == bird1["id"]
    active = await client.get(
        "/api/v1/sickness", headers=auth["headers"], params={"status": "active"}
    )
    assert active.json()["total"] == 1
    assert active.json()["items"][0]["bird_id"] == bird2["id"]
    assert shed2  # explicit second-shed setup


@pytest.mark.asyncio
async def test_summary_counts_recovered_and_followups(client: AsyncClient) -> None:
    auth = await _owner(client, f"sick-summary-{uuid4().hex[:8]}@example.com", "Summary Farm")
    shed, flock, _ = await _stack(client, auth)
    today = date.today()

    birds = [
        await _bird(client, auth["headers"], flock["id"], f"SUM-{uuid4().hex[:5].upper()}")
        for _ in range(3)
    ]
    overdue = await client.post(
        f"/api/v1/birds/{birds[0]['id']}/sickness",
        headers=auth["headers"],
        json=_payload(
            sick_date=(today - timedelta(days=4)).isoformat(),
            follow_up_date=(today - timedelta(days=1)).isoformat(),
        ),
    )
    assert overdue.status_code == 201, overdue.text
    due = await client.post(
        f"/api/v1/birds/{birds[1]['id']}/sickness",
        headers=auth["headers"],
        json=_payload(
            sick_date=today.isoformat(),
            follow_up_date=(today + timedelta(days=2)).isoformat(),
        ),
    )
    assert due.status_code == 201, due.text
    recovered = await client.post(
        f"/api/v1/birds/{birds[2]['id']}/sickness",
        headers=auth["headers"],
        json=_payload(sick_date=(today - timedelta(days=5)).isoformat(), follow_up_date=None),
    )
    assert recovered.status_code == 201, recovered.text
    recover_resp = await client.post(
        f"/api/v1/sickness/{recovered.json()['id']}/recover",
        headers=auth["headers"],
        json={"recovery_date": today.isoformat()},
    )
    assert recover_resp.status_code == 200, recover_resp.text

    summary = await client.get("/api/v1/sickness/summary", headers=auth["headers"])
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["currently_sick_birds"] == 2
    assert body["active_episodes"] == 2
    assert body["follow_ups_overdue"] == 1
    assert body["follow_ups_due"] == 1
    assert body["recovered_birds"] == 1
    assert body["recovered_episodes"] == 1
    assert body["new_episodes"] == 3
    assert body["new_unique_birds"] == 3
    assert body["severity_breakdown"]["moderate"] == 2
    assert body["shed_breakdown"][0]["shed_id"] == shed
    assert body["shed_breakdown"][0]["active_birds"] == 2
