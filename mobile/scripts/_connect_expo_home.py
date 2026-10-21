"""Connect Expo Go to local Metro and capture home dashboard."""
from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
S = Path(__file__).resolve().parent
DUMP = S / "_tmp_h.xml"
OUT = S / "home_dashboard_verify.png"
OUT_XML = S / "home_dashboard_verify.xml"
URL = "exp://127.0.0.1:8084"
acct = json.loads((S / "_emu_local_account.json").read_text(encoding="utf-8"))
EMAIL = acct["email"]
PASSWORD = acct["password"]


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump() -> Path:
    adb("shell", "uiautomator", "dump", "/sdcard/h.xml")
    adb("pull", "/sdcard/h.xml", str(DUMP))
    return DUMP


def shot() -> None:
    adb("shell", "screencap", "-p", "/sdcard/home_dash.png")
    adb("pull", "/sdcard/home_dash.png", str(OUT))


def texts() -> list[str]:
    return [
        (n.attrib.get("text") or "").strip()
        for n in ET.parse(dump()).getroot().iter("node")
        if (n.attrib.get("text") or "").strip()
    ]


def has(needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts())


def tap_contains(label: str) -> bool:
    want = label.lower()
    root = ET.parse(dump()).getroot()
    for n in root.iter("node"):
        t = ((n.attrib.get("text") or "") + " " + (n.attrib.get("content-desc") or "")).strip().lower()
        if want not in t:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if not m:
            continue
        x = (int(m.group(1)) + int(m.group(3))) // 2
        y = (int(m.group(2)) + int(m.group(4))) // 2
        adb("shell", "input", "tap", str(x), str(y))
        return True
    return False


def tap_edit(index: int = 0) -> bool:
    eds = []
    for n in ET.parse(dump()).getroot().iter("node"):
        if "EditText" not in (n.attrib.get("class") or ""):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if m:
            eds.append(((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2))
    if index >= len(eds):
        return False
    x, y = eds[index]
    adb("shell", "input", "tap", str(x), str(y))
    return True


def clear_field() -> None:
    for _ in range(50):
        adb("shell", "input", "keyevent", "67")


def type_text(value: str) -> None:
    esc = value.replace(" ", "%s").replace("@", "\\@")
    adb("shell", "input", "text", esc)


def dismiss_compat() -> None:
    if has("16 KB") or has("Don't Show Again"):
        tap_contains("Don't Show Again") or tap_contains("OK")
        time.sleep(1)


def connect_metro() -> None:
    adb("reverse", "tcp:8084", "tcp:8084")
    adb("shell", "am", "force-stop", "host.exp.exponent")
    time.sleep(0.8)
    adb("shell", "monkey", "-p", "host.exp.exponent", "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(5)
    dismiss_compat()
    # Prefer deep link
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", URL)
    time.sleep(8)
    if has("Overview") or has("Sign In") or has("Email") or has("PoultryTrack"):
        return
    # Manual URL entry
    if has("Enter URL manually"):
        tap_contains("Enter URL manually")
        time.sleep(1.2)
        tap_edit(0)
        time.sleep(0.3)
        clear_field()
        type_text(URL)
        time.sleep(0.4)
        tap_contains("Connect to URL") or tap_contains("Connect") or tap_contains("Go")
        time.sleep(12)


def login_if_needed() -> None:
    if has("Overview") or has("Farm snapshot") or has("Quick actions"):
        return
    if has("Sign in") and not has("Email"):
        tap_contains("Sign in")
        time.sleep(1.5)
    if not has("Email") and not has("Password"):
        return
    tap_edit(0)
    time.sleep(0.3)
    clear_field()
    type_text(EMAIL)
    time.sleep(0.3)
    tap_edit(1)
    time.sleep(0.3)
    clear_field()
    type_text(PASSWORD)
    time.sleep(0.3)
    tap_contains("Sign In") or tap_contains("Sign in") or tap_contains("Log in")
    time.sleep(6)


def main() -> None:
    connect_metro()
    print("AFTER_CONNECT", texts()[:35])
    login_if_needed()
    if not has("Overview"):
        tap_contains("Home")
        time.sleep(1.5)
    ts = texts()
    print("HOME_TEXTS", ts[:45])
    checks = {
        "overview": has("Overview"),
        "search": has("Search birds, batches, sheds"),
        "farm_snapshot": has("Farm snapshot"),
        "quick_actions": has("Quick actions"),
        "no_good_morning": not has("Good morning"),
        "no_hello": not any(t.lower().startswith("hello,") for t in ts),
        "vaccination_tasks": has("Vaccination tasks"),
        "live_birds": has("Live birds"),
        "farm_health": has("Farm health"),
    }
    print("CHECKS", json.dumps(checks))
    shot()
    adb("pull", "/sdcard/h.xml", str(OUT_XML))
    print("SCREENSHOT", OUT if OUT.exists() else "MISSING")


if __name__ == "__main__":
    main()
