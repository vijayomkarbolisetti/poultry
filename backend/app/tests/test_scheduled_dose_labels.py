"""Phase 2: scheduled-dose display labels without requiring schedule.view."""

import pytest
from httpx import AsyncClient


async def _owner(client: AsyncClient, email: str) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Label Owner",
            "organization_name": f"Org {email}",
        },
    )
    assert reg.status_code == 201, reg.text
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {reg.json()['access_token']}"},
    )
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "token": reg.json()["access_token"],
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
        "owner_id": owner_id,
    }


@pytest.mark.asyncio
async def test_farmer_gets_dose_labels_without_schedule_view(client: AsyncClient) -> None:
    owner = await _owner(client, "dose-labels-owner@example.com")
    headers = owner["headers"]

    cats = await client.get("/api/v1/vaccine-catalogues", headers=headers)
    assert cats.status_code == 200
    cat_id = next(c["id"] for c in cats.json() if c["code"] == "EXAMPLE_GENERAL_POULTRY")
    assigned = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=headers,
        json={"catalogue_id": cat_id, "apply_scope": "all_active"},
    )
    assert assigned.status_code == 200, assigned.text

    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "Label Shed", "code": "LBL1"},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    other = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "Other Shed", "code": "LBL2"},
    )
    assert other.status_code == 201, other.text

    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": "BATCH-LBL",
            "initial_count": 40,
            "unbanded_count": 40,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-09-01",
        },
    )
    assert flock.status_code == 201, flock.text

    other_flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": other.json()["id"],
            "batch_code": "BATCH-OTHER",
            "initial_count": 10,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-09-01",
        },
    )
    assert other_flock.status_code == 201, other_flock.text

    farmer = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "full_name": "Dose Farmer",
            "email": "dose-labels-farmer@example.com",
            "password": "password123",
            "permission_codes": ["vaccination.view", "shed.view", "flock.view"],
            "shed_ids": [shed_id],
        },
    )
    assert farmer.status_code == 201, farmer.text

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "dose-labels-farmer@example.com", "password": "password123"},
    )
    assert login.status_code == 200, login.text
    f_headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": owner["owner_id"],
    }

    # Must not require schedule.view for vaccine names on doses.
    denied = await client.get("/api/v1/vaccines", headers=f_headers)
    assert denied.status_code == 403

    doses = await client.get("/api/v1/vaccines/scheduled-doses", headers=f_headers)
    assert doses.status_code == 200, doses.text
    rows = doses.json()
    assert len(rows) >= 1
    for row in rows:
        assert row["shed_id"] == shed_id
        assert row["vaccine_name"]
        assert "illustrative" in row["vaccine_name"].lower() or len(row["vaccine_name"]) > 1
        assert row["shed_name"] == "Label Shed"
        assert row["flock_label"] == "BATCH-LBL"
        assert row["remaining_count"] == max(0, row["eligible_count"] - row["completed_count"])
        assert row["banded_count"] is not None
        assert row["unbanded_count"] is not None

    # Unassigned shed must not appear.
    assert all(r["shed_name"] != "Other Shed" for r in rows)


@pytest.mark.asyncio
async def test_unknown_hatch_needs_review_on_doses(client: AsyncClient) -> None:
    owner = await _owner(client, "dose-review-owner@example.com")
    headers = owner["headers"]
    cats = await client.get("/api/v1/vaccine-catalogues", headers=headers)
    cat_id = next(c["id"] for c in cats.json() if c["code"] == "EXAMPLE_GENERAL_POULTRY")
    await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=headers,
        json={"catalogue_id": cat_id, "apply_scope": "all_active"},
    )
    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "Review Shed", "code": "REV1"},
    )
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed.json()["id"],
            "batch_code": "BATCH-REV",
            "initial_count": 12,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
            "hatch_date": None,
        },
    )
    assert flock.status_code == 201, flock.text
    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"flock_id": flock.json()["id"]},
    )
    assert doses.status_code == 200
    rows = doses.json()
    assert len(rows) >= 1
    assert all(r["needs_review"] or r["status"] == "needs_review" for r in rows)
    assert all(r.get("vaccine_name") for r in rows)
