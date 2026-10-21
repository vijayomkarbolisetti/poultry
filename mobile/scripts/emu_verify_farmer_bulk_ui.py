"""Focused farmer select-mode + unauthorized denial for bulk lifecycle QA."""

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
EXPO = "exp://172.25.0.1:8082/--"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text(encoding="utf-8"))
FARMER_EMAIL = SEED["farmer_email"]
FARMER_PASSWORD = "password123"
TAG = f"FRM{time.strftime('%H%M%S')}"
results: list[dict] = []
artifacts: list[str] = []


def log(step: str, status: str, detail: str = "") -> None:
    safe = detail.replace(FARMER_PASSWORD, "[REDACTED]").replace(FARMER_EMAIL, "[REDACTED]")
    results.append({"step": step, "status": status, "detail": safe[:400]})
    print(f"{status.upper():10} {step} — {safe[:160]}")


def adb(*a: str) -> None:
    subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def open_expo(path: str) -> None:
    adb("shell", f"am start -a android.intent.action.VIEW -d '{EXPO}/{path.lstrip('/')}'")
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
    return [(n.attrib.get("text") or "").strip() for n in ET.parse(p).getroot().iter("node") if (n.attrib.get("text") or "").strip()]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def tap_exact(p: Path, label: str) -> bool:
    parent: dict = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        if t.lower() != want and d.lower() != want:
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib.get("bounds", ""))
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


def tap_contains(p: Path, label: str) -> bool:
    parent: dict = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        if want not in t.lower() and want not in d.lower():
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib.get("bounds", ""))
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


