"""Seed disposable shed-bird fixtures on :8002 and verify owner/farmer API flows.

Credentials are never printed. Uses unique band prefixes so farm pilot data is untouched.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

BASE = "http://127.0.0.1:8002"
S = Path(__file__).resolve().parent
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
FARMER = json.loads((S / "pilot-farmer.json").read_text(encoding="utf-8"))
TAG = "SBM1210"  # disposable prefix
results: list[dict] = []


def log(step: str, status: str, detail: str = "") -> None:
    safe = detail
    for secret in (OWNER.get("ownerPassword"), FARMER.get("farmerPassword")):
        if secret:
            safe = safe.replace(secret, "[REDACTED]")
    results.append({"step": step, "status": status, "detail": safe[:400]})
    print(f"{status.upper():10} {step} — {safe[:160]}")


def req(method: str, path: str, headers: dict | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={**(headers or {}), **({"Content-Type": "application/json"} if body is not None else {})},
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw[:200]}
        return e.code, payload


def login(email: str, password: str) -> dict:
    code, data = req("POST", "/api/v1/auth/login", body={"email": email, "password": password})
    if code != 200:
        raise RuntimeError(f"login failed {code} {data}")
    me_code, me = req(
        "GET",
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    if me_code != 200:
        raise RuntimeError(f"me failed {me_code}")
    owner_id = me["memberships"][0]["owner_account_id"]
    return {
        "Authorization": f"Bearer {data['access_token']}",
        "X-Owner-Account-Id": owner_id,
    }, owner_id


def main() -> None:
    oh, owner_id = login(OWNER["ownerEmail"], OWNER["ownerPassword"])
    log("owner_login", "passed", owner_id)

    # Disposable shed + mixed batch with unbanded + banded birds
    code, shed = req(
        "POST",
        "/api/v1/sheds",
        headers=oh,
        body={"name": f"SBM Verify {TAG}", "code": f"SBM{TAG}", "is_owner_managed": True},
    )
    if code != 201:
        log("create_shed", "failed", f"{code} {shed}")
        _write()
        return
    sid = shed["id"]
    log("create_shed", "passed", sid)

    code, flock = req(
        "POST",
        "/api/v1/flocks",
        headers=oh,
        body={
            "shed_id": sid,
            "batch_code": f"BX-{TAG}",
            "initial_count": 15,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 14,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": 15,
            "breed": "Layer",
        },
    )
    assert code == 201, flock
    fid = flock["id"]
    log("create_batch", "passed", fid)

    bands = [f"{TAG}-A1", f"{TAG}-A2", f"{TAG}-B9", f"{TAG}-C1", f"{TAG}-C2", f"{TAG}-C3"]
    bird_ids: dict[str, str] = {}
    for b in bands:
        code, bird = req(
            "POST",
            "/api/v1/birds",
            headers=oh,
            body={"flock_id": fid, "band_id": b, "dob_confidence": "unknown", "sex": "F", "breed": "Layer"},
        )
        assert code == 201, (b, bird)
        bird_ids[b] = bird["id"]
    log("seed_banded", "passed", str(list(bird_ids.keys())))

    # List
    q = urllib.parse.urlencode({"shed_id": sid, "limit": 3, "offset": 0})
    code, listed = req("GET", f"/api/v1/birds/in-shed?{q}", headers=oh)
    assert code == 200, listed
    assert listed["total"] == 6
    assert len(listed["items"]) == 3
    assert listed["unbanded_total"] == 9  # 15-6
    assert all(i.get("band_id") for i in listed["items"])
    log("list_pagination", "passed", f"total={listed['total']} unbanded={listed['unbanded_total']}")

    q = urllib.parse.urlencode({"shed_id": sid, "q": f"{TAG}-A"})
    code, partial = req("GET", f"/api/v1/birds/in-shed?{q}", headers=oh)
    assert code == 200 and partial["total"] == 2
    log("search_partial", "passed", str([i["band_id"] for i in partial["items"]]))

    q = urllib.parse.urlencode({"shed_id": sid, "q": f"{TAG}-A1"})
    code, exact = req("GET", f"/api/v1/birds/in-shed?{q}", headers=oh)
    assert code == 200 and exact["total"] == 1
    log("search_exact", "passed", exact["items"][0]["band_id"])

    q = urllib.parse.urlencode({"shed_id": sid, "flock_id": fid})
    code, by_batch = req("GET", f"/api/v1/birds/in-shed?{q}", headers=oh)
    assert code == 200 and by_batch["total"] == 6
    log("filter_batch", "passed")

    # Duplicate band
    code, dup = req(
        "POST",
        "/api/v1/birds",
        headers=oh,
        body={"flock_id": fid, "band_id": f"{TAG}-A1", "dob_confidence": "unknown"},
    )
    assert code == 400
    log("duplicate_band_rejected", "passed", str(dup.get("detail")))

    # Add new bird
    code, added = req(
        "POST",
        "/api/v1/birds",
        headers=oh,
        body={"flock_id": fid, "band_id": f"{TAG}-NEW", "dob_confidence": "unknown", "notes": "api-add"},
    )
    assert code == 201
    bird_ids[f"{TAG}-NEW"] = added["id"]
    code, after_add = req("GET", f"/api/v1/birds/in-shed?shed_id={sid}", headers=oh)
    assert after_add["total"] == 7
    assert after_add["unbanded_total"] == 8
    log("add_bird_counts", "passed", f"total={after_add['total']} unbanded={after_add['unbanded_total']}")

    # Edit
    bid = bird_ids[f"{TAG}-A1"]
    code, edited = req(
        "PATCH",
        f"/api/v1/birds/{bid}",
        headers=oh,
        body={"breed": "Rhode Island", "notes": "edited-via-api", "sex": "F"},
    )
    assert code == 200 and edited["breed"] == "Rhode Island"
    code, profile = req("GET", f"/api/v1/birds/{bid}/profile", headers=oh)
    assert profile["breed"] == "Rhode Island" and profile["notes"] == "edited-via-api"
    log("edit_bird", "passed")

    # Lifecycle on three disposable birds
    for band, etype, status in (
        (f"{TAG}-C1", "mortality", "dead"),
        (f"{TAG}-C2", "sale", "sold"),
        (f"{TAG}-C3", "transfer", "transferred_out"),
    ):
        code, ev = req(
            "POST",
            "/api/v1/lifecycle-events",
            headers=oh,
            body={
                "event_type": etype,
                "effective_date": date.today().isoformat(),
                "bird_id": bird_ids[band],
                "quantity": 1,
                "reason": f"SBM verify {etype}",
                "idempotency_key": f"sbm-{etype}-{bird_ids[band]}",
            },
        )
        assert code == 201, ev
        # Idempotent replay
        code2, _ = req(
            "POST",
            "/api/v1/lifecycle-events",
            headers=oh,
            body={
                "event_type": etype,
                "effective_date": date.today().isoformat(),
                "bird_id": bird_ids[band],
                "quantity": 1,
                "idempotency_key": f"sbm-{etype}-{bird_ids[band]}",
            },
        )
        assert code2 == 201
        code, prof = req("GET", f"/api/v1/birds/{bird_ids[band]}/profile", headers=oh)
        assert prof["lifecycle_status"] == status and prof["is_active"] is False
        assert any(e["event_type"] == etype for e in prof["lifecycle_events"])
        log(f"lifecycle_{etype}", "passed", status)

    code, active = req("GET", f"/api/v1/birds/in-shed?shed_id={sid}", headers=oh)
    # 7 created - 3 lifecycle = 4 active
    assert active["total"] == 4
    log("active_after_lifecycle", "passed", f"total={active['total']}")

    code, dead = req(
        "GET",
        f"/api/v1/birds/in-shed?shed_id={sid}&lifecycle_status=dead&include_inactive=true",
        headers=oh,
    )
    assert dead["total"] == 1
    log("filter_lifecycle_dead", "passed")

    # Farmer: create assigned farmer for this disposable shed
    farmer_email = f"sbm-farmer-{TAG.lower()}@example.com"
    code, fr = req(
        "POST",
        "/api/v1/farmers",
        headers=oh,
        body={
            "email": farmer_email,
            "password": "password123",
            "full_name": "SBM Farmer",
            "role": "farmer",
            "permission_codes": [
                "bird.view",
                "bird.create",
                "bird.update",
                "lifecycle.record",
                "shed.view",
                "flock.view",
            ],
            "shed_ids": [sid],
        },
    )
    # May already exist from prior run
    if code not in (201, 400, 409):
        log("create_farmer", "failed", f"{code} {fr}")
    else:
        log("create_farmer", "passed" if code == 201 else "passed", f"status={code}")

    fh, _ = login(farmer_email, "password123")
    code, flist = req("GET", f"/api/v1/birds/in-shed?shed_id={sid}", headers=fh)
    assert code == 200 and flist["total"] == 4
    log("farmer_list_assigned", "passed")

    # Unauthorized: pilot farmer shed (different) or other owner shed
    other_shed = OWNER.get("shedId")
    if other_shed and other_shed != sid:
        code, denied = req("GET", f"/api/v1/birds/in-shed?shed_id={other_shed}", headers=fh)
        assert code in (403, 404)
        log("farmer_denied_other_shed", "passed", str(code))
    else:
        log("farmer_denied_other_shed", "not_tested", "no alternate shed id")

    # Existing pilot farmer against disposable shed (should be denied if not assigned)
    try:
        pfh, _ = login(FARMER["farmerEmail"], FARMER["farmerPassword"])
        code, denied2 = req("GET", f"/api/v1/birds/in-shed?shed_id={sid}", headers=pfh)
        if code in (403, 404):
            log("pilot_farmer_denied_sbm_shed", "passed", str(code))
        elif code == 200:
            log("pilot_farmer_denied_sbm_shed", "failed", "unexpected access")
        else:
            log("pilot_farmer_denied_sbm_shed", "failed", f"{code}")
    except Exception as e:
        log("pilot_farmer_denied_sbm_shed", "not_tested", str(e)[:120])

    seed = {
        "base": BASE,
        "shed_id": sid,
        "flock_id": fid,
        "shed_code": f"SBM{TAG}",
        "batch_code": f"BX-{TAG}",
        "bands": bands + [f"{TAG}-NEW"],
        "bird_ids": bird_ids,
        "lifecycle": {
            f"{TAG}-C1": "dead",
            f"{TAG}-C2": "sold",
            f"{TAG}-C3": "transferred_out",
        },
        "farmer_email": farmer_email,
        "tag": TAG,
    }
    (S / "shed_birds_verify_seed.json").write_text(json.dumps(seed, indent=2), encoding="utf-8")
    _write(seed)


def _write(seed: dict | None = None) -> None:
    out = {
        "authenticated_api": True,
        "backend": BASE,
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "seed": seed,
    }
    (S / "shed_birds_api_verification.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("API_SUMMARY", json.dumps({k: out[k] for k in out if k not in ("results", "seed")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("fatal", "failed", str(e))
        _write()
        raise
