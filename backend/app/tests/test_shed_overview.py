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
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "owner_id": owner_id,
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
    }


async def _farmer_headers(client: AsyncClient, email: str, owner_id: str) -> dict:
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200, login.text
    return {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": owner_id,
    }


@pytest.mark.asyncio
async def test_shed_overview_population_and_empty_vax(client: AsyncClient) -> None:
    a = await _owner(client, "overview-owner@example.com", "Overview Farm")
    shed = await client.post(
        "/api/v1/sheds",
        headers=a["headers"],
        json={"name": "Shed A", "code": "SA1", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    shed_id = shed.json()["id"]

    empty = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert empty.status_code == 200, empty.text
    body = empty.json()
    assert body["shed"]["id"] == shed_id
    assert body["organization_name"] == "Overview Farm"
    assert body["population"]["total_live_birds"] == 0
    assert body["population"]["active_batch_count"] == 0
    assert body["population"]["banded_birds"] == 0
    assert body["population"]["unbanded_birds"] == 0
    assert body["vaccination"] == {"overdue": 0, "due_today": 0, "upcoming": 0, "needs_review": 0}
    assert body["batches"] == []

    b1 = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "BATCH-001",
            "breed": "Asil",
            "initial_count": 100,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-10-18",
        },
    )
    assert b1.status_code == 201, b1.text
    b2 = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "BATCH-002",
            "breed": "Asil",
            "initial_count": 80,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 10,
            "unbanded_count": 80,
        },
    )
    assert b2.status_code == 201, b2.text

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert overview.status_code == 200, overview.text
    data = overview.json()
    assert data["population"]["total_live_birds"] == 180
    assert data["population"]["active_batch_count"] == 2
    # batch mode: all unbanded; mixed starts as unbanded 80 — no double-count vs total
    assert data["population"]["banded_birds"] + data["population"]["unbanded_birds"] >= data["population"][
        "total_live_birds"
    ] or data["population"]["unbanded_birds"] == 180
    assert data["population"]["banded_birds"] == 0
    assert data["population"]["unbanded_birds"] == 180
    codes = {b["batch_code"] for b in data["batches"]}
    assert codes == {"BATCH-001", "BATCH-002"}


@pytest.mark.asyncio
async def test_shed_overview_vaccination_scoped_and_auth(client: AsyncClient) -> None:
    a = await _owner(client, "overview-vax@example.com", "Vax Overview Farm")
    shed_a = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Alpha", "code": "A1"}
    )
    shed_b = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Beta", "code": "B1"}
    )
    assert shed_a.status_code == 201 and shed_b.status_code == 201
    sid_a, sid_b = shed_a.json()["id"], shed_b.json()["id"]

    flock_a = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid_a,
            "batch_code": "VA1",
            "initial_count": 50,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    flock_b = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid_b,
            "batch_code": "VB1",
            "initial_count": 40,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    assert flock_a.status_code == 201 and flock_b.status_code == 201

    vax = await client.post(
        "/api/v1/vaccines",
        headers=a["headers"],
        json={
            "name": "Overview Vax",
            "rules": [{"dose_number": 1, "target_age_days": 1, "grace_period_days": 0, "reminder_lead_days": 1}],
        },
    )
    assert vax.status_code == 201, vax.text
    def_id = vax.json()["id"]
    for fid in (flock_a.json()["id"], flock_b.json()["id"]):
        gen = await client.post(
            "/api/v1/vaccines/generate-schedules",
            headers=a["headers"],
            json={"flock_id": fid, "vaccine_definition_ids": [def_id]},
        )
        assert gen.status_code == 200, gen.text

    ov_a = await client.get(f"/api/v1/sheds/{sid_a}/overview", headers=a["headers"])
    ov_b = await client.get(f"/api/v1/sheds/{sid_b}/overview", headers=a["headers"])
    assert ov_a.status_code == 200 and ov_b.status_code == 200
    tasks_a = sum(ov_a.json()["vaccination"].values())
    tasks_b = sum(ov_b.json()["vaccination"].values())
    assert tasks_a >= 1
    assert tasks_b >= 1
    # Shed A overview must not include shed B batches
    assert all(b["batch_code"] != "VB1" for b in ov_a.json()["batches"])

    farmer = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "overview-farmer@example.com",
            "password": "password123",
            "full_name": "Overview Farmer",
            "role": "farmer",
            "permission_codes": [
                "shed.view",
                "flock.view",
                "vaccination.view",
                "report.view",
            ],
            "shed_ids": [sid_a],
        },
    )
    assert farmer.status_code == 201, farmer.text
    f_headers = await _farmer_headers(client, "overview-farmer@example.com", a["owner_id"])

    ok = await client.get(f"/api/v1/sheds/{sid_a}/overview", headers=f_headers)
    assert ok.status_code == 200, ok.text
    denied = await client.get(f"/api/v1/sheds/{sid_b}/overview", headers=f_headers)
    assert denied.status_code in {403, 404}

    # Unfiltered flock list must not leak shed B to this farmer
    flocks = await client.get("/api/v1/flocks", headers=f_headers)
    assert flocks.status_code == 200
    assert all(f["shed_id"] == sid_a for f in flocks.json())
    assert all(f["batch_code"] != "VB1" for f in flocks.json())

    doses = await client.get("/api/v1/vaccines/scheduled-doses", headers=f_headers)
    assert doses.status_code == 200
    assert all(d["shed_id"] == sid_a for d in doses.json())

    doses_b = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=f_headers,
        params={"shed_id": sid_b},
    )
    assert doses_b.status_code in {403, 404}


