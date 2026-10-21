"""Seed + verify GET /api/v1/search on the live backend (default :8002)."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from httpx import Client

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8002"
OUT = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")
stamp = "1100"


def main() -> None:
    report: dict = {"base": BASE, "steps": [], "passed": [], "failed": []}

    def ok(step: str, detail: str = "") -> None:
        report["passed"].append(step)
        report["steps"].append({"step": step, "status": "passed", "detail": detail})

    def fail(step: str, detail: str) -> None:
        report["failed"].append(step)
        report["steps"].append({"step": step, "status": "failed", "detail": detail})

    with Client(timeout=60) as c:
        health = c.get(f"{BASE}/health")
        if health.status_code != 200:
            fail("health", str(health.status_code))
            _write(report)
            return
        ok("health", health.text)

        openapi = c.get(f"{BASE}/openapi.json")
        paths = openapi.json().get("paths", {}) if openapi.status_code == 200 else {}
        if "/api/v1/search" not in paths:
            fail("openapi_search", ",".join(p for p in paths if "search" in p))
            _write(report)
            return
        ok("openapi_search", "registered")

        email = f"gs.verify.{stamp}@example.com"
        reg = c.post(
            f"{BASE}/api/v1/auth/register-owner",
            json={
                "email": email,
                "password": "password123",
                "full_name": "GS Verify",
                "organization_name": f"GS Verify Farm {stamp}",
            },
        )
        token = (
            reg.json()["access_token"]
            if reg.status_code in {200, 201}
            else c.post(
                f"{BASE}/api/v1/auth/login",
                json={"email": email, "password": "password123"},
            ).json()["access_token"]
        )
        me = c.get(f"{BASE}/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        owner = me.json()["memberships"][0]["owner_account_id"]
        h = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner}
        ok("owner_auth", email)

        shed = c.post(
            f"{BASE}/api/v1/sheds",
            headers=h,
            json={"name": f"Alpha Shed {stamp}", "code": f"AS{stamp}", "is_owner_managed": True},
        )
        assert shed.status_code == 201, shed.text
        other = c.post(
            f"{BASE}/api/v1/sheds",
            headers=h,
            json={"name": f"Beta Shed {stamp}", "code": f"BS{stamp}", "is_owner_managed": True},
        )
        assert other.status_code == 201, other.text
        flock = c.post(
            f"{BASE}/api/v1/flocks",
            headers=h,
            json={
                "shed_id": shed.json()["id"],
                "batch_code": f"BX-{stamp}",
                "initial_count": 15,
                "tracking_mode": "mixed",
                "dob_confidence": "estimated",
                "estimated_age_days": 12,
                "age_reported_on": date.today().isoformat(),
                "unbanded_count": 14,
                "breed": "Layer",
            },
        )
        assert flock.status_code == 201, flock.text
        bird = c.post(
            f"{BASE}/api/v1/birds",
            headers=h,
            json={
                "flock_id": flock.json()["id"],
                "band_id": f"GB-{stamp}",
                "dob_confidence": "unknown",
            },
        )
        assert bird.status_code == 201, bird.text
        ok("seed", f"bird={bird.json()['id']}")

        # Exact bird
        exact = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": f"GB-{stamp}"})
        assert exact.status_code == 200, exact.text
        body = exact.json()
        assert body["birds"] and body["birds"]["exact_count"] >= 1
        assert any(i["band_id"] == f"GB-{stamp}" for i in body["birds"]["items"])
        ok("exact_bird", str(body["birds"]["exact_count"]))

        # Partial bird
        part = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": "GB-11"})
        assert part.status_code == 200
        assert part.json()["birds"]["total"] >= 1
        ok("partial_bird")

        # Batch
        batch = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": f"BX-{stamp}"})
        assert batch.status_code == 200
        assert batch.json()["batches"]["exact_count"] >= 1
        ok("batch_code")

        # Shed name + code
        sn = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": "Alpha Shed"})
        assert sn.status_code == 200
        assert sn.json()["sheds"]["total"] >= 1
        sc = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": f"AS{stamp}"})
        assert sc.status_code == 200
        assert sc.json()["sheds"]["total"] >= 1
        ok("shed_name_code")

        # Empty
        empty = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": "ZZZNOPE999"})
        assert empty.status_code == 200
        e = empty.json()
        assert e["birds"]["total"] == 0 and e["batches"]["total"] == 0 and e["sheds"]["total"] == 0
        ok("empty")

        # Types filter — birds only
        birds_only = c.get(
            f"{BASE}/api/v1/search", headers=h, params={"q": stamp, "types": "birds"}
        )
        assert birds_only.status_code == 200
        assert birds_only.json()["batches"] is None and birds_only.json()["sheds"] is None
        ok("types_birds_only")

        # Farmer scope
        farmer = c.post(
            f"{BASE}/api/v1/farmers",
            headers=h,
            json={
                "email": f"gs.verify.farmer.{stamp}@example.com",
                "password": "password123",
                "full_name": "GS Farmer",
                "role": "farmer",
                "permission_codes": ["bird.view", "shed.view", "flock.view"],
                "shed_ids": [shed.json()["id"]],
            },
        )
        assert farmer.status_code == 201, farmer.text
        fl = c.post(
            f"{BASE}/api/v1/auth/login",
            json={"email": f"gs.verify.farmer.{stamp}@example.com", "password": "password123"},
        )
        fh = {
            "Authorization": f"Bearer {fl.json()['access_token']}",
            "X-Owner-Account-Id": owner,
        }
        fsearch = c.get(f"{BASE}/api/v1/search", headers=fh, params={"q": stamp})
        assert fsearch.status_code == 200
        fb = fsearch.json()
        shed_ids = [i["id"] for i in (fb["sheds"]["items"] if fb["sheds"] else [])]
        assert shed.json()["id"] in shed_ids
        assert other.json()["id"] not in shed_ids
        beta = c.get(f"{BASE}/api/v1/search", headers=fh, params={"q": f"BS{stamp}"})
        assert (beta.json()["sheds"] or {"total": 0})["total"] == 0
        ok("farmer_shed_scope")

        # Cross-org isolation
        other_owner = c.post(
            f"{BASE}/api/v1/auth/register-owner",
            json={
                "email": f"gs.verify.other.{stamp}@example.com",
                "password": "password123",
                "full_name": "Other",
                "organization_name": f"Other {stamp}",
            },
        )
        ot = other_owner.json()["access_token"]
        ome = c.get(f"{BASE}/api/v1/auth/me", headers={"Authorization": f"Bearer {ot}"})
        oh = {
            "Authorization": f"Bearer {ot}",
            "X-Owner-Account-Id": ome.json()["memberships"][0]["owner_account_id"],
        }
        cross = c.get(f"{BASE}/api/v1/search", headers=oh, params={"q": f"GB-{stamp}"})
        assert cross.status_code == 200
        assert cross.json()["birds"]["total"] == 0
        ok("tenant_isolation")

        # Stale deleted bird detail = 404
        missing = c.get(f"{BASE}/api/v1/birds/{bird.json()['id']}/profile", headers=oh)
        assert missing.status_code == 404
        ok("unauthorized_profile_404")

        report["seed"] = {
            "band": f"GB-{stamp}",
            "batch": f"BX-{stamp}",
            "shed_name": f"Alpha Shed {stamp}",
            "shed_code": f"AS{stamp}",
            "bird_id": bird.json()["id"],
            "flock_id": flock.json()["id"],
            "shed_id": shed.json()["id"],
            "owner_email": email,
            "farmer_email": f"gs.verify.farmer.{stamp}@example.com",
            "password": "password123",
            "owner_account_id": owner,
        }

    _write(report)
    print(json.dumps(report, indent=2))


def _write(report: dict) -> None:
    (OUT / "global_search_api_verification.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
