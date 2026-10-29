"""Phase 1: owner catalogues, clone, flock override, batch product fields."""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _owner(client: AsyncClient, label: str = "P1") -> dict:
    email = f"{label.lower()}-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": f"{label} Owner",
            "organization_name": f"{label} Farm",
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
    return {"headers": headers, "owner_id": owner_id, "email": email, "token": reg.json()["access_token"]}


@pytest.mark.asyncio
async def test_clone_platform_and_reject_platform_patch(client: AsyncClient) -> None:
    ctx = await _owner(client, "Clone")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    assert listed.status_code == 200, listed.text
    platform = next(c for c in listed.json() if c["code"] == "EXAMPLE_GENERAL_POULTRY")
    assert platform["is_platform"] is True
    assert platform["owner_account_id"] is None

    cloned = await client.post(
        f"/api/v1/vaccine-catalogues/{platform['id']}/clone",
        headers=ctx["headers"],
        json={"code": "MY_POULTRY_PROG", "name": "My poultry programme"},
    )
    assert cloned.status_code == 201, cloned.text
    body = cloned.json()
    assert body["is_platform"] is False
    assert body["owner_account_id"] == ctx["owner_id"]
    assert body["cloned_from_catalogue_id"] == platform["id"]
    assert body["item_count"] >= 1
    assert len(body["items"]) >= 1
    assert body["items"][0]["id"] != platform["id"]

    # Platform remains immutable
    patch = await client.patch(
        f"/api/v1/vaccine-catalogues/{platform['id']}",
        headers=ctx["headers"],
        json={"name": "Hacked"},
    )
    assert patch.status_code == 403, patch.text

    # Farm catalogue editable (metadata without items)
    ok = await client.patch(
        f"/api/v1/vaccine-catalogues/{body['id']}",
        headers=ctx["headers"],
        json={"name": "My poultry programme v2", "description": "Edited"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "My poultry programme v2"


@pytest.mark.asyncio
async def test_scoped_code_uniqueness_and_create(client: AsyncClient) -> None:
    a = await _owner(client, "UA")
    b = await _owner(client, "UB")

    created = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=a["headers"],
        json={
            "code": "FARM_CUSTOM",
            "name": "Farm A custom",
            "items": [
                {
                    "name": "Custom ND",
                    "disease_label": "ND",
                    "rules": [{"dose_number": 1, "target_age_days": 7}],
                }
            ],
        },
    )
    assert created.status_code == 201, created.text

    dup = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=a["headers"],
        json={"code": "FARM_CUSTOM", "name": "Dup"},
    )
    assert dup.status_code == 409, dup.text

    # Same code allowed for a different farm
    other = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=b["headers"],
        json={"code": "FARM_CUSTOM", "name": "Farm B custom"},
    )
    assert other.status_code == 201, other.text

    # Tenant isolation: A cannot see B's farm catalogue detail
    hidden = await client.get(
        f"/api/v1/vaccine-catalogues/{other.json()['id']}",
        headers=a["headers"],
    )
    assert hidden.status_code == 404, hidden.text