@pytest.mark.asyncio
async def test_shed_overview_mixed_banding_no_double_count(client: AsyncClient) -> None:
    a = await _owner(client, "overview-band@example.com", "Band Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Band Shed", "code": "BD1"}
    )
    shed_id = shed.json()["id"]
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "MIX-1",
            "initial_count": 50,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
            "unbanded_count": 50,
        },
    )
    assert flock.status_code == 201, flock.text
    flock_id = flock.json()["id"]
    bird = await client.post(
        "/api/v1/birds/band-from-unbanded",
        headers=a["headers"],
        json={
            "flock_id": flock_id,
            "band_id": "BND-1",
            "idempotency_key": "overview-band-cnv-1",
        },
    )
    assert bird.status_code == 201, bird.text

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert overview.status_code == 200, overview.text
    pop = overview.json()["population"]
    assert pop["total_live_birds"] == pop["banded_birds"] + pop["unbanded_birds"]
    assert pop["total_live_birds"] == 50
    assert pop["banded_birds"] == 1
    assert pop["unbanded_birds"] == 49


@pytest.mark.asyncio
async def test_shed_overview_excludes_closed_includes_zero_and_individual(client: AsyncClient) -> None:
    a = await _owner(client, "overview-modes@example.com", "Modes Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Mode Shed", "code": "MD1"}
    )
    shed_id = shed.json()["id"]

    zero = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "ZERO-1",
            "initial_count": 0,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
        },
    )
    assert zero.status_code == 201, zero.text

    closed = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "CLOSED-1",
            "initial_count": 25,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
        },
    )
    assert closed.status_code == 201, closed.text
    patch = await client.patch(
        f"/api/v1/flocks/{closed.json()['id']}",
        headers=a["headers"],
        json={"status": "closed"},
    )
    assert patch.status_code == 200, patch.text

    individual = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "IND-1",
            "initial_count": 0,
            "tracking_mode": "individual",
            "dob_confidence": "unknown",
        },
    )
    assert individual.status_code == 201, individual.text
    for band in ("I1", "I2", "I3"):
        bird = await client.post(
            "/api/v1/birds",
            headers=a["headers"],
            json={
                "flock_id": individual.json()["id"],
                "band_id": band,
                "dob_confidence": "exact",
                "hatch_date": "2026-01-01",
            },
        )
        assert bird.status_code == 201, bird.text

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert overview.status_code == 200, overview.text
    data = overview.json()
    codes = {b["batch_code"] for b in data["batches"]}
    assert "CLOSED-1" not in codes
    assert "ZERO-1" in codes
    assert "IND-1" in codes
    # zero + 3 individual birds
    assert data["population"]["total_live_birds"] == 3
    assert data["population"]["active_batch_count"] == 2
    assert data["population"]["banded_birds"] == 3
    assert data["population"]["unbanded_birds"] == 0
    assert data["population"]["banded_birds"] + data["population"]["unbanded_birds"] == data[
        "population"
    ]["total_live_birds"]


