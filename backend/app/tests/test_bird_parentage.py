"""Optional sire/dam parentage (linked + descriptive, no fake birds)."""

from uuid import uuid4

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
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        }
    }


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _register(
    client: AsyncClient, headers: dict, shed_id: str, band: str, **extra
) -> dict:
    body = {
        "shed_id": shed_id,
        "band_id": band,
        "hatch_date": "2026-10-01",
        "sex": "male",
        **extra,
    }
    r = await client.post("/api/v1/birds/register-in-shed", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_register_both_parents_unknown(client: AsyncClient) -> None:
    auth = await _owner(client, f"par-unk-{uuid4().hex[:8]}@example.com", "Par Unk")
    shed = await _shed(client, auth["headers"], f"PU{uuid4().hex[:4].upper()}")
    bird = await _register(client, auth["headers"], shed, f"CH-{uuid4().hex[:5].upper()}")
    prof = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=auth["headers"])
    assert prof.status_code == 200
    p = prof.json()
    assert p["sire"] is None and p["dam"] is None
    assert p["sire_parentage"]["source"] == "unknown"
    assert p["dam_parentage"]["source"] == "unknown"
    assert p["sire_parentage"]["label"] == "Unknown"


@pytest.mark.asyncio
async def test_manual_sire_without_band(client: AsyncClient) -> None:
    auth = await _owner(client, f"par-sire-{uuid4().hex[:8]}@example.com", "Par Sire")
    shed = await _shed(client, auth["headers"], f"PS{uuid4().hex[:4].upper()}")
    bird = await _register(
        client,
        auth["headers"],
        shed,
        f"CS-{uuid4().hex[:5].upper()}",
        sire={"mode": "manual", "display_name": "Old Rooster", "breed": "Aseel", "notes": "Farm neighbor"},
        dam={"mode": "manual", "breed": "Shamo"},
    )
    prof = await client.get(f"/api/v1/birds/{bird['id']}/profile", headers=auth["headers"])
    assert prof.status_code == 200
    p = prof.json()
    assert p["sire"] is None
    assert p["sire_parentage"]["source"] == "manual"
    assert p["sire_parentage"]["display_name"] == "Old Rooster"
    assert p["sire_parentage"]["band_id"] is None
    assert p["sire_parentage"]["breed"] == "Aseel"
    assert p["dam_parentage"]["source"] == "manual"
    assert p["dam_parentage"]["breed"] == "Shamo"
    assert p["dam_parentage"]["bird_id"] is None


@pytest.mark.asyncio
async def test_simple_name_and_wing_band_fields(client: AsyncClient) -> None:
    """Simplified UI fields: optional name + optional wing band (maps to band_number)."""
    auth = await _owner(client, f"par-simple-{uuid4().hex[:8]}@example.com", "Par Simple")
    shed = await _shed(client, auth["headers"], f"SM{uuid4().hex[:4].upper()}")

    name_only = await _register(
        client,
        auth["headers"],
        shed,
        f"NO-{uuid4().hex[:5].upper()}",
        sire={"mode": "manual", "display_name": "Red Cock"},
        dam={"mode": "manual", "display_name": "Speckled Hen"},
    )
    p1 = (
        await client.get(f"/api/v1/birds/{name_only['id']}/profile", headers=auth["headers"])
    ).json()
    assert p1["sire_parentage"]["display_name"] == "Red Cock"
    assert p1["sire_parentage"]["band_id"] is None
    assert p1["dam_parentage"]["display_name"] == "Speckled Hen"
    assert p1["dam_parentage"]["band_id"] is None

    band_only = await _register(
        client,
        auth["headers"],
        shed,
        f"BO-{uuid4().hex[:5].upper()}",
        sire={"mode": "manual", "band_number": "W-100"},
        dam={"mode": "manual", "band_number": "W-200"},
    )
    p2 = (
        await client.get(f"/api/v1/birds/{band_only['id']}/profile", headers=auth["headers"])
    ).json()
    assert p2["sire_parentage"]["display_name"] is None
    assert p2["sire_parentage"]["band_id"] == "W-100"
    assert p2["dam_parentage"]["band_id"] == "W-200"

    both = await _register(
        client,
        auth["headers"],
        shed,
        f"BT-{uuid4().hex[:5].upper()}",
        sire={"mode": "manual", "display_name": "Sire Name", "band_number": "SB-1"},
        dam={"mode": "manual", "display_name": "Dam Name", "band_number": "DB-1"},
    )
    p3 = (await client.get(f"/api/v1/birds/{both['id']}/profile", headers=auth["headers"])).json()
    assert p3["sire_parentage"]["display_name"] == "Sire Name"
    assert p3["sire_parentage"]["band_id"] == "SB-1"
    assert p3["dam_parentage"]["display_name"] == "Dam Name"
    assert p3["dam_parentage"]["band_id"] == "DB-1"

    # Editing unrelated fields must not wipe parentage when sire/dam omitted.
    patch = await client.patch(
        f"/api/v1/birds/{both['id']}",
        headers=auth["headers"],
        json={"notes": "wing band check"},
    )
    assert patch.status_code == 200, patch.text
    p4 = (await client.get(f"/api/v1/birds/{both['id']}/profile", headers=auth["headers"])).json()
    assert p4["notes"] == "wing band check"
    assert p4["sire_parentage"]["display_name"] == "Sire Name"
    assert p4["dam_parentage"]["band_id"] == "DB-1"


