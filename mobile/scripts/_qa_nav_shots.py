"""Navigate Expo Home → Sheds → Overview and capture QA screenshots."""
from __future__ import annotations

import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
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
    print("saved", name, (OUT / name).stat().st_size)


def bounds(node: ET.Element) -> tuple[int, int, int, int] | None:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
    if not m:
        return None
    return tuple(map(int, m.groups()))  # type: ignore[return-value]


def texts(root: ET.Element) -> list[str]:
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def tap_exact(root: ET.Element, label: str) -> bool:
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip().lower()
        if t != want:
            continue
        b = bounds(n)
        if not b:
            continue
        adb("shell", "input", "tap", str((b[0] + b[2]) // 2), str((b[1] + b[3]) // 2))
        return True
    return False


def tap_contains(root: ET.Element, label: str) -> bool:
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip().lower()
        if want not in t or not t:
            continue
        b = bounds(n)
        if not b:
            continue
        # Prefer larger nodes (list rows)
        if (b[2] - b[0]) < 80:
            continue
        adb("shell", "input", "tap", str((b[0] + b[2]) // 2), str((b[1] + b[3]) // 2))
        return True
    return False


def main() -> None:
    root = dump()
    print("start:", texts(root)[:25])
    assert "Tasks" not in texts(root), "Tasks tab should be hidden"
    shot("02-home.png")

    assert tap_exact(root, "Sheds"), "Sheds tab missing"
    time.sleep(3)
    root = dump()
    print("sheds:", texts(root)[:35])
    shot("03-sheds-list.png")

    # Open first shed card: look for a code-like or named row excluding chrome
    skip = {
        "sheds",
        "home",
        "batches",
        "more",
        "search",
        "active",
        "inactive",
        "all",
        "create shed",
        "new shed",
        "tools",
        "poultrytrack",
    }
    opened = False
    for t in texts(root):
        tl = t.lower().strip()
        if tl in skip or len(t) < 2:
            continue
        if any(x in tl for x in ("live", "bird", "farmer", "group", "batch", "filter", "sort")):
            continue
        if tap_contains(root, t):
            opened = True
            print("opened row:", t)
            break
    if not opened:
        print("WARN: could not open a shed row")
        return
    time.sleep(3)
    root = dump()
    print("overview:", texts(root)[:45])
    shot("04-shed-overview.png")

    # Add birds / Groups / Birds if present
    for label, fname in [
        ("Add birds", "05-add-birds-sheet.png"),
        ("Groups", "06-groups.png"),
        ("Birds", "07-birds.png"),
    ]:
        if tap_exact(root, label) or tap_contains(root, label):
            time.sleep(2)
            root = dump()
            print(label, ":", texts(root)[:30])
            shot(fname)
            # back
            adb("shell", "input", "keyevent", "KEYCODE_BACK")
            time.sleep(1.5)
            root = dump()


if __name__ == "__main__":
    main()
