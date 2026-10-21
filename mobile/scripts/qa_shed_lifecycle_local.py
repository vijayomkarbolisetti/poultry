"""Local :8002 shed create→view→list→auth isolation (disposable owner)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

S = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:8002"
TAG = f"LQA{time.strftime('%H%M%S')}"
results: list[dict] = []


def log(tid, scenario, expected, actual, status):
    results.append(
        {"test_id": tid, "scenario": scenario, "expected": expected, "actual": str(actual)[:300], "status": status}
    )
    print(f"{status:8} {tid} — {scenario}: {str(actual)[:120]}")


def api(method, path, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={**headers, "Content-Type": "application/json"}, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, str(e)


def main():
    email = f"shed.qa.{TAG.lower()}@example.com"
    c, reg = api(
        "POST",
        "/api/v1/auth/register-owner",
        {},
        {
            "email": email,
            "password": "password123",
            "full_name": f"Shed QA {TAG}",
            "organization_name": f"Shed QA Farm {TAG}",
        },
    )
    if c not in (200, 201):
        log("LOC-01", "Register owner", "201", f"{c} {reg}", "FAIL")
        _out()
        return
    token = reg["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    h = {
        "Authorization": f"Bearer {token}",
        "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"],
    }
    log("LOC-01", "Register owner", "201", "ok", "PASS")

    name, code = f"Local Shed {TAG}", f"L{TAG[-4:]}"
    c, shed = api("POST", "/api/v1/sheds", h, {"name": name, "code": code, "is_owner_managed": True})
    sid = shed.get("id") if isinstance(shed, dict) else None
    log("LOC-02", "Create shed", "201 + id", f"{c} {sid}", "PASS" if c in (200, 201) and sid else "FAIL")
    if not sid:
        _out()
        return

    c, ov = api("GET", f"/api/v1/sheds/{sid}/overview", h)
    log(
        "LOC-03",
        "Overview after create",
        "matching name",
        f"{c} {ov.get('shed',{}).get('name') if isinstance(ov, dict) else ov}",
        "PASS" if c == 200 and ov.get("shed", {}).get("id") == sid else "FAIL",
    )

    c, listed = api("GET", "/api/v1/sheds", h)
    row = next((s for s in listed if s["id"] == sid), None) if isinstance(listed, list) else None
    has_managers = isinstance(row, dict) and isinstance(row.get("manager_names"), list)
    log(
        "LOC-04",
        "List item includes manager_names array",
        "array present",
        f"found={bool(row)} managers={None if not row else row.get('manager_names')}",
        "PASS" if row and has_managers else "FAIL",
    )

    # Double-create same code (flush-time IntegrityError must map to 409, not 500)
    c, dup = api("POST", "/api/v1/sheds", h, {"name": name + "2", "code": code, "is_owner_managed": True})
    log("LOC-05", "Duplicate code", "409", f"{c} {dup}", "PASS" if c == 409 else "FAIL")

    # Spaces-only name
    c, blank = api("POST", "/api/v1/sheds", h, {"name": "   ", "code": f"{code}X", "is_owner_managed": True})
    log("LOC-06", "Blank name", "4xx", c, "PASS" if c >= 400 else "FAIL")

    # Cross-tenant
    email2 = f"shed.qa.other.{TAG.lower()}@example.com"
    c, reg2 = api(
        "POST",
        "/api/v1/auth/register-owner",
        {},
        {
            "email": email2,
            "password": "password123",
            "full_name": "Other",
            "organization_name": f"Other {TAG}",
        },
    )
    t2 = reg2["access_token"]
    _, me2 = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {t2}"})
    h2 = {
        "Authorization": f"Bearer {t2}",
        "X-Owner-Account-Id": me2["memberships"][0]["owner_account_id"],
    }
    c, denied = api("GET", f"/api/v1/sheds/{sid}/overview", h2)
    log("LOC-07", "Other org cannot overview shed", "403/404", c, "PASS" if c in (403, 404) else "FAIL")

    # Farmer-managed without farmer
    c, nf = api("POST", "/api/v1/sheds", h, {"name": f"NF {TAG}", "code": f"N{TAG[-3:]}", "is_owner_managed": False})
    log("LOC-08", "Farmer-managed missing farmer", "4xx", c, "PASS" if c >= 400 else "FAIL")

    _out(sid)


def _out(sid=None):
    out = {
        "base": BASE,
        "tag": TAG,
        "shed_id": sid,
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
    }
    (S / "shed_lifecycle_local_qa.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("LOCAL_SUMMARY", {k: out[k] for k in ("passed", "failed")})


if __name__ == "__main__":
    main()
