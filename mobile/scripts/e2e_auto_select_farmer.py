"""Emulator: New Shed → Add Farmer → verify auto-select (no manual picker tap)."""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8001"
S = Path(__file__).resolve().parent
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
STAMP = time.strftime("%H%M%S")
SHED_NAME = f"AutoBarn{STAMP}"
SHED_CODE = f"AB{STAMP[-4:]}"
NOTES = f"Notes{STAMP}"
FARMER_NAME = f"AutoFarmer{STAMP}"
FARMER_EMAIL = f"auto.farmer.{STAMP}@example.com"
FARMER_PASS = "password123"


def adb(*a, check=True):
    p = subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError((p.stdout or "") + (p.stderr or ""))
    return (p.stdout or "") + (p.stderr or "")


def dump(n: str) -> Path:
    remote = f"/sdcard/{n}.xml"
    local = S / f"{n}.xml"
    for _ in range(4):
        adb("shell", "uiautomator", "dump", remote, check=False)
        time.sleep(0.35)
        adb("pull", remote, str(local), check=False)
        if local.exists() and local.stat().st_size > 80:
            return local
        time.sleep(0.7)
    raise RuntimeError(f"dump failed: {n}")


def texts(path: Path):
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def has(path: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(path))


def edit_centers(path: Path):
    root = ET.parse(path).getroot()
    out = []
    for n in root.iter("node"):
        if n.attrib.get("class", "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            out.append(
                ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            )
    return out


def tap(x, y):
    adb("shell", "input", "tap", str(x), str(y))


