"""B1/B2 bird search and profile — authz, tenant isolation, empty individual history."""

from datetime import date

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


async def _farmer(
    client: AsyncClient,
    headers: dict,
    email: str,
    *,
    perms: list[str],
    shed_ids: list[str],
) -> dict:
    res = await client.post(
        "/api/v1/farmers",
        headers=headers,
        json={
            "email": email,
            "password": "password123",
            "full_name": "Farmer",
            "role": "farmer",
            "permission_codes": perms,
            "shed_ids": shed_ids,
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


async def _mixed_flock(client: AsyncClient, headers: dict, shed_id: str, code: str) -> dict:
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": 20,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 30,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": 20,
            "breed": "Layer",
        },
    )
    assert flock.status_code == 201, flock.text
    return flock.json()


@pytest.mark.asyncio
async def test_bird_search_exact_partial_pagination(client: AsyncClient) -> None:
    a = await _owner(client, "bird-search@example.com", "Search Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "S1", "code": "S1", "is_owner_managed": True}
    )
    sid = shed.json()["id"]
    flock = await _mixed_flock(client, a["headers"], sid, "SRCH1")

    for band in ("WING-100", "WING-101", "LEG-200", "WING-X"):
        r = await client.post(
            "/api/v1/birds",
            headers=a["headers"],
            json={"flock_id": flock["id"], "band_id": band, "dob_confidence": "exact", "hatch_date": "2026-01-15"},
        )
        assert r.status_code == 201, r.text

    exact = await client.get("/api/v1/birds/search", headers=a["headers"], params={"q": "WING-100"})
    assert exact.status_code == 200, exact.text
    body = exact.json()
    assert body["total"] >= 1
    assert body["exact_count"] >= 1
    assert any(i["band_id"] == "WING-100" and i["match_kind"] == "exact" for i in body["items"])

    partial = await client.get("/api/v1/birds/search", headers=a["headers"], params={"q": "WING"})
    assert partial.status_code == 200
    bands = {i["band_id"] for i in partial.json()["items"]}
    assert "WING-100" in bands and "WING-101" in bands and "WING-X" in bands
    assert "LEG-200" not in bands
    assert partial.json()["total"] >= 3

    page = await client.get(
        "/api/v1/birds/search",
        headers=a["headers"],
        params={"q": "WING", "limit": 2, "offset": 0},
    )
    assert page.status_code == 200
    assert len(page.json()["items"]) == 2
    assert page.json()["total"] >= 3

    empty = await client.get("/api/v1/birds/search", headers=a["headers"], params={"q": "NOPE-ZZZ"})
    assert empty.status_code == 200
    assert empty.json()["total"] == 0
    assert empty.json()["items"] == []


@pytest.mark.asyncio
async def test_bird_search_farmer_shed_scope_and_missing_perm(client: AsyncClient) -> None:
    a = await _owner(client, "bird-search-f@example.com", "Farmer Search Farm")
    shed_a = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "A", "code": "A1", "is_owner_managed": True}
    )
    shed_b = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "B", "code": "B1", "is_owner_managed": True}
    )
    fa = await _mixed_flock(client, a["headers"], shed_a.json()["id"], "FA1")
    fb = await _mixed_flock(client, a["headers"], shed_b.json()["id"], "FB1")
    ba = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": fa["id"], "band_id": "SHARED-A", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    bb = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": fb["id"], "band_id": "SHARED-B", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert ba.status_code == 201 and bb.status_code == 201

    farmer = await _farmer(
        client,
        a["headers"],
        "search-farmer@example.com",
        perms=["bird.view", "shed.view", "flock.view"],
        shed_ids=[shed_a.json()["id"]],
    )
    fh = await _farmer_headers(client, "search-farmer@example.com", a["owner_id"])
    assert farmer["membership_id"]

    scoped = await client.get("/api/v1/birds/search", headers=fh, params={"q": "SHARED"})
    assert scoped.status_code == 200
    bands = {i["band_id"] for i in scoped.json()["items"]}
    assert bands == {"SHARED-A"}

    denied = await _farmer(
        client,
        a["headers"],
        "no-bird-view@example.com",
        perms=["shed.view"],
        shed_ids=[shed_a.json()["id"]],
    )
    assert denied
    nh = await _farmer_headers(client, "no-bird-view@example.com", a["owner_id"])
    assert (await client.get("/api/v1/birds/search", headers=nh, params={"q": "SHARED"})).status_code == 403


@pytest.mark.asyncio
async def test_bird_search_tenant_isolation(client: AsyncClient) -> None:
    a = await _owner(client, "bird-ten-a@example.com", "Tenant A")
    b = await _owner(client, "bird-ten-b@example.com", "Tenant B")
    shed_a = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "TA", "code": "TA", "is_owner_managed": True}
    )
    flock = await _mixed_flock(client, a["headers"], shed_a.json()["id"], "TA1")
    bird = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": flock["id"], "band_id": "SECRET-99", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert bird.status_code == 201

    other = await client.get("/api/v1/birds/search", headers=b["headers"], params={"q": "SECRET-99"})
    assert other.status_code == 200
    assert other.json()["total"] == 0

    cross = await client.get(f"/api/v1/birds/{bird.json()['id']}/profile", headers=b["headers"])
    assert cross.status_code == 404


