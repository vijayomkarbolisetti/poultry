"""Resume E2E from farmer-managed New Shed form already filled (stamp 345316)."""
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

STAMP = "345316"
SHED_NAME = f"E2EBarn{STAMP}"
SHED_CODE = f"E2{STAMP[-4:]}"  # E25316
SHED_NOTES = f"Notes{STAMP}"
FARMER_NAME = f"E2EFarmer{STAMP}"
FARMER_EMAIL = f"e2e.farmer.{STAMP}@example.com"
FARMER_PASS = "password123"
RESULTS: list[dict] = []


def log(step: str, ok: bool, detail: str = "") -> None:
    RESULTS.append({"step": step, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), "-", step, "-", detail[:220])


def adb(*args: str, check: bool = True) -> str:
    p = subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(p.stdout + p.stderr)
    return (p.stdout or "") + (p.stderr or "")


def dump(name: str) -> Path:
    remote = f"/sdcard/{name}.xml"
    local = SCRIPTS / f"{name}.xml"
    for _ in range(3):
        adb("shell", "uiautomator", "dump", remote, check=False)
        time.sleep(0.4)
        out = adb("pull", remote, str(local), check=False)
        if local.exists() and local.stat().st_size > 100:
            return local
        time.sleep(1)
    raise RuntimeError(f"dump failed {name}: {out}")


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


def tap(x, y):
    adb("shell", "input", "tap", str(x), str(y))