@pytest.mark.asyncio
async def test_linked_parents_and_sex_validation(client: AsyncClient) -> None:
    auth = await _owner(client, f"par-link-{uuid4().hex[:8]}@example.com", "Par Link")
    shed = await _shed(client, auth["headers"], f"PL{uuid4().hex[:4].upper()}")
    sire = await _register(client, auth["headers"], shed, f"SI-{uuid4().hex[:5].upper()}", sex="male")
    dam = await _register(client, auth["headers"], shed, f"DA-{uuid4().hex[:5].upper()}", sex="female")
    child = await _register(
        client,
        auth["headers"],
        shed,
        f"KD-{uuid4().hex[:5].upper()}",
        sire={"mode": "existing", "bird_id": sire["id"]},
        dam={"mode": "existing", "bird_id": dam["id"]},
    )
    prof = await client.get(f"/api/v1/birds/{child['id']}/profile", headers=auth["headers"])
    assert prof.status_code == 200
    p = prof.json()
    assert p["sire"]["id"] == sire["id"]
    assert p["dam"]["id"] == dam["id"]
    assert p["sire_parentage"]["source"] == "linked"
    assert p["sire_parentage"]["bird_id"] == sire["id"]

    # Sex mismatch: female as sire
    bad = await client.post(
        "/api/v1/birds/register-in-shed",
        headers=auth["headers"],
        json={
            "shed_id": shed,
            "band_id": f"BAD-{uuid4().hex[:5].upper()}",
            "hatch_date": "2026-10-01",
            "sex": "male",
            "sire": {"mode": "existing", "bird_id": dam["id"]},
        },
    )
    assert bad.status_code == 400
    assert "female" in bad.json()["detail"].lower() or "sire" in bad.json()["detail"].lower()

    # Self-parent
    self_p = await client.patch(
        f"/api/v1/birds/{child['id']}",
        headers=auth["headers"],
        json={"sire": {"mode": "existing", "bird_id": child["id"]}},
    )
    assert self_p.status_code == 400


@pytest.mark.asyncio
async def test_edit_parentage_and_tenant_isolation(client: AsyncClient) -> None:
    a = await _owner(client, f"par-a-{uuid4().hex[:8]}@example.com", "Org A")
    b = await _owner(client, f"par-b-{uuid4().hex[:8]}@example.com", "Org B")
    shed_a = await _shed(client, a["headers"], f"A{uuid4().hex[:4].upper()}")
    shed_b = await _shed(client, b["headers"], f"B{uuid4().hex[:4].upper()}")
    parent_b = await _register(client, b["headers"], shed_b, f"XB-{uuid4().hex[:5].upper()}")
    child = await _register(client, a["headers"], shed_a, f"XA-{uuid4().hex[:5].upper()}")

    stolen = await client.patch(
        f"/api/v1/birds/{child['id']}",
        headers=a["headers"],
        json={"sire": {"mode": "existing", "bird_id": parent_b["id"]}},
    )
    assert stolen.status_code in {400, 404}

    ok = await client.patch(
        f"/api/v1/birds/{child['id']}",
        headers=a["headers"],
        json={
            "sire": {"mode": "manual", "display_name": "Local Cock", "band_number": None},
            "dam": {"mode": "manual", "display_name": "Local Hen", "breed": "Aseel"},
        },
    )
    assert ok.status_code == 200, ok.text
    prof = await client.get(f"/api/v1/birds/{child['id']}/profile", headers=a["headers"])
    assert prof.json()["sire_parentage"]["display_name"] == "Local Cock"
    assert prof.json()["dam_parentage"]["display_name"] == "Local Hen"

    # Clear parents
    cleared = await client.patch(
        f"/api/v1/birds/{child['id']}",
        headers=a["headers"],
        json={"sire": {"mode": "unknown"}, "dam": {"mode": "unknown"}},
    )
    assert cleared.status_code == 200
    prof2 = await client.get(f"/api/v1/birds/{child['id']}/profile", headers=a["headers"])
    assert prof2.json()["sire_parentage"]["source"] == "unknown"
    assert prof2.json()["dam_parentage"]["source"] == "unknown"
