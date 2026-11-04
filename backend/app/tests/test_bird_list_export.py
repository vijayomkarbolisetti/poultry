"""Dead / sold bird list CSV & XLSX export — filters, authz, limits."""

from io import BytesIO
from uuid import uuid4

import pytest
from httpx import AsyncClient
from openpyxl import load_workbook

from app.core.config import get_settings


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


async def _shed(client: AsyncClient, headers: dict, code: str) -> str:
    r = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": f"Shed {code}", "code": code, "is_owner_managed": True},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _flock(client: AsyncClient, headers: dict, shed_id: str, code: str) -> dict:
    r = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed_id,
            "batch_code": code,
            "initial_count": 5,
            "tracking_mode": "mixed",
            "dob_confidence": "exact",
            "hatch_date": "2026-01-15",
            "unbanded_count": 3,
            "breed": "Aseel",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _bird(client: AsyncClient, headers: dict, flock_id: str, band: str) -> dict:
    r = await client.post(
        "/api/v1/birds",
        headers=headers,
        json={
            "flock_id": flock_id,
            "band_id": band,
            "dob_confidence": "exact",
            "hatch_date": "2026-01-15",
            "breed": "Aseel",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _mortality(
    client: AsyncClient, headers: dict, bird_id: str, *, day: str, reason: str = "Illness"
) -> None:
    r = await client.post(
        "/api/v1/lifecycle-events",
        headers=headers,
        json={
            "event_type": "mortality",
            "effective_date": day,
            "bird_id": bird_id,
            "reason": reason,
            "idempotency_key": f"mort-{uuid4().hex}",
        },
    )
    assert r.status_code in {200, 201}, r.text


async def _sale(
    client: AsyncClient,
    headers: dict,
    bird_id: str,
    *,
    day: str,
    buyer: str = "Buyer",
    mobile: str = "9000011111",
) -> None:
    r = await client.post(
        "/api/v1/lifecycle-events",
        headers=headers,
        json={
            "event_type": "sale",
            "effective_date": day,
            "bird_id": bird_id,
            "buyer_name": buyer,
            "buyer_mobile": mobile,
            "idempotency_key": f"sale-{uuid4().hex}",
        },
    )
    assert r.status_code in {200, 201}, r.text


def _xlsx_rows(content: bytes) -> list[tuple]:
    wb = load_workbook(BytesIO(content), read_only=True)
    ws = wb.active
    return [tuple(cell.value for cell in row) for row in ws.iter_rows()]


@pytest.mark.asyncio
async def test_dead_export_csv_and_xlsx_and_date_filter(client: AsyncClient) -> None:
    auth = await _owner(client, f"exp-dead-{uuid4().hex[:8]}@example.com", "Dead Export")
    shed = await _shed(client, auth["headers"], f"D{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BD-{uuid4().hex[:6]}")
    early = await _bird(client, auth["headers"], flock["id"], f"E-{uuid4().hex[:5].upper()}")
    late = await _bird(client, auth["headers"], flock["id"], f"L-{uuid4().hex[:5].upper()}")
    await _mortality(client, auth["headers"], early["id"], day="2026-09-01", reason="Heat")
    await _mortality(client, auth["headers"], late["id"], day="2026-11-05", reason="Injury")

    csv_resp = await client.get(
        "/api/v1/birds/dead-birds/export",
        headers=auth["headers"],
        params={
            "format": "csv",
            "died_from": "2026-10-01",
            "died_to": "2026-11-30",
        },
    )
    assert csv_resp.status_code == 200, csv_resp.text
    assert "text/csv" in csv_resp.headers["content-type"]
    cd = csv_resp.headers.get("content-disposition", "")
    assert "dead-birds-2026-10-01_to_2026-11-30.csv" in cd
    text = csv_resp.content.decode("utf-8-sig")
    assert "Bird band/ID" in text
    assert "Died on" in text
    assert "Injury" in text
    assert late["band_id"] in text
    assert early["band_id"] not in text
    assert "Heat" not in text

    xlsx_resp = await client.get(
        "/api/v1/birds/dead-birds/export",
        headers=auth["headers"],
        params={
            "format": "xlsx",
            "died_from": "2026-10-01",
            "died_to": "2026-11-30",
        },
    )
    assert xlsx_resp.status_code == 200, xlsx_resp.text
    assert "spreadsheetml" in xlsx_resp.headers["content-type"]
    rows = _xlsx_rows(xlsx_resp.content)
    assert rows[0][0] == "Bird band/ID"
    assert rows[0][4] == "Died on"
    assert len(rows) == 2  # header + 1 data
    assert rows[1][0] == late["band_id"]
    assert rows[1][4] == "2026-11-05"
    assert rows[1][5] == "Injury"


@pytest.mark.asyncio
async def test_sold_export_csv_and_xlsx_and_date_filter(client: AsyncClient) -> None:
    auth = await _owner(client, f"exp-sold-{uuid4().hex[:8]}@example.com", "Sold Export")
    shed = await _shed(client, auth["headers"], f"S{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BS-{uuid4().hex[:6]}")
    early = await _bird(client, auth["headers"], flock["id"], f"SE-{uuid4().hex[:5].upper()}")
    late = await _bird(client, auth["headers"], flock["id"], f"SL-{uuid4().hex[:5].upper()}")
    await _sale(client, auth["headers"], early["id"], day="2026-08-10", buyer="Old Buyer")
    await _sale(
        client,
        auth["headers"],
        late["id"],
        day="2026-10-20",
        buyer="Priya Sharma",
        mobile="9988776655",
    )

    csv_resp = await client.get(
        "/api/v1/birds/sold/export",
        headers=auth["headers"],
        params={"format": "csv", "sold_from": "2026-10-01", "sold_to": "2026-10-31"},
    )
    assert csv_resp.status_code == 200, csv_resp.text
    text = csv_resp.content.decode("utf-8-sig")
    assert "Buyer name" in text
    assert "Priya Sharma" in text
    assert "9988776655" in text
    assert late["band_id"] in text
    assert early["band_id"] not in text
    assert "Old Buyer" not in text

    xlsx_resp = await client.get(
        "/api/v1/birds/sold/export",
        headers=auth["headers"],
        params={"format": "xlsx", "sold_from": "2026-10-01", "sold_to": "2026-10-31"},
    )
    assert xlsx_resp.status_code == 200
    rows = _xlsx_rows(xlsx_resp.content)
    assert rows[0][:3] == ("Bird band/ID", "Breed", "Batch")
    assert len(rows) == 2
    assert rows[1][0] == late["band_id"]
    assert rows[1][4] == "2026-10-20"
    assert rows[1][5] == "Priya Sharma"


@pytest.mark.asyncio
async def test_export_empty_results(client: AsyncClient) -> None:
    auth = await _owner(client, f"exp-empty-{uuid4().hex[:8]}@example.com", "Empty Export")
    dead = await client.get(
        "/api/v1/birds/dead-birds/export",
        headers=auth["headers"],
        params={"format": "csv", "died_from": "2020-01-01", "died_to": "2020-01-31"},
    )
    assert dead.status_code == 200
    text = dead.content.decode("utf-8-sig").strip().splitlines()
    assert text[0].startswith("Bird band/ID")
    assert len(text) == 1  # header only

    sold = await client.get(
        "/api/v1/birds/sold/export",
        headers=auth["headers"],
        params={"format": "xlsx"},
    )
    assert sold.status_code == 200
    rows = _xlsx_rows(sold.content)
    assert len(rows) == 1
    assert rows[0][0] == "Bird band/ID"


@pytest.mark.asyncio
async def test_export_tenant_isolation(client: AsyncClient) -> None:
    a = await _owner(client, f"exp-a-{uuid4().hex[:8]}@example.com", "Org A Exp")
    b = await _owner(client, f"exp-b-{uuid4().hex[:8]}@example.com", "Org B Exp")
    shed = await _shed(client, a["headers"], f"A{uuid4().hex[:4].upper()}")
    flock = await _flock(client, a["headers"], shed, f"BA-{uuid4().hex[:6]}")
    bird = await _bird(client, a["headers"], flock["id"], f"ISO-{uuid4().hex[:5].upper()}")
    await _mortality(client, a["headers"], bird["id"], day="2026-10-15")
    await _sale(
        client,
        a["headers"],
        (await _bird(client, a["headers"], flock["id"], f"SL-{uuid4().hex[:5].upper()}"))["id"],
        day="2026-10-16",
    )

    dead_leak = await client.get(
        "/api/v1/birds/dead-birds/export", headers=b["headers"], params={"format": "csv"}
    )
    assert dead_leak.status_code == 200
    assert bird["band_id"] not in dead_leak.content.decode("utf-8-sig")

    sold_leak = await client.get(
        "/api/v1/birds/sold/export", headers=b["headers"], params={"format": "csv"}
    )
    assert sold_leak.status_code == 200
    assert "Buyer" in sold_leak.content.decode("utf-8-sig").splitlines()[0]
    # only header — no tenant A rows
    assert len(sold_leak.content.decode("utf-8-sig").strip().splitlines()) == 1


@pytest.mark.asyncio
async def test_export_permission_and_farmer_shed_scope(client: AsyncClient) -> None:
    a = await _owner(client, f"exp-f-{uuid4().hex[:8]}@example.com", "Farmer Export Farm")
    shed_a = await _shed(client, a["headers"], f"FA{uuid4().hex[:3].upper()}")
    shed_b = await _shed(client, a["headers"], f"FB{uuid4().hex[:3].upper()}")
    fa = await _flock(client, a["headers"], shed_a, f"FA-{uuid4().hex[:5]}")
    fb = await _flock(client, a["headers"], shed_b, f"FB-{uuid4().hex[:5]}")
    bird_a = await _bird(client, a["headers"], fa["id"], f"FA-{uuid4().hex[:5].upper()}")
    bird_b = await _bird(client, a["headers"], fb["id"], f"FB-{uuid4().hex[:5].upper()}")
    await _mortality(client, a["headers"], bird_a["id"], day="2026-10-01")
    await _mortality(client, a["headers"], bird_b["id"], day="2026-10-02")

    farmer_email = f"exp-farmer-{uuid4().hex[:8]}@example.com"
    await _farmer(
        client,
        a["headers"],
        farmer_email,
        perms=["bird.view", "shed.view", "flock.view"],
        shed_ids=[shed_a],
    )
    fh = await _farmer_headers(client, farmer_email, a["owner_id"])

    scoped = await client.get(
        "/api/v1/birds/dead-birds/export", headers=fh, params={"format": "csv"}
    )
    assert scoped.status_code == 200
    body = scoped.content.decode("utf-8-sig")
    assert bird_a["band_id"] in body
    assert bird_b["band_id"] not in body

    denied_email = f"exp-noperm-{uuid4().hex[:8]}@example.com"
    await _farmer(
        client,
        a["headers"],
        denied_email,
        perms=["shed.view"],
        shed_ids=[shed_a],
    )
    nh = await _farmer_headers(client, denied_email, a["owner_id"])
    assert (
        await client.get("/api/v1/birds/dead-birds/export", headers=nh, params={"format": "csv"})
    ).status_code == 403
    assert (
        await client.get("/api/v1/birds/sold/export", headers=nh, params={"format": "xlsx"})
    ).status_code == 403


@pytest.mark.asyncio
async def test_export_invalid_format_and_date_order(client: AsyncClient) -> None:
    auth = await _owner(client, f"exp-bad-{uuid4().hex[:8]}@example.com", "Bad Export")
    bad_fmt = await client.get(
        "/api/v1/birds/dead-birds/export",
        headers=auth["headers"],
        params={"format": "pdf"},
    )
    assert bad_fmt.status_code == 400

    bad_range = await client.get(
        "/api/v1/birds/sold/export",
        headers=auth["headers"],
        params={"format": "csv", "sold_from": "2026-12-01", "sold_to": "2026-01-01"},
    )
    assert bad_range.status_code == 400


@pytest.mark.asyncio
async def test_export_size_limit(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    auth = await _owner(client, f"exp-lim-{uuid4().hex[:8]}@example.com", "Limit Export")
    shed = await _shed(client, auth["headers"], f"L{uuid4().hex[:4].upper()}")
    flock = await _flock(client, auth["headers"], shed, f"BL-{uuid4().hex[:6]}")
    for i in range(3):
        bird = await _bird(client, auth["headers"], flock["id"], f"LIM{i}-{uuid4().hex[:4].upper()}")
        await _mortality(client, auth["headers"], bird["id"], day="2026-10-10")

    settings = get_settings()
    monkeypatch.setattr(settings, "bird_list_export_max_rows", 2)

    resp = await client.get(
        "/api/v1/birds/dead-birds/export",
        headers=auth["headers"],
        params={"format": "csv"},
    )
    assert resp.status_code == 400, resp.text
    assert "maximum" in resp.json()["detail"].lower()
