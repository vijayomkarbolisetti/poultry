"""Inactive-shed write policy: block new operational onboarding; allow historical catch-up."""

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
        "owner_id": owner_id,
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
    }


async def _farmer(client: AsyncClient, headers: dict, email: str, *, perms: list | None = None) -> dict:
    res = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "email": email,
            "password": "password123",
            "full_name": "Policy Farmer",
            "role": "farmer",
            "permission_codes": perms
            or [
                "shed.view",
                "flock.view",
                "flock.create",
                "flock.update",
                "bird.create",
                "lifecycle.record",
                "vaccination.view",
                "vaccination.record",
                "schedule.view",
                "schedule.manage",
            ],
            "shed_ids": [],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _farmer_headers(client: AsyncClient, email: str, owner_id: str) -> dict:
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    return {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": owner_id,
    }


async def _vaccine(client: AsyncClient, headers: dict) -> dict:
    res = await client.post(
        "/api/v1/vaccines",
        headers=headers,
        json={
            "name": "ND Inactive",
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
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
async def test_inactive_shed_write_matrix(client: AsyncClient) -> None:
    """Documented policy enforcement for inactive sheds."""
    a = await _owner(client, "pol-owner@example.com", "Policy Farm")
    farmer = await _farmer(client, a["headers"], "pol-farmer@example.com")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Policy Shed",
            "code": "POL1",
            "is_owner_managed": False,
            "initial_farmer_membership_id": farmer["membership_id"],
        },
    )
    assert shed.status_code == 201, shed.text
    sid = shed.json()["id"]

    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid,
            "batch_code": "POLB1",
            "initial_count": 20,
            "unbanded_count": 20,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
        },
    )
    assert flock.status_code == 201, flock.text
    fid = flock.json()["id"]

    vaccine = await _vaccine(client, a["headers"])
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=a["headers"],
        json={"flock_id": fid, "vaccine_definition_ids": [vaccine["id"]]},
    )
    assert gen.status_code == 200, gen.text
    doses = gen.json()
    assert len(doses) >= 1
    dose_id = doses[0]["id"]

    deact = await client.post(f"/api/v1/sheds/{sid}/deactivate", headers=a["headers"])
    assert deact.status_code == 200
    assert deact.json()["is_active"] is False

    # --- BLOCKED: new batches / birds / schedules ---
    assert (
        await client.post(
            "/api/v1/flocks",
            headers=a["headers"],
            json={
                "shed_id": sid,
                "batch_code": "POLB2",
                "initial_count": 5,
                "unbanded_count": 5,
                "tracking_mode": "batch",
                "dob_confidence": "unknown",
            },
        )
    ).status_code == 400

    assert (
        await client.post(
            "/api/v1/birds",
            headers=a["headers"],
            json={"flock_id": fid, "band_id": "POL-BAND-1", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
        )
    ).status_code == 400

    assert (
        await client.post(
            "/api/v1/birds/bulk-import",
            headers=a["headers"],
            json={"flock_id": fid, "rows": [{"band_id": "POL-B2"}, {"band_id": "POL-B3"}]},
        )
    ).status_code == 400

    assert (
        await client.post(
            "/api/v1/vaccines/generate-schedules",
            headers=a["headers"],
            json={"flock_id": fid, "vaccine_definition_ids": [vaccine["id"]]},
        )
    ).status_code == 400

    # Farmer also blocked from new batch on inactive assigned shed
    fh = await _farmer_headers(client, "pol-farmer@example.com", a["owner_id"])
    assert (
        await client.post(
            "/api/v1/flocks",
            headers=fh,
            json={
                "shed_id": sid,
                "batch_code": "POLBF",
                "initial_count": 3,
                "unbanded_count": 3,
                "tracking_mode": "batch",
                "dob_confidence": "unknown",
            },
        )
    ).status_code == 400

    # --- ALLOWED: historical catch-up on existing records ---
    vax = await client.post(
        "/api/v1/vaccination-events",
        headers=a["headers"],
        json={
            "scheduled_dose_id": dose_id,
            "birds_covered": 1,
            "verification_status": "verified",
            "idempotency_key": "pol-vax-1",
        },
    )
    assert vax.status_code == 201, vax.text

    life = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "flock_id": fid,
            "event_type": "mortality",
            "quantity": 1,
            "effective_date": "2026-10-18",
            "reason": "catch-up while inactive",
        },
    )
    assert life.status_code == 201, life.text

    upd = await client.patch(
        f"/api/v1/flocks/{fid}",
        headers=a["headers"],
        json={"notes": "reconciled while inactive"},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["notes"] == "reconciled while inactive"

    # Overview history still readable
    ov = await client.get(f"/api/v1/sheds/{sid}/overview", headers=a["headers"])
    assert ov.status_code == 200
    assert ov.json()["shed"]["is_active"] is False
    assert ov.json()["population"]["total_live_birds"] == 19  # 20 - 1 mortality

    # Reactivate restores new batch creation; assignments unchanged
    before_asg = await client.get(f"/api/v1/sheds/{sid}/assignments", headers=a["headers"])
    react = await client.post(f"/api/v1/sheds/{sid}/reactivate", headers=a["headers"])
    assert react.status_code == 200
    after_asg = await client.get(f"/api/v1/sheds/{sid}/assignments", headers=a["headers"])
    assert len(after_asg.json()) == len(before_asg.json()) == 1

    ok = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid,
            "batch_code": "POLB3",
            "initial_count": 2,
            "unbanded_count": 2,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
        },
    )
    assert ok.status_code == 201, ok.text


