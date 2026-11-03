"""Cohort population vaccination history appears on bird profile / PDF when attributable."""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient


async def _owner(client: AsyncClient, email: str) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Owner",
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
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        }
    }


@pytest.mark.asyncio
async def test_full_cohort_batch_record_shows_on_bird_profile_and_pdf(
    client: AsyncClient,
) -> None:
    owner = await _owner(client, f"cohort-hist-{uuid4().hex[:8]}@ex.com")
    h = owner["headers"]
    hatch = (date.today() - timedelta(days=20)).isoformat()
    shed = await client.post(
        "/api/v1/sheds",
        headers=h,
        json={"name": "CH", "code": f"CH{uuid4().hex[:4].upper()}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    a = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed_id, "band_id": f"CA-{uuid4().hex[:5].upper()}", "hatch_date": hatch},
    )
    b = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed_id, "band_id": f"CB-{uuid4().hex[:5].upper()}", "hatch_date": hatch},
    )
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["flock_id"] == b.json()["flock_id"]
    flock_id = a.json()["flock_id"]

    vax = await client.post(
        "/api/v1/vaccines",
        headers=h,
        json={
            "name": f"IBD-CH-{uuid4().hex[:4]}",
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": 7,
                    "grace_period_days": 0,
                    "reminder_lead_days": 0,
                }
            ],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=h,
        json={"flock_id": flock_id, "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    dose_id = next(d["id"] for d in gen.json() if d["vaccine_definition_id"] == vax.json()["id"])

    # Population coverage for both banded birds (no bird_id) — how the mobile "all remaining" path records.
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose_id,
            "birds_covered": 2,
            "administration_date": date.today().isoformat(),
            "lot_number": "LOT-COHORT-1",
        },
    )
    assert rec.status_code == 201, rec.text
    assert rec.json().get("bird_id") in (None, "")

    for bird_id in (a.json()["id"], b.json()["id"]):
        prof = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=h)
        assert prof.status_code == 200, prof.text
        rows = prof.json()["individual_vaccinations"]
        assert len(rows) == 1
        assert rows[0]["coverage_scope"] == "cohort"
        assert rows[0]["birds_covered"] == 2
        assert rows[0]["lot_number"] == "LOT-COHORT-1"
        assert rows[0]["vaccine_name"] == vax.json()["name"]

        pdf = await client.get(f"/api/v1/birds/{bird_id}/vaccination-report.pdf", headers=h)
        assert pdf.status_code == 200, pdf.text
        assert pdf.headers["content-type"].startswith("application/pdf")
        assert len(pdf.content) > 1500


@pytest.mark.asyncio
async def test_partial_cohort_batch_not_attributed_to_every_bird(client: AsyncClient) -> None:
    owner = await _owner(client, f"cohort-partial-{uuid4().hex[:8]}@ex.com")
    h = owner["headers"]
    hatch = (date.today() - timedelta(days=18)).isoformat()
    shed = await client.post(
        "/api/v1/sheds",
        headers=h,
        json={"name": "CP", "code": f"CP{uuid4().hex[:4].upper()}", "is_owner_managed": True},
    )
    shed_id = shed.json()["id"]
    a = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed_id, "band_id": f"PA-{uuid4().hex[:5].upper()}", "hatch_date": hatch},
    )
    b = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=h,
        json={"shed_id": shed_id, "band_id": f"PB-{uuid4().hex[:5].upper()}", "hatch_date": hatch},
    )
    flock_id = a.json()["flock_id"]
    vax = await client.post(
        "/api/v1/vaccines",
        headers=h,
        json={
            "name": f"ND-P-{uuid4().hex[:4]}",
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": 5,
                    "grace_period_days": 0,
                    "reminder_lead_days": 0,
                }
            ],
        },
    )
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=h,
        json={"flock_id": flock_id, "vaccine_definition_ids": [vax.json()["id"]]},
    )
    dose_id = next(d["id"] for d in gen.json() if d["vaccine_definition_id"] == vax.json()["id"])
    partial = await client.post(
        "/api/v1/vaccination-events",
        headers=h,
        json={
            "scheduled_dose_id": dose_id,
            "birds_covered": 1,
            "administration_date": date.today().isoformat(),
        },
    )
    assert partial.status_code == 201, partial.text

    for bird_id in (a.json()["id"], b.json()["id"]):
        prof = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=h)
        assert prof.json()["individual_vaccinations"] == []
