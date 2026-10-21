"""Seed Global Search fixtures under the pilot owner already used on the emulator."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from httpx import Client

BASE = "http://127.0.0.1:8002"
S = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
stamp = "1105"


def main() -> None:
    with Client(timeout=60) as c:
        login = c.post(
            f"{BASE}/api/v1/auth/login",
            json={"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        owner = OWNER.get("ownerAccountId")
        if not owner:
            me = c.get(f"{BASE}/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
            owner = me.json()["memberships"][0]["owner_account_id"]
        h = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner}

        shed = c.post(
            f"{BASE}/api/v1/sheds",
            headers=h,
            json={
                "name": f"Alpha Shed {stamp}",
                "code": f"AS{stamp}",
                "is_owner_managed": True,
            },
        )
        assert shed.status_code == 201, shed.text
        other = c.post(
            f"{BASE}/api/v1/sheds",
            headers=h,
            json={
                "name": f"Beta Shed {stamp}",
                "code": f"BS{stamp}",
                "is_owner_managed": True,
            },
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

        # Confirm search sees them
        search = c.get(f"{BASE}/api/v1/search", headers=h, params={"q": stamp})
        assert search.status_code == 200, search.text
        body = search.json()
        assert body["birds"]["total"] >= 1
        assert body["batches"]["total"] >= 1
        assert body["sheds"]["total"] >= 1

        out = {
            "base": BASE,
            "owner_email": OWNER["ownerEmail"],
            "owner_account_id": owner,
            "band": f"GB-{stamp}",
            "batch": f"BX-{stamp}",
            "shed_name": f"Alpha Shed {stamp}",
            "shed_code": f"AS{stamp}",
            "other_shed_code": f"BS{stamp}",
            "bird_id": bird.json()["id"],
            "flock_id": flock.json()["id"],
            "shed_id": shed.json()["id"],
            "search_totals": {
                "birds": body["birds"]["total"],
                "batches": body["batches"]["total"],
                "sheds": body["sheds"]["total"],
            },
        }
        (S / "global_search_pilot_seed.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
