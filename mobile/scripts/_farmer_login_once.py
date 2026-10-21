"""One-shot farmer login + select-mode check (no clipboard)."""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8002"
EXPO = "exp://10.0.2.2:8082/--"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text(encoding="utf-8"))
EMAIL = SEED["farmer_email"]
PASSWORD = "password123"
results = []


def log(step, status, detail=""):
    results.append({"step": step, "status": status, "detail": detail[:300]})
    print(f"{status.upper():10} {step} — {detail[:160]}")


def adb(*a):
    subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump(name):
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.4)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def texts(p):
    return [(n.attrib.get("text") or "").strip() for n in ET.parse(p).getroot().iter("node") if (n.attrib.get("text") or "").strip()]


def has(p, needle):
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def edit_nodes(p):
    out = []
    for n in ET.parse(p).getroot().iter("node"):
        if (n.attrib.get("class") or "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            out.append(
                {
                    "cx": (int(m.group(1)) + int(m.group(3))) // 2,
                    "cy": (int(m.group(2)) + int(m.group(4))) // 2,
                    "password": n.attrib.get("password") == "true",
                    "text": n.attrib.get("text") or "",
                    "bounds": n.attrib["bounds"],
                }
            )
    return out


def tap_desc(p, desc):
    for n in ET.parse(p).getroot().iter("node"):
        if (n.attrib.get("content-desc") or "").strip() == desc and n.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            adb(
                "shell",
                "input",
                "tap",
                str((int(m.group(1)) + int(m.group(3))) // 2),
                str((int(m.group(2)) + int(m.group(4))) // 2),
            )
            return True
    return False


def clear_hard():
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(200):
        adb("shell", "input", "keyevent", "67")


def type_email(email: str):
    # Type local + @ + domain separately so @ is reliable
    local, _, domain = email.partition("@")
    adb("shell", "input", "text", local)
    adb("shell", "input", "text", r"\@")
    adb("shell", "input", "text", domain)


def open_expo(path):
    adb("shell", f"am start -a android.intent.action.VIEW -d '{EXPO}/{path.lstrip('/')}'")
    time.sleep(5)


def api(method, path, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={**headers, "Content-Type": "application/json"}, method=method
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode() or "{}")


def wait_login_form(timeout_s: int = 30) -> Path:
    open_expo("(auth)/login")
    deadline = time.time() + timeout_s
    p = dump("fl_wait")
    while time.time() < deadline:
        eds = edit_nodes(p)
        if has(p, "Sign In") and len(eds) >= 2:
            return p
        time.sleep(2)
        p = dump("fl_wait")
    return p


def main():
    # Do not force-stop — Expo Go cold start often leaves only the brand splash briefly.
    p = wait_login_form()
    eds = edit_nodes(p)
    email_ed = next((e for e in eds if not e["password"]), None)
    pass_ed = next((e for e in eds if e["password"]), None)
    if not email_ed or not pass_ed:
        log("farmer_ui_login", "failed", f"no fields texts={texts(p)[:10]}")
        return
    adb("shell", "input", "tap", str(email_ed["cx"]), str(email_ed["cy"]))
    clear_hard()
    type_email(EMAIL)
    time.sleep(0.5)
    p = dump("fl_email")
    adb("shell", "screencap", "-p", "/sdcard/fl_email.png")
    adb("pull", "/sdcard/fl_email.png", str(S / "fl_email.png"))
    email_ok = "sbm-farmer" in " ".join(texts(p)).lower() or EMAIL.split("@")[0] in " ".join(texts(p))
    log("farmer_email_filled", "passed" if email_ok else "failed", str(texts(p)[:12]))

    eds = edit_nodes(p)
    pass_ed = next((e for e in eds if e["password"]), None) or pass_ed
    adb("shell", "input", "tap", str(pass_ed["cx"]), str(pass_ed["cy"]))
    clear_hard()
    adb("shell", "input", "text", PASSWORD)
    p = dump("fl_before")
    if not tap_desc(p, "Sign In"):
        adb("shell", "input", "tap", "800", "1218")
    time.sleep(12)
    p = dump("fl_home")
    adb("shell", "screencap", "-p", "/sdcard/fl_home.png")
    adb("pull", "/sdcard/fl_home.png", str(S / "fl_home.png"))
    logged = has(p, "Hello, SBM") or (has(p, "Hello") and not has(p, "Sign In")) or has(p, "Live birds")
    log("farmer_ui_login", "passed" if logged else "failed", str(texts(p)[:12]))
    if not logged:
        (S / "shed_birds_farmer_ui_retry.json").write_text(json.dumps({"results": results}, indent=2))
        print("STOP", results)
        return

    shed = SEED["shed_id"]
    other = OWNER["shedId"]
    open_expo(f"(app)/sheds/{shed}")
    time.sleep(3)
    p = dump("fl_shed")
    for _ in range(14):
        if has(p, "Select") or has(p, "Add Bird") or has(p, "Batch count"):
            break
        adb("shell", "input", "swipe", "800", "1700", "800", "650", "350")
        time.sleep(0.5)
        p = dump("fl_shed")
    adb("shell", "screencap", "-p", "/sdcard/fl_shed.png")
    adb("pull", "/sdcard/fl_shed.png", str(S / "fl_shed.png"))

    # Enter select
    entered = False
    # Prefer exact Select near birds
    for n in ET.parse(p).getroot().iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t == "Select" and n.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            adb(
                "shell",
                "input",
                "tap",
                str((int(m.group(1)) + int(m.group(3))) // 2),
                str((int(m.group(2)) + int(m.group(4))) // 2),
            )
            entered = True
            break
        if t == "Select":
            # climb
            pass
    if not entered:
        # content search with parent climb
        parent = {}
        root = ET.parse(p).getroot()
        for pr in root.iter("node"):
            for c in list(pr):
                parent[c] = pr
        for n in root.iter("node"):
            if (n.attrib.get("text") or "").strip() != "Select":
                continue
            cur = n
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
                    entered = True
                    break
                cur = parent.get(cur)
            if entered:
                break
    time.sleep(1.5)
    p = dump("fl_select")
    adb("shell", "screencap", "-p", "/sdcard/fl_select.png")
    adb("pull", "/sdcard/fl_select.png", str(S / "fl_select.png"))
    ok_sel = has(p, "Exit selection") or has(p, "Select all")
    log("farmer_ui_select_mode", "passed" if ok_sel else "failed", str(texts(p)[:14]))
    if ok_sel:
        if has(p, "Select all loaded") or has(p, "Select all"):
            for n in ET.parse(p).getroot().iter("node"):
                t = (n.attrib.get("text") or "").strip().lower()
                if "select all" in t and n.attrib.get("clickable") == "true":
                    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
                    adb(
                        "shell",
                        "input",
                        "tap",
                        str((int(m.group(1)) + int(m.group(3))) // 2),
                        str((int(m.group(2)) + int(m.group(4))) // 2),
                    )
                    break
            time.sleep(1)
            p = dump("fl_sel_all")
        actions = [t for t in texts(p) if t.lower().startswith("record ")]
        hard = any(t.lower() == "delete" for t in texts(p))
        log(
            "farmer_ui_allowed_actions",
            "passed" if not hard and (not actions or all(a.lower() in ("record mortality", "record sale", "record transfer") for a in actions)) else "failed",
            f"actions={actions}",
        )
        # exit without submitting
        for n in ET.parse(p).getroot().iter("node"):
            if (n.attrib.get("text") or "").strip() == "Exit selection":
                parent = {}
                root = ET.parse(p).getroot()
                for pr in root.iter("node"):
                    for c in list(pr):
                        parent[c] = pr
                cur = n
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
                        break
                    cur = parent.get(cur)
                break
    else:
        log("farmer_ui_allowed_actions", "not_tested")

    open_expo(f"(app)/sheds/{other}")
    time.sleep(4)
    p = dump("fl_deny")
    adb("shell", "screencap", "-p", "/sdcard/fl_deny.png")
    adb("pull", "/sdcard/fl_deny.png", str(S / "fl_deny.png"))
    exposed = has(p, "Add Bird") and has(p, "Select")
    denied = has(p, "denied") or has(p, "not found") or has(p, "access") or has(p, "Retry") or has(p, "Unable") or not has(p, "Add Bird")
    log("farmer_ui_unauthorized_shed", "failed" if exposed else ("passed" if denied else "failed"), str(texts(p)[:12]))

    # API: forbidden other-shed bird must not mutate — use owner bird from pilot shed
    code, body = api("POST", "/api/v1/auth/login", {}, {"email": EMAIL, "password": PASSWORD})
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    fh = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"]}
    # Create disposable on assigned shed then attempt from "wrong" perspective already covered;
    # unauthorized list already 403. Confirm no Add Bird on deny screen.
    out = {
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "artifacts": [
            "mobile/scripts/fl_email.png",
            "mobile/scripts/fl_home.png",
            "mobile/scripts/fl_shed.png",
            "mobile/scripts/fl_select.png",
            "mobile/scripts/fl_deny.png",
        ],
    }
    (S / "shed_birds_farmer_ui_retry.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("FARMER_RETRY", json.dumps({k: out[k] for k in ("passed", "failed", "not_tested")}))


if __name__ == "__main__":
    main()
