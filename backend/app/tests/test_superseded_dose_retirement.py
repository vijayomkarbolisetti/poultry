"""Phase 2: retire superseded open doses without harming history or unrelated tasks."""

from datetime import date, timedelta
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


async def _setup_programme_with_flock(
    client: AsyncClient,
    *,
    label: str,
    hatch_days_ago: int = 10,
    alpha_age: int = 1,
    beta_age: int = 7,
) -> dict:
    ctx = await _owner(client, label)
    headers = ctx["headers"]
    cat = await client.post(
        "/api/v1/vaccine-catalogues",
        headers=headers,
        json={
            "code": f"R{uuid4().hex[:6].upper()}",
            "name": f"Retire prog {label}",
            "items": [
                {
                    "name": "AlphaVac",
                    "disease_label": "ND",
                    "rules": [{"dose_number": 1, "target_age_days": alpha_age, "grace_period_days": 0}],
                },
                {
                    "name": "BetaVac",
                    "disease_label": "IBD",
                    "rules": [{"dose_number": 1, "target_age_days": beta_age, "grace_period_days": 0}],
                },
            ],
        },
    )
    assert cat.status_code == 201, cat.text
    cat_body = cat.json()
    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=headers,
        json={"catalogue_id": cat_body["id"], "apply_scope": "all_active", "confirm_change": True},
    )
    assert assign.status_code == 200, assign.text

    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "Retire Shed", "code": f"RS-{uuid4().hex[:4].upper()}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    hatch = (date.today() - timedelta(days=hatch_days_ago)).isoformat()
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed.json()["id"],
            "batch_code": f"RB-{uuid4().hex[:4].upper()}",
            "initial_count": 5,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": hatch,
        },
    )
    assert flock.status_code == 201, flock.text

    vaccines = await client.get("/api/v1/vaccines", headers=headers)
    assert vaccines.status_code == 200, vaccines.text
    by_name = {v["name"]: v for v in vaccines.json()}
    assert "AlphaVac" in by_name and "BetaVac" in by_name

    doses = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"flock_id": flock.json()["id"]},
    )
    assert doses.status_code == 200, doses.text
    return {
        **ctx,
        "catalogue": cat_body,
        "shed_id": shed.json()["id"],
        "flock_id": flock.json()["id"],
        "hatch": date.fromisoformat(hatch),
        "defs": by_name,
        "doses": doses.json(),
    }


