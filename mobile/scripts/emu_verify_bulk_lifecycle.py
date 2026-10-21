"""Emulator + API verification for bulk/batch lifecycle and multi-batch flockId prefill."""

from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8002"
EXPO_BASE = "exp://172.25.0.1:8082/--"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text(encoding="utf-8"))
EMAIL = OWNER["ownerEmail"]
PASSWORD = OWNER["ownerPassword"]
TAG = f"BLK{time.strftime('%H%M')}"
results: list[dict] = []
artifacts: list[str] = []


def log(step: str, status: str, detail: str = "") -> None:
    safe = detail.replace(PASSWORD, "[REDACTED]").replace(EMAIL, "[owner]")
    results.append({"step": step, "status": status, "detail": safe[:400]})
    print(f"{status.upper():10} {step} — {safe[:160]}")


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def open_expo(path: str) -> None:
    uri = f"{EXPO_BASE}/{path.lstrip('/')}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{uri}'")
    time.sleep(5)


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.35)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def screenshot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))
    artifacts.append(f"mobile/scripts/{name}.png")


def texts(p: Path) -> list[str]:
    if not p.exists():
        return []
    return [(n.attrib.get("text") or "").strip() for n in ET.parse(p).getroot().iter("node") if (n.attrib.get("text") or "").strip()]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def tap_label(p: Path, label: str, exact: bool = False) -> bool:
    parent: dict = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        ok = (t.lower() == want or d.lower() == want) if exact else (want in t.lower() or want in d.lower())
        if not ok:
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
                if m:
                    adb(
                        "shell",
                        "input",
                        "tap",
                        str((int(m.group(1)) + int(m.group(3))) // 2),
                        str((int(m.group(2)) + int(m.group(4))) // 2),
                    )
                    return True
            cur = parent.get(cur)
    return False


def api(method: str, path: str, headers: dict, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={**headers, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def login(email: str, password: str) -> dict:
    code, body = api("POST", "/api/v1/auth/login", {}, {"email": email, "password": password})
    if code != 200:
        raise RuntimeError(f"login {code} {body}")
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    return {
        "Authorization": f"Bearer {token}",
        "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"],
    }


def profile_status(headers: dict, bird_id: str) -> str | None:
    code, body = api("GET", f"/api/v1/birds/{bird_id}/profile", headers)
    if code != 200:
        return None
    return body.get("lifecycle_status")


def main() -> None:
    headers = login(EMAIL, PASSWORD)
    log("api_login", "passed")

    # Ensure disposable birds on SBM shed
    flock_id = SEED["flock_id"]
    shed_id = SEED["shed_id"]
    birds = {}
    for suffix, _ in (("M1", "mortality"), ("S1", "sale"), ("S2", "sale"), ("T1", "transfer"), ("T2", "transfer"), ("C1", "cancel")):
        band = f"{TAG}-{suffix}"
        code, body = api(
            "POST",
            "/api/v1/birds",
            headers,
            {"flock_id": flock_id, "band_id": band, "dob_confidence": "unknown"},
        )
        if code in (200, 201):
            birds[suffix] = body
        else:
            log("seed_bird", "failed", f"{band} {code} {body}")
    log("seed_birds", "passed" if len(birds) >= 5 else "failed", f"count={len(birds)}")

    # Second batch for multi-batch flockId prefill
    code, flock2 = api(
        "POST",
        "/api/v1/flocks",
        headers,
        {
            "shed_id": shed_id,
            "batch_code": f"BX-{TAG}",
            "initial_count": 5,
            "tracking_mode": "mixed",
            "dob_confidence": "unknown",
            "unbanded_count": 5,
            "breed": "Layer",
        },
    )
    if code not in (200, 201):
        log("seed_second_batch", "failed", str(flock2)[:200])
        flock2_id = None
    else:
        flock2_id = flock2["id"]
        log("seed_second_batch", "passed", flock2.get("batch_code", ""))

    # --- API: single mortality confirm path (disposable) ---
    if "M1" in birds:
        key = f"emu-mort-{birds['M1']['id']}"
        code, ev = api(
            "POST",
            "/api/v1/lifecycle-events",
            headers,
            {
                "event_type": "mortality",
                "effective_date": time.strftime("%Y-%m-%d"),
                "bird_id": birds["M1"]["id"],
                "quantity": 1,
                "idempotency_key": key,
                "reason": "emu mortality",
            },
        )
        st = profile_status(headers, birds["M1"]["id"])
        log("api_mortality_submit", "passed" if code == 201 and st == "dead" else "failed", f"{code} {st}")
        code2, _ = api(
            "POST",
            "/api/v1/lifecycle-events",
            headers,
            {
                "event_type": "mortality",
                "effective_date": time.strftime("%Y-%m-%d"),
                "bird_id": birds["M1"]["id"],
                "quantity": 1,
                "idempotency_key": key,
            },
        )
        log("api_mortality_idempotent_retry", "passed" if code2 == 201 else "failed", str(code2))

    # --- API: bulk sale ---
    if "S1" in birds and "S2" in birds:
        key = f"emu-sale-{TAG}"
        code, body = api(
            "POST",
            "/api/v1/lifecycle-events/bulk",
            headers,
            {
                "event_type": "sale",
                "effective_date": time.strftime("%Y-%m-%d"),
                "bird_ids": [birds["S1"]["id"], birds["S2"]["id"]],
                "idempotency_key": key,
                "reason": "emu bulk sale",
            },
        )
        s1 = profile_status(headers, birds["S1"]["id"])
        s2 = profile_status(headers, birds["S2"]["id"])
        log(
            "api_bulk_sale",
            "passed" if code == 201 and s1 == "sold" and s2 == "sold" else "failed",
            f"{code} {s1}/{s2}",
        )
        code2, body2 = api(
            "POST",
            "/api/v1/lifecycle-events/bulk",
            headers,
            {
                "event_type": "sale",
                "effective_date": time.strftime("%Y-%m-%d"),
                "bird_ids": [birds["S1"]["id"], birds["S2"]["id"]],
                "idempotency_key": key,
            },
        )
        log(
            "api_bulk_sale_idempotent",
            "passed" if code2 == 201 and body2.get("idempotent_replay") else "failed",
            str(body2)[:120],
        )

    # --- API: bulk transfer ---
    if "T1" in birds and "T2" in birds:
        key = f"emu-xfer-{TAG}"
        code, body = api(
            "POST",
            "/api/v1/lifecycle-events/bulk",
            headers,
            {
                "event_type": "transfer",
                "effective_date": time.strftime("%Y-%m-%d"),
                "bird_ids": [birds["T1"]["id"], birds["T2"]["id"]],
                "idempotency_key": key,
            },
        )
        t1 = profile_status(headers, birds["T1"]["id"])
        t2 = profile_status(headers, birds["T2"]["id"])
        log(
            "api_bulk_transfer",
            "passed" if code == 201 and t1 == "transferred_out" and t2 == "transferred_out" else "failed",
            f"{code} {t1}/{t2}",
        )

    # --- API: cancel baseline (C1 stays active until UI confirm) ---
    if "C1" in birds:
        before = profile_status(headers, birds["C1"]["id"])
        log("api_cancel_baseline_active", "passed" if before == "active" else "failed", str(before))

    # Batch count against second flock (still has unbanded)
    count_flock = flock2_id or flock_id
    code, flock = api("GET", f"/api/v1/flocks/{count_flock}", headers)
    unbanded = flock.get("unbanded_count", 0) if code == 200 else 0
    if unbanded >= 1:
        code, _ = api(
            "POST",
            "/api/v1/lifecycle-events",
            headers,
            {
                "event_type": "mortality",
                "effective_date": time.strftime("%Y-%m-%d"),
                "flock_id": count_flock,
                "quantity": 1,
                "idempotency_key": f"emu-count-{TAG}",
                "reason": "emu unbanded count",
            },
        )
        code2, flock_after = api("GET", f"/api/v1/flocks/{count_flock}", headers)
        ok = code == 201 and code2 == 200 and flock_after.get("unbanded_count") == unbanded - 1
        log(
            "api_batch_count_mortality",
            "passed" if ok else "failed",
            f"before={unbanded} after={flock_after.get('unbanded_count')} code={code}",
        )
    else:
        log("api_batch_count_mortality", "not_tested", "no unbanded left")

    # --- UI: multi-batch Add Bird prefill (before mutating C1) ---
    if flock2_id:
        open_expo(f"(app)/birds/add?shedId={shed_id}&flockId={flock2_id}")
        time.sleep(3)
        p = dump("blk_add_prefill")
        screenshot("blk_add_prefill")
        prefilled = has(p, f"BX-{TAG}")
        log("ui_add_bird_flockId_prefill", "passed" if prefilled else "failed", str(texts(p)[:16]))
        bad_id = str(uuid.uuid4())
        open_expo(f"(app)/birds/add?shedId={shed_id}&flockId={bad_id}")
        time.sleep(4)
        p = dump("blk_add_invalid")
        screenshot("blk_add_invalid")
        log(
            "ui_add_bird_invalid_flockId",
            "passed" if has(p, "not available") or has(p, "Choose a valid") else "failed",
            str(texts(p)[:18]),
        )

    # --- UI: shed selection mode ---
    open_expo(f"(app)/sheds/{shed_id}")
    time.sleep(2)
    p = dump("blk_shed")
    for _ in range(8):
        adb("shell", "input", "swipe", "800", "700", "800", "1900", "350")
        time.sleep(0.45)
        p = dump("blk_shed_top")
        if has(p, "LIVE BIRDS") or has(p, "Edit shed"):
            break
    for _ in range(12):
        if has(p, "Select") or has(p, "Batch count actions"):
            break
        adb("shell", "input", "swipe", "800", "1700", "800", "700", "350")
        time.sleep(0.55)
        p = dump("blk_shed_birds")
    screenshot("blk_birds_select_ready")
    if tap_label(p, "Select", exact=True) or tap_label(p, "Select"):
        time.sleep(1.5)
        p = dump("blk_select_mode")
        screenshot("blk_select_mode")
        log(
            "ui_select_mode",
            "passed" if has(p, "selected") or has(p, "Select all") or has(p, "Exit selection") else "failed",
            str(texts(p)[:14]),
        )
        if tap_label(p, "Exit selection") or tap_label(p, "Cancel selection"):
            time.sleep(1)
            st = profile_status(headers, birds["C1"]["id"]) if "C1" in birds else "active"
            log("ui_cancel_selection_no_mutation", "passed" if st == "active" else "failed", str(st))
        else:
            log("ui_cancel_selection_no_mutation", "failed", "exit tap missed")
    else:
        log("ui_select_mode", "failed", str(texts(p)[:16]))
        log("ui_cancel_selection_no_mutation", "not_tested")

    # Profile cancel then confirm mortality on disposable C1 (still active)
    if "C1" in birds and profile_status(headers, birds["C1"]["id"]) == "active":
        open_expo(f"(app)/birds/{birds['C1']['id']}?fromShedId={shed_id}")
        time.sleep(2)
        for _ in range(10):
            p = dump("blk_prof")
            if has(p, "Record mortality"):
                break
            adb("shell", "input", "swipe", "800", "1700", "800", "600", "350")
            time.sleep(0.5)
        if tap_label(p, "Record mortality"):
            time.sleep(1.2)
            p = dump("blk_mort_alert")
            screenshot("blk_mortality_cancel")
            copy_ok = has(p, "Cancel") or has(p, "CANCEL")
            tap_label(p, "Cancel") or tap_label(p, "CANCEL") or adb("shell", "input", "keyevent", "4")
            time.sleep(1)
            st = profile_status(headers, birds["C1"]["id"])
            log(
                "ui_mortality_cancel",
                "passed" if copy_ok and st == "active" else "failed",
                f"copy={copy_ok} status={st}",
            )
        else:
            log("ui_mortality_cancel", "failed", "button missing")

        open_expo(f"(app)/birds/{birds['C1']['id']}?fromShedId={shed_id}")
        time.sleep(2)
        for _ in range(10):
            p = dump("blk_prof2")
            if has(p, "Record mortality"):
                break
            adb("shell", "input", "swipe", "800", "1700", "800", "600", "350")
            time.sleep(0.5)
        if tap_label(p, "Record mortality"):
            time.sleep(1.2)
            p = dump("blk_mort_confirm")
            if not (tap_label(p, "RECORD MORTALITY") or tap_label(p, "Record mortality")):
                adb("shell", "input", "keyevent", "22")
                adb("shell", "input", "keyevent", "66")
            time.sleep(4)
            st = profile_status(headers, birds["C1"]["id"])
            screenshot("blk_mortality_done")
            log("ui_mortality_confirm_submit", "passed" if st == "dead" else "failed", str(st))
            if st == "dead":
                code, prof = api("GET", f"/api/v1/birds/{birds['C1']['id']}/profile", headers)
                hist = code == 200 and any(
                    e.get("event_type") == "mortality" for e in prof.get("lifecycle_events", [])
                )
                log("ui_mortality_history_preserved", "passed" if hist else "failed")
        else:
            log("ui_mortality_confirm_submit", "failed", "no button")
            log("ui_mortality_history_preserved", "not_tested")
    else:
        log("ui_mortality_cancel", "not_tested", "C1 unavailable")
        log("ui_mortality_confirm_submit", "not_tested")
        log("ui_mortality_history_preserved", "not_tested")

    # Batch count UI (static lifecycle route — not birds/[id])
    open_expo(f"(app)/lifecycle-batch?shedId={shed_id}&flockId={count_flock}&eventType=mortality")
    time.sleep(2)
    p = dump("blk_batch_ui")
    screenshot("blk_batch_lifecycle")
    log(
        "ui_batch_lifecycle_screen",
        "passed" if has(p, "Batch count") or has(p, "unbanded") or has(p, "Quantity") else "failed",
        str(texts(p)[:14]),
    )
    if tap_label(p, "Cancel"):
        log("ui_batch_lifecycle_cancel", "passed")
    else:
        log("ui_batch_lifecycle_cancel", "not_tested", "cancel tap missed")

    # Farmer permissions AFTER UI disposable bird work
    farmer_email = SEED.get("farmer_email")
    if farmer_email:
        try:
            fh = login(farmer_email, "password123")
            other = OWNER.get("shedId")
            # Farmer may lifecycle assigned shed birds that remain active
            code_o, _ = api("GET", f"/api/v1/birds/in-shed?shed_id={other}&limit=1", fh)
            log("farmer_api_other_shed_403", "passed" if code_o in (403, 404) else "failed", str(code_o))
            code_a, assigned = api(
                "GET",
                f"/api/v1/birds/in-shed?shed_id={shed_id}&limit=5",
                fh,
            )
            log(
                "farmer_api_assigned_shed_list",
                "passed" if code_a == 200 else "failed",
                f"code={code_a} total={assigned.get('total') if isinstance(assigned, dict) else assigned}",
            )
        except Exception as e:
            log("farmer_api", "failed", str(e))

    out = {
        "date": time.strftime("%Y-%m-%d"),
        "tag": TAG,
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "artifacts": artifacts,
        "birds": {k: v.get("id") for k, v in birds.items()},
        "flock2_id": flock2_id,
    }
    (S / "shed_birds_bulk_verification.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("BULK_SUMMARY", json.dumps({k: out[k] for k in ("passed", "failed", "not_tested", "artifacts")}))


if __name__ == "__main__":
    main()
