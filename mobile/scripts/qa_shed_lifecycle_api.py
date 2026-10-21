"""API lifecycle: create shed → overview → list → reopen → unauthorized isolation."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

S = Path(__file__).resolve().parent
BASE = "https://3.6.160.64.sslip.io"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
TAG = f"QA{time.strftime('%H%M%S')}"
results: list[dict] = []


def log(tid: str, scenario: str, expected: str, actual: str, status: str) -> None:
    results.append(
        {
            "test_id": tid,
            "scenario": scenario,
            "expected": expected,
            "actual": actual[:300],
            "status": status,
        }
    )
    print(f"{status:8} {tid} — {scenario}: {actual[:120]}")


def api(method: str, path: str, headers: dict, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={**headers, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


def login(email: str, password: str) -> dict:
    code, body = api("POST", "/api/v1/auth/login", {}, {"email": email, "password": password})
    if code != 200:
        raise RuntimeError(f"login {code} {body}")
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    return {
        "Authorization": f"Bearer {token}",
        "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"],
        "me": me,
    }


def main() -> None:
    try:
        h = login(OWNER["ownerEmail"], OWNER["ownerPassword"])
        log("API-01", "Owner login to production API", "200 + token", "ok", "PASS")
    except Exception as e:
        log("API-01", "Owner login to production API", "200 + token", str(e), "FAIL")
        (S / "shed_lifecycle_api_qa.json").write_text(json.dumps({"results": results}, indent=2))
        return

    name = f"QA Shed {TAG}"
    code = f"Q{TAG[-4:]}"
    code2 = f"Q{TAG[-4:]}B"

    # Valid create
    c1, shed = api(
        "POST",
        "/api/v1/sheds",
        h,
        {"name": name, "code": code, "is_owner_managed": True, "location_notes": "QA notes"},
    )
    ok = c1 in (200, 201) and shed.get("id") and shed.get("name") == name
    log("API-02", "Create owner-managed shed", "201 with matching name", f"{c1} {shed.get('id')}", "PASS" if ok else "FAIL")
    sid = shed.get("id")

    if not sid:
        (S / "shed_lifecycle_api_qa.json").write_text(json.dumps({"results": results}, indent=2))
        return

    # Overview immediately after create
    c2, ov = api("GET", f"/api/v1/sheds/{sid}/overview", h)
    ok = c2 == 200 and ov.get("shed", {}).get("id") == sid and ov["shed"]["name"] == name
    log("API-03", "Overview after create", "200 exact shed", f"{c2} name={ov.get('shed',{}).get('name')}", "PASS" if ok else "FAIL")

    # List contains shed
    c3, listed = api("GET", "/api/v1/sheds", h)
    ids = [s["id"] for s in listed] if isinstance(listed, list) else []
    log("API-04", "List contains new shed", "id present", f"found={sid in ids} n={len(ids)}", "PASS" if sid in ids else "FAIL")

    # GET by id
    c4, one = api("GET", f"/api/v1/sheds/{sid}", h)
    log("API-05", "GET shed by id", "200 matching", f"{c4} {one.get('code')}", "PASS" if c4 == 200 and one.get("id") == sid else "FAIL")

    # Duplicate code rejected
    c5, dup = api(
        "POST",
        "/api/v1/sheds",
        h,
        {"name": f"{name} Dup", "code": code, "is_owner_managed": True},
    )
    log("API-06", "Duplicate code rejected", "4xx DUPLICATE", f"{c5} {dup}", "PASS" if c5 in (400, 409, 422) else "FAIL")

    # Whitespace validation (API may trim — name empty after strip should fail)
    c6, blank = api("POST", "/api/v1/sheds", h, {"name": "   ", "code": code2, "is_owner_managed": True})
    log("API-07", "Blank name rejected", "4xx", f"{c6}", "PASS" if c6 >= 400 else "FAIL")

    # Farmer-managed without farmer
    c7, nf = api(
        "POST",
        "/api/v1/sheds",
        h,
        {"name": f"{name} NF", "code": f"{code2}N", "is_owner_managed": False},
    )
    log("API-08", "Farmer-managed without farmer", "4xx FARMER_REQUIRED", f"{c7} {nf}", "PASS" if c7 >= 400 else "FAIL")

    # Cross-tenant / random id
    fake = str(uuid.uuid4())
    c8, denied = api("GET", f"/api/v1/sheds/{fake}/overview", h)
    log("API-09", "Unknown shed overview", "403/404", f"{c8}", "PASS" if c8 in (403, 404) else "FAIL")

    # Second create + ensure overview isolation
    c9, shed2 = api(
        "POST",
        "/api/v1/sheds",
        h,
        {"name": f"{name} Two", "code": code2, "is_owner_managed": True},
    )
    sid2 = shed2.get("id")
    ov1 = api("GET", f"/api/v1/sheds/{sid}/overview", h)[1]
    ov2 = api("GET", f"/api/v1/sheds/{sid2}/overview", h)[1] if sid2 else {}
    ok = (
        c9 in (200, 201)
        and ov1.get("shed", {}).get("id") == sid
        and ov2.get("shed", {}).get("id") == sid2
        and ov1["shed"]["name"] != ov2.get("shed", {}).get("name")
    )
    log("API-10", "Two sheds overview isolation", "distinct records", f"ok={ok}", "PASS" if ok else "FAIL")

    # Deactivate / list active
    c11, deact = api("POST", f"/api/v1/sheds/{sid2}/deactivate", h)
    active = api("GET", "/api/v1/sheds", h)[1]
    active_ids = [s["id"] for s in active] if isinstance(active, list) else []
    log(
        "API-11",
        "Deactivate removes from active list",
        "sid2 absent from active list",
        f"deact={c11} in_active={sid2 in active_ids}",
        "PASS" if c11 == 200 and sid2 not in active_ids else "FAIL",
    )

    out = {
        "base": BASE,
        "tag": TAG,
        "shed_ids": [sid, sid2],
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
    }
    (S / "shed_lifecycle_api_qa.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("SUMMARY", {k: out[k] for k in ("passed", "failed", "tag")})


if __name__ == "__main__":
    main()
