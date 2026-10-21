"""Quick emulator login + screenshots for QA report (preview APK)."""
from __future__ import annotations

import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
EMAIL = "pilot-owner-211956487@example.com"
PASSWORD = "password123"
OUT = Path(__file__).resolve().parent.parent / "docs" / "qa-screenshots"
OUT.mkdir(parents=True, exist_ok=True)
TMP = OUT / "_tmp_ui.xml"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump() -> ET.Element:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    adb("pull", "/sdcard/ui.xml", str(TMP))
    return ET.parse(TMP).getroot()


def shot(name: str) -> None:
    remote = f"/sdcard/{name}"
    adb("shell", "screencap", "-p", remote)
    adb("pull", remote, str(OUT / name))
    print("saved", OUT / name)


def bounds(node: ET.Element) -> tuple[int, int, int, int] | None:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if not m:
        return None
    return tuple(map(int, m.groups()))  # type: ignore[return-value]


def tap_xy(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def edit_centers(root: ET.Element) -> list[tuple[int, int]]:
    pts: list[tuple[int, int]] = []
    for n in root.iter("node"):
        if "EditText" not in (n.attrib.get("class") or ""):
            continue
        b = bounds(n)
        if b:
            pts.append(((b[0] + b[2]) // 2, (b[1] + b[3]) // 2))
    return pts


def tap_text(root: ET.Element, label: str) -> bool:
    want = label.lower()
    for n in root.iter("node"):
        blob = f"{n.attrib.get('text') or ''} {n.attrib.get('content-desc') or ''}".lower()
        if want not in blob:
            continue
        b = bounds(n)
        if not b:
            continue
        tap_xy((b[0] + b[2]) // 2, (b[1] + b[3]) // 2)
        return True
    return False


def texts(root: ET.Element) -> list[str]:
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def main() -> None:
    adb("shell", "am", "start", "-n", "com.vijayomkar.poultrytracker/.MainActivity")
    time.sleep(3)
    root = dump()
    shot("01-login.png")
    print("texts:", texts(root)[:20])
    edits = edit_centers(root)
    if len(edits) < 2:
        print("FAIL: need email/password fields")
        return
    # Email
    tap_xy(*edits[0])
    time.sleep(0.3)
    adb("shell", "input", "keyevent", "KEYCODE_CTRL_A")
    adb("shell", "input", "text", EMAIL.replace("@", "\\@"))
    time.sleep(0.4)
    # Password
    tap_xy(*edits[1])
    time.sleep(0.3)
    adb("shell", "input", "text", PASSWORD)
    time.sleep(0.4)
    root = dump()
    if not tap_text(root, "Sign In"):
        print("FAIL: Sign In not found")
        return
    time.sleep(6)
    root = dump()
    shot("02-after-login.png")
    print("after login:", texts(root)[:30])
    # Try Sheds tab
    if tap_text(root, "Sheds"):
        time.sleep(3)
        root = dump()
        shot("03-sheds.png")
        print("sheds:", texts(root)[:30])
        # Open first shed-looking row if any non-tab text
        for label in texts(root):
            if label in {"Sheds", "Home", "Batches", "More", "Tasks"}:
                continue
            if len(label) < 2:
                continue
            if tap_text(root, label):
                time.sleep(3)
                root = dump()
                shot("04-shed-overview.png")
                print("overview:", texts(root)[:40])
                break


if __name__ == "__main__":
    main()