@pytest.mark.asyncio
async def test_bird_profile_individual_history_not_batch_events(client: AsyncClient) -> None:
    a = await _owner(client, "bird-prof@example.com", "Profile Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "P", "code": "P1", "is_owner_managed": True}
    )
    flock = await _mixed_flock(client, a["headers"], shed.json()["id"], "PR1")
    bird = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": flock["id"], "band_id": "PROF-1", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    bird_id = bird.json()["id"]

    vax = await client.post(
        "/api/v1/vaccines",
        headers=a["headers"],
        json={
            "name": "ND Profile",
            "rules": [
                {"dose_number": 1, "target_age_days": 1, "grace_period_days": 0, "reminder_lead_days": 0}
            ],
        },
    )
    assert vax.status_code == 201, vax.text
    gen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=a["headers"],
        json={"flock_id": flock["id"], "vaccine_definition_ids": [vax.json()["id"]]},
    )
    assert gen.status_code == 200, gen.text
    doses = gen.json()
    assert len(doses) >= 1

    # Full cohort population coverage (covers the one banded bird present) — appears as cohort scope.
    batch_rec = await client.post(
        "/api/v1/vaccination-events",
        headers=a["headers"],
        json={
            "scheduled_dose_id": doses[0]["id"],
            "birds_covered": 5,
            "administration_date": date.today().isoformat(),
        },
    )
    assert batch_rec.status_code == 201, batch_rec.text
    assert batch_rec.json().get("bird_id") in (None, )

    # Individual event on this bird
    ind = await client.post(
        "/api/v1/vaccination-events",
        headers=a["headers"],
        json={
            "flock_id": flock["id"],
            "bird_id": bird_id,
            "vaccine_definition_id": vax.json()["id"],
            "birds_covered": 1,
            "administration_date": date.today().isoformat(),
            "lot_number": "LOT-1",
            "product_expiry": "2027-06-01",
            "manufacturer_or_brand": "Acme",
            "vaccine_type_or_strain": "ND-LaSota",
            "dose_amount": "1 drop",
            "route": "Eye drop",
            "notes": "Individual dose",
        },
    )
    assert ind.status_code == 201, ind.text

    profile = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=a["headers"])
    assert profile.status_code == 200, profile.text
    p = profile.json()
    assert p["band_id"] == "PROF-1"
    assert p["batch_code"] == "PR1"
    assert p["shed_code"] == "P1"
    assert p["organization_name"] == "Profile Farm"
    assert len(p["individual_vaccinations"]) == 2
    by_scope = {row["coverage_scope"]: row for row in p["individual_vaccinations"]}
    assert "individual" in by_scope and "cohort" in by_scope
    ev = by_scope["individual"]
    assert ev["lot_number"] == "LOT-1"
    assert ev["vaccine_name"] == "ND Profile"
    assert ev["manufacturer_or_brand"] == "Acme"
    assert ev["vaccine_type_or_strain"] == "ND-LaSota"
    assert ev["product_expiry"] == "2027-06-01"
    assert ev["route"] == "Eye drop"
    assert ev["dose_amount"] == "1 drop"
    assert ev["notes"] == "Individual dose"
    assert by_scope["cohort"]["birds_covered"] == 5
    # Hatch-date schedule section labeled; may be empty if dose completed fully
    for d in p["batch_upcoming_doses"]:
        assert "Shed hatch-date schedule" in d["attribution_note"]
        assert "not confirmed as an individual" in d["attribution_note"]

    # Bird added after population recording must not inherit prior cohort history.
    bird2 = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": flock["id"], "band_id": "PROF-2", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    empty = await client.get(f"/api/v1/birds/{bird2.json()['id']}/profile", headers=a["headers"])
    assert empty.status_code == 200
    assert empty.json()["individual_vaccinations"] == []


@pytest.mark.asyncio
async def test_bird_profile_inactive_and_lifecycle(client: AsyncClient) -> None:
    a = await _owner(client, "bird-life@example.com", "Life Farm")
    shed = await client.post(
        "/api/v1/sheds", headers=a["headers"], json={"name": "L", "code": "L1", "is_owner_managed": True}
    )
    flock = await _mixed_flock(client, a["headers"], shed.json()["id"], "LF1")
    bird = await client.post(
        "/api/v1/birds",
        headers=a["headers"],
        json={"flock_id": flock["id"], "band_id": "LIFE-1", "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    bird_id = bird.json()["id"]
    life = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "mortality",
            "effective_date": date.today().isoformat(),
            "bird_id": bird_id,
            "quantity": 1,
            "reason": "test",
        },
    )
    assert life.status_code == 201, life.text

    profile = await client.get(f"/api/v1/birds/{bird_id}/profile", headers=a["headers"])
    assert profile.status_code == 200
    p = profile.json()
    assert p["is_active"] is False
    assert p["lifecycle_status"] == "dead"
    assert any(e["event_type"] == "mortality" for e in p["lifecycle_events"])

    search = await client.get("/api/v1/birds/search", headers=a["headers"], params={"q": "LIFE-1"})
    assert search.status_code == 200
    hit = next(i for i in search.json()["items"] if i["band_id"] == "LIFE-1")
    assert hit["is_active"] is False
