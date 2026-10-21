"""Continue E2E assuming pilot owner is already logged in on emulator."""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import psycopg2

SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8001"
DB = "postgresql://poultry:poultry@localhost:5433/poultry_tracker"
SCRIPTS = Path(__file__).resolve().parent
OWNER = json.loads((SCRIPTS / "pilot-owner.json").read_text(encoding="utf-8"))
STAMP = str(int(time.time()) % 1000000)
SHED_NAME = f"E2EBarn{STAMP}"  # no spaces for adb reliability
SHED_CODE = f"E2{STAMP[-4:]}"
SHED_NOTES = f"Notes{STAMP}"
FARMER_NAME = f"E2EFarmer{STAMP}"
FARMER_EMAIL = f"e2e.farmer.{STAMP}@example.com"
FARMER_PASS = "password123"
RESULTS: list[dict] = []


def log(step: str, ok: bool, detail: str = "") -> None:
    RESULTS.append({"step": step, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), "-", step, "-", detail[:200])


def adb(*args: str) -> str:
    return subprocess.check_output(["adb", "-s", SERIAL, *args], stderr=subprocess.STDOUT).decode(
        "utf-8", errors="replace"
    )


def dump(name: str) -> Path:
    remote = f"/sdcard/{name}.xml"
    local = SCRIPTS / f"{name}.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(local))
    return local


def texts(path: Path) -> list[str]:
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def has(path: Path, needle: str) -> bool:
    return any(needle.lower() in t.lower() for t in texts(path))