@pytest.mark.asyncio
async def test_farmer_without_shed_update_denied_lifecycle_ops(client: AsyncClient) -> None:
    a = await _owner(client, "pol-auth@example.com", "Auth Policy Farm")
    farmer = await _farmer(
        client,
        a["headers"],
        "pol-auth-f@example.com",
        perms=["shed.view", "flock.view", "vaccination.view"],
    )
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "AuthPol",
            "code": "AP1",
            "is_owner_managed": False,
            "initial_farmer_membership_id": farmer["membership_id"],
        },
    )
    sid = shed.json()["id"]
    fh = await _farmer_headers(client, "pol-auth-f@example.com", a["owner_id"])

    assert (await client.patch(f"/api/v1/sheds/{sid}", headers=fh, json={"name": "Nope"})).status_code == 403
    assert (await client.post(f"/api/v1/sheds/{sid}/deactivate", headers=fh)).status_code == 403
    assert (await client.post(f"/api/v1/sheds/{sid}/reactivate", headers=fh)).status_code == 403
    assert (
        await client.post(
            f"/api/v1/sheds/{sid}/assignments",
            headers=fh,
            json={"owner_membership_id": farmer["membership_id"], "is_manager": True},
        )
    ).status_code == 403

    # Still can view assigned shed
    assert (await client.get(f"/api/v1/sheds/{sid}/overview", headers=fh)).status_code == 200


@pytest.mark.asyncio
async def test_cross_org_deactivate_and_assignment_rejected(client: AsyncClient) -> None:
    a = await _owner(client, "pol-xa@example.com", "XA Farm")
    b = await _owner(client, "pol-xb@example.com", "XB Farm")
    farmer_b = await _farmer(client, b["headers"], "pol-xb-f@example.com")
    shed_a = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "XA", "code": "XAA", "is_owner_managed": True},
    )
    sid = shed_a.json()["id"]

    assert (await client.post(f"/api/v1/sheds/{sid}/deactivate", headers=b["headers"])).status_code in {
        403,
        404,
    }
    assert (await client.post(f"/api/v1/sheds/{sid}/reactivate", headers=b["headers"])).status_code in {
        403,
        404,
    }
    assert (
        await client.post(
            f"/api/v1/sheds/{sid}/assignments",
            headers=a["headers"],
            json={"owner_membership_id": farmer_b["membership_id"], "is_manager": True},
        )
    ).status_code == 400

    still = await client.get(f"/api/v1/sheds/{sid}", headers=a["headers"])
    assert still.json()["is_active"] is True


@pytest.mark.asyncio
async def test_inactive_shed_allows_media_documentation_with_auth(client: AsyncClient) -> None:
    """Media on inactive sheds is allowed: historical evidence, not new onboarding."""
    a = await _owner(client, "pol-media@example.com", "Media Policy Farm")
    farmer = await _farmer(
        client,
        a["headers"],
        "pol-media-f@example.com",
        perms=["shed.view", "flock.view", "media.view"],  # no media.upload
    )
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={
            "name": "Media Shed",
            "code": "MED1",
            "is_owner_managed": False,
            "initial_farmer_membership_id": farmer["membership_id"],
        },
    )
    sid = shed.json()["id"]
    assert (await client.post(f"/api/v1/sheds/{sid}/deactivate", headers=a["headers"])).status_code == 200

    # Owner may still register documentation media against the inactive shed
    media = await client.post(
        "/api/v1/media",
        headers=a["headers"],
        json={"public_id": "test/inactive-shed-doc", "shed_id": sid, "version": 1},
    )
    assert media.status_code == 201, media.text
    assert media.json().get("id")

    sign = await client.post(
        "/api/v1/media/sign",
        headers=a["headers"],
        json={"shed_id": sid, "folder_suffix": "docs"},
    )
    assert sign.status_code == 200

    # Farmer without media.upload cannot upload
    fh = await _farmer_headers(client, "pol-media-f@example.com", a["owner_id"])
    denied = await client.post(
        "/api/v1/media",
        headers=fh,
        json={"public_id": "test/farmer-denied", "shed_id": sid, "version": 1},
    )
    assert denied.status_code == 403
