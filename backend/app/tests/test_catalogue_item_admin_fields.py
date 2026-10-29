"""Catalogue item product-guidance fields (dose text, route, diluent).

Keeps vaccination_events recording fields separate; no product seed invention.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _owner(client: AsyncClient, label: str = "AdminFields") -> dict:
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
    return {
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
        "owner_id": owner_id,
    }


@pytest.mark.asyncio
async def test_platform_items_expose_null_admin_fields(client: AsyncClient) -> None:
    ctx = await _owner(client, "PlatNull")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    assert listed.status_code == 200, listed.text
    platform = next(c for c in listed.json() if c["code"] == "EXAMPLE_GENERAL_POULTRY")
    detail = await client.get(f"/api/v1/vaccine-catalogues/{platform['id']}", headers=ctx["headers"])
    assert detail.status_code == 200, detail.text
    items = detail.json()["items"]
    assert items
    for item in items:
        assert "recommended_dose_text" in item
        assert "route" in item
        assert "diluent_instructions" in item
        assert item["recommended_dose_text"] is None
        assert item["route"] is None
        assert item["diluent_instructions"] is None


@pytest.mark.asyncio
async def test_create_update_clone_round_trip_admin_fields(client: AsyncClient) -> None:
    ctx = await _owner(client, "RoundTrip")
    created = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=ctx["headers"],
        json={
            "code": "ADMIN_FIELDS_SRC",
            "name": "Admin fields source",
            "items": [
                {
                    "name": "Custom product A",
                    "disease_label": "ND",
                    "instructions": "General note only",
                    "recommended_dose_text": "  1 drop/bird  ",
                    "route": " eye drop ",
                    "diluent_instructions": " Use sterile diluent as labeled ",
                    "rules": [{"dose_number": 1, "target_age_days": 0, "display_day_label": "Day 1"}],
                },
                {
                    "name": "Custom product B",
                    "disease_label": "IBD",
                    "instructions": "",
                    "recommended_dose_text": "",
                    "route": "   ",
                    "diluent_instructions": None,
                    "rules": [{"dose_number": 1, "target_age_days": 14}],
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert len(body["items"]) == 2
    by_name = {i["name"]: i for i in body["items"]}

    a = by_name["Custom product A"]
    assert a["recommended_dose_text"] == "1 drop/bird"
    assert a["route"] == "eye drop"
    assert a["diluent_instructions"] == "Use sterile diluent as labeled"
    assert a["instructions"] == "General note only"

    b = by_name["Custom product B"]
    assert b["recommended_dose_text"] is None
    assert b["route"] is None
    assert b["diluent_instructions"] is None
    assert b["instructions"] is None

    # Clone preserves values and nulls
    cloned = await client.post(
        f"/api/v1/vaccine-catalogues/{body['id']}/clone",
        headers=ctx["headers"],
        json={"code": "ADMIN_FIELDS_CLONE", "name": "Admin fields clone"},
    )
    assert cloned.status_code == 201, cloned.text
    clone_items = {i["name"]: i for i in cloned.json()["items"]}
    assert clone_items["Custom product A"]["recommended_dose_text"] == "1 drop/bird"
    assert clone_items["Custom product A"]["route"] == "eye drop"
    assert clone_items["Custom product A"]["diluent_instructions"] == "Use sterile diluent as labeled"
    assert clone_items["Custom product B"]["recommended_dose_text"] is None
    assert clone_items["Custom product B"]["route"] is None
    assert clone_items["Custom product B"]["diluent_instructions"] is None

    # Update items on farm catalogue (confirm_change required)
    updated = await client.patch(
        f"/api/v1/vaccine-catalogues/{body['id']}",
        headers=ctx["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            "items": [
                {
                    "name": "Custom product A",
                    "disease_label": "ND",
                    "instructions": "General note only",
                    "recommended_dose_text": "as per label",
                    "route": "drinking water",
                    "diluent_instructions": None,
                    "rules": [{"dose_number": 1, "target_age_days": 0}],
                }
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    only = updated.json()["items"][0]
    assert only["recommended_dose_text"] == "as per label"
    assert only["route"] == "drinking water"
    assert only["diluent_instructions"] is None


@pytest.mark.asyncio
async def test_reject_oversized_admin_fields(client: AsyncClient) -> None:
    ctx = await _owner(client, "TooLong")
    too_long_dose = "x" * 129
    resp = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=ctx["headers"],
        json={
            "code": "TOO_LONG",
            "name": "Too long",
            "items": [
                {
                    "name": "Bad",
                    "recommended_dose_text": too_long_dose,
                    "rules": [{"dose_number": 1, "target_age_days": 0}],
                }
            ],
        },
    )
    assert resp.status_code == 422, resp.text
