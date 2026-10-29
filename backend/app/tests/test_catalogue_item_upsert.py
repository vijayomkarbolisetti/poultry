"""Phase 1: catalogue item identity-preserving upsert on PATCH."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def _owner(client: AsyncClient, label: str = "Upsert") -> dict:
    email = f"{label.lower()}-{uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": f"{label} Owner",
            "organization_name": f"{label} Farm {uuid4().hex[:4]}",
        },
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "headers": {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner_id},
        "owner_id": owner_id,
    }


async def _create_two_item_catalogue(client: AsyncClient, headers: dict, code: str) -> dict:
    resp = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=headers,
        json={
            "code": code,
            "name": f"Prog {code}",
            "items": [
                {
                    "name": "Alpha",
                    "disease_label": "ND",
                    "sort_order": 1,
                    "rules": [{"dose_number": 1, "target_age_days": 0}],
                },
                {
                    "name": "Beta",
                    "disease_label": "IBD",
                    "sort_order": 2,
                    "rules": [{"dose_number": 1, "target_age_days": 14}],
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _guards(client: AsyncClient, headers: dict, cat_id: str, items: list | None = None) -> dict:
    preview = await client.post(
        f"/api/v1/vaccine-catalogues/{cat_id}/preview-update",
        headers=headers,
        json={"apply_scope": "new_flocks", "items": items or []},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    return {
        "expected_version": body["catalogue_version"],
        "expected_assignment_catalogue_id": body["expected_assignment_catalogue_id"],
        "expected_override_flock_count": body["expected_override_flock_count"],
    }


async def _patch_items(
    client: AsyncClient,
    headers: dict,
    cat_id: str,
    items: list,
    *,
    preview_items: list | None = None,
    **extra,
):
    guards = await _guards(client, headers, cat_id, preview_items if preview_items is not None else items)
    return await client.patch(
        f"/api/v1/vaccine-catalogues/{cat_id}",
        headers=headers,
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            **guards,
            "items": items,
            **extra,
        },
    )


@pytest.mark.asyncio
async def test_upsert_preserves_item_id_and_rules_parent(client: AsyncClient) -> None:
    ctx = await _owner(client, "PreserveId")
    cat = await _create_two_item_catalogue(client, ctx["headers"], f"UP{uuid4().hex[:6].upper()}")
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    alpha_id = alpha["id"]
    old_rule_ids = {r["id"] for r in alpha["rules"]}

    patched = await _patch_items(
        client,
        ctx["headers"],
        cat["id"],
        [
            {
                "id": alpha_id,
                "name": "Alpha Renamed",
                "disease_label": "ND",
                "sort_order": 1,
                "recommended_dose_text": "0.5 ml",
                "route": "S/C",
                "rules": [{"dose_number": 1, "target_age_days": 7}],
            }
        ],
    )
    assert patched.status_code == 200, patched.text
    items = patched.json()["items"]
    assert len(items) == 2
    updated = next(i for i in items if i["id"] == alpha_id)
    assert updated["name"] == "Alpha Renamed"
    assert updated["rules"][0]["target_age_days"] == 7
    # Rule rows replaced; parent item identity unchanged
    assert {r["id"] for r in updated["rules"]} != old_rule_ids
    assert next(i for i in items if i["name"] == "Beta")["id"] == next(
        i for i in cat["items"] if i["name"] == "Beta"
    )["id"]


@pytest.mark.asyncio
async def test_upsert_preserves_source_catalogue_item_link(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ctx = await _owner(client, "SrcLink")
    cat = await _create_two_item_catalogue(client, ctx["headers"], f"SL{uuid4().hex[:6].upper()}")
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")

    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": cat["id"], "apply_scope": "new_flocks", "confirm_change": True},
    )
    assert assign.status_code == 200, assign.text

    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    before = (
        await db_session.execute(
            text(
                """
                SELECT id, source_catalogue_item_id
                FROM vaccine_definitions
                WHERE owner_account_id = :oid AND source_catalogue_item_id = :iid
                """
            ),
            {"oid": ctx["owner_id"], "iid": alpha["id"]},
        )
    ).mappings().one()
    def_id = before["id"]
    assert str(before["source_catalogue_item_id"]) == alpha["id"]

    patched = await _patch_items(
        client,
        ctx["headers"],
        cat["id"],
        [
            {
                "id": alpha["id"],
                "name": "Alpha",
                "disease_label": "ND",
                "rules": [{"dose_number": 1, "target_age_days": 3}],
            }
        ],
    )
    assert patched.status_code == 200, patched.text
    assert next(i for i in patched.json()["items"] if i["name"] == "Alpha")["id"] == alpha["id"]

    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    after = (
        await db_session.execute(
            text(
                """
                SELECT id, source_catalogue_item_id
                FROM vaccine_definitions
                WHERE id = :did
                """
            ),
            {"did": def_id},
        )
    ).mappings().one()
    assert after["id"] == def_id
    assert str(after["source_catalogue_item_id"]) == alpha["id"]

    # Still exactly one def linked to this catalogue item
    count = await db_session.scalar(
        text(
            """
            SELECT COUNT(*) FROM vaccine_definitions
            WHERE owner_account_id = :oid AND source_catalogue_item_id = :iid
            """
        ),
        {"oid": ctx["owner_id"], "iid": alpha["id"]},
    )
    assert int(count or 0) == 1


@pytest.mark.asyncio
async def test_omit_id_creates_new_item(client: AsyncClient) -> None:
    ctx = await _owner(client, "NewItem")
    cat = await _create_two_item_catalogue(client, ctx["headers"], f"NI{uuid4().hex[:6].upper()}")
    existing_ids = {i["id"] for i in cat["items"]}

    patched = await _patch_items(
        client,
        ctx["headers"],
        cat["id"],
        [
            {
                "name": "Gamma",
                "disease_label": "IB",
                "rules": [{"dose_number": 1, "target_age_days": 21}],
            }
        ],
    )
    assert patched.status_code == 200, patched.text
    items = patched.json()["items"]
    assert len(items) == 3
    gamma = next(i for i in items if i["name"] == "Gamma")
    assert gamma["id"] not in existing_ids
    assert existing_ids.issubset({i["id"] for i in items})


@pytest.mark.asyncio
async def test_duplicate_item_ids_rejected(client: AsyncClient) -> None:
    ctx = await _owner(client, "DupId")
    cat = await _create_two_item_catalogue(client, ctx["headers"], f"DI{uuid4().hex[:6].upper()}")
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")

    bad = await _patch_items(
        client,
        ctx["headers"],
        cat["id"],
        [
            {
                "id": alpha["id"],
                "name": "Alpha",
                "rules": [{"dose_number": 1, "target_age_days": 0}],
            },
            {
                "id": alpha["id"],
                "name": "Alpha again",
                "rules": [{"dose_number": 1, "target_age_days": 1}],
            },
        ],
        preview_items=[],
    )
    assert bad.status_code == 400, bad.text
    assert "Duplicate" in bad.json()["detail"]

    detail = await client.get(f"/api/v1/vaccine-catalogues/{cat['id']}", headers=ctx["headers"])
    assert detail.status_code == 200
    assert {i["id"] for i in detail.json()["items"]} == {i["id"] for i in cat["items"]}
    assert next(i for i in detail.json()["items"] if i["id"] == alpha["id"])["name"] == "Alpha"


@pytest.mark.asyncio
async def test_foreign_item_id_rejected_no_partial_write(client: AsyncClient) -> None:
    a = await _owner(client, "ForeignA")
    b = await _owner(client, "ForeignB")
    cat_a = await _create_two_item_catalogue(client, a["headers"], f"FA{uuid4().hex[:6].upper()}")
    cat_b = await _create_two_item_catalogue(client, b["headers"], f"FB{uuid4().hex[:6].upper()}")
    foreign_item = cat_b["items"][0]
    alpha_a = next(i for i in cat_a["items"] if i["name"] == "Alpha")

    bad = await _patch_items(
        client,
        a["headers"],
        cat_a["id"],
        [
            {
                "id": alpha_a["id"],
                "name": "ShouldNotPersist",
                "rules": [{"dose_number": 1, "target_age_days": 99}],
            },
            {
                "id": foreign_item["id"],
                "name": "Foreign",
                "rules": [{"dose_number": 1, "target_age_days": 0}],
            },
        ],
        preview_items=[],
    )
    assert bad.status_code == 400, bad.text
    assert "does not belong" in bad.json()["detail"]

    detail = await client.get(f"/api/v1/vaccine-catalogues/{cat_a['id']}", headers=a["headers"])
    assert detail.status_code == 200
    items = detail.json()["items"]
    assert len(items) == 2
    assert next(i for i in items if i["id"] == alpha_a["id"])["name"] == "Alpha"
    assert next(i for i in items if i["id"] == alpha_a["id"])["rules"][0]["target_age_days"] == 0


@pytest.mark.asyncio
async def test_unknown_item_id_rejected(client: AsyncClient) -> None:
    ctx = await _owner(client, "UnknownId")
    cat = await _create_two_item_catalogue(client, ctx["headers"], f"UK{uuid4().hex[:6].upper()}")
    bogus = str(uuid4())

    bad = await _patch_items(
        client,
        ctx["headers"],
        cat["id"],
        [
            {
                "id": bogus,
                "name": "Ghost",
                "rules": [{"dose_number": 1, "target_age_days": 0}],
            }
        ],
        preview_items=[],
    )
    assert bad.status_code == 400, bad.text


@pytest.mark.asyncio
async def test_repeated_identical_upsert_no_duplicate_items_or_defs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ctx = await _owner(client, "Repeat")
    cat = await _create_two_item_catalogue(client, ctx["headers"], f"RP{uuid4().hex[:6].upper()}")
    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": cat["id"], "apply_scope": "new_flocks", "confirm_change": True},
    )
    assert assign.status_code == 200, assign.text

    payload_items = [
        {
            "id": i["id"],
            "name": i["name"],
            "disease_label": i["disease_label"],
            "sort_order": i["sort_order"],
            "rules": [
                {
                    "dose_number": r["dose_number"],
                    "target_age_days": r["target_age_days"],
                    "grace_period_days": r["grace_period_days"],
                    "reminder_lead_days": r["reminder_lead_days"],
                    "is_manual_only": r["is_manual_only"],
                }
                for r in i["rules"]
            ],
        }
        for i in cat["items"]
    ]

    for _ in range(3):
        patched = await _patch_items(client, ctx["headers"], cat["id"], payload_items)
        assert patched.status_code == 200, patched.text
        assert len(patched.json()["items"]) == 2
        assert {i["id"] for i in patched.json()["items"]} == {i["id"] for i in cat["items"]}

    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    ids = [i["id"] for i in cat["items"]]
    def_count = await db_session.scalar(
        text(
            """
            SELECT COUNT(*) FROM vaccine_definitions
            WHERE owner_account_id = CAST(:oid AS uuid)
              AND source_catalogue_item_id IN (CAST(:i1 AS uuid), CAST(:i2 AS uuid))
            """
        ),
        {"oid": ctx["owner_id"], "i1": ids[0], "i2": ids[1]},
    )
    assert int(def_count or 0) == 2


@pytest.mark.asyncio
async def test_platform_catalogue_still_immutable(client: AsyncClient) -> None:
    ctx = await _owner(client, "PlatImm")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    platform = next(c for c in listed.json() if c["code"] == "GAMEFOWL_CHICK_0_18")
    detail = await client.get(f"/api/v1/vaccine-catalogues/{platform['id']}", headers=ctx["headers"])
    item = detail.json()["items"][0]

    patch = await client.patch(
        f"/api/v1/vaccine-catalogues/{platform['id']}",
        headers=ctx["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            "items": [
                {
                    "id": item["id"],
                    "name": "Hacked",
                    "rules": [{"dose_number": 1, "target_age_days": 0}],
                }
            ],
        },
    )
    assert patch.status_code == 403, patch.text


@pytest.mark.asyncio
async def test_tenant_cannot_patch_other_farm_catalogue(client: AsyncClient) -> None:
    a = await _owner(client, "TenA")
    b = await _owner(client, "TenB")
    cat_b = await _create_two_item_catalogue(client, b["headers"], f"TB{uuid4().hex[:6].upper()}")
    item = cat_b["items"][0]

    hidden = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat_b['id']}",
        headers=a["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            "items": [
                {
                    "id": item["id"],
                    "name": "Stolen",
                    "rules": [{"dose_number": 1, "target_age_days": 0}],
                }
            ],
        },
    )
    assert hidden.status_code == 404, hidden.text
