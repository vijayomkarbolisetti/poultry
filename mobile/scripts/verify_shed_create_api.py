"""Live API check: owner-managed + farmer-managed create with assignment."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8001"
OWNER = json.loads(Path(__file__).with_name("pilot-owner.json").read_text(encoding="utf-8"))


def req(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")


def main() -> None:
    st, login = req(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    print("login", st)
    headers = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }
    stamp = int(time.time()) % 100000
    st, farmers = req("GET", "/api/v1/farmers", headers=headers)
    farmer = next(f for f in farmers if f.get("role") == "farmer" and f.get("is_active"))
    fid = farmer["membership_id"]
    print("farmer", farmer["full_name"], fid)

    st, shed = req(
        "POST",
        "/api/v1/sheds",
        {
            "name": "E2E Farmer Shed",
            "code": f"EF{stamp}",
            "is_owner_managed": False,
            "initial_farmer_membership_id": fid,
        },
        headers,
    )
    print("farmer-managed create", st, shed if st >= 400 else shed["id"])
    assert st == 201
    st, assigns = req("GET", f"/api/v1/sheds/{shed['id']}/assignments", headers=headers)
    print("assignments", st, assigns)
    assert len(assigns) == 1 and assigns[0]["owner_membership_id"] == fid

    st, om = req(
        "POST",
        "/api/v1/sheds",
        {"name": "E2E Owner Shed", "code": f"EO{stamp}", "is_owner_managed": True},
        headers,
    )
    print("owner-managed create", st, om["id"] if st == 201 else om)
    assert st == 201

    st, bad = req(
        "POST",
        "/api/v1/sheds",
        {"name": "Bad", "code": f"EB{stamp}", "is_owner_managed": False},
        headers,
    )
    print("missing farmer rejected", st)
    assert st == 422
    print("OK")


if __name__ == "__main__":
    main()
