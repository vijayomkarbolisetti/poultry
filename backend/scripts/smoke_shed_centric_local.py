"""Disposable local smoke: shed-centric register / unbanded / convert / counts.

Requires a running API (default http://127.0.0.1:8002). Uses a unique org email.
Does not touch production.
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import date, timedelta

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8002"
API = f"{BASE.rstrip('/')}/api/v1"


def main() -> int:
    stamp = uuid.uuid4().hex[:8]
    email = f"smoke-{stamp}@example.com"
    results: list[tuple[str, str]] = []

    with httpx.Client(timeout=30.0) as client:
        reg = client.post(
            f"{API}/auth/register-owner",
            json={
                "email": email,
                "password": "password123",
                "full_name": "Smoke QA",
                "organization_name": f"Smoke Org {stamp}",
            },
        )
        if reg.status_code != 201:
            print("FAIL register-owner", reg.status_code, reg.text[:300])
            return 1
        token = reg.json()["access_token"]
        me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        owner = me.json()["memberships"][0]["owner_account_id"]
        h = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner}

        shed = client.post(
            f"{API}/sheds",
            headers=h,
            json={"name": f"Smoke Shed {stamp}", "code": f"S{stamp[:5].upper()}", "is_owner_managed": True},
        )
        assert shed.status_code == 201, shed.text
        shed_id = shed.json()["id"]
        results.append(("empty shed create", "VERIFIED"))

        hatch = (date.today() - timedelta(days=9)).isoformat()
        future = (date.today() + timedelta(days=2)).isoformat()

        bad = client.post(
            f"{API}/birds/register-in-shed",
            headers=h,
            json={"shed_id": shed_id, "band_id": f"B-{stamp}", "hatch_date": future},
        )
        assert bad.status_code == 422, bad.text
        results.append(("reject future DOB", "VERIFIED"))

        band = f"RB-{stamp.upper()}"
        ok = client.post(
            f"{API}/birds/register-in-shed",
            headers=h,
            json={"shed_id": shed_id, "band_id": band, "hatch_date": hatch},
        )
        assert ok.status_code == 201, ok.text
        results.append(("register banded empty shed", "VERIFIED"))

        ub = client.post(
            f"{API}/birds/add-unbanded-in-shed",
            headers=h,
            json={
                "shed_id": shed_id,
                "quantity": 15,
                "hatch_date": hatch,
                "idempotency_key": f"ub-{stamp}",
            },
        )
        assert ub.status_code == 201, ub.text
        assert ub.json()["flock"]["unbanded_count"] >= 15
        flock_id = ub.json()["flock"]["id"]
        results.append(("add unbanded same DOB cohort", "VERIFIED"))

        ov = client.get(f"{API}/sheds/{shed_id}/overview", headers=h)
        assert ov.status_code == 200, ov.text
        pop = ov.json()["population"]
        assert pop["banded_birds"] == 1
        assert pop["unbanded_birds"] == 15
        assert pop["total_live_birds"] == 16
        results.append(("overview counts after register+unbanded", "VERIFIED"))

        key = f"cnv-{stamp}"
        cnv = client.post(
            f"{API}/birds/band-from-unbanded",
            headers=h,
            json={"flock_id": flock_id, "band_id": f"CV-{stamp.upper()}", "idempotency_key": key},
        )
        assert cnv.status_code == 201, cnv.text
        assert cnv.json()["flock_unbanded_count"] == 14
        assert cnv.json()["flock_banded_count"] == 2
        assert cnv.json()["flock_current_count"] == 16
        replay = client.post(
            f"{API}/birds/band-from-unbanded",
            headers=h,
            json={"flock_id": flock_id, "band_id": f"CV-{stamp.upper()}", "idempotency_key": key},
        )
        assert replay.status_code == 201 and replay.json()["idempotent_replay"] is True
        results.append(("band-from-unbanded + idempotent replay", "VERIFIED"))

        listed = client.get(f"{API}/birds/in-shed", headers=h, params={"shed_id": shed_id})
        assert listed.status_code == 200, listed.text
        assert listed.json()["total"] == 2
        assert listed.json()["unbanded_total"] == 14
        results.append(("in-shed list", "VERIFIED"))

        bird_id = cnv.json()["bird"]["id"]
        prof = client.get(f"{API}/birds/{bird_id}/profile", headers=h)
        assert prof.status_code == 200, prof.text
        assert prof.json()["hatch_date"] == hatch
        results.append(("profile preserves cohort DOB", "VERIFIED"))

        # Duplicate band
        dup = client.post(
            f"{API}/birds/register-in-shed",
            headers=h,
            json={"shed_id": shed_id, "band_id": band, "hatch_date": hatch},
        )
        assert dup.status_code == 400, dup.text
        results.append(("duplicate band rejected", "VERIFIED"))

    print(json.dumps({"base": BASE, "email": email, "results": results}, indent=2))
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
