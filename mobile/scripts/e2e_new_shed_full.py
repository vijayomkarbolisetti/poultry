"""
Final E2E: New Shed → Add Farmer → Create Shed on emulator-5554.
Also verifies API/DB assignment and farmer access.
"""
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
SHED_NAME = f"E2E Barn {STAMP}"
SHED_CODE = f"E2{STAMP[-4:]}"
SHED_NOTES = f"Notes{STAMP}"
FARMER_NAME = f"E2E Farmer {STAMP}"
FARMER_EMAIL = f"e2e.farmer.{STAMP}@example.com"
FARMER_PASS = "password123"
DUP_EMAIL = FARMER_EMAIL  # reuse for failure case after success, or use before

RESULTS: list[dict] = []


def log(step: str, ok: bool, detail: str = "") -> None:
    RESULTS.append({"step": step, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), step, detail)


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


def has_text(path: Path, needle: str) -> bool:
    return any(needle in t for t in texts(path))


def edit_texts(path: Path) -> list[tuple[int, int, str]]:
    root = ET.parse(path).getroot()
    out = []
    for n in root.iter("node"):
        if n.attrib.get("class", "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            assert m
            x = (int(m.group(1)) + int(m.group(3))) // 2
            y = (int(m.group(2)) + int(m.group(4))) // 2
            out.append((x, y, n.attrib.get("text") or ""))
    return out


def tap_xy(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def tap_label(path: Path, label: str) -> None:
    root = ET.parse(path).getroot()
    parent: dict = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    target = None
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() == label:
            target = n
            break
    if target is None:
        raise RuntimeError(f"label not found: {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            assert m
            tap_xy((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            return
        cur = parent.get(cur)
    raise RuntimeError(f"no clickable for {label}")


def type_text(value: str) -> None:
    # adb input text: space=%s, @=\@, escape specials lightly
    escaped = (
        value.replace("\\", "\\\\")
        .replace(" ", "%s")
        .replace("@", "\\@")
        .replace("'", "\\'")
        .replace("&", "\\&")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .replace("|", "\\|")
        .replace(";", "\\;")
    )
    adb("shell", "input", "text", escaped)


def clear_field() -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(40):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill_edit(x: int, y: int, value: str) -> None:
    tap_xy(x, y)
    time.sleep(0.4)
    clear_field()
    type_text(value)
    time.sleep(0.3)
    adb("shell", "input", "keyevent", "KEYCODE_BACK")  # dismiss keyboard
    time.sleep(0.3)


def open_url(path: str) -> None:
    url = f"exp://127.0.0.1:8082/--{path}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{url}'")
    time.sleep(4)


def toggle_owner_managed_off(path: Path) -> None:
    root = ET.parse(path).getroot()
    switches = [
        n
        for n in root.iter("node")
        if "Switch" in (n.attrib.get("class") or "") or n.attrib.get("checkable") == "true"
    ]
    if not switches:
        raise RuntimeError("no switch found")
    b = switches[-1].attrib["bounds"]
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
    assert m
    tap_xy((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
    time.sleep(1.5)


def api(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")


def ensure_owner_session() -> None:
    open_url("/(app)/home")
    p = dump("e2e_home")
    t = texts(p)
    if any("Hello, Pilot" in x or "Pilot Farm" in x for x in t) and not any(
        x == "Sign In" for x in t
    ):
        # May already be owner; check settings for email
        open_url("/(app)/settings")
        p2 = dump("e2e_settings")
        t2 = texts(p2)
        if OWNER["ownerEmail"] in t2 or any("Owner" in x for x in t2):
            log("owner session", True, "already logged in as owner-ish")
            return
        if any(x == "Log out" for x in t2):
            tap_label(p2, "Log out")
            time.sleep(3)

    # Login
    open_url("/(auth)/login")
    time.sleep(2)
    p = dump("e2e_login")
    eds = edit_texts(p)
    if len(eds) < 2:
        # maybe already on welcome with Sign In
        if has_text(p, "Sign In"):
            tap_label(p, "Sign In")
            time.sleep(2)
            p = dump("e2e_login2")
            eds = edit_texts(p)
    if len(eds) < 2:
        log("owner login form", False, f"edittexts={eds} texts={texts(p)[:15]}")
        raise SystemExit("cannot find login fields")
    fill_edit(eds[0][0], eds[0][1], OWNER["ownerEmail"])
    fill_edit(eds[1][0], eds[1][1], OWNER["ownerPassword"])
    p = dump("e2e_login3")
    tap_label(p, "Sign In")
    time.sleep(6)
    p = dump("e2e_after_login")
    ok = has_text(p, "Pilot") or has_text(p, "Live birds") or has_text(p, "POULTRYTRACK")
    log("owner login", ok, str(texts(p)[:12]))
    if not ok:
        raise SystemExit("owner login failed")


def create_button_enabled(path: Path) -> bool | None:
    root = ET.parse(path).getroot()
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() == "Create shed":
            # walk up for enabled/clickable
            # uiautomator exposes enabled on the node or parent
            enabled = n.attrib.get("enabled")
            clickable = n.attrib.get("clickable")
            cur = n
            parent: dict = {}
            for p in root.iter("node"):
                for c in list(p):
                    parent[c] = p
            while cur is not None:
                if cur.attrib.get("clickable") == "true":
                    return cur.attrib.get("enabled", "true") == "true"
                cur = parent.get(cur)
            return enabled != "false" if enabled is not None else clickable == "true"
    return None


def main() -> None:
    print("STAMP", STAMP, "SHED", SHED_NAME, SHED_CODE, "FARMER", FARMER_EMAIL)
    ensure_owner_session()

    # --- Step: open New Shed, fill form ---
    open_url("/(app)/sheds/create")
    p = dump("e2e_create0")
    eds = edit_texts(p)
    log("open new shed", len(eds) >= 2, f"fields={len(eds)}")
    # name, code, notes — usually 3 EditTexts
    if len(eds) >= 1:
        fill_edit(eds[0][0], eds[0][1], SHED_NAME)
    if len(eds) >= 2:
        fill_edit(eds[1][0], eds[1][1], SHED_CODE)
    if len(eds) >= 3:
        fill_edit(eds[2][0], eds[2][1], SHED_NOTES)
    p = dump("e2e_create_filled")
    preserved = has_text(p, SHED_NAME) or has_text(p, SHED_CODE)
    # autCapitalize may change casing — check code uppercase
    preserved = preserved or has_text(p, SHED_CODE.upper()) or has_text(p, SHED_NAME)
    log("filled shed fields", preserved, str([t for t in texts(p) if STAMP in t or "E2E" in t or "Barn" in t or "Notes" in t][:10]))

    # Owner-managed OFF
    toggle_owner_managed_off(p)
    p = dump("e2e_fm")
    log(
        "farmer section visible",
        has_text(p, "Assigned farmer") and has_text(p, "Add Farmer"),
        str([t for t in texts(p) if "farmer" in t.lower() or "Add" in t or "Create" in t][:12]),
    )
    enabled = create_button_enabled(p)
    log("create disabled without farmer", enabled is False or enabled is None, f"enabled={enabled}")

    # --- Failed farmer creation (duplicate will be tested after success; first use invalid email) ---
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("e2e_modal1")
    log("add farmer modal open", has_text(p, "Add farmer") and has_text(p, "Create farmer"), "")
    eds = edit_texts(p)
    if len(eds) >= 3:
        fill_edit(eds[0][0], eds[0][1], "Bad Farmer")
        fill_edit(eds[1][0], eds[1][1], "not-an-email")
        fill_edit(eds[2][0], eds[2][1], "short")
    p = dump("e2e_modal_invalid")
    # Try submit — zod should block or show errors
    if has_text(p, "Create farmer"):
        try:
            tap_label(p, "Create farmer")
        except Exception:
            pass
    time.sleep(2)
    p = dump("e2e_modal_invalid2")
    still_modal = has_text(p, "Add farmer")
    log("invalid farmer stays on modal", still_modal, str(texts(p)[:20]))
    if has_text(p, "Close"):
        tap_label(p, "Close")
        time.sleep(1.5)
    p = dump("e2e_after_invalid")
    form_ok = has_text(p, SHED_CODE) or has_text(p, SHED_CODE.upper()) or has_text(p, SHED_NAME) or has_text(p, "Barn")
    log("shed form preserved after failed farmer", form_ok, str([t for t in texts(p) if "E2" in t or "Barn" in t or "Notes" in t or "Assigned" in t][:15]))

    # Ensure still farmer-managed
    if not has_text(p, "Assigned farmer"):
        toggle_owner_managed_off(p)
        p = dump("e2e_fm2")

    # --- Successful Add Farmer ---
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("e2e_modal_ok")
    eds = edit_texts(p)
    if len(eds) < 3:
        log("modal fields", False, f"eds={eds}")
        raise SystemExit("modal fields missing")
    fill_edit(eds[0][0], eds[0][1], FARMER_NAME)
    fill_edit(eds[1][0], eds[1][1], FARMER_EMAIL)
    fill_edit(eds[2][0], eds[2][1], FARMER_PASS)
    p = dump("e2e_modal_ready")
    tap_label(p, "Create farmer")
    time.sleep(5)
    p = dump("e2e_after_farmer")
    back_on_form = has_text(p, "Create shed") and not has_text(p, "Create farmer")
    form_kept = has_text(p, SHED_CODE) or has_text(p, SHED_CODE.upper()) or has_text(p, "Barn")
    auto_selected = has_text(p, FARMER_NAME) or has_text(p, FARMER_EMAIL) or has_text(p, "E2E Farmer")
    log("return to shed form after farmer create", back_on_form, str(texts(p)[:25]))
    log("shed values preserved", form_kept, "")
    log("new farmer auto-selected or visible", auto_selected, str([t for t in texts(p) if "E2E" in t or "farmer" in t.lower() or "@" in t][:15]))

    # If not auto-selected, try open selector and pick
    if not auto_selected and has_text(p, "Select a farmer"):
        tap_label(p, "Select a farmer")
        time.sleep(2)
        p = dump("e2e_picker")
        if has_text(p, FARMER_NAME) or has_text(p, "E2E Farmer"):
            # tap farmer name
            label = next(t for t in texts(p) if "E2E Farmer" in t)
            tap_label(p, label)
            time.sleep(1)
            p = dump("e2e_picked")
            auto_selected = has_text(p, "E2E Farmer")
            log("manual farmer select", auto_selected, "")

    # --- Submit shed ---
    sheds_before_st, sheds_before = api(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    token = sheds_before["access_token"]
    oh = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": OWNER["ownerAccountId"]}
    _, sheds_list_before = api("GET", "/api/v1/sheds", headers=oh)
    codes_before = {s["code"] for s in sheds_list_before}

    p = dump("e2e_before_submit")
    if has_text(p, "Create shed"):
        tap_label(p, "Create shed")
    time.sleep(6)
    p = dump("e2e_after_submit")
    navigated = has_text(p, "Shed overview") or has_text(p, SHED_NAME) or has_text(p, "Barn")
    log("submit navigates to overview", navigated, str(texts(p)[:20]))

    # API / DB evidence
    st, sheds = api("GET", "/api/v1/sheds", headers=oh)
    match = next((s for s in sheds if s["code"] == SHED_CODE.upper() or s["code"] == SHED_CODE), None)
    if match is None:
        # try name contains
        match = next((s for s in sheds if STAMP in s.get("name", "")), None)
    log("API shed exists", match is not None, str(match)[:200] if match else f"codes={[s['code'] for s in sheds][-5:]}")
    shed_id = match["id"] if match else None
    assigns = []
    if shed_id:
        st, assigns = api("GET", f"/api/v1/sheds/{shed_id}/assignments", headers=oh)
        log(
            "API assignment present",
            st == 200 and len(assigns) == 1 and assigns[0].get("is_manager") is True,
            str(assigns)[:300],
        )
        st, overview = api("GET", f"/api/v1/sheds/{shed_id}/overview", headers=oh)
        log("owner overview access", st == 200, f"name={overview.get('shed',{}).get('name') if isinstance(overview, dict) else overview}")

    # DB check
    if shed_id:
        with psycopg2.connect(DB) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT is_owner_managed, name, code FROM sheds WHERE id=%s",
                (shed_id,),
            )
            row = cur.fetchone()
            cur.execute(
                """
                SELECT sm.is_active, sm.is_manager, u.email
                FROM shed_memberships sm
                JOIN owner_memberships om ON om.id = sm.owner_membership_id
                JOIN users u ON u.id = om.user_id
                WHERE sm.shed_id=%s AND sm.is_active
                """,
                (shed_id,),
            )
            mems = cur.fetchall()
        log("DB shed farmer-managed", row and row[0] is False, str(row))
        log("DB membership", any(m[2] == FARMER_EMAIL for m in mems), str(mems))

    # Duplicate submit check — navigate back to create shouldn't recreate same code easily
    # Farmer access
    st, flogin = api("POST", "/api/v1/auth/login", {"email": FARMER_EMAIL, "password": FARMER_PASS})
    log("new farmer login", st == 200, str(st))
    if st == 200 and shed_id:
        fh = {
            "Authorization": f"Bearer {flogin['access_token']}",
            "X-Owner-Account-Id": OWNER["ownerAccountId"],
        }
        st, fsheds = api("GET", "/api/v1/sheds", headers=fh)
        log("farmer sees new shed", st == 200 and any(s["id"] == shed_id for s in fsheds), str([s["code"] for s in fsheds]))
        st, fov = api("GET", f"/api/v1/sheds/{shed_id}/overview", headers=fh)
        log("farmer overview access", st == 200, str(st))

    # Duplicate farmer creation failure while preserving form
    open_url("/(app)/sheds/create")
    time.sleep(2)
    p = dump("e2e_dup0")
    eds = edit_texts(p)
    if len(eds) >= 2:
        fill_edit(eds[0][0], eds[0][1], f"Dup Keep {STAMP}")
        fill_edit(eds[1][0], eds[1][1], f"DK{STAMP[-4:]}")
    toggle_owner_managed_off(p)
    p = dump("e2e_dup1")
    tap_label(p, "+ Add Farmer")
    time.sleep(2)
    p = dump("e2e_dup_modal")
    eds = edit_texts(p)
    if len(eds) >= 3:
        fill_edit(eds[0][0], eds[0][1], "Dup Farmer")
        fill_edit(eds[1][0], eds[1][1], FARMER_EMAIL)  # duplicate
        fill_edit(eds[2][0], eds[2][1], FARMER_PASS)
        tap_label(dump("e2e_dup_modal2"), "Create farmer")
        time.sleep(3)
    p = dump("e2e_dup_fail")
    still_modal = has_text(p, "Add farmer") or has_text(p, "Create farmer")
    has_err = any("exist" in t.lower() or "already" in t.lower() or "error" in t.lower() or "fail" in t.lower() or "@" in t for t in texts(p))
    log("duplicate farmer error shown / stays modal", still_modal or has_err, str(texts(p)[:25]))
    if has_text(p, "Close"):
        tap_label(p, "Close")
        time.sleep(1)
    p = dump("e2e_dup_form")
    log("form intact after dup farmer fail", has_text(p, "Dup Keep") or has_text(p, f"DK{STAMP[-4:].upper()}") or has_text(p, f"DK{STAMP[-4:]}"), str(texts(p)[:20]))
    # no incomplete shed for DK code
    _, sheds2 = api("GET", "/api/v1/sheds", headers=oh)
    log(
        "no orphan shed from failed farmer path",
        not any(s["code"] in {f"DK{STAMP[-4:]}", f"DK{STAMP[-4:].upper()}"} for s in sheds2),
        "",
    )

    # Owner-managed path
    open_url("/(app)/sheds/create")
    time.sleep(2)
    p = dump("e2e_om0")
    eds = edit_texts(p)
    om_code = f"OM{STAMP[-4:]}"
    if len(eds) >= 2:
        fill_edit(eds[0][0], eds[0][1], f"Owner Only {STAMP}")
        fill_edit(eds[1][0], eds[1][1], om_code)
    # ensure owner-managed ON (default)
    p = dump("e2e_om1")
    if has_text(p, "Assigned farmer"):
        # toggle back on
        toggle_owner_managed_off(p)  # may flip to off if already on — check
        p = dump("e2e_om2")
        if has_text(p, "Assigned farmer"):
            toggle_owner_managed_off(p)
            p = dump("e2e_om3")
    log("owner-managed no farmer section", not has_text(p, "Assigned farmer"), str([t for t in texts(p) if "Owner" in t or "Create" in t][:10]))
    tap_label(p, "Create shed")
    time.sleep(5)
    p = dump("e2e_om_done")
    _, sheds3 = api("GET", "/api/v1/sheds", headers=oh)
    om = next((s for s in sheds3 if s["code"] in {om_code, om_code.upper()}), None)
    log("owner-managed shed created", om is not None and om.get("is_owner_managed") is True, str(om)[:200] if om else "")
    if om:
        st, oa = api("GET", f"/api/v1/sheds/{om['id']}/assignments", headers=oh)
        log("owner-managed has no assignment", st == 200 and oa == [], str(oa))

    out = SCRIPTS / "e2e_new_shed_results.json"
    summary = {"pass": sum(1 for r in RESULTS if r["ok"]), "fail": sum(1 for r in RESULTS if not r["ok"]), "results": RESULTS}
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("SUMMARY", summary["pass"], "pass,", summary["fail"], "fail")
    print("WROTE", out)


if __name__ == "__main__":
    main()
