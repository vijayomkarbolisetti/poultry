"""Login on emulator, open Sheds tab, capture screenshot for visual QA."""
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
DUMP = S / "_tmp_sheds.xml"
OUT = S / "sheds_screen_verify.png"
OUT_XML = S / "sheds_screen_verify.xml"
EMAIL = "pilot-owner-211956487@example.com"
PASSWORD = "password123"
URL = "exp://127.0.0.1:8084"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump() -> Path:
    adb("shell", "uiautomator", "dump", "/sdcard/sheds.xml")
    adb("pull", "/sdcard/sheds.xml", str(DUMP))
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


def tap_contains(label: str, *, exact: bool = False, y_min: int | None = None) -> bool:
    want = label.lower()
    for n in ET.parse(dump()).getroot().iter("node"):
        text = (n.attrib.get("text") or "").strip()
        desc = (n.attrib.get("content-desc") or "").strip()
        blob = f"{text} {desc}".strip().lower()
        if exact:
            if text.lower() != want and desc.lower() != want:
                continue
        elif want not in blob:
            continue
        b = bounds(n)
        if not b:
            continue
        if y_min is not None and b[1] < y_min:
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
    esc = value.replace(" ", "%s").replace("@", "\\@")
    adb("shell", "input", "text", esc)


def shot() -> None:
    adb("shell", "screencap", "-p", "/sdcard/sheds_verify.png")
    adb("pull", "/sdcard/sheds_verify.png", str(OUT))


def login_if_needed() -> None:
    if has("Overview") or has("Sheds") and has("Search, filter"):
        return
    for _ in range(3):
        if has("Email") and has("Password"):
            break
        if has("Sign in"):
            tap_contains("Sign in")
            time.sleep(1.5)
    eds = edit_centers()
    print("EDITS", len(eds), eds)
    if len(eds) < 2:
        return
    tap_xy(*eds[0])
    time.sleep(0.4)
    clear_field()
    type_text(EMAIL)
    time.sleep(0.4)
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.6)
    eds = edit_centers()
    if len(eds) >= 2:
        tap_xy(*eds[1])
    else:
        tap_xy(eds[0][0] if eds else 540, (eds[0][1] + 250) if eds else 1462)
    time.sleep(0.4)
    clear_field()
    type_text(PASSWORD)
    time.sleep(0.3)
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.6)
    tap_contains("Sign In") or tap_contains("Sign in")
    time.sleep(10)


def main() -> None:
    adb("reverse", "tcp:8084", "tcp:8084")
    adb("reverse", "tcp:8002", "tcp:8002")
    adb("shell", "am", "force-stop", "host.exp.exponent")
    time.sleep(1)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", URL)
    for _ in range(22):
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
    login_if_needed()

    for _ in range(8):
        if has("Overview") or has("Farm snapshot") or has("Search, filter"):
            break
        time.sleep(2)

    # Open Sheds tab — exact label near bottom (avoid Home search placeholder "…sheds…")
    tapped = tap_contains("Sheds", exact=True, y_min=1800)
    if not tapped:
        tapped = tap_contains("Sheds", exact=True, y_min=1400)
    print("TAP_SHEDS", tapped)
    time.sleep(5)

    for _ in range(8):
        ts = texts()
        print("WAIT", ts[:40])
        if has("Search, filter") or has("Search by name") or has("Total sheds"):
            break
        time.sleep(2)
        tap_contains("Sheds", exact=True, y_min=1400)
        time.sleep(2)

    ts = texts()
    root = ET.parse(dump()).getroot()
    descs = [(n.attrib.get("content-desc") or "").lower() for n in root.iter("node")]

    checks = {
        "title_sheds": any(t == "Sheds" for t in ts),
        "subtitle": has("Search, filter, and open a shed overview"),
        "search_placeholder": has("Search by name or code"),
        "no_visible_mode_chips": not has("All modes") and not has("All status"),
        "no_sort_control": not has("Name (A") and not has("Name (A–Z)") and not has("Name (A-Z)"),
        "total_sheds": has("Total sheds"),
        "active_sheds": has("Active sheds"),
        "add_shed_a11y": any("add shed" in d for d in descs),
        "open_filters_a11y": any("open filters" in d for d in descs),
        "no_large_add_label": not any(t.strip().lower() == "add shed" for t in ts),
        "no_greeting": not has("Good morning") and not any(t.lower().startswith("hello") for t in ts),
        "live_birds_metric": has("Live birds"),
        "banded": has("Banded"),
        "unbanded": has("Unbanded"),
        "dose_tasks": has("Dose tasks"),
    }

    # Open filter sheet and confirm ownership/status options live there
    opened = False
    for n in ET.parse(dump()).getroot().iter("node"):
        d = (n.attrib.get("content-desc") or "").lower()
        if "open filters" in d:
            b = bounds(n)
            if b:
                tap_xy((b[0] + b[2]) // 2, (b[1] + b[3]) // 2)
                opened = True
                break
    time.sleep(1.5)
    sheet_ts = texts()
    checks["filter_sheet_opened"] = opened and has("Filters")
    checks["sheet_all_modes"] = "All modes" in sheet_ts or has("All modes")
    checks["sheet_owner"] = has("Owner")
    checks["sheet_farmer"] = has("Farmer")
    checks["sheet_active"] = any(t == "Active" for t in sheet_ts)
    checks["sheet_inactive"] = has("Inactive")
    checks["sheet_all_status"] = has("All status")
    checks["sheet_apply"] = has("Apply")
    checks["sheet_reset"] = has("Reset")

    # Close sheet via backdrop/back before screenshot of main list
    adb("shell", "input", "keyevent", "4")
    time.sleep(1.2)

    print("CHECKS", json.dumps(checks, indent=2))
    print("SHEDS_TEXTS", ts[:80])
    shot()
    adb("shell", "uiautomator", "dump", "/sdcard/sheds.xml")
    adb("pull", "/sdcard/sheds.xml", str(OUT_XML))
    print("SCREENSHOT", OUT, OUT.exists(), OUT.stat().st_size if OUT.exists() else 0)
    failed = [k for k, v in checks.items() if not v]
    print("FAILED", failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
