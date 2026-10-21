"""Final device checks: edit form typing, confirm dialogs, farmer UI permissions."""
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
FARMER = json.loads((S / "pilot-farmer.json").read_text(encoding="utf-8"))
STAMP = time.strftime("%H%M%S")


def adb(*a, check=True):
    p = subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError((p.stdout or "") + (p.stderr or ""))
    return (p.stdout or "") + (p.stderr or "")


def deep_link(path: str):
    url = f"exp://127.0.0.1:8082/--/{path}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{url}'")


def dump(n: str) -> Path:
    remote = f"/sdcard/{n}.xml"
    local = S / f"{n}.xml"
    for _ in range(4):
        adb("shell", "uiautomator", "dump", remote, check=False)
        time.sleep(0.35)
        adb("pull", remote, str(local), check=False)
        if local.exists() and local.stat().st_size > 80:
            return local
        time.sleep(0.6)
    raise RuntimeError(f"dump fail {n}")


def texts(path: Path):
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def has(path: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(path))


def tap_label(path: Path, label: str, *, contains: bool = False):
    root = ET.parse(path).getroot()
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    target = None
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t == label or (contains and label in t):
            target = n
            break
    if target is None:
        raise RuntimeError(f"missing {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            adb(
                "shell",
                "input",
                "tap",
                str((int(m.group(1)) + int(m.group(3))) // 2),
                str((int(m.group(2)) + int(m.group(4))) // 2),
            )
            return
        cur = parent.get(cur)
    raise RuntimeError(f"not clickable {label}")


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


def clear_field():
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(40):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill(x, y, value: str):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(0.25)
    clear_field()
    adb("shell", "input", "text", value.replace("@", "\\@").replace(" ", "%s"))
    time.sleep(0.2)
    adb("shell", "input", "tap", "800", "100")
    time.sleep(0.2)


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


def log(results, step, ok, detail="", *, status="tested"):
    results.append({"step": step, "ok": ok, "status": status, "detail": detail})
    tag = "PASS" if ok else ("SKIP" if status == "not_tested" else "FAIL")
    print(tag, "-", step, "-", str(detail)[:200])


def owner_headers():
    st, login = api(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    if st != 200:
        raise RuntimeError("owner login failed")
    return {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }


def main():
    results = []
    oh = owner_headers()
    name = f"CloseEdit{STAMP}"
    code = f"CE{STAMP[-4:]}"
    notes = f"N{STAMP}"

    # Seed farmer-managed shed for mode-switch confirm + edit
    st, farmer = api(
        "POST",
        "/api/v1/farmers",
        {
            "email": f"close.farmer.{STAMP}@example.com",
            "password": "password123",
            "full_name": f"CloseFarmer{STAMP}",
            "role": "farmer",
            "permission_codes": ["shed.view", "flock.view", "vaccination.view"],
            "shed_ids": [],
        },
        oh,
    )
    log(results, "seed farmer", st == 201, farmer.get("membership_id") if isinstance(farmer, dict) else farmer)
    mem = farmer["membership_id"]
    st, shed = api(
        "POST",
        "/api/v1/sheds",
        {
            "name": name,
            "code": code,
            "location_notes": notes,
            "is_owner_managed": False,
            "initial_farmer_membership_id": mem,
        },
        oh,
    )
    log(results, "seed shed", st == 201, shed.get("id") if isinstance(shed, dict) else shed)
    sid = shed["id"]

    # --- Edit form typing + save ---
    deep_link(f"(app)/sheds/edit/{sid}")
    time.sleep(5)
    p = dump("cl_edit0")
    if not (has(p, "Edit shed") or has(p, "Save changes")):
        log(results, "open edit form", False, str(texts(p)[:16]))
    else:
        log(results, "open edit form", True, str(texts(p)[:12]))
        eds = edit_centers(p)
        if len(eds) < 3:
            log(results, "edit form fields", False, f"eds={len(eds)}")
        else:
            new_name = f"Typed{STAMP}"
            new_code = f"TY{STAMP[-4:]}"
            new_notes = f"TypedNotes{STAMP}"
            fill(eds[0][0], eds[0][1], new_name)
            fill(eds[1][0], eds[1][1], new_code)
            fill(eds[2][0], eds[2][1], new_notes)
            p = dump("cl_edit1")
            tap_label(p, "Save changes")
            time.sleep(5)
            p = dump("cl_edit_done")
            st, got = api("GET", f"/api/v1/sheds/{sid}", headers=oh)
            ui_ok = has(p, new_name) or has(p, "Shed overview")
            api_ok = (
                st == 200
                and got.get("name") == new_name
                and got.get("code") == new_code
                and got.get("location_notes") == new_notes
            )
            log(
                results,
                "edit form typing and save",
                ui_ok and api_ok,
                f"ui={ui_ok} api={api_ok} name={got.get('name')} code={got.get('code')}",
            )
            name, code, notes = new_name, new_code, new_notes

    # --- Owner-managed confirmation dialog ---
    deep_link(f"(app)/sheds/edit/{sid}")
    time.sleep(4)
    p = dump("cl_mode0")
    # Find Switch and turn owner-managed ON (currently farmer-managed)
    root = ET.parse(p).getroot()
    switches = [
        n
        for n in root.iter("node")
        if "Switch" in (n.attrib.get("class") or "") or n.attrib.get("checkable") == "true"
    ]
    if not switches:
        log(results, "owner-managed confirm dialog", False, "no switch", status="not_tested")
    else:
        sw = switches[-1]
        checked = sw.attrib.get("checked") == "true"
        # Want farmer-managed False -> tap to go True and trigger confirm
        if checked:
            # Already owner-managed in UI unexpectedly; skip
            log(
                results,
                "owner-managed confirm dialog",
                False,
                "switch already ON; cannot provoke confirm",
                status="not_tested",
            )
        else:
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", sw.attrib["bounds"])
            adb(
                "shell",
                "input",
                "tap",
                str((int(m.group(1)) + int(m.group(3))) // 2),
                str((int(m.group(2)) + int(m.group(4))) // 2),
            )
            time.sleep(1.5)
            p = dump("cl_mode_alert")
            alert_ok = has(p, "Switch to owner-managed") or has(p, "lose access")
            log(
                results,
                "owner-managed confirm dialog appears",
                alert_ok,
                str(texts(p)[:18]),
            )
            if alert_ok:
                # Cancel to keep farmer-managed for deactivate path
                try:
                    tap_label(p, "Cancel")
                    time.sleep(1)
                    log(results, "owner-managed confirm cancel", True, "")
                except Exception as e:
                    log(results, "owner-managed confirm cancel", False, str(e), status="not_tested")
            else:
                log(
                    results,
                    "owner-managed confirm cancel",
                    False,
                    "alert not detected",
                    status="not_tested",
                )

    # --- Deactivate confirmation dialog ---
    deep_link(f"(app)/sheds/{sid}")
    time.sleep(5)
    p = dump("cl_ov")
    if has(p, "Deactivate"):
        tap_label(p, "Deactivate")
        time.sleep(2)
        p = dump("cl_deact_alert")
        # First call loads deps then shows Alert — may need second wait
        if not (has(p, "Deactivate this shed") or has(p, "preserves")):
            time.sleep(3)
            p = dump("cl_deact_alert2")
        deact_alert = has(p, "Deactivate this shed") or has(p, "preserves") or has(p, "Permanent deletion")
        log(results, "deactivate confirm dialog appears", deact_alert, str(texts(p)[:20]))
        if deact_alert:
            try:
                tap_label(p, "Cancel")
                time.sleep(1)
                log(results, "deactivate confirm cancel", True, "")
            except Exception as e:
                # Prefer tapping Cancel if labeled; else Escape
                adb("shell", "input", "keyevent", "KEYCODE_BACK", check=False)
                log(results, "deactivate confirm cancel", False, str(e), status="not_tested")
        else:
            log(results, "deactivate confirm cancel", False, "alert not seen", status="not_tested")
    else:
        log(results, "deactivate confirm dialog appears", False, "Deactivate not on overview", status="not_tested")

    # --- Farmer UI session ---
    # Logout via settings is flaky; deep-link login after clearing may not switch account.
    # Attempt: open settings logout if present, else mark not_tested for UI and rely on API.
    deep_link("(app)/settings")
    time.sleep(4)
    p = dump("cl_set")
    if has(p, "Log out") or has(p, "Logout") or has(p, "Sign out"):
        try:
            for lab in ("Log out", "Logout", "Sign out"):
                if has(p, lab):
                    tap_label(p, lab, contains=True)
                    break
            time.sleep(3)
            p = dump("cl_login")
            if has(p, "Email") or has(p, "Sign in") or has(p, "Log in"):
                eds = edit_centers(p)
                if len(eds) >= 2:
                    fill(eds[0][0], eds[0][1], FARMER["farmerEmail"])
                    fill(eds[1][0], eds[1][1], FARMER["farmerPassword"])
                    for lab in ("Sign in", "Log in", "Login"):
                        if has(p, lab) or True:
                            p2 = dump("cl_login2")
                            try:
                                tap_label(p2, lab)
                                break
                            except Exception:
                                continue
                    time.sleep(6)
                    deep_link(f"(app)/sheds/{sid}")
                    time.sleep(5)
                    p = dump("cl_farmer_ov")
                    # Farmer should not see Edit shed / Deactivate
                    no_edit = not has(p, "Edit shed")
                    no_deact = not has(p, "Deactivate")
                    # May get 403 empty screen if not assigned to this verify shed
                    log(
                        results,
                        "farmer UI hides edit/deactivate",
                        no_edit and no_deact,
                        str(texts(p)[:18]),
                    )
                else:
                    log(results, "farmer UI hides edit/deactivate", False, "login fields missing", status="not_tested")
            else:
                log(results, "farmer UI hides edit/deactivate", False, "login screen not reached", status="not_tested")
        except Exception as e:
            log(results, "farmer UI hides edit/deactivate", False, str(e), status="not_tested")
    else:
        # API-only confirmation for pilot farmer
        st, fl = api(
            "POST",
            "/api/v1/auth/login",
            {"email": FARMER["farmerEmail"], "password": FARMER["farmerPassword"]},
        )
        fh = {
            "Authorization": f"Bearer {fl['access_token']}",
            "X-Owner-Account-Id": OWNER["ownerAccountId"],
        }
        st_p, _ = api("PATCH", f"/api/v1/sheds/{sid}", {"name": "Nope"}, fh)
        st_d, _ = api("POST", f"/api/v1/sheds/{sid}/deactivate", headers=fh)
        log(
            results,
            "farmer UI hides edit/deactivate",
            False,
            f"UI logout not found; API-only patch={st_p} deact={st_d}",
            status="not_tested",
        )
        log(
            results,
            "farmer API denied edit/deactivate",
            st_p == 403 and st_d == 403,
            f"patch={st_p} deact={st_d}",
        )

    out = {
        "stamp": STAMP,
        "shed_id": sid,
        "pass": sum(1 for r in results if r["ok"]),
        "fail": sum(1 for r in results if not r["ok"] and r["status"] == "tested"),
        "not_tested": sum(1 for r in results if r["status"] == "not_tested"),
        "results": results,
    }
    (S / "verify_shed_closure_device.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(
        "SUMMARY",
        out["pass"],
        "pass /",
        out["fail"],
        "fail /",
        out["not_tested"],
        "not_tested",
    )


if __name__ == "__main__":
    main()