def tap_label(path: Path, label: str) -> None:
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
        raise RuntimeError(f"missing {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            assert m
            tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            return
        cur = parent.get(cur)
    raise RuntimeError(f"not clickable {label}")


def type_text(value: str) -> None:
    adb("shell", "input", "text", value.replace(" ", "%s").replace("@", "\\@"))


def clear_field() -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(35):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill(x, y, value):
    tap(x, y)
    time.sleep(0.3)
    clear_field()
    type_text(value)
    time.sleep(0.2)
    tap(800, 120)
    time.sleep(0.3)


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
    b = switches[-1].attrib["bounds"]
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
    assert m
    tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
    time.sleep(1.5)


def create_enabled(path: Path):
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


def main():
    print("RESUME", STAMP, SHED_CODE, FARMER_EMAIL)
    p = dump("r0")
    # If not on form, reopen
    if not has(p, "New shed"):
        open_url("/(app)/sheds/create")
        p = dump("r0b")
        eds = edit_texts(p)
        fill(eds[0][0], eds[0][1], SHED_NAME)
        fill(eds[1][0], eds[1][1], SHED_CODE)
        if len(eds) >= 3:
            fill(eds[2][0], eds[2][1], SHED_NOTES)
        p = dump("r0c")
        if not has(p, "Assigned farmer"):
            toggle_switch(p)
            p = dump("r0d")

    log("form ready farmer-managed", has(p, SHED_NAME) and has(p, "Assigned farmer"), str(texts(p)[:20]))
    en = create_enabled(p)
    log("Create disabled without farmer", en is False, f"enabled={en}")

    # invalid farmer
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("rm0")
    eds = edit_texts(p)
    fill(eds[0][0], eds[0][1], "BadName")
    fill(eds[1][0], eds[1][1], "bademail")
    fill(eds[2][0], eds[2][1], "short")
    tap_label(dump("rm1"), "Create farmer")
    time.sleep(2)
    p = dump("rm2")
    log("invalid farmer blocked", has(p, "Add farmer") or has(p, "Create farmer"), str(texts(p)[:16]))
    tap_label(p, "Close")
    time.sleep(1.2)
    p = dump("rf1")
    log("values preserved after invalid farmer", has(p, SHED_NAME) and has(p, SHED_CODE), "")

    st, login = api("POST", "/api/v1/auth/login", {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]})
    oh = {"Authorization": f"Bearer {login['access_token']}", "X-Owner-Account-Id": OWNER["ownerAccountId"]}

    # valid farmer
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("rm3")
    eds = edit_texts(p)
    fill(eds[0][0], eds[0][1], FARMER_NAME)
    fill(eds[1][0], eds[1][1], FARMER_EMAIL)
    fill(eds[2][0], eds[2][1], FARMER_PASS)
    tap_label(dump("rm4"), "Create farmer")
    time.sleep(6)
    p = dump("rf2")
    log("back on shed form", has(p, "Create shed") and not has(p, "Create farmer"), str(texts(p)[:24]))
    log("shed fields preserved", has(p, SHED_NAME) and has(p, SHED_CODE), "")
    selected = has(p, FARMER_NAME) or has(p, FARMER_EMAIL)
    log("farmer auto-selected", selected, str([t for t in texts(p) if "E2E" in t or "@" in t][:10]))
    if not selected and has(p, "Select a farmer"):
        tap_label(p, "Select a farmer")
        time.sleep(2)
        p = dump("rpick")
        lab = next((t for t in texts(p) if FARMER_NAME in t or FARMER_EMAIL in t), None)
        if lab:
            tap_label(p, lab)
            time.sleep(1)
            p = dump("rpicked")
            selected = has(p, FARMER_NAME) or has(p, FARMER_EMAIL)
            log("manual farmer select", selected, "")

    en = create_enabled(p)
    log("Create enabled with farmer", en is not False, f"enabled={en}")
    tap_label(p, "Create shed")
    time.sleep(7)
    p = dump("rdone")
    log("overview after create", has(p, "Shed overview") or has(p, SHED_NAME) or has(p, "LIVE"), str(texts(p)[:20]))

    _, sheds = api("GET", "/api/v1/sheds", headers=oh)
    match = next((s for s in sheds if s["code"] in {SHED_CODE, SHED_CODE.upper()}), None)
    log("API shed exists", match is not None, str(match)[:200] if match else "")
    shed_id = match["id"] if match else None
    if shed_id:
        _, assigns = api("GET", f"/api/v1/sheds/{shed_id}/assignments", headers=oh)
        log(
            "API assignment",
            len(assigns) == 1 and assigns[0].get("farmer_email") == FARMER_EMAIL and assigns[0].get("is_manager"),
            str(assigns)[:280],
        )
        st, ov = api("GET", f"/api/v1/sheds/{shed_id}/overview", headers=oh)
        log("owner overview API", st == 200, "")
        with psycopg2.connect(DB) as conn, conn.cursor() as cur:
            cur.execute("SELECT is_owner_managed, name FROM sheds WHERE id=%s", (shed_id,))
            row = cur.fetchone()
            cur.execute(
                """
                SELECT u.email, sm.is_manager FROM shed_memberships sm
                JOIN owner_memberships om ON om.id=sm.owner_membership_id
                JOIN users u ON u.id=om.user_id WHERE sm.shed_id=%s AND sm.is_active
                """,
                (shed_id,),
            )
            mems = cur.fetchall()
        log("DB evidence", row and row[0] is False and any(m[0] == FARMER_EMAIL for m in mems), str((row, mems)))
        st, fl = api("POST", "/api/v1/auth/login", {"email": FARMER_EMAIL, "password": FARMER_PASS})
        log("farmer login", st == 200, str(st))
        if st == 200:
            fh = {"Authorization": f"Bearer {fl['access_token']}", "X-Owner-Account-Id": OWNER["ownerAccountId"]}
            _, fs = api("GET", "/api/v1/sheds", headers=fh)
            log("farmer sees shed", any(s["id"] == shed_id for s in fs), str([s["code"] for s in fs]))
            st2, _ = api("GET", f"/api/v1/sheds/{shed_id}/overview", headers=fh)
            log("farmer overview", st2 == 200, str(st2))

    # duplicate farmer fail
    open_url("/(app)/sheds/create")
    p = dump("dd0")
    eds = edit_texts(p)
    keep = f"Keep{STAMP}"
    kcode = f"KP{STAMP[-4:]}"
    fill(eds[0][0], eds[0][1], keep)
    fill(eds[1][0], eds[1][1], kcode)
    toggle_switch(p)
    p = dump("dd1")
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("dd2")
    eds = edit_texts(p)
    fill(eds[0][0], eds[0][1], "Dup")
    fill(eds[1][0], eds[1][1], FARMER_EMAIL)
    fill(eds[2][0], eds[2][1], FARMER_PASS)
    tap_label(dump("dd3"), "Create farmer")
    time.sleep(4)
    p = dump("dd4")
    log(
        "duplicate farmer failed safely",
        has(p, "Add farmer") or has(p, "Create farmer") or any("already" in t.lower() or "exist" in t.lower() for t in texts(p)),
        str(texts(p)[:18]),
    )
    if has(p, "Close"):
        tap_label(p, "Close")
        time.sleep(1)
    p = dump("dd5")
    log("form intact after dup fail", has(p, keep) or has(p, kcode) or has(p, kcode.upper()), str(texts(p)[:16]))
    _, sheds2 = api("GET", "/api/v1/sheds", headers=oh)
    log("no orphan KP shed", not any(s["code"] in {kcode, kcode.upper()} for s in sheds2), "")

    # owner-managed
    open_url("/(app)/sheds/create")
    p = dump("oo0")
    eds = edit_texts(p)
    omc = f"OM{STAMP[-4:]}"
    fill(eds[0][0], eds[0][1], f"OwnerOnly{STAMP}")
    fill(eds[1][0], eds[1][1], omc)
    p = dump("oo1")
    # ensure ON
    for _ in range(2):
        if has(p, "Assigned farmer"):
            toggle_switch(p)
            p = dump("oo_t")
        else:
            break
    log("owner-managed UI", not has(p, "Assigned farmer"), "")
    tap_label(p, "Create shed")
    time.sleep(6)
    _, sheds3 = api("GET", "/api/v1/sheds", headers=oh)
    om = next((s for s in sheds3 if s["code"] in {omc, omc.upper()}), None)
    log("owner-managed created", om is not None and om.get("is_owner_managed") is True, str(om)[:180] if om else "")
    if om:
        _, oa = api("GET", f"/api/v1/sheds/{om['id']}/assignments", headers=oh)
        log("owner-managed no assignment", oa == [], str(oa))

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
    print("SUMMARY", summary["pass"], "pass /", summary["fail"], "fail ->", out)


if __name__ == "__main__":
    main()