async def _active_doses(client: AsyncClient, headers: dict, flock_id: str) -> list[dict]:
    resp = await client.get(
        "/api/v1/vaccines/scheduled-doses",
        headers=headers,
        params={"flock_id": flock_id},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _dose_rows_for_def(
    db_session: AsyncSession, *, owner_id: str, flock_id: str, definition_id: str
) -> list[dict]:
    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    rows = (
        await db_session.execute(
            text(
                """
                SELECT id::text, due_date, status, is_active, schedule_version_id::text
                FROM scheduled_doses
                WHERE owner_account_id = CAST(:oid AS uuid)
                  AND flock_id = CAST(:fid AS uuid)
                  AND vaccine_definition_id = CAST(:did AS uuid)
                  AND bird_id IS NULL
                ORDER BY created_at
                """
            ),
            {"oid": owner_id, "fid": flock_id, "did": definition_id},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


@pytest.mark.asyncio
async def test_target_age_change_retires_obsolete_open_due(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ctx = await _setup_programme_with_flock(client, label="AgeChg", hatch_days_ago=10, alpha_age=1)
    alpha_id = ctx["defs"]["AlphaVac"]["id"]
    old_due = ctx["hatch"] + timedelta(days=1)
    new_age = 5
    new_due = ctx["hatch"] + timedelta(days=new_age)

    before = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    assert any(r["due_date"] == old_due and r["is_active"] for r in before)

    versioned = await client.post(
        f"/api/v1/vaccines/{alpha_id}/versions",
        headers=ctx["headers"],
        json={
            "effective_date": date.today().isoformat(),
            "apply_scope": "all_active",
            "rules": [{"dose_number": 1, "target_age_days": new_age, "grace_period_days": 0}],
        },
    )
    assert versioned.status_code == 201, versioned.text

    active = await _active_doses(client, ctx["headers"], ctx["flock_id"])
    alpha_active = [d for d in active if d.get("vaccine_name") == "AlphaVac"]
    assert len(alpha_active) == 1, alpha_active
    assert alpha_active[0]["due_date"] == new_due.isoformat()

    after = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    obsolete = [r for r in after if r["due_date"] == old_due]
    assert obsolete, after
    assert all(r["is_active"] is False and r["status"] == "inactive" for r in obsolete)
    current = [r for r in after if r["due_date"] == new_due and r["is_active"]]
    assert len(current) == 1

    # Reconciler must not be the only mechanism: obsolete row remains (inactive), not deleted.
    assert len(after) >= 2


@pytest.mark.asyncio
async def test_age_change_preserves_completed_and_events(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ctx = await _setup_programme_with_flock(client, label="KeepDone", hatch_days_ago=10, alpha_age=1)
    alpha_id = ctx["defs"]["AlphaVac"]["id"]
    active = await _active_doses(client, ctx["headers"], ctx["flock_id"])
    alpha_dose = next(d for d in active if d.get("vaccine_name") == "AlphaVac")

    recorded = await client.post(
        "/api/v1/vaccination-events/batch",
        headers=ctx["headers"],
        json={
            "administration_date": date.today().isoformat(),
            "idempotency_key": f"retire-done-{uuid4().hex[:8]}",
            "items": [
                {
                    "scheduled_dose_id": alpha_dose["id"],
                    "birds_covered": alpha_dose["eligible_count"],
                }
            ],
        },
    )
    assert recorded.status_code == 201, recorded.text

    await db_session.execute(text("SET LOCAL app.rls_bypass = 'on'"))
    events_before = await db_session.scalar(
        text(
            """
            SELECT COUNT(*) FROM vaccination_events
            WHERE owner_account_id = CAST(:oid AS uuid) AND is_void IS FALSE
            """
        ),
        {"oid": ctx["owner_id"]},
    )

    versioned = await client.post(
        f"/api/v1/vaccines/{alpha_id}/versions",
        headers=ctx["headers"],
        json={
            "effective_date": date.today().isoformat(),
            "apply_scope": "all_active",
            "rules": [{"dose_number": 1, "target_age_days": 8, "grace_period_days": 0}],
        },
    )
    assert versioned.status_code == 201, versioned.text

    rows = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    completed = [r for r in rows if str(r["status"]).startswith("completed")]
    assert completed
    assert all(r["is_active"] for r in completed)

    events_after = await db_session.scalar(
        text(
            """
            SELECT COUNT(*) FROM vaccination_events
            WHERE owner_account_id = CAST(:oid AS uuid) AND is_void IS FALSE
            """
        ),
        {"oid": ctx["owner_id"]},
    )
    assert int(events_after or 0) == int(events_before or 0)


@pytest.mark.asyncio
async def test_deactivated_definition_retires_open_doses(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ctx = await _setup_programme_with_flock(client, label="Deact", hatch_days_ago=10)
    alpha_id = ctx["defs"]["AlphaVac"]["id"]

    archived = await client.post(
        f"/api/v1/vaccines/{alpha_id}/archive",
        headers=ctx["headers"],
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["is_active"] is False

    regen = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=ctx["headers"],
        json={"flock_id": ctx["flock_id"], "vaccine_definition_ids": [alpha_id]},
    )
    assert regen.status_code == 200, regen.text

    rows = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    open_active = [
        r
        for r in rows
        if r["is_active"] and not str(r["status"]).startswith("completed")
    ]
    assert open_active == []
    assert any(r["is_active"] is False and r["status"] == "inactive" for r in rows)

    # Unrelated BetaVac still active
    beta_active = [
        d for d in await _active_doses(client, ctx["headers"], ctx["flock_id"]) if d.get("vaccine_name") == "BetaVac"
    ]
    assert len(beta_active) == 1


@pytest.mark.asyncio
async def test_repeat_regeneration_idempotent(client: AsyncClient, db_session: AsyncSession) -> None:
    ctx = await _setup_programme_with_flock(client, label="Idem", hatch_days_ago=10, alpha_age=1)
    alpha_id = ctx["defs"]["AlphaVac"]["id"]
    new_age = 4

    for _ in range(3):
        versioned = await client.post(
            f"/api/v1/vaccines/{alpha_id}/versions",
            headers=ctx["headers"],
            json={
                "effective_date": date.today().isoformat(),
                "apply_scope": "all_active",
                "rules": [{"dose_number": 1, "target_age_days": new_age, "grace_period_days": 0}],
            },
        )
        assert versioned.status_code == 201, versioned.text

    active = [d for d in await _active_doses(client, ctx["headers"], ctx["flock_id"]) if d.get("vaccine_name") == "AlphaVac"]
    assert len(active) == 1
    assert active[0]["due_date"] == (ctx["hatch"] + timedelta(days=new_age)).isoformat()

    rows = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    assert len([r for r in rows if r["is_active"]]) == 1


@pytest.mark.asyncio
async def test_unrelated_definition_and_flock_untouched(client: AsyncClient) -> None:
    ctx = await _setup_programme_with_flock(client, label="Scope", hatch_days_ago=10, alpha_age=1)
    headers = ctx["headers"]

    # Second flock on same shed / catalogue (different hatch → distinct cohort key)
    hatch2 = ctx["hatch"] - timedelta(days=3)
    flock2 = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": ctx["shed_id"],
            "batch_code": f"RB2-{uuid4().hex[:4].upper()}",
            "initial_count": 3,
            "tracking_mode": "batch",
            "dob_confidence": "exact",
            "hatch_date": hatch2.isoformat(),
        },
    )
    assert flock2.status_code == 201, flock2.text
    flock2_id = flock2.json()["id"]

    before_beta = [
        d for d in await _active_doses(client, headers, ctx["flock_id"]) if d.get("vaccine_name") == "BetaVac"
    ]
    before_f2_alpha = [
        d for d in await _active_doses(client, headers, flock2_id) if d.get("vaccine_name") == "AlphaVac"
    ]
    assert len(before_beta) == 1
    assert len(before_f2_alpha) == 1
    f2_alpha_due = before_f2_alpha[0]["due_date"]
    beta_due = before_beta[0]["due_date"]
    beta_id = before_beta[0]["id"]

    versioned = await client.post(
        f"/api/v1/vaccines/{ctx['defs']['AlphaVac']['id']}/versions",
        headers=headers,
        json={
            "effective_date": date.today().isoformat(),
            "apply_scope": "selected_flocks",
            "flock_ids": [ctx["flock_id"]],
            "rules": [{"dose_number": 1, "target_age_days": 9, "grace_period_days": 0}],
        },
    )
    assert versioned.status_code == 201, versioned.text

    after_beta = next(
        d for d in await _active_doses(client, headers, ctx["flock_id"]) if d.get("vaccine_name") == "BetaVac"
    )
    assert after_beta["id"] == beta_id
    assert after_beta["due_date"] == beta_due

    after_f2_alpha = [
        d for d in await _active_doses(client, headers, flock2_id) if d.get("vaccine_name") == "AlphaVac"
    ]
    assert len(after_f2_alpha) == 1
    assert after_f2_alpha[0]["due_date"] == f2_alpha_due


@pytest.mark.asyncio
async def test_cross_tenant_generate_does_not_touch_other_farm(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    a = await _setup_programme_with_flock(client, label="TenA", hatch_days_ago=10, alpha_age=1)
    b = await _setup_programme_with_flock(client, label="TenB", hatch_days_ago=10, alpha_age=1)

    # Tenant B asks generate with A's definition id — must not alter A's doses.
    before = await _dose_rows_for_def(
        db_session, owner_id=a["owner_id"], flock_id=a["flock_id"], definition_id=a["defs"]["AlphaVac"]["id"]
    )
    assert before

    resp = await client.post(
        "/api/v1/vaccines/generate-schedules",
        headers=b["headers"],
        json={
            "flock_id": b["flock_id"],
            "vaccine_definition_ids": [a["defs"]["AlphaVac"]["id"]],
        },
    )
    assert resp.status_code == 200, resp.text

    after = await _dose_rows_for_def(
        db_session, owner_id=a["owner_id"], flock_id=a["flock_id"], definition_id=a["defs"]["AlphaVac"]["id"]
    )
    assert [(r["id"], r["is_active"], r["status"], r["due_date"]) for r in after] == [
        (r["id"], r["is_active"], r["status"], r["due_date"]) for r in before
    ]


@pytest.mark.asyncio
async def test_catalogue_item_all_active_edit_remains_gated(client: AsyncClient) -> None:
    ctx = await _setup_programme_with_flock(client, label="Gate", hatch_days_ago=5)
    item = next(i for i in ctx["catalogue"]["items"] if i["name"] == "AlphaVac")
    items_payload = [
        {
            "id": item["id"],
            "name": "AlphaVac",
            "rules": [{"dose_number": 1, "target_age_days": 11}],
        }
    ]
    preview = await client.post(
        f"/api/v1/vaccine-catalogues/{ctx['catalogue']['id']}/preview-update",
        headers=ctx["headers"],
        json={"apply_scope": "all_active", "items": items_payload},
    )
    assert preview.status_code == 200, preview.text
    pv = preview.json()
    gated = await client.patch(
        f"/api/v1/vaccine-catalogues/{ctx['catalogue']['id']}",
        headers=ctx["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "all_active",
            "expected_version": pv["catalogue_version"],
            "expected_assignment_catalogue_id": pv["expected_assignment_catalogue_id"],
            "expected_override_flock_count": pv["expected_override_flock_count"],
            "items": items_payload,
        },
    )
    assert gated.status_code == 403, gated.text
    assert "not enabled" in gated.json()["detail"].lower()


@pytest.mark.asyncio
async def test_catalogue_age_change_via_assign_regen_retires_obsolete(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Materialize with new_flocks then assign all_active uses retirement in generate."""
    ctx = await _setup_programme_with_flock(client, label="CatAge", hatch_days_ago=10, alpha_age=1)
    item = next(i for i in ctx["catalogue"]["items"] if i["name"] == "AlphaVac")
    alpha_id = ctx["defs"]["AlphaVac"]["id"]
    old_due = ctx["hatch"] + timedelta(days=1)
    new_age = 6
    new_due = ctx["hatch"] + timedelta(days=new_age)

    items_payload = [
        {
            "id": item["id"],
            "name": "AlphaVac",
            "disease_label": "ND",
            "rules": [{"dose_number": 1, "target_age_days": new_age, "grace_period_days": 0}],
        }
    ]
    preview = await client.post(
        f"/api/v1/vaccine-catalogues/{ctx['catalogue']['id']}/preview-update",
        headers=ctx["headers"],
        json={"apply_scope": "new_flocks", "items": items_payload},
    )
    assert preview.status_code == 200, preview.text
    pv = preview.json()
    patched = await client.patch(
        f"/api/v1/vaccine-catalogues/{ctx['catalogue']['id']}",
        headers=ctx["headers"],
        json={
            "confirm_change": True,
            "apply_scope": "new_flocks",
            "expected_version": pv["catalogue_version"],
            "expected_assignment_catalogue_id": pv["expected_assignment_catalogue_id"],
            "expected_override_flock_count": pv["expected_override_flock_count"],
            "items": items_payload,
        },
    )
    assert patched.status_code == 200, patched.text
    assert next(i for i in patched.json()["items"] if i["id"] == item["id"])["id"] == item["id"]

    # Still old due until flock regen
    mid = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    assert any(r["due_date"] == old_due and r["is_active"] for r in mid)

    assign = await client.post(
        "/api/v1/vaccine-catalogues/assign",
        headers=ctx["headers"],
        json={
            "catalogue_id": ctx["catalogue"]["id"],
            "apply_scope": "all_active",
            "confirm_change": True,
        },
    )
    assert assign.status_code == 200, assign.text

    after = await _dose_rows_for_def(
        db_session, owner_id=ctx["owner_id"], flock_id=ctx["flock_id"], definition_id=alpha_id
    )
    assert any(r["due_date"] == new_due and r["is_active"] for r in after)
    assert any(r["due_date"] == old_due and r["is_active"] is False and r["status"] == "inactive" for r in after)