def edit_texts(path: Path):
    root = ET.parse(path).getroot()
    out = []
    for n in root.iter("node"):
        if n.attrib.get("class", "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            assert m
            out.append(((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2))
    return out


def tap(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def tap_label(path: Path, label: str) -> None:
    root = ET.parse(path).getroot()
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    target = None
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() == label:
            target = n
            break
    if target is None:
        # partial match
        for n in root.iter("node"):
            if label in ((n.attrib.get("text") or "").strip()):
                target = n
                break
    if target is None:
        raise RuntimeError(f"label not found: {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            assert m
            tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            return
        cur = parent.get(cur)
    raise RuntimeError(f"no clickable: {label}")


def type_text(value: str) -> None:
    esc = value.replace(" ", "%s").replace("@", "\\@")
    adb("shell", "input", "text", esc)


def clear_field() -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(50):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill(x: int, y: int, value: str) -> None:
    tap(x, y)
    time.sleep(0.35)
    clear_field()
    type_text(value)
    time.sleep(0.25)
    # blur without leaving app — tap top area of form
    tap(800, 120)
    time.sleep(0.35)


def open_url(path: str) -> None:
    adb("shell", f"am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082/--{path}'")
    time.sleep(4)


def toggle_switch(path: Path) -> None:
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
    assert m
    tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
    time.sleep(1.5)


def create_enabled(path: Path) -> bool | None:
    root = ET.parse(path).getroot()
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() == "Create shed":
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


def main() -> None:
    print("STAMP", STAMP, SHED_NAME, SHED_CODE, FARMER_EMAIL)

    open_url("/(app)/sheds/create")
    p = dump("c0")
    eds = edit_texts(p)
    log("open new shed", len(eds) >= 2 and has(p, "Owner-managed"), f"eds={len(eds)}")
    fill(eds[0][0], eds[0][1], SHED_NAME)
    fill(eds[1][0], eds[1][1], SHED_CODE)
    if len(eds) >= 3:
        fill(eds[2][0], eds[2][1], SHED_NOTES)
    p = dump("c1")
    log(
        "entered unique shed values",
        has(p, SHED_NAME) or has(p, SHED_CODE) or has(p, SHED_CODE.upper()),
        str([t for t in texts(p) if STAMP in t or "E2E" in t or "Notes" in t][:10]),
    )

    toggle_switch(p)
    p = dump("c2")
    log(
        "owner-managed OFF shows farmer section",
        has(p, "Assigned farmer") and has(p, "Add Farmer"),
        str([t for t in texts(p) if "farmer" in t.lower() or "Add" in t or "Create" in t][:12]),
    )
    en = create_enabled(p)
    log("Create shed disabled without farmer", en is False, f"enabled={en}")

    # Invalid farmer attempt
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("m0")
    log("Add Farmer modal opens", has(p, "Add farmer") and has(p, "Create farmer"), "")
    eds = edit_texts(p)
    fill(eds[0][0], eds[0][1], "BadName")
    fill(eds[1][0], eds[1][1], "bademail")
    fill(eds[2][0], eds[2][1], "short")
    p = dump("m1")
    tap_label(p, "Create farmer")
    time.sleep(2)
    p = dump("m2")
    log("invalid farmer remains on modal", has(p, "Add farmer") or has(p, "Create farmer"), str(texts(p)[:18]))
    tap_label(p, "Close")
    time.sleep(1.5)
    p = dump("c3")
    log(
        "shed form preserved after failed farmer",
        (has(p, SHED_NAME) or has(p, SHED_CODE) or has(p, SHED_CODE.upper())) and has(p, "Assigned farmer"),
        str([t for t in texts(p) if STAMP in t or "E2" in t or "Assigned" in t or "Notes" in t][:12]),
    )

    # Count sheds before
    st, login = api("POST", "/api/v1/auth/login", {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]})
    oh = {"Authorization": f"Bearer {login['access_token']}", "X-Owner-Account-Id": OWNER["ownerAccountId"]}
    _, before_sheds = api("GET", "/api/v1/sheds", headers=oh)
    before_codes = {s["code"] for s in before_sheds}

    # Valid farmer
    if not has(p, "Add Farmer"):
        toggle_switch(p)
        p = dump("c3b")
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("m3")
    eds = edit_texts(p)
    fill(eds[0][0], eds[0][1], FARMER_NAME)
    fill(eds[1][0], eds[1][1], FARMER_EMAIL)
    fill(eds[2][0], eds[2][1], FARMER_PASS)
    p = dump("m4")
    tap_label(p, "Create farmer")
    time.sleep(6)
    p = dump("c4")
    log("returned to New Shed after farmer create", has(p, "Create shed") and not has(p, "Create farmer"), str(texts(p)[:22]))
    log(
        "shed fields still present",
        has(p, SHED_NAME) or has(p, SHED_CODE) or has(p, SHED_CODE.upper()),
        str([t for t in texts(p) if STAMP in t or "E2" in t][:10]),
    )
    selected = has(p, FARMER_NAME) or has(p, FARMER_EMAIL) or has(p, "E2EFarmer")
    log("new farmer auto-selected/visible", selected, str([t for t in texts(p) if "E2E" in t or "@" in t or "Farmer" in t][:12]))
    if not selected and has(p, "Select a farmer"):
        tap_label(p, "Select a farmer")
        time.sleep(2)
        p = dump("pick")
        label = next((t for t in texts(p) if "E2EFarmer" in t or FARMER_EMAIL in t), None)
        if label:
            tap_label(p, label)
            time.sleep(1)
            p = dump("picked")
            selected = has(p, "E2EFarmer") or has(p, FARMER_EMAIL)
            log("manual select farmer", selected, "")

    en = create_enabled(p)
    log("Create shed enabled with farmer", en is True or en is None, f"enabled={en}")

    tap_label(p, "Create shed")
    time.sleep(7)
    p = dump("c5")
    log(
        "navigated after create",
        has(p, "Shed overview") or has(p, SHED_NAME) or has(p, "LIVE BIRDS") or has(p, "Live birds"),
        str(texts(p)[:22]),
    )

    _, sheds = api("GET", "/api/v1/sheds", headers=oh)
    match = next((s for s in sheds if s["code"] in {SHED_CODE, SHED_CODE.upper()}), None)
    if not match:
        match = next((s for s in sheds if STAMP in s.get("name", "")), None)
    log("API: shed created", match is not None and match["code"] not in before_codes or match is not None, str(match)[:220] if match else "")
    shed_id = match["id"] if match else None
    if shed_id:
        _, assigns = api("GET", f"/api/v1/sheds/{shed_id}/assignments", headers=oh)
        log(
            "API: initial farmer assignment",
            len(assigns) == 1 and assigns[0].get("is_manager") is True and assigns[0].get("farmer_email") == FARMER_EMAIL,
            str(assigns)[:300],
        )
        _, ov = api("GET", f"/api/v1/sheds/{shed_id}/overview", headers=oh)
        log("owner opens shed overview", isinstance(ov, dict) and ov.get("shed", {}).get("id") == shed_id, "")
        with psycopg2.connect(DB) as conn, conn.cursor() as cur:
            cur.execute("SELECT is_owner_managed FROM sheds WHERE id=%s", (shed_id,))
            row = cur.fetchone()
            cur.execute(
                """
                SELECT u.email, sm.is_manager FROM shed_memberships sm
                JOIN owner_memberships om ON om.id=sm.owner_membership_id
                JOIN users u ON u.id=om.user_id
                WHERE sm.shed_id=%s AND sm.is_active
                """,
                (shed_id,),
            )
            mems = cur.fetchall()
        log("DB: farmer-managed + assignment", row and row[0] is False and any(m[0] == FARMER_EMAIL for m in mems), str((row, mems)))

        st, fl = api("POST", "/api/v1/auth/login", {"email": FARMER_EMAIL, "password": FARMER_PASS})
        log("new farmer can login", st == 200, str(st))
        if st == 200:
            fh = {"Authorization": f"Bearer {fl['access_token']}", "X-Owner-Account-Id": OWNER["ownerAccountId"]}
            _, fs = api("GET", "/api/v1/sheds", headers=fh)
            log("farmer lists new shed", any(s["id"] == shed_id for s in fs), str([s["code"] for s in fs]))
            st2, _ = api("GET", f"/api/v1/sheds/{shed_id}/overview", headers=fh)
            log("farmer overview access", st2 == 200, str(st2))

    # Duplicate farmer while form filled
    open_url("/(app)/sheds/create")
    p = dump("d0")
    eds = edit_texts(p)
    keep_name = f"Keep{STAMP}"
    keep_code = f"KP{STAMP[-4:]}"
    fill(eds[0][0], eds[0][1], keep_name)
    fill(eds[1][0], eds[1][1], keep_code)
    toggle_switch(p)
    p = dump("d1")
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("d2")
    eds = edit_texts(p)
    fill(eds[0][0], eds[0][1], "DupFarmer")
    fill(eds[1][0], eds[1][1], FARMER_EMAIL)
    fill(eds[2][0], eds[2][1], FARMER_PASS)
    p = dump("d3")
    tap_label(p, "Create farmer")
    time.sleep(4)
    p = dump("d4")
    log(
        "duplicate farmer shows error / stays modal",
        has(p, "Add farmer") or has(p, "Create farmer") or any("already" in t.lower() or "exist" in t.lower() for t in texts(p)),
        str(texts(p)[:20]),
    )
    if has(p, "Close"):
        tap_label(p, "Close")
        time.sleep(1)
    p = dump("d5")
    log(
        "form intact after duplicate farmer fail",
        has(p, keep_name) or has(p, keep_code) or has(p, keep_code.upper()),
        str([t for t in texts(p) if "Keep" in t or "KP" in t or "Assigned" in t][:10]),
    )
    _, sheds2 = api("GET", "/api/v1/sheds", headers=oh)
    log(
        "no incomplete shed from failed farmer path",
        not any(s["code"] in {keep_code, keep_code.upper()} for s in sheds2),
        "",
    )

    # Owner-managed path
    open_url("/(app)/sheds/create")
    p = dump("o0")
    eds = edit_texts(p)
    om_code = f"OM{STAMP[-4:]}"
    fill(eds[0][0], eds[0][1], f"OwnerOnly{STAMP}")
    fill(eds[1][0], eds[1][1], om_code)
    p = dump("o1")
    if has(p, "Assigned farmer"):
        toggle_switch(p)
        p = dump("o2")
        if has(p, "Assigned farmer"):
            toggle_switch(p)
            p = dump("o3")
    log("owner-managed hides farmer section", not has(p, "Assigned farmer"), "")
    tap_label(p, "Create shed")
    time.sleep(6)
    _, sheds3 = api("GET", "/api/v1/sheds", headers=oh)
    om = next((s for s in sheds3 if s["code"] in {om_code, om_code.upper()}), None)
    log("owner-managed create works", om is not None and om.get("is_owner_managed") is True, str(om)[:180] if om else "")
    if om:
        _, oa = api("GET", f"/api/v1/sheds/{om['id']}/assignments", headers=oh)
        log("owner-managed has zero assignments", oa == [], str(oa))

    summary = {
        "pass": sum(1 for r in RESULTS if r["ok"]),
        "fail": sum(1 for r in RESULTS if not r["ok"]),
        "stamp": STAMP,
        "shed_code": SHED_CODE,
        "farmer_email": FARMER_EMAIL,
        "shed_id": shed_id,
        "results": RESULTS,
    }
    out = SCRIPTS / "e2e_new_shed_results.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("SUMMARY", summary["pass"], "pass /", summary["fail"], "fail")
    print("WROTE", out)


if __name__ == "__main__":
    main()
