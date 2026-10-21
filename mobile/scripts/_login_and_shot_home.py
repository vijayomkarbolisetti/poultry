"""Login on emulator and capture PoultryTrack home dashboard."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

SERIAL = "emulator-5554"
S = Path(__file__).resolve().parent
DUMP = S / "_tmp_h.xml"
OUT = S / "home_dashboard_verify.png"
OUT_XML = S / "home_dashboard_verify.xml"
EMAIL = "pilot-owner-211956487@example.com"
PASSWORD = "password123"
URL = "exp://127.0.0.1:8084"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump() -> Path:
    adb("shell", "uiautomator", "dump", "/sdcard/h.xml")
    adb("pull", "/sdcard/h.xml", str(DUMP))
    return DUMP


def texts() -> list[str]:
    return [
        (n.attrib.get("text") or "").strip()
        for n in ET.parse(dump()).getroot().iter("node")
        if (n.attrib.get("text") or "").strip()
    ]


def has(needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts())


def bounds(node) -> tuple[int, int, int, int] | None:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))


def tap_xy(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def tap_contains(label: str) -> bool:
    want = label.lower()
    for n in ET.parse(dump()).getroot().iter("node"):
        t = ((n.attrib.get("text") or "") + " " + (n.attrib.get("content-desc") or "")).strip().lower()
        if want not in t:
            continue
        b = bounds(n)
        if not b:
            continue
        tap_xy((b[0] + b[2]) // 2, (b[1] + b[3]) // 2)
        return True
    return False


def edit_centers() -> list[tuple[int, int]]:
    pts = []
    for n in ET.parse(dump()).getroot().iter("node"):
        if "EditText" not in (n.attrib.get("class") or ""):
            continue
        b = bounds(n)
        if b:
            pts.append(((b[0] + b[2]) // 2, (b[1] + b[3]) // 2))
    return pts


def clear_field() -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(80):
        adb("shell", "input", "keyevent", "67")


def type_text(value: str) -> None:
    # Avoid clipboard — host clipboard may contain unrelated docs.
    esc = value.replace(" ", "%s").replace("@", "\\@")
    adb("shell", "input", "text", esc)


def shot() -> None:
    adb("shell", "screencap", "-p", "/sdcard/home_dash.png")
    adb("pull", "/sdcard/home_dash.png", str(OUT))


def main() -> None:
    adb("reverse", "tcp:8084", "tcp:8084")
    adb("shell", "am", "force-stop", "host.exp.exponent")
    time.sleep(1)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", URL)
    for _ in range(20):
        time.sleep(2)
        if has("Email") or has("Overview") or has("Sign In") or has("Continue"):
            break
    time.sleep(2)

    if has("Continue") and "developer menu" in " ".join(texts()).lower():
        tap_contains("Continue")
        time.sleep(2)
    if has("Open DevTools") or has("Toggle performance"):
        adb("shell", "input", "keyevent", "4")
        time.sleep(1.5)

    print("BOOT", texts()[:25])

    # Ensure login form
    for _ in range(3):
        if has("Email") and has("Password"):
            break
        if has("Sign in"):
            tap_contains("Sign in")
            time.sleep(1.5)

    eds = edit_centers()
    print("EDITS", len(eds), eds)
    if len(eds) < 2:
        print("NO_EDIT_FIELDS")
        shot()
        return

    # Email
    tap_xy(*eds[0])
    time.sleep(0.5)
    clear_field()
    type_text(EMAIL)
    time.sleep(0.5)
    adb("shell", "input", "keyevent", "4")  # hide keyboard
    time.sleep(0.8)

    # Password
    eds = edit_centers()
    print("EDITS2", len(eds), eds)
    if len(eds) < 2:
        # fallback: approximate password field below email
        tap_xy(eds[0][0] if eds else 540, (eds[0][1] + 250) if eds else 1462)
    else:
        tap_xy(*eds[1])
    time.sleep(0.5)
    clear_field()
    type_text(PASSWORD)
    time.sleep(0.4)

    # Dismiss keyboard then sign in
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.8)
    print("PRE_SIGNIN", texts()[:30])
    tap_contains("Sign In") or tap_contains("Sign in")
    time.sleep(12)

    for _ in range(5):
        ts = texts()
        print("WAIT", ts[:40])
        if has("Overview") or has("Farm snapshot") or has("Quick actions"):
            break
        if has("Could not sign in") or has("internet"):
            print("LOGIN_ERROR")
            break
        time.sleep(2)

    if not has("Overview"):
        tap_contains("Home")
        time.sleep(2)

    ts = texts()
    checks = {
        "overview": has("Overview"),
        "search": has("Search birds, batches, sheds"),
        "farm_snapshot": has("Farm snapshot"),
        "quick_actions": has("Quick actions"),
        "no_good_morning": not has("Good morning"),
        "no_hello": not any(t.lower().startswith("hello,") for t in ts),
        "vaccination_tasks": has("Vaccination tasks"),
        "live_birds": has("Live birds"),
        "farm_health_badge": any("farm health ·" in t.lower() or "farm health •" in t.lower() for t in ts),
    }
    print("CHECKS", json.dumps(checks))
    print("HOME_TEXTS", ts[:60])
    shot()
    adb("pull", "/sdcard/h.xml", str(OUT_XML))
    print("SCREENSHOT", OUT, OUT.exists(), OUT.stat().st_size if OUT.exists() else 0)


if __name__ == "__main__":
    main()
