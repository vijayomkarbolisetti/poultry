"""Open Expo home on emulator, login if needed, capture dashboard screenshot."""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
OUT = S / "home_dashboard_verify.png"
DUMP = S / "home_dashboard_verify.xml"
acct_path = S / "_emu_local_account.json"

if acct_path.exists():
    acct = json.loads(acct_path.read_text(encoding="utf-8"))
    EMAIL = acct["email"]
    PASSWORD = acct["password"]
else:
    EMAIL = os.environ.get("POULTRY_QA_EMAIL", "")
    PASSWORD = os.environ.get("POULTRY_QA_PASSWORD", "")


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump() -> Path:
    for _ in range(5):
        adb("shell", "uiautomator", "dump", "/sdcard/home_dash.xml")
        time.sleep(0.5)
        adb("pull", "/sdcard/home_dash.xml", str(DUMP))
        if DUMP.exists() and DUMP.stat().st_size > 100:
            return DUMP
        time.sleep(0.4)
    raise FileNotFoundError("uiautomator dump failed")


def shot() -> None:
    adb("shell", "screencap", "-p", "/sdcard/home_dash.png")
    adb("pull", "/sdcard/home_dash.png", str(OUT))


def texts(p: Path) -> list[str]:
    return [
        (n.attrib.get("text") or "").strip()
        for n in ET.parse(p).getroot().iter("node")
        if (n.attrib.get("text") or "").strip()
    ]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def tap_text(p: Path, label: str) -> bool:
    want = label.lower()
    for n in ET.parse(p).getroot().iter("node"):
        if n.attrib.get("clickable") != "true":
            continue
        t = (n.attrib.get("text") or "").strip().lower()
        d = (n.attrib.get("content-desc") or "").strip().lower()
        if want == t or want in t or want == d or want in d:
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
            if m:
                x = (int(m.group(1)) + int(m.group(3))) // 2
                y = (int(m.group(2)) + int(m.group(4))) // 2
                adb("shell", "input", "tap", str(x), str(y))
                return True
    return False


def edit_bounds(p: Path) -> list[tuple[int, int]]:
    pts: list[tuple[int, int]] = []
    for n in ET.parse(p).getroot().iter("node"):
        cls = n.attrib.get("class", "")
        if "EditText" not in cls:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if m:
            pts.append(((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2))
    return pts


def type_text(value: str) -> None:
    esc = value.replace(" ", "%s").replace("@", "\\@")
    adb("shell", "input", "text", esc)


def login_if_needed(p: Path) -> Path:
    if has(p, "Overview") or has(p, "Quick actions") or has(p, "Farm snapshot"):
        return p
    if not EMAIL or not PASSWORD:
        print("NO_CREDS_AND_NOT_HOME")
        return p
    # Navigate to sign-in if on welcome
    if has(p, "Sign in") or has(p, "Email"):
        tap_text(p, "Sign in")
        time.sleep(1.2)
        p = dump()
    eds = edit_bounds(p)
    if len(eds) >= 2:
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        time.sleep(0.3)
        adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
        for _ in range(40):
            adb("shell", "input", "keyevent", "67")
        type_text(EMAIL)
        time.sleep(0.3)
        adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
        time.sleep(0.3)
        for _ in range(40):
            adb("shell", "input", "keyevent", "67")
        type_text(PASSWORD)
        time.sleep(0.3)
        p = dump()
        if not tap_text(p, "Sign in"):
            tap_text(p, "Log in")
        time.sleep(4)
        p = dump()
    return p


def main() -> None:
    # Prefer Expo Go deep link via adb reverse port
    adb("shell", "am", "force-stop", "host.exp.exponent")
    time.sleep(0.5)
    adb(
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "exp://127.0.0.1:8084",
    )
    time.sleep(10)
    p = dump()
    print("BOOT_TEXTS", texts(p)[:25])
    p = login_if_needed(p)
    # Ensure Home tab
    if not has(p, "Overview"):
        tap_text(p, "Home")
        time.sleep(1.5)
        p = dump()
    print("HOME_TEXTS", texts(p)[:40])
    checks = {
        "overview": has(p, "Overview"),
        "search": has(p, "Search birds, batches, sheds"),
        "farm_snapshot": has(p, "Farm snapshot"),
        "quick_actions": has(p, "Quick actions"),
        "no_good_morning": not has(p, "Good morning"),
        "no_hello": not any(t.lower().startswith("hello,") for t in texts(p)),
        "vaccination_tasks": has(p, "Vaccination tasks"),
        "live_birds": has(p, "Live birds"),
    }
    print("CHECKS", json.dumps(checks))
    shot()
    print("SCREENSHOT", OUT if OUT.exists() else "MISSING")


if __name__ == "__main__":
    main()
