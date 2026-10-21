"""Create a temporary mixed batch with count_mismatch for UI verification (owner farm)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

import psycopg2

BASE = "http://127.0.0.1:8001"
OWNER = json.loads(Path(__file__).with_name("pilot-owner.json").read_text(encoding="utf-8"))
DB = "postgresql://poultry:poultry@localhost:5433/poultry_tracker"
OUT = Path(__file__).with_name("pilot-mismatch.json")


def req(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")


def main() -> None:
    code, login = req(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    assert code == 200, login
    headers = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }
    fcode, flock = req(
        "POST",
        "/api/v1/flocks",
        {
            "shed_id": OWNER["shedId"],
            "batch_code": "MISMATCH-UI",
            "initial_count": 40,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
            "unbanded_count": 40,
        },
        headers,
    )
    print("create flock", fcode, flock if fcode >= 400 else flock.get("id"))
    assert fcode == 201, flock
    fid = flock["id"]
    with psycopg2.connect(DB) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE flocks
            SET banded_count = 5, unbanded_count = 30, count_mismatch = true
            WHERE id = %s
            """,
            (fid,),
        )
        conn.commit()
    ocode, overview = req("GET", f"/api/v1/sheds/{OWNER['shedId']}/overview", headers=headers)
    batch = next(b for b in overview["batches"] if b["id"] == fid)
    print("overview batch mismatch", batch["count_mismatch"], batch["banded_count"], batch["unbanded_count"], batch["current_count"])
    OUT.write_text(
        json.dumps({"flockId": fid, "shedId": OWNER["shedId"], "batch_code": "MISMATCH-UI"}, indent=2),
        encoding="utf-8",
    )
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
