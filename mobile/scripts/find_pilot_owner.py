"""Locate or create a pilot owner for smoke testing (local API only)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8001"
OUT = Path(__file__).with_name("pilot-owner.json")
FARMER = json.loads(Path(__file__).with_name("pilot-farmer.json").read_text(encoding="utf-8"))


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
    candidates = [
        "pilot-owner@example.com",
        f"pilot-owner-{FARMER.get('ownerAccountId', '')[:8]}@example.com",
        "pilot-owner-2043019676@example.com",
    ]
    for email in candidates:
        code, raw = req("POST", "/api/v1/auth/login", {"email": email, "password": "password123"})
        print("try", email, code)
        if code == 200:
            token = json.loads(raw)["access_token"]
            me_code, me_raw = req(
                "GET",
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            me = json.loads(me_raw)
            mem = next(
                (m for m in me["memberships"] if m["owner_account_id"] == FARMER["ownerAccountId"]),
                me["memberships"][0],
            )
            payload = {
                "ownerEmail": email,
                "ownerPassword": "password123",
                "ownerAccountId": mem["owner_account_id"],
                "shedId": FARMER["shedId"],
                "flockId": FARMER["flockId"],
                "shedName": FARMER.get("shedName"),
            }
            OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print("FOUND", email, "role", mem.get("role"), "owner", mem["owner_account_id"])
            return

    # Register a fresh owner for smoke only if none of the candidates work.
    # Do NOT attach to farmer farm — create independent org and report for smoke.
    email = "pilot-smoke-owner@example.com"
    code, raw = req(
        "POST",
        "/api/v1/auth/register-owner",
        {
            "email": email,
            "password": "password123",
            "full_name": "Pilot Smoke Owner",
            "organization_name": "Pilot Smoke Farm",
        },
    )
    print("register", email, code, raw[:200])
    if code not in {200, 201}:
        # maybe already exists
        code, raw = req("POST", "/api/v1/auth/login", {"email": email, "password": "password123"})
        print("login fallback", code)
    if code not in {200, 201}:
        raise SystemExit("No owner account available for smoke test")
    token = json.loads(raw)["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    me_code, me_raw = req("GET", "/api/v1/auth/me", headers=headers)
    me = json.loads(me_raw)
    owner_id = me["memberships"][0]["owner_account_id"]
    headers["X-Owner-Account-Id"] = owner_id

    sheds_code, sheds_raw = req("GET", "/api/v1/sheds", headers=headers)
    sheds = json.loads(sheds_raw) if sheds_code == 200 else []
    if not sheds:
        sc, sr = req(
            "POST",
            "/api/v1/sheds",
            {"name": "Smoke Shed", "code": "SMK1"},
            headers,
        )
        print("create shed", sc, sr[:160])
        shed = json.loads(sr)
    else:
        shed = sheds[0]

    payload = {
        "ownerEmail": email,
        "ownerPassword": "password123",
        "ownerAccountId": owner_id,
        "shedId": shed["id"],
        "shedName": shed["name"],
        "flockId": None,
        "note": "Independent smoke owner (not Pilot Farmer farm)",
    }
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