@pytest.mark.asyncio
async def test_shed_overview_vax_buckets_match_scheduled_doses_api(client: AsyncClient) -> None:
    a = await _owner(client, "overview-buckets@example.com", "Bucket Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Bucket Shed", "code": "BK1"}
    )
    shed_id = shed.json()["id"]
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "BK-B1",
            "initial_count": 10,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    assert flock.status_code == 201, flock.text
    vax = await client.post(
        "/api/v1/vaccines",
        headers=a["headers"],
        json={
            "name": "Bucket Vax",
            "rules": [{"dose_number": 1, "target_age_days": 1, "grace_period_days": 0, "reminder_lead_days": 1}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=a["headers"],
        json={"flock_id": flock.json()["id"], "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=a["headers"],
        params={"shed_id": shed_id},
    )
    assert doses.status_code == 200, doses.text
    rows = doses.json()
    expected = {"overdue": 0, "due_today": 0, "upcoming": 0, "needs_review": 0}
    for d in rows:
        st = d["status"]
        if st == "overdue":
            expected["overdue"] += 1
        elif st == "due_today":
            expected["due_today"] += 1
        elif st in {"upcoming", "due_soon"}:
            expected["upcoming"] += 1
        elif st == "needs_review":
            expected["needs_review"] += 1

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert overview.status_code == 200, overview.text
    assert overview.json()["vaccination"] == expected


@pytest.mark.asyncio
async def test_farmer_cannot_read_unassigned_flock_or_events(client: AsyncClient) -> None:
    a = await _owner(client, "overview-auth2@example.com", "Auth2 Farm")
    shed_a = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Auth A", "code": "AA1"}
    )
    shed_b = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Auth B", "code": "BB1"}
    )
    sid_a, sid_b = shed_a.json()["id"], shed_b.json()["id"]
    flock_b = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": sid_b,
            "batch_code": "AUTH-B",
            "initial_count": 5,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
        },
    )
    assert flock_b.status_code == 201, flock_b.text
    fid_b = flock_b.json()["id"]

    farmer = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "overview-auth2-farmer@example.com",
            "password": "password123",
            "full_name": "Auth Farmer",
            "role": "farmer",
            "permission_codes": [
                "shed.view",
                "flock.view",
                "vaccination.view",
                "bird.view",
            ],
            "shed_ids": [sid_a],
        },
    )
    assert farmer.status_code == 201, farmer.text
    f_headers = await _farmer_headers(client, "overview-auth2-farmer@example.com", a["owner_id"])

    denied_flock = await client.get(f"/api/v1/flocks/{fid_b}", headers=f_headers)
    assert denied_flock.status_code in {403, 404}

    denied_birds = await client.get("/api/v1/birds", headers=f_headers, params={"flock_id": fid_b})
    assert denied_birds.status_code in {403, 404}

    denied_events = await client.get(
        "/api/v1/vaccination-events",
        headers=f_headers,
        params={"flock_id": fid_b},
    )
    assert denied_events.status_code in {403, 404}

    events = await client.get("/api/v1/vaccination-events", headers=f_headers)
    assert events.status_code == 200
    assert all(e.get("shed_id") != sid_b for e in events.json())