def tap_label(path: Path, label: str):
    root = ET.parse(path).getroot()
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    target = None
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t == label or label in t:
            target = n
            break
    if target is None:
        raise RuntimeError(f"missing label: {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            return
        cur = parent.get(cur)
    raise RuntimeError(f"not clickable: {label}")


def clear_field():
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(40):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill(x, y, value: str):
    tap(x, y)
    time.sleep(0.2)
    clear_field()
    adb("shell", "input", "text", value.replace("@", "\\@").replace(" ", "%s"))
    time.sleep(0.2)
    tap(800, 100)
    time.sleep(0.2)


def toggle_owner_off(path: Path):
    root = ET.parse(path).getroot()
    switches = [
        n
        for n in root.iter("node")
        if "Switch" in (n.attrib.get("class") or "") or n.attrib.get("checkable") == "true"
    ]
    if not switches:
        raise RuntimeError("no switch")
    b = switches[-1].attrib["bounds"]
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
    # If checked (owner-managed ON), tap to turn OFF
    checked = switches[-1].attrib.get("checked") == "true"
    if checked:
        tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
        time.sleep(1.2)


def create_enabled(path: Path) -> bool | None:
    root = ET.parse(path).getroot()
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() != "Create shed":
            continue
        # Prefer clickable button node
        en = n.attrib.get("enabled")
        if en is not None and n.attrib.get("clickable") == "true":
            return en == "true"
        # Walk up for clickable parent
        # (uiautomator often nests Text under clickable View)
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() != "Create shed":
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                return cur.attrib.get("enabled", "true") == "true"
            cur = parent.get(cur)
    return None


def api(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def log(results, step, ok, detail=""):
    results.append({"step": step, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), "-", step, "-", detail[:220])


def ensure_owner_session():
    # Deep-link create; if redirected to login, fail clearly
    adb(
        "shell",
        "am start -a android.intent.action.VIEW -d \"exp://127.0.0.1:8082/--/(app)/sheds/create\"",
    )
    time.sleep(4)
    p = dump("as0")
    if has(p, "Welcome") or has(p, "Sign in") or has(p, "Log in"):
        raise RuntimeError("Not logged in as owner — open Pilot Owner session first")
    return p


def main():
    results = []
    print("STAMP", STAMP, SHED_NAME, SHED_CODE, FARMER_EMAIL)

    p = ensure_owner_session()
    log(results, "open new shed", has(p, "New shed") or has(p, "Shed name"), str(texts(p)[:12]))

    eds = edit_centers(p)
    log(results, "form fields present", len(eds) >= 3, f"eds={len(eds)}")
    fill(eds[0][0], eds[0][1], SHED_NAME)
    fill(eds[1][0], eds[1][1], SHED_CODE)
    fill(eds[2][0], eds[2][1], NOTES)

    p = dump("as1")
    toggle_owner_off(p)
    p = dump("as2")
    log(
        results,
        "owner-managed off",
        has(p, "Assigned farmer")
        and (has(p, "Select a farmer") or has(p, "Select the farmer") or has(p, "+ Add Farmer")),
        str(texts(p)[:16]),
    )
    en = create_enabled(p)
    log(results, "create disabled without farmer", en is False, f"enabled={en}")

    tap_label(p, "+ Add Farmer")
    time.sleep(1.5)
    p = dump("as3")
    log(results, "add farmer modal", has(p, "Create farmer") or has(p, "Add farmer"), str(texts(p)[:14]))
    eds = edit_centers(p)
    fill(eds[0][0], eds[0][1], FARMER_NAME)
    fill(eds[1][0], eds[1][1], FARMER_EMAIL)
    fill(eds[2][0], eds[2][1], FARMER_PASS)
    tap_label(p, "Create farmer")
    time.sleep(5)

    p = dump("as4")
    back = has(p, "Create shed") and not has(p, "Create farmer")
    log(results, "back on new shed form", back, str(texts(p)[:20]))
    log(results, "shed values preserved", has(p, SHED_NAME) and has(p, SHED_CODE), "")

    # CORE ASSERTION: farmer name shown as selected — not placeholder
    selected = has(p, FARMER_NAME)
    still_placeholder = has(p, "Select a farmer")
    log(
        results,
        "auto-selected without manual picker",
        selected and not still_placeholder,
        f"selected={selected} placeholder={still_placeholder} texts={[t for t in texts(p) if 'Auto' in t or 'Select' in t or 'farmer' in t.lower()][:12]}",
    )
    en2 = create_enabled(p)
    log(results, "create enabled after auto-select", en2 is True, f"enabled={en2}")

    # Submit without opening the farmer selector
    if en2 is True or selected:
        tap_label(p, "Create shed")
        time.sleep(6)
        p = dump("as5")
        log(
            results,
            "overview after create",
            has(p, "Shed overview") and has(p, SHED_NAME) and has(p, FARMER_NAME),
            str(texts(p)[:16]),
        )

    st, login = api(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    oh = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }
    _, sheds = api("GET", "/api/v1/sheds", headers=oh)
    shed = next((s for s in sheds if s.get("code") == SHED_CODE), None)
    log(results, "API shed exists", shed is not None and shed.get("is_owner_managed") is False, str(shed)[:180] if shed else "")
    if shed:
        _, assigns = api("GET", f"/api/v1/sheds/{shed['id']}/assignments", headers=oh)
        ok_asg = (
            isinstance(assigns, list)
            and len(assigns) == 1
            and assigns[0].get("farmer_email") == FARMER_EMAIL
            and assigns[0].get("is_manager") is True
        )
        log(results, "API assignment membership", ok_asg, str(assigns)[:220])
        # membership id used by create must match assignment's owner_membership_id
        mem = assigns[0].get("owner_membership_id") if ok_asg else None
        _, farmers = api("GET", "/api/v1/farmers", headers=oh)
        match = next((f for f in (farmers or []) if f.get("email") == FARMER_EMAIL), None)
        log(
            results,
            "membership_id matches farmer record",
            match is not None and match.get("membership_id") == mem,
            f"assignment_mem={mem} farmer_mem={match.get('membership_id') if match else None}",
        )

    out = {
        "stamp": STAMP,
        "pass": sum(1 for r in results if r["ok"]),
        "fail": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    (S / "e2e_auto_select_farmer.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("SUMMARY", out["pass"], "pass /", out["fail"], "fail")
    if out["fail"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
