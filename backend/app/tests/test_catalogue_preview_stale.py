"""Phase 3: preview-update, stale guards, soft-remove provenance, rollback."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def _owner(client: AsyncClient, label: str) -> dict:
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


async def _create_catalogue(client: AsyncClient, headers: dict) -> dict:
    resp = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=headers,
        json={
            "code": f"PV{uuid4().hex[:6].upper()}",
            "name": "Preview prog",
            "items": [
                {
                    "name": "Alpha",
                    "rules": [{"dose_number": 1, "target_age_days": 0}],
                },
                {
                    "name": "Beta",
                    "rules": [{"dose_number": 1, "target_age_days": 14}],
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _preview(client: AsyncClient, headers: dict, cat_id: str, **body) -> dict:
    resp = await client.post(
        f"/api/v1/vaccine-catalogues/{cat_id}/preview-update",
        headers=headers,
        json={"apply_scope": "new_flocks", **body},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _patch_from_preview(preview: dict, items: list, **extra) -> dict:
    return {
        "confirm_change": True,
        "apply_scope": "new_flocks",
        "expected_version": preview["catalogue_version"],
        "expected_assignment_catalogue_id": preview["expected_assignment_catalogue_id"],
        "expected_override_flock_count": preview["expected_override_flock_count"],
        "items": items,
        **extra,
    }


@pytest.mark.asyncio
async def test_preview_update_reports_diff_and_fingerprint(client: AsyncClient) -> None:
    ctx = await _owner(client, "PrevDiff")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    beta = next(i for i in cat["items"] if i["name"] == "Beta")

    preview = await _preview(
        client,
        ctx["headers"],
        cat["id"],
        items=[
            {
                "id": alpha["id"],
                "name": "Alpha",
                "rules": [{"dose_number": 1, "target_age_days": 3}],
            },
            {"name": "Gamma", "rules": [{"dose_number": 1, "target_age_days": 21}]},
        ],
        remove_item_ids=[beta["id"]],
    )
    assert preview["catalogue_version"] == cat["version"]
    assert alpha["id"] in preview["items_updated"]
    assert alpha["id"] in preview["rule_changes"]
    assert "Gamma" in preview["items_added"]
    assert beta["id"] in preview["items_removed"]
    assert preview["all_active_gated"] is True
    assert preview["flocks_affected_new_flocks"] == 0
    assert "preserved" in preview["warning"].lower()


@pytest.mark.asyncio
async def test_stale_version_rejected(client: AsyncClient) -> None:
    ctx = await _owner(client, "StaleVer")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    preview = await _preview(
        client,
        ctx["headers"],
        cat["id"],
        items=[{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 1}]}],
    )
    # First apply succeeds and bumps version
    ok = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json=_patch_from_preview(
            preview,
            [{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 1}]}],
        ),
    )
    assert ok.status_code == 200, ok.text

    stale = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json=_patch_from_preview(
            preview,
            [{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 2}]}],
        ),
    )
    assert stale.status_code == 409, stale.text
    assert "preview" in stale.json()["detail"].lower()


@pytest.mark.asyncio
async def test_assignment_drift_rejected(client: AsyncClient) -> None:
    ctx = await _owner(client, "AssignDrift")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    preview = await _preview(
        client,
        ctx["headers"],
        cat["id"],
        items=[{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 2}]}],
    )
    assert preview["expected_assignment_catalogue_id"] is None

    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    platform = next(c for c in listed.json() if c["is_platform"])
    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": platform["id"], "apply_scope": "new_flocks", "confirm_change": True},
    )
    assert assign.status_code == 200, assign.text

    stale = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json=_patch_from_preview(
            preview,
            [{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 2}]}],
        ),
    )
    assert stale.status_code == 409, stale.text


@pytest.mark.asyncio
async def test_cancel_means_no_patch_no_writes(client: AsyncClient) -> None:
    ctx = await _owner(client, "Cancel")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    await _preview(
        client,
        ctx["headers"],
        cat["id"],
        items=[{"id": alpha["id"], "name": "Renamed", "rules": [{"dose_number": 1, "target_age_days": 0}]}],
    )
    # Client cancels: no PATCH
    detail = await client.get(f"/api/v1/vaccine-catalogues/{cat['id']}", headers=ctx["headers"])
    assert detail.status_code == 200
    assert detail.json()["version"] == cat["version"]
    assert next(i for i in detail.json()["items"] if i["id"] == alpha["id"])["name"] == "Alpha"


@pytest.mark.asyncio
async def test_soft_remove_keeps_provenance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ctx = await _owner(client, "SoftRm")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    beta = next(i for i in cat["items"] if i["name"] == "Beta")

    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={"catalogue_id": cat["id"], "apply_scope": "new_flocks", "confirm_change": True},
    )
    assert assign.status_code == 200, assign.text

    preview = await _preview(
        client,
        ctx["headers"],
        cat["id"],
        items=[{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 0}]}],
        remove_item_ids=[beta["id"]],
    )
    patched = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json=_patch_from_preview(
            preview,
            [{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 0}]}],
            remove_item_ids=[beta["id"]],
        ),
    )
    assert patched.status_code == 200, patched.text
    names = {i["name"] for i in patched.json()["items"]}
    assert names == {"Alpha"}
    assert patched.json()["version"] == cat["version"] + 1

    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    item_row = (
        await db_session.execute(
            text(
                """
                SELECT is_active FROM vaccine_catalogue_items
                WHERE id = CAST(:iid AS uuid)
                """
            ),
            {"iid": beta["id"]},
        )
    ).mappings().one()
    assert item_row["is_active"] is False

    def_row = (
        await db_session.execute(
            text(
                """
                SELECT is_active, source_catalogue_item_id::text AS src
                FROM vaccine_definitions
                WHERE owner_account_id = CAST(:oid AS uuid)
                  AND source_catalogue_item_id = CAST(:iid AS uuid)
                """
            ),
            {"oid": ctx["owner_id"], "iid": beta["id"]},
        )
    ).mappings().one()
    assert def_row["is_active"] is False
    assert def_row["src"] == beta["id"]


@pytest.mark.asyncio
async def test_invalid_remove_rolls_back(client: AsyncClient) -> None:
    ctx = await _owner(client, "RollRm")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    preview = await _preview(
        client,
        ctx["headers"],
        cat["id"],
        items=[{"id": alpha["id"], "name": "ShouldNotPersist", "rules": [{"dose_number": 1, "target_age_days": 9}]}],
    )
    # Preview itself rejects foreign remove id
    bad_preview = await client.post(
        f"/api/v1/vaccine-catalogues/{cat['id']}/preview-update",
        headers=ctx["headers"],
        json={
            "apply_scope": "new_flocks",
            "items": [
                {"id": alpha["id"], "name": "ShouldNotPersist", "rules": [{"dose_number": 1, "target_age_days": 9}]}
            ],
            "remove_item_ids": [str(uuid4())],
        },
    )
    assert bad_preview.status_code == 400, bad_preview.text

    # Mix valid update with foreign remove on PATCH — must not partially apply rename
    bad = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            "expected_version": preview["catalogue_version"],
            "expected_assignment_catalogue_id": preview["expected_assignment_catalogue_id"],
            "expected_override_flock_count": preview["expected_override_flock_count"],
            "items": [
                {"id": alpha["id"], "name": "ShouldNotPersist", "rules": [{"dose_number": 1, "target_age_days": 9}]}
            ],
            "remove_item_ids": [str(uuid4())],
        },
    )
    assert bad.status_code == 400, bad.text
    detail = await client.get(f"/api/v1/vaccine-catalogues/{cat['id']}", headers=ctx["headers"])
    assert next(i for i in detail.json()["items"] if i["id"] == alpha["id"])["name"] == "Alpha"
    assert detail.json()["version"] == cat["version"]


@pytest.mark.asyncio
async def test_missing_fingerprint_rejected(client: AsyncClient) -> None:
    ctx = await _owner(client, "NoFp")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    bad = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            "items": [
                {"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 1}]}
            ],
        },
    )
    assert bad.status_code == 409, bad.text


@pytest.mark.asyncio
async def test_all_active_still_gated_with_valid_preview(client: AsyncClient) -> None:
    ctx = await _owner(client, "StillGate")
    cat = await _create_catalogue(client, ctx["headers"])
    alpha = next(i for i in cat["items"] if i["name"] == "Alpha")
    preview = await _preview(
        client,
        ctx["headers"],
        cat["id"],
        apply_scope="all_active",
        items=[{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 1}]}],
    )
    gated = await client.patch(
        f"/api/v1/vaccine-catalogues/{cat['id']}",
        headers=ctx["headers"],
        json={
            **_patch_from_preview(
                preview,
                [{"id": alpha["id"], "name": "Alpha", "rules": [{"dose_number": 1, "target_age_days": 1}]}],
            ),
            "apply_scope": "all_active",
        },
    )
    assert gated.status_code == 403, gated.text


@pytest.mark.asyncio
async def test_platform_preview_update_forbidden(client: AsyncClient) -> None:
    ctx = await _owner(client, "PlatPrev")
    listed = await client.get("/api/v1/vaccine-catalogues", headers=ctx["headers"])
    platform = next(c for c in listed.json() if c["code"] == "GAMEFOWL_CHICK_0_18")
    resp = await client.post(
        f"/api/v1/vaccine-catalogues/{platform['id']}/preview-update",
        headers=ctx["headers"],
        json={"apply_scope": "new_flocks", "items": []},
    )
    assert resp.status_code == 403, resp.text
