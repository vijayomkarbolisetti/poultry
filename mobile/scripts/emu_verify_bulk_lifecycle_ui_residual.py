"""Residual UI checks after Metro reload: select mode, flockId prefill, batch screen."""

from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8002"
EXPO = "exp://172.25.0.1:8082/--"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text(encoding="utf-8"))
results: list[dict] = []
artifacts: list[str] = []


def log(step: str, status: str, detail: str = "") -> None:
    results.append({"step": step, "status": status, "detail": detail[:350]})
    print(f"{status.upper():10} {step} — {detail[:150]}")


def adb(*a: str) -> None:
    subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def open_expo(path: str) -> None:
    adb("shell", f"am start -a android.intent.action.VIEW -d '{EXPO}/{path.lstrip('/')}'")
    time.sleep(5)


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.4)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def screenshot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))
    artifacts.append(f"mobile/scripts/{name}.png")


def texts(p: Path) -> list[str]:
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


def api(method: str, path: str, headers: dict, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={**headers, "Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode() or "{}")


def login():
    code, body = api("POST", "/api/v1/auth/login", {}, {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]})
    assert code == 200
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    return {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"]}


def main() -> None:
    h = login()
    shed_id = SEED["shed_id"]
    # Ensure two active batches
    code, flocks = api("GET", f"/api/v1/flocks?shed_id={shed_id}", h)
    active = [f for f in (flocks if isinstance(flocks, list) else []) if f.get("status") == "active"]
    if len(active) < 2:
        api(
            "POST",
            "/api/v1/flocks",
            h,
            {
                "shed_id": shed_id,
                "batch_code": f"BX-RES{int(time.time())%10000}",
                "initial_count": 3,
                "tracking_mode": "mixed",
                "dob_confidence": "unknown",
                "unbanded_count": 3,
            },
        )
        _, flocks = api("GET", f"/api/v1/flocks?shed_id={shed_id}", h)
        active = [f for f in flocks if f.get("status") == "active"]
    # Prefer a non-primary batch so prefill is distinguishable from sole-batch auto-select.
    target = next((f for f in active if f["batch_code"] != "BX-SBM1210"), active[-1])
    log("multi_batch_ready", "passed", f"n={len(active)} target={target['batch_code']}")

    # Prefill
    open_expo(f"(app)/birds/add?shedId={shed_id}&flockId={target['id']}")
    time.sleep(4)
    p = dump("res_add_prefill")
    screenshot("res_add_prefill")
    log(
        "ui_add_bird_flockId_prefill",
        "passed" if has(p, target["batch_code"]) else "failed",
        str(texts(p)[:20]),
    )

    bad = str(uuid.uuid4())
    open_expo(f"(app)/birds/add?shedId={shed_id}&flockId={bad}")
    time.sleep(5)
    p = dump("res_add_invalid")
    screenshot("res_add_invalid")
    log(
        "ui_add_bird_invalid_flockId",
        "passed" if has(p, "not available") or has(p, "Choose a valid") else "failed",
        str(texts(p)[:22]),
    )

    # Batch lifecycle route
    open_expo(f"(app)/lifecycle-batch?shedId={shed_id}&flockId={target['id']}&eventType=mortality")
    time.sleep(3)
    p = dump("res_batch")
    screenshot("res_batch")
    log(
        "ui_batch_lifecycle_screen",
        "passed" if (has(p, "Batch count") or has(p, "Quantity")) and not has(p, "Unmatched Route") else "failed",
        str(texts(p)[:16]),
    )
    if has(p, "Cancel") and tap_label(p, "Cancel"):
        log("ui_batch_lifecycle_cancel", "passed")
    else:
        log("ui_batch_lifecycle_cancel", "not_tested")

    # Bulk confirm screen route
    open_expo(
        f"(app)/lifecycle-bulk?shedId={shed_id}&eventType=sale&birdIds={uuid.uuid4()}&labels=TESTBand"
    )
    time.sleep(3)
    p = dump("res_bulk")
    screenshot("res_bulk")
    log(
        "ui_bulk_lifecycle_screen",
        "passed"
        if (has(p, "Record sale") or has(p, "No birds selected") or has(p, "Affects")) and not has(p, "Unmatched Route")
        else "failed",
        str(texts(p)[:14]),
    )

    # Select mode on shed
    open_expo(f"(app)/sheds/{shed_id}")
    time.sleep(3)
    p = dump("res_shed")
    for _ in range(10):
        adb("shell", "input", "swipe", "800", "700", "800", "1900", "300")
        time.sleep(0.4)
    for _ in range(14):
        p = dump("res_shed_s")
        if has(p, "Select") or has(p, "Batch count actions"):
            break
        adb("shell", "input", "swipe", "800", "1700", "800", "650", "300")
        time.sleep(0.5)
    screenshot("res_select_ready")
    if tap_label(p, "Select", exact=True) or tap_label(p, "Select"):
        time.sleep(1.5)
        p = dump("res_select_on")
        screenshot("res_select_on")
        ok = has(p, "Exit selection") or has(p, "Select all") or has(p, "selected")
        log("ui_select_mode", "passed" if ok else "failed", str(texts(p)[:14]))
        if tap_label(p, "Exit selection") or tap_label(p, "Cancel selection"):
            log("ui_cancel_selection", "passed")
        else:
            log("ui_cancel_selection", "failed")
    else:
        log("ui_select_mode", "failed", str(texts(p)[:16]))
        log("ui_cancel_selection", "not_tested")

    out = {
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "artifacts": artifacts,
    }
    (S / "shed_birds_bulk_ui_residual.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("RESIDUAL_UI", json.dumps(out))


if __name__ == "__main__":
    main()