@pytest.mark.asyncio
async def test_dashboard_active_birds_uses_batch_current_count(client: AsyncClient) -> None:
    a = await _owner(client, "dash-live@example.com", "Dash Live Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Dash Shed", "code": "DS1"}
    )
    assert shed.status_code == 201, shed.text
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed.json()["id"],
            "batch_code": "DASH-B1",
            "initial_count": 75,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
        },
    )
    assert flock.status_code == 201, flock.text
    dash = await client.get("/api/v1/dashboard/summary", headers=a["headers"])
    assert dash.status_code == 200, dash.text
    # Batch-only farm has 0 Bird rows; live population must still be 75
    assert dash.json()["active_birds"] == 75
    assert dash.json()["active_flocks"] == 1


@pytest.mark.asyncio
async def test_shed_overview_shed_view_only_shows_vax_aggregates_not_dose_details(
    client: AsyncClient,
) -> None:
    """Policy: shed.view may see overview vaccination bucket counts; dose rows need vaccination.view."""
    a = await _owner(client, "overview-shedview@example.com", "ShedView Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "SV Shed", "code": "SV1"}
    )
    shed_id = shed.json()["id"]
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "SV-B1",
            "initial_count": 10,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-01",
        },
    )
    assert flock.status_code == 201, flock.text
    vax = await client.post(
        "/api/v1/vaccines",
        headers=a["headers"],
        json={
            "name": "SV Vax",
            "rules": [{"dose_number": 1, "target_age_days": 1, "grace_period_days": 0, "reminder_lead_days": 1}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=a["headers"],
        json={"flock_id": flock.json()["id"], "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text

    view_only = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "shed-view-only@example.com",
            "password": "password123",
            "full_name": "View Only",
            "role": "farmer",
            "permission_codes": ["shed.view"],
            "shed_ids": [shed_id],
        },
    )
    assert view_only.status_code == 201, view_only.text
    h = await _farmer_headers(client, "shed-view-only@example.com", a["owner_id"])

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=h)
    assert overview.status_code == 200, overview.text
    assert sum(overview.json()["vaccination"].values()) >= 1

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=h,
        params={"shed_id": shed_id},
    )
    assert doses.status_code == 403

    events = await client.get("/api/v1/vaccination-events", headers=h)
    assert events.status_code == 403

    with_vax = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "shed-view-vax@example.com",
            "password": "password123",
            "full_name": "View Vax",
            "role": "farmer",
            "permission_codes": ["shed.view", "vaccination.view"],
            "shed_ids": [shed_id],
        },
    )
    assert with_vax.status_code == 201, with_vax.text
    hv = await _farmer_headers(client, "shed-view-vax@example.com", a["owner_id"])
    doses_ok = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=hv,
        params={"shed_id": shed_id},
    )
    assert doses_ok.status_code == 200
    assert len(doses_ok.json()) >= 1


