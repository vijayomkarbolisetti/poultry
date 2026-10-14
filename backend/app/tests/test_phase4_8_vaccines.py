from datetime import date

import pytest
from httpx import AsyncClient


async def _farm(client: AsyncClient) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": "vaxowner@example.com",
            "password": "password123",
            "full_name": "Vax Owner",
            "organization_name": "Vax Farm",
        },
    )
    assert reg.status_code == 201, reg.text
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}", "X-Owner-Account-Id": owner_id}
    shed = await client.post("/api/v1/sheds", headers=headers, json={"name": "VShed", "code": "VS1"})
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed.json()["id"],
            "batch_code": "VB1",
            "initial_count": 50,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    assert flock.status_code == 201, flock.text
    return {"headers": headers, "flock_id": flock.json()["id"], "shed_id": shed.json()["id"]}


@pytest.mark.asyncio
async def test_vaccine_schedule_vaccinate_report_media(client: AsyncClient) -> None:
    f = await _farm(client)
    vax = await client.post(
        "/api/v1/vaccines",
        headers=f["headers"],
        json={
            "name": "Marek example",
            "category": "vaccine",
            "rules": [{"dose_number": 1, "target_age_days": 1, "grace_period_days": 0, "reminder_lead_days": 1}],
        },
    )
    assert vax.status_code == 201, vax.text
    def_id = vax.json()["id"]

    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=f["headers"],
        json={"flock_id": f["flock_id"], "vaccine_definition_ids": [def_id]},
    )
    assert gen.status_code == 200, gen.text
    assert len(gen.json()) >= 1
    dose_id = gen.json()[0]["id"]

    # late completion should stay late
    rec = await client.post(
        "/api/v1/vaccination-events",
        headers=f["headers"],
        json={
            "scheduled_dose_id": dose_id,
            "administration_date": "2026-02-01",
            "birds_covered": 40,
            "idempotency_key": "vax-1",
            "verification_status": "verified",
        },
    )
    assert rec.status_code == 201, rec.text
    assert rec.json()["timing_status"] == "completed_late"
    assert rec.json()["birds_covered"] == 40

    # idempotent retry
    again = await client.post(
        "/api/v1/vaccination-events",
        headers=f["headers"],
        json={
            "scheduled_dose_id": dose_id,
            "administration_date": "2026-02-01",
            "birds_covered": 40,
            "idempotency_key": "vax-1",
        },
    )
    assert again.status_code == 201
    assert again.json()["id"] == rec.json()["id"]

    report = await client.get("/api/v1/reports/compliance", headers=f["headers"])
    assert report.status_code == 200
    assert "compliance_numerator" in report.json()

    await client.post("/api/v1/notifications/generate", headers=f["headers"])
    notes = await client.get("/api/v1/notifications", headers=f["headers"])
    assert notes.status_code == 200

    sign = await client.post("/api/v1/media/sign", headers=f["headers"], json={"shed_id": f["shed_id"]})
    assert sign.status_code == 200
    assert sign.json()["enabled"] is False  # no cloudinary in test

    media = await client.post(
        "/api/v1/media",
        headers=f["headers"],
        json={"public_id": "test/img1", "shed_id": f["shed_id"], "version": 1},
    )
    assert media.status_code == 201
    mid = media.json()["id"]
    upd = await client.patch(f"/api/v1/media/{mid}", headers=f["headers"], json={"version": 2})
    assert upd.status_code == 200
    assert upd.json()["version"] == 2
    deleted = await client.delete(f"/api/v1/media/{mid}", headers=f["headers"])
    assert deleted.status_code == 200
    assert deleted.json()["is_deleted"] is True

    dash = await client.get("/api/v1/dashboard/summary", headers=f["headers"])
    assert dash.status_code == 200


@pytest.mark.asyncio
async def test_schedule_version_requires_scope(client: AsyncClient) -> None:
    f = await _farm(client)
    # unique email already used — register different
    # reuse farm vaccine
    vax = await client.post(
        "/api/v1/vaccines",
        headers=f["headers"],
        json={"name": "Deworm", "rules": [{"target_age_days": 30, "repeat_interval_days": 30, "max_repeats": 2}]},
    )
    assert vax.status_code == 201
    bad = await client.post(
        f"/api/v1/vaccines/{vax.json()['id']}/versions",
        headers=f["headers"],
        json={"effective_date": date.today().isoformat(), "apply_scope": "selected_flocks", "rules": [{"target_age_days": 35}]},
    )
    assert bad.status_code == 400