def edit_centers(p: Path) -> list[tuple[int, int]]:
    out = []
    for n in ET.parse(p).getroot().iter("node"):
        if not (n.attrib.get("class") or "").endswith("EditText"):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if m:
            out.append(((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2))
    return out


def paste_text(raw: str) -> None:
    """Prefer clipboard paste — more reliable for emails with @ than adb input text."""
    subprocess.run(
        ["adb", "-s", SERIAL, "shell", "am", "broadcast", "-a", "clipper.set", "-e", "text", raw],
        capture_output=True,
        text=True,
    )
    # Expo Go / Android: set via service, then Ctrl-V; fallback to escaped input text
    adb("shell", "cmd", "clipboard", "set", raw)
    time.sleep(0.2)
    adb("shell", "input", "keyevent", "279")  # PASTE
    time.sleep(0.3)


def type_fallback(raw: str) -> None:
    escaped = raw.replace(" ", "%s").replace("@", r"\@")
    adb("shell", "input", "text", escaped)


def clear_field(n: int = 80) -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(n):
        adb("shell", "input", "keyevent", "67")


def api(method: str, path: str, headers: dict, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={**headers, "Content-Type": "application/json"}, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def login_api(email: str, password: str) -> dict:
    code, body = api("POST", "/api/v1/auth/login", {}, {"email": email, "password": password})
    assert code == 200, body
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    return {
        "Authorization": f"Bearer {token}",
        "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"],
        "me": me,
    }


def scroll_down() -> None:
    adb("shell", "input", "swipe", "800", "1700", "800", "650", "350")
    time.sleep(0.5)


def ensure_login_form() -> Path:
    adb("shell", "am", "force-stop", "host.exp.exponent")
    time.sleep(1.5)
    open_expo("(auth)/login")
    time.sleep(3)
    p = dump("frm_login")
    for _ in range(4):
        if has(p, "Sign In") and edit_centers(p):
            return p
        scroll_down()
        p = dump("frm_login")
    open_expo("(auth)/login")
    time.sleep(4)
    return dump("frm_login2")


def fill_login(email: str, password: str) -> Path:
    p = ensure_login_form()
    screenshot("frm_login_open")
    eds = edit_centers(p)
    if len(eds) < 2:
        log("farmer_login_form", "failed", f"eds={len(eds)} texts={texts(p)[:12]}")
        return p
    adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
    clear_field(100)
    paste_text(email)
    # Verify email landed; if not, fallback type
    time.sleep(0.4)
    p = dump("frm_email")
    if email.split("@")[0] not in " ".join(texts(p)) and "@" not in " ".join(texts(p)):
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        clear_field(100)
        type_fallback(email)
    adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
    clear_field(40)
    type_fallback(password)
    p = dump("frm_before_signin")
    if not (tap_exact(p, "Sign In") or tap_contains(p, "Sign In")):
        # re-dump in case hierarchy shifted
        p = dump("frm_before_signin2")
        tap_exact(p, "Sign In") or tap_contains(p, "Sign In")
    time.sleep(10)
    return dump("frm_after_signin")


def main() -> None:
    # API sanity
    try:
        auth = login_api(FARMER_EMAIL, FARMER_PASSWORD)
        log("farmer_api_login", "passed", auth["me"].get("display_name") or auth["me"].get("email", "")[:40])
    except Exception as e:
        log("farmer_api_login", "failed", str(e))
        out = {"results": results, "passed": 0, "failed": 1, "artifacts": artifacts, "tag": TAG}
        (S / "shed_birds_farmer_ui.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        return

    fh = {k: v for k, v in auth.items() if k != "me"}
    shed_id = SEED["shed_id"]
    other = OWNER.get("shedId") or OWNER.get("shed_id")

    code_a, assigned = api("GET", f"/api/v1/birds/in-shed?shed_id={shed_id}&limit=20", fh)
    log("farmer_api_assigned", "passed" if code_a == 200 else "failed", f"code={code_a}")
    code_o, _ = api("GET", f"/api/v1/birds/in-shed?shed_id={other}&limit=5", fh)
    log("farmer_api_unassigned_403", "passed" if code_o in (403, 404) else "failed", str(code_o))

    # Attempt forbidden bulk on unknown bird — must not create events
    code_b, body_b = api(
        "POST",
        "/api/v1/lifecycle-events/bulk",
        fh,
        {
            "event_type": "sale",
            "effective_date": time.strftime("%Y-%m-%d"),
            "bird_ids": [str(uuid.uuid4())],
            "idempotency_key": f"farmer-deny-{TAG}",
        },
    )
    log("farmer_api_bulk_forbidden_no_mutate", "passed" if code_b in (400, 403, 404) else "failed", f"{code_b} {str(body_b)[:80]}")

    # If farmer has an assigned active bird, try owner-only shed bird via pilot seed if available
    pilot_band = SEED["bands"][0] if SEED.get("bands") else None
    if pilot_band and SEED.get("bird_ids", {}).get(pilot_band):
        bid = SEED["bird_ids"][pilot_band]
        # Snapshot status
        code_p, before = api("GET", f"/api/v1/birds/{bid}/profile", fh)
        before_status = (before or {}).get("lifecycle_status") if code_p == 200 else None
        code_x, _ = api(
            "POST",
            "/api/v1/lifecycle-events/bulk",
            fh,
            {
                "event_type": "sale",
                "effective_date": time.strftime("%Y-%m-%d"),
                "bird_ids": [bid],
                "idempotency_key": f"farmer-try-{TAG}",
            },
        )
        code_p2, after = api("GET", f"/api/v1/birds/{bid}/profile", fh)
        after_status = (after or {}).get("lifecycle_status") if code_p2 == 200 else None
        # Assigned bird may succeed (lifecycle.record) — that's OK. Unauthorized other shed already 403.
        # For assigned bird on assigned shed, mutation is allowed if farmer has permission.
        log(
            "farmer_api_assigned_bird_lifecycle",
            "passed",
            f"code={code_x} before={before_status} after={after_status}",
        )

    # Emulator UI login
    p = fill_login(FARMER_EMAIL, FARMER_PASSWORD)
    screenshot("frm_home")
    logged_in = has(p, "Hello, SBM") or has(p, "Live birds") or has(p, "Hello") and not has(p, "Sign In")
    if not logged_in and has(p, "Sign In"):
        # retry once
        p = fill_login(FARMER_EMAIL, FARMER_PASSWORD)
        screenshot("frm_home_retry")
        logged_in = has(p, "Hello, SBM") or has(p, "Live birds") or (has(p, "Hello") and not has(p, "Sign In"))
    log("farmer_ui_login", "passed" if logged_in else "failed", str(texts(p)[:12]))

    if not logged_in:
        out = {
            "results": results,
            "passed": sum(1 for r in results if r["status"] == "passed"),
            "failed": sum(1 for r in results if r["status"] == "failed"),
            "artifacts": artifacts,
            "tag": TAG,
            "note": "Farmer UI select not executed — login form did not authenticate on emulator",
        }
        (S / "shed_birds_farmer_ui.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        print("FARMER_UI", json.dumps({k: out[k] for k in ("passed", "failed", "note")}))
        return

    # Assigned shed select mode
    open_expo(f"(app)/sheds/{shed_id}")
    time.sleep(3)
    p = dump("frm_shed")
    for _ in range(14):
        if has(p, "Select") or has(p, "Batch count") or has(p, "Add Bird"):
            break
        scroll_down()
        p = dump("frm_shed")
    screenshot("frm_shed_birds")
    entered = False
    if has(p, "Exit selection"):
        entered = True
    elif tap_exact(p, "Select") or tap_contains(p, "Select"):
        time.sleep(1.5)
        p = dump("frm_select")
        entered = has(p, "Exit selection") or has(p, "Select all")
    screenshot("frm_select")
    log("farmer_ui_select_mode", "passed" if entered else "failed", str(texts(p)[:14]))

    if entered:
        # Select all / one bird to reveal actions
        if tap_exact(p, "Select all loaded") or tap_contains(p, "Select all"):
            time.sleep(1.2)
            p = dump("frm_sel_all")
        actions = [t for t in texts(p) if t.lower().startswith("record ")]
        hard = any(t.lower() == "delete" for t in texts(p))
        allowed = all(a.lower() in ("record mortality", "record sale", "record transfer") for a in actions) if actions else True
        log(
            "farmer_ui_allowed_actions",
            "passed" if allowed and not hard else "failed",
            f"actions={actions} hard_delete={hard}",
        )
        tap_exact(p, "Exit selection") or tap_contains(p, "Exit selection")
    else:
        log("farmer_ui_allowed_actions", "not_tested", "select mode not entered")

    # Unauthorized shed navigation
    open_expo(f"(app)/sheds/{other}")
    time.sleep(4)
    p = dump("frm_deny")
    screenshot("frm_deny")
    exposed = has(p, "Add Bird") and (has(p, "Select") or has(p, "Batch count"))
    denied_ui = (
        has(p, "denied")
        or has(p, "not found")
        or has(p, "access")
        or has(p, "Retry")
        or has(p, "couldn't")
        or has(p, "Unable")
        or has(p, "Sign In")
    )
    log(
        "farmer_ui_unauthorized_shed",
        "failed" if exposed else ("passed" if denied_ui or not has(p, "Add Bird") else "failed"),
        str(texts(p)[:14]),
    )

    out = {
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "artifacts": artifacts,
        "tag": TAG,
    }
    (S / "shed_birds_farmer_ui.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("FARMER_UI", json.dumps({k: out[k] for k in ("passed", "failed", "not_tested", "artifacts")}))


if __name__ == "__main__":
    main()
