from datetime import date

import pytest
from httpx import AsyncClient

from app.services.notification_service import format_dose_alert_body


def test_format_dose_alert_body_uses_shed_and_hatch() -> None:
    body = format_dose_alert_body(
        due_date=date(2026, 9, 10),
        shed_name="North Shed",
        hatch_date=date(2026, 1, 1),
    )
    assert body == "Dose due 2026-09-10 (North Shed \u00b7 hatch 2026-01-01)"
    assert "flock" not in body.lower()
    assert "batch" not in body.lower()


def test_format_dose_alert_body_fallback_without_context() -> None:
    body = format_dose_alert_body(due_date=date(2026, 9, 10))
    assert body == "Dose due 2026-09-10"
    assert "flock" not in body.lower()
    assert "batch" not in body.lower()


def test_format_dose_alert_body_strips_blank_shed_name() -> None:
    body = format_dose_alert_body(due_date=date(2026, 1, 5), shed_name="  ")
    assert body == "Dose due 2026-01-05"
    assert "batch" not in body.lower()


async def _farm_with_overdue_dose(client: AsyncClient) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": "notif-batch@example.com",
            "password": "password123",
            "full_name": "Notif Owner",
            "organization_name": "Notif Farm",
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
    shed = await client.post("/api/v1/sheds", headers=headers, json={"name": "NShed", "code": "NS1"})
    assert shed.status_code == 201, shed.text
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed.json()["id"],
            "batch_code": "NB-ALERT-1",
            "initial_count": 20,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]
    vax = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": "Alert Vax",
            "category": "vaccine",
            "rules": [
                {
                    "dose_number": 1,
                    "target_age_days": 1,
                    "grace_period_days": 0,
                    "reminder_lead_days": 1,
                }
            ],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=headers,
        json={"flock_id": flock_id, "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    assert len(gen.json()) >= 1
    return {
        "headers": headers,
        "flock_id": flock_id,
        "shed_name": "NShed",
        "hatch_date": "2026-01-01",
        "due_date": gen.json()[0]["due_date"],
    }


@pytest.mark.asyncio
async def test_generated_notification_body_uses_shed_hatch_terminology(client: AsyncClient) -> None:
    farm = await _farm_with_overdue_dose(client)
    created = await client.post("/api/v1/notifications/generate", headers=farm["headers"])
    assert created.status_code == 200, created.text

    notes = await client.get("/api/v1/notifications", headers=farm["headers"])
    assert notes.status_code == 200, notes.text
    bodies = [n["body"] for n in notes.json()]
    assert bodies, "expected at least one notification"
    expected = f"Dose due {farm['due_date']} ({farm['shed_name']} \u00b7 hatch {farm['hatch_date']})"
    assert expected in bodies
    for body in bodies:
        assert "flock" not in body.lower()
        assert "batch" not in body.lower()
        assert str(farm["flock_id"]) not in body
