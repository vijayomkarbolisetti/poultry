"""Regression: catalogue rematerialize must not spawn twin Marex/ND dashboard cards."""

from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _owner_with_custom_catalogue(client: AsyncClient) -> dict:
    email = f"dup-dose-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Dup Dose Owner",
            "organization_name": f"Dup Farm {uuid4().hex[:4]}",
        },
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    headers = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner_id}

    cat = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=headers,
        json={
            "name": f"Prog {uuid4().hex[:4]}",
            "code": f"P{uuid4().hex[:6].upper()}",
            "items": [
                {
                    "name": "Marex",
                    "disease_label": "Marek",
                    "rules": [{"dose_number": 1, "target_age_days": 1, "grace_period_days": 0}],
                },
                {
                    "name": "ND",
                    "disease_label": "ND",
                    "rules": [{"dose_number": 1, "target_age_days": 7, "grace_period_days": 0}],
                },
            ],
        },
    )
    assert cat.status_code == 201, cat.text
    cat_id = cat.json()["id"]

    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=headers,
        json={"catalogue_id": cat_id, "apply_scope": "all_active", "confirm_change": True},
    )
    assert assign.status_code == 200, assign.text

    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "Dup Shed", "code": f"DS-{uuid4().hex[:4].upper()}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    hatch = (date.today() - timedelta(days=10)).isoformat()
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": f"B-{uuid4().hex[:4].upper()}",
            "initial_count": 4,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": hatch,
        },
    )
    assert flock.status_code == 201, flock.text
    return {
        "headers": headers,
        "owner_id": owner_id,
        "shed_id": shed_id,
        "flock_id": flock.json()["id"],
        "catalogue_id": cat_id,
    }


def _counts_by_vaccine(rows: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for d in rows:
        name = d.get("vaccine_name") or "?"
        out[name] = out.get(name, 0) + 1
    return out


@pytest.mark.asyncio
async def test_repeated_catalogue_assign_does_not_duplicate_open_doses(client: AsyncClient) -> None:
    ctx = await _owner_with_custom_catalogue(client)

    before = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"shed_id": ctx["shed_id"]},
    )
    assert before.status_code == 200
    before_counts = _counts_by_vaccine(before.json())
    assert before_counts.get("Marex") == 1, before_counts
    assert before_counts.get("ND") == 1, before_counts

    for _ in range(3):
        again = await client.post(
            "/api/v1/vaccine-catalogues/assign",
            headers=ctx["headers"],
            json={
                "catalogue_id": ctx["catalogue_id"],
                "apply_scope": "all_active",
                "confirm_change": True,
            },
        )
        assert again.status_code == 200, again.text

    after = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=ctx["headers"],
        params={"shed_id": ctx["shed_id"]},
    )
    assert after.status_code == 200
    after_counts = _counts_by_vaccine(after.json())
    assert after_counts.get("Marex") == 1, after_counts
    assert after_counts.get("ND") == 1, after_counts


@pytest.mark.asyncio
async def test_recording_marex_then_nd_with_fresh_keys_updates_dashboard(client: AsyncClient) -> None:
    """Marex then ND: each dose persists; reused key conflicts; dashboard overdue clears."""
    ctx = await _owner_with_custom_catalogue(client)
    headers = ctx["headers"]

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"shed_id": ctx["shed_id"]},
    )
    marex = next(d for d in doses.json() if d["vaccine_name"] == "Marex")
    nd = next(d for d in doses.json() if d["vaccine_name"] == "ND")

    key_m = f"marex-{uuid4().hex}"
    m_res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": key_m,
            "items": [{"scheduled_dose_id": marex["id"], "birds_covered": marex["eligible_count"]}],
        },
    )
    assert m_res.status_code == 201, m_res.text
    assert m_res.json()[0]["scheduled_dose_id"] == marex["id"]

    reuse = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": key_m,
            "items": [{"scheduled_dose_id": nd["id"], "birds_covered": nd["eligible_count"]}],
        },
    )
    assert reuse.status_code == 409, reuse.text

    key_n = f"nd-{uuid4().hex}"
    n_res = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": key_n,
            "items": [{"scheduled_dose_id": nd["id"], "birds_covered": nd["eligible_count"]}],
        },
    )
    assert n_res.status_code == 201, n_res.text
    assert n_res.json()[0]["scheduled_dose_id"] == nd["id"]

    replay = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": key_n,
            "items": [{"scheduled_dose_id": nd["id"], "birds_covered": nd["eligible_count"]}],
        },
    )
    assert replay.status_code == 201
    assert replay.json()[0]["id"] == n_res.json()[0]["id"]

    listed = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"shed_id": ctx["shed_id"]},
    )
    by_id = {d["id"]: d for d in listed.json()}
    assert str(by_id[marex["id"]]["status"]).startswith("completed")
    assert by_id[marex["id"]]["completed_count"] == marex["eligible_count"]
    assert str(by_id[nd["id"]]["status"]).startswith("completed")
    assert by_id[nd["id"]]["completed_count"] == nd["eligible_count"]

    overview = await client.get(f"/api/v1/sheds/{ctx['shed_id']}/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["vaccination"]["overdue"] == 0


@pytest.mark.asyncio
async def test_partial_then_finish_keeps_single_dose_card(client: AsyncClient) -> None:
    ctx = await _owner_with_custom_catalogue(client)
    headers = ctx["headers"]
    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"shed_id": ctx["shed_id"]},
    )
    marex = next(d for d in doses.json() if d["vaccine_name"] == "Marex")
    elig = marex["eligible_count"]
    assert elig >= 2

    part = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"part-{uuid4().hex}",
            "items": [{"scheduled_dose_id": marex["id"], "birds_covered": 1}],
        },
    )
    assert part.status_code == 201, part.text

    mid = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"shed_id": ctx["shed_id"]},
    )
    row = next(d for d in mid.json() if d["id"] == marex["id"])
    assert row["completed_count"] == 1
    assert row["remaining_count"] == elig - 1
    assert not str(row["status"]).startswith("completed")
    assert _counts_by_vaccine(mid.json()).get("Marex") == 1

    fin = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=headers,
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"fin-{uuid4().hex}",
            "items": [{"scheduled_dose_id": marex["id"], "birds_covered": elig - 1}],
        },
    )
    assert fin.status_code == 201, fin.text

    end = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"shed_id": ctx["shed_id"]},
    )
    row2 = next(d for d in end.json() if d["id"] == marex["id"])
    assert row2["completed_count"] == elig
    assert str(row2["status"]).startswith("completed")
    assert _counts_by_vaccine(end.json()).get("Marex") == 1