@pytest.mark.asyncio
async def test_overview_refresh_updates_stale_dose_status(
    client: AsyncClient, db_session
) -> None:
    """Shed overview (and shed-scoped dose list) refresh open statuses using farm-local today."""
    from sqlalchemy import text

    a = await _owner(client, "overview-fresh@example.com", "Fresh Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "Fresh Shed", "code": "FR1"}
    )
    shed_id = shed.json()["id"]
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "FR-B1",
            "initial_count": 5,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": "2020-01-01",
        },
    )
    assert flock.status_code == 201, flock.text
    vax = await client.post(
        "/api/v1/vaccines",
        headers=a["headers"],
        json={
            "name": "Fresh Vax",
            "rules": [{"dose_number": 1, "target_age_days": 1, "grace_period_days": 0, "reminder_lead_days": 0}],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=a["headers"],
        json={"flock_id": flock.json()["id"], "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    dose_id = gen.json()[0]["id"]

    await db_session.execute(
        text("SET LOCAL app.rls_bypass = 'on'")
    )
    await db_session.execute(
        text("UPDATE scheduled_doses SET status = 'upcoming' WHERE id = CAST(:id AS uuid)"),
        {"id": dose_id},
    )
    await db_session.commit()

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert overview.status_code == 200, overview.text
    assert overview.json()["vaccination"]["upcoming"] == 0
    assert overview.json()["vaccination"]["overdue"] >= 1

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=a["headers"],
        params={"shed_id": shed_id},
    )
    assert doses.status_code == 200, doses.text
    row = next(d for d in doses.json() if d["id"] == dose_id)
    assert row["status"] == "overdue"
    assert overview.json()["vaccination"]["overdue"] == sum(
        1 for d in doses.json() if d["status"] == "overdue"
    )


@pytest.mark.asyncio
async def test_shed_overview_surfaces_count_mismatch_flag(
    client: AsyncClient, db_session
) -> None:
    from sqlalchemy import text

    a = await _owner(client, "overview-mismatch@example.com", "Mismatch Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "MM Shed", "code": "MM1"}
    )
    shed_id = shed.json()["id"]
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "MM-B1",
            "initial_count": 40,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
            "unbanded_count": 40,
        },
    )
    assert flock.status_code == 201, flock.text
    fid = flock.json()["id"]

    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    await db_session.execute(
        text(
            """
            UPDATE flocks
            SET banded_count = 5, unbanded_count = 30, count_mismatch = true
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": fid},
    )
    await db_session.commit()

    overview = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert overview.status_code == 200, overview.text
    data = overview.json()
    batch = next(b for b in data["batches"] if b["id"] == fid)
    assert batch["count_mismatch"] is True
    assert batch["current_count"] == 40
    assert batch["banded_count"] + batch["unbanded_count"] != batch["current_count"]
    # Live total still uses current_count; banded/unbanded are not auto-corrected
    assert data["population"]["total_live_birds"] == 40
    assert data["population"]["banded_birds"] == 5
    assert data["population"]["unbanded_birds"] == 30
    assert (
        data["population"]["banded_birds"] + data["population"]["unbanded_birds"]
        != data["population"]["total_live_birds"]
    )


@pytest.mark.asyncio
async def test_shed_overview_mismatch_clears_after_reconcile(
    client: AsyncClient, db_session
) -> None:
    """Setting current_count to match banded+unbanded clears count_mismatch (reconcile path).

    ``reconcile_flock_counts`` derives ``banded_count`` from active Bird rows, so a
    legitimate clear must align ``current_count`` with that derived banded total plus
    ``unbanded_count`` — not with a stale SQL-only banded figure.
    """
    from sqlalchemy import text

    a = await _owner(client, "overview-mm-clear@example.com", "MM Clear Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "MMC Shed", "code": "MMC"}
    )
    shed_id = shed.json()["id"]
    flock = await client.post(
        "/api/v1/flocks",
        headers=a["headers"],
        json={
            "shed_id": shed_id,
            "batch_code": "MMC-B1",
            "initial_count": 40,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
            "unbanded_count": 40,
        },
    )
    assert flock.status_code == 201, flock.text
    fid = flock.json()["id"]
    # 0 birds → banded stays 0; inflate current_count to force mismatch with unbanded=40
    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    await db_session.execute(
        text(
            """
            UPDATE flocks
            SET current_count = 55, unbanded_count = 40, banded_count = 0, count_mismatch = true
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": fid},
    )
    await db_session.commit()

    before = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert before.status_code == 200
    assert any(b["count_mismatch"] for b in before.json()["batches"])
    assert before.json()["population"]["total_live_birds"] == 55

    # Align live headcount with unbanded (banded derived from birds = 0)
    patch = await client.patch(
        f"/api/v1/flocks/{fid}",
        headers=a["headers"],
        json={"current_count": 40},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["count_mismatch"] is False
    assert patch.json()["current_count"] == 40

    after = await client.get(f"/api/v1/sheds/{shed_id}/overview", headers=a["headers"])
    assert after.status_code == 200
    assert all(not b["count_mismatch"] for b in after.json()["batches"])
    assert after.json()["population"]["total_live_birds"] == 40
    assert (
        after.json()["population"]["banded_birds"]
        + after.json()["population"]["unbanded_birds"]
        == after.json()["population"]["total_live_birds"]
    )
