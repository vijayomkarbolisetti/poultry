"""One-off farmer session probes against the pilot API (port 8001)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8001"
CRED = json.loads(Path(__file__).with_name("pilot-farmer.json").read_text(encoding="utf-8"))


def req(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def main() -> None:
    status, raw = req(
        "POST",
        "/api/v1/auth/login",
        {"email": CRED["farmerEmail"], "password": CRED["farmerPassword"]},
    )
    print("LOGIN", status)
    login = json.loads(raw)
    token = login["access_token"]
    owner = CRED["ownerAccountId"]
    headers = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner}
    me_status, me_raw = req("GET", "/api/v1/auth/me", headers=headers)
    print("ME", me_status)
    me = json.loads(me_raw)
    memberships = [m for m in me.get("memberships", []) if m.get("owner_account_id") == owner]
    mem = memberships[0] if memberships else me["memberships"][0]
    print("role", mem.get("role"), "perms", mem.get("permission_codes"))

    checks = [
        ("sheds", "GET", "/api/v1/sheds"),
        ("overview ok", "GET", f"/api/v1/sheds/{CRED['shedId']}/overview"),
        ("overview secret", "GET", f"/api/v1/sheds/{CRED['secretShedId']}/overview"),
        ("flock ok", "GET", f"/api/v1/flocks/{CRED['flockId']}"),
        ("flock fake", "GET", "/api/v1/flocks/00000000-0000-0000-0000-000000000099"),
        ("doses assigned", "GET", f"/api/v1/vaccines/scheduled-doses?shed_id={CRED['shedId']}"),
        ("doses secret", "GET", f"/api/v1/vaccines/scheduled-doses?shed_id={CRED['secretShedId']}"),
        ("events assigned", "GET", f"/api/v1/vaccination-events?shed_id={CRED['shedId']}"),
        ("events secret", "GET", f"/api/v1/vaccination-events?shed_id={CRED['secretShedId']}"),
        (
            "assign secret",
            "POST",
            f"/api/v1/sheds/{CRED['secretShedId']}/assignments",
            {"owner_membership_id": mem["id"], "is_manager": True},
        ),
        ("create shed", "POST", "/api/v1/sheds", {"name": "Hijack", "code": "HJ1"}),
        (
            "create flock",
            "POST",
            "/api/v1/flocks",
            {
                "shed_id": CRED["shedId"],
                "batch_code": "X",
                "initial_count": 1,
                "tracking_mode": "batch",
                "dob_confidence": "unknown",
            },
        ),
    ]
    for item in checks:
        label, method, path = item[0], item[1], item[2]
        body = item[3] if len(item) > 3 else None
        code, payload = req(method, path, body, headers)
        snippet = payload[:240] + ("..." if len(payload) > 240 else "")
        print(f"{label}: {code} {snippet}")


if __name__ == "__main__":
    main()