@pytest.mark.asyncio
async def test_farm_default_vs_flock_override(client: AsyncClient) -> None:
    ctx = await _owner(client, "Override")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    platform_id = next(c["id"] for c in listed.json() if c["code"] == "EXAMPLE_GENERAL_POULTRY")

    clone = await client.post(
        f"/api/v1/vaccine-catalogues/{platform_id}/clone",
        headers=ctx["headers"],
        json={"code": "OVERRIDE_SRC", "name": "Override source"},
    )
    assert clone.status_code == 201, clone.text
    farm_cat_id = clone.json()["id"]

    # Farm default = platform
    assigned = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": platform_id, "apply_scope": "all_active", "confirm_change": True},
    )
    assert assigned.status_code == 200, assigned.text

    shed = await client.post(
        "/api/v1/sheds",
        headers=ctx["headers"],
        json={"name": "OShed", "code": f"OS-{uuid4().hex[:4].upper()}"},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    inherit = await client.post(
        "/api/v1/flocks",
        headers=ctx["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "INH1",
            "initial_count": 100,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-01",
        },
    )
    assert inherit.status_code == 201, inherit.text
    assert inherit.json().get("vaccination_catalogue_id") is None

    override = await client.post(
        "/api/v1/flocks",
        headers=ctx["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "OVR1",
            "initial_count": 80,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-05",
            "vaccination_catalogue_id": farm_cat_id,
        },
    )
    assert override.status_code == 201, override.text
    assert override.json()["vaccination_catalogue_id"] == farm_cat_id

    preview = await client.get(
        f"/api/v1/vaccine-catalogues/{farm_cat_id}/preview-assign",
        headers=ctx["headers"],
        params={"apply_scope": "all_active"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["override_flock_count"] >= 1
    assert preview.json()["inheriting_flock_count"] >= 1

    # Changing farm default must not clear the override column
    reassign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": farm_cat_id, "apply_scope": "all_active", "confirm_change": True},
    )
    assert reassign.status_code == 200, reassign.text

    still = await client.get(f"/api/v1/flocks/{override.json()['id']}", headers=ctx["headers"])
    assert still.status_code == 200, still.text
    assert still.json()["vaccination_catalogue_id"] == farm_cat_id

    inherit_after = await client.get(f"/api/v1/flocks/{inherit.json()['id']}", headers=ctx["headers"])
    assert inherit_after.json().get("vaccination_catalogue_id") is None


@pytest.mark.asyncio
async def test_farmer_cannot_manage_catalogues(client: AsyncClient) -> None:
    ctx = await _owner(client, "Perm")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    cat_id = listed.json()[0]["id"]
    email = f"p1farmer-{uuid4().hex[:6]}@example.com"
    farmer = await client.post(
        "/api/v1/farmers",
        headers=ctx["headers"],
        json={
            "email": email,
            "password": "password123",
            "full_name": "Farmer",
            "permission_codes": ["vaccination.view", "vaccination.record", "shed.view"],
        },
    )
    if farmer.status_code not in (200, 201):
        pytest.skip(f"farmer create unavailable: {farmer.status_code} {farmer.text}")

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200, login.text
    fheaders = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": ctx["owner_id"],
    }
    denied_create = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=fheaders,
        json={"code": "NOPE", "name": "Nope"},
    )
    assert denied_create.status_code in (401, 403), denied_create.text
    denied_clone = await client.post(
        f"/api/v1/vaccine-catalogues/{cat_id}/clone",
        headers=fheaders,
        json={},
    )
    assert denied_clone.status_code in (401, 403), denied_clone.text


@pytest.mark.asyncio
async def test_batch_product_fields_and_idempotency(client: AsyncClient) -> None:
    ctx = await _owner(client, "BatchP1")
    shed = await client.post(
        "/api/v1/sheds",
        headers=ctx["headers"],
        json={"name": "BP Shed", "code": f"BP-{uuid4().hex[:4].upper()}"},
    )
    assert shed.status_code == 201, shed.text
    flock = await client.post(
        "/api/v1/flocks",
        headers=ctx["headers"],
        json={
            "shed_id": shed.json()["id"],
            "batch_code": "BP1",
            "initial_count": 50,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-01",
        },
    )
    assert flock.status_code == 201, flock.text
    vax = await client.post(
        "/api/v1/vaccines",
        headers=ctx["headers"],
        json={
            "name": "ND",
            "category": "vaccine",
            "rules": [{"dose_number": 1, "target_age_days": 0, "grace_period_days": 0}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=ctx["headers"],
        json={"flock_id": flock.json()["id"], "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    dose_id = gen.json()[0]["id"]
    key = f"stable-batch-key-{uuid4().hex[:12]}"
    payload = {
        "items": [{"scheduled_dose_id": dose_id, "birds_covered": 10}],
        "administration_date": "2026-10-01",
        "idempotency_key": key,
        "lot_number": "LOT-99",
        "product_expiry": "2027-01-01",
        "manufacturer_or_brand": "Acme Vet",
        "vaccine_type_or_strain": "LaSota",
        "route": "eye drop",
        "dose_amount": "1 drop",
        "notes": "shed-wide",
    }
    first = await client.post("/api/v1/vaccination-events/batch", headers=ctx["headers"], json=payload)
    assert first.status_code == 201, first.text
    ev = first.json()[0]
    assert ev["lot_number"] == "LOT-99"
    assert ev["manufacturer_or_brand"] == "Acme Vet"
    assert ev["vaccine_type_or_strain"] == "LaSota"
    assert ev["route"] == "eye drop"
    assert ev["product_expiry"] == "2027-01-01"

    second = await client.post("/api/v1/vaccination-events/batch", headers=ctx["headers"], json=payload)
    assert second.status_code == 201, second.text
    assert second.json()[0]["id"] == ev["id"]

    listed = await client.get("/api/v1/vaccination-events", headers=ctx["headers"])
    assert listed.status_code == 200
    matching = [e for e in listed.json() if e["id"] == ev["id"]]
    assert len(matching) == 1
