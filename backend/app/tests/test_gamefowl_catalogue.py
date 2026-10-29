"""General Schedule rename + Gamefowl Chick Vaccination Schedule (0–18 Weeks)."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from app.models.enums import DobConfidence
from app.services.schedule_engine import (
    STATUS_DUE_TODAY,
    STATUS_OVERDUE,
    compute_dose_status,
    generate_due_dates,
)

GAMEFOWL_CODE = "GAMEFOWL_CHICK_0_18"
GENERAL_CODE = "EXAMPLE_GENERAL_POULTRY"

# Reference ages → elapsed-day offsets (Day 1 hatch = 0) + grace for ranges.
EXPECTED_RULES = [
    ("Marek's", "Day 1", 0, 0, "0.2 ml", "Subcutaneous (S/C)"),
    ("IB + Lasota + ND + VVND (Killed)", "Day 6", 5, 0, "0.5 ml", "Subcutaneous (S/C)"),
    ("IBD Intermediate", "Day 8–9", 7, 1, "Eye drops", "Ocular"),
    ("IBD Plus", "Day 18–19", 17, 1, "Eye drops", "Ocular"),
    ("IB + Lasota Booster", "Day 31", 30, 0, "Dilute in drinking water", "Oral / Water"),
    ("Fowl Pox", "Week 5–6", 34, 7, "0.2 ml", "Subcutaneous (S/C)"),
    ("Coryza", "Week 6–7", 41, 7, "0.5 ml", "Injection"),
    ("IB + Lasota", "Week 10", 69, 0, "1/2 dose (from 1500-dose vial) in drinking water", "Oral / Water"),
    ("Coryza", "Week 14", 97, 0, "0.5 ml", "Injection"),
    ("ND + IB (Killed)", "Week 17", 118, 0, "0.5 ml", "Injection"),
    ("VVND", "Week 18", 125, 0, "0.5 ml", "Injection"),
]


async def _owner(client: AsyncClient, email: str) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Gamefowl Owner",
            "organization_name": "Gamefowl Farm",
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


def _flat_rules(detail: dict) -> list[dict]:
    rows: list[dict] = []
    for item in detail["items"]:
        for rule in item["rules"]:
            rows.append(
                {
                    "name": item["name"],
                    "dose": item.get("recommended_dose_text"),
                    "route": item.get("route"),
                    "label": rule.get("display_day_label"),
                    "age": rule.get("target_age_days"),
                    "grace": rule.get("grace_period_days"),
                }
            )
    rows.sort(key=lambda r: (r["age"] if r["age"] is not None else 10**9, r["name"]))
    return rows


@pytest.mark.asyncio
async def test_general_schedule_rename_preserves_code_and_history(client: AsyncClient) -> None:
    ctx = await _owner(client, "general-rename@example.com")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    assert listed.status_code == 200, listed.text
    cat = next(c for c in listed.json() if c["code"] == GENERAL_CODE)
    assert cat["name"] == "General Schedule"
    assert cat["is_example"] is False
    assert cat.get("requires_veterinary_review") is False
    assert "not a veterinarian" not in (cat.get("description") or "").lower()
    assert "target_age" not in (cat.get("description") or "").lower()

    # Assign once — history / materialization must remain intact on re-list.
    assigned = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": cat["id"], "apply_scope": "all_active"},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["catalogue_code"] == GENERAL_CODE
    assert assigned.json()["catalogue_name"] == "General Schedule"
    materialised = assigned.json()["materialized_definition_ids"]
    assert len(materialised) >= 1

    again = await client.get("/api/v1/vaccine-catalogues/assignment", headers=ctx["headers"])
    assert again.status_code == 200
    assert again.json()["catalogue_id"] == cat["id"]
    assert again.json()["catalogue_name"] == "General Schedule"


@pytest.mark.asyncio
async def test_gamefowl_schedule_has_eleven_reference_entries(client: AsyncClient) -> None:
    ctx = await _owner(client, "gamefowl-entries@example.com")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    assert listed.status_code == 200, listed.text
    codes = [c["code"] for c in listed.json()]
    assert GAMEFOWL_CODE in codes
    assert GENERAL_CODE in codes

    cat = next(c for c in listed.json() if c["code"] == GAMEFOWL_CODE)
    assert cat["name"] == "Gamefowl Chick Vaccination Schedule (0–18 Weeks)"
    assert cat["requires_veterinary_review"] is True
    assert cat["is_example"] is False
    assert cat["item_count"] == 11

    detail = await client.get(f"/api/v1/vaccine-catalogues/{cat['id']}", headers=ctx["headers"])
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["requires_veterinary_review"] is True
    assert len(body["items"]) == 11

    rows = _flat_rules(body)
    assert len(rows) == 11
    for expected, actual in zip(EXPECTED_RULES, rows, strict=True):
        name, label, age, grace, dose, route = expected
        assert actual["name"] == name
        assert actual["label"] == label
        assert actual["age"] == age
        assert actual["grace"] == grace
        assert actual["dose"] == dose
        assert actual["route"] == route


@pytest.mark.asyncio
async def test_gamefowl_seed_idempotent_no_duplicate_catalogue(client: AsyncClient) -> None:
    ctx = await _owner(client, "gamefowl-idem@example.com")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    gamefowl = [c for c in listed.json() if c["code"] == GAMEFOWL_CODE]
    assert len(gamefowl) == 1
    detail = await client.get(
        f"/api/v1/vaccine-catalogues/{gamefowl[0]['id']}", headers=ctx["headers"]
    )
    assert len(detail.json()["items"]) == 11
    assert len(_flat_rules(detail.json())) == 11


@pytest.mark.asyncio
async def test_gamefowl_age_offsets_and_range_due_windows() -> None:
    hatch = date(2026, 1, 1)

    # Day 1 hatch => due on hatch date.
    dues, needs = generate_due_dates(
        hatch_date=hatch,
        target_age_days=0,
        repeat_interval_days=None,
        max_repeats=None,
        dob_confidence=DobConfidence.exact,
    )
    assert needs is False
    assert dues == [hatch]

    # Day 8–9 window: due Day 8 (offset 7), still due_today through Day 9 (grace 1).
    due = hatch + timedelta(days=7)
    assert (
        compute_dose_status(
            due_date=due, grace_period_days=1, reminder_lead_days=3, today=due
        )
        == STATUS_DUE_TODAY
    )
    assert (
        compute_dose_status(
            due_date=due,
            grace_period_days=1,
            reminder_lead_days=3,
            today=due + timedelta(days=1),
        )
        == STATUS_DUE_TODAY
    )
    assert (
        compute_dose_status(
            due_date=due,
            grace_period_days=1,
            reminder_lead_days=3,
            today=due + timedelta(days=2),
        )
        == STATUS_OVERDUE
    )

    # Week 5–6: offsets 34–41 via grace 7 — single due date, one task.
    week_dues, _ = generate_due_dates(
        hatch_date=hatch,
        target_age_days=34,
        repeat_interval_days=None,
        max_repeats=None,
        dob_confidence=DobConfidence.exact,
    )
    assert week_dues == [hatch + timedelta(days=34)]
    assert len(week_dues) == 1
    wdue = week_dues[0]
    assert (
        compute_dose_status(
            due_date=wdue,
            grace_period_days=7,
            reminder_lead_days=3,
            today=wdue + timedelta(days=7),
        )
        == STATUS_DUE_TODAY
    )
    assert (
        compute_dose_status(
            due_date=wdue,
            grace_period_days=7,
            reminder_lead_days=3,
            today=wdue + timedelta(days=8),
        )
        == STATUS_OVERDUE
    )


@pytest.mark.asyncio
async def test_gamefowl_assign_schedules_from_hatch_without_replacing_implicitly(
    client: AsyncClient,
) -> None:
    ctx = await _owner(client, "gamefowl-assign@example.com")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    general = next(c for c in listed.json() if c["code"] == GENERAL_CODE)
    gamefowl = next(c for c in listed.json() if c["code"] == GAMEFOWL_CODE)

    # Explicitly assign General first.
    first = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": general["id"], "apply_scope": "all_active"},
    )
    assert first.status_code == 200, first.text

    # Listing gamefowl must not change current assignment.
    cur = await client.get("/api/v1/vaccine-catalogues/assignment", headers=ctx["headers"])
    assert cur.json()["catalogue_id"] == general["id"]

    shed = await client.post(
        "/api/v1/sheds", headers=ctx["headers"], json={"name": "GF Shed", "code": "GFS1"}
    )
    assert shed.status_code == 201, shed.text
    flock = await client.post(
        "/api/v1/flocks",
        headers=ctx["headers"],
        json={
            "shed_id": shed.json()["id"],
            "batch_code": "GFB1",
            "initial_count": 10,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    assert flock.status_code == 201, flock.text

    preview = await client.get(
        f"/api/v1/vaccine-catalogues/{gamefowl['id']}/preview-assign",
        headers=ctx["headers"],
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["current_catalogue_id"] == general["id"]
    assert "target_age" not in preview.json()["warning"].lower()

    # Explicit switch only after user assign.
    switched = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={
            "catalogue_id": gamefowl["id"],
            "apply_scope": "all_active",
            "confirm_change": True,
        },
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["catalogue_code"] == GAMEFOWL_CODE
    assert switched.json()["regenerated_doses"] >= 1

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"flock_id": flock.json()["id"]},
    )
    assert doses.status_code == 200, doses.text
    due_dates = {d["due_date"] for d in doses.json()}
    # Hatch 2026-01-01 + offsets 0, 5, 7, ...
    assert "2026-01-01" in due_dates  # Day 1
    assert "2026-01-06" in due_dates  # Day 6
    assert "2026-01-08" in due_dates  # Day 8 start of 8–9 window
    # Range entries must not fan out into one task per day.
    day_8_9 = [d for d in doses.json() if d["due_date"] in {"2026-01-08", "2026-01-09"}]
    assert len({d["due_date"] for d in day_8_9}) == 1


@pytest.mark.asyncio
async def test_farmer_cannot_assign_catalogue_by_default(client: AsyncClient) -> None:
    owner = await _owner(client, "gamefowl-farmer-owner@example.com")
    farmer = await client.post(
        "/api/v1/farmers",
        headers=owner["headers"],
        json={
            "email": "gamefowl-farmer@example.com",
            "password": "password123",
            "full_name": "Farm Hand",
            "permission_codes": ["vaccination.view", "vaccination.record", "shed.view"],
        },
    )
    if farmer.status_code not in (200, 201):
        pytest.skip(f"farmer create unavailable: {farmer.status_code} {farmer.text}")
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "gamefowl-farmer@example.com", "password": "password123"},
    )
    assert login.status_code == 200, login.text
    listed = await client.get("/api/v1/vaccine-catalogues", headers=owner["headers"])
    cat_id = next(c["id"] for c in listed.json() if c["code"] == GAMEFOWL_CODE)
    denied = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers={
            "Authorization": f"Bearer {login.json()['access_token']}",
            "X-Owner-Account-Id": owner["owner_id"],
        },
        json={"catalogue_id": cat_id, "apply_scope": "all_active", "confirm_change": True},
    )
    assert denied.status_code in {401, 403}, denied.text
