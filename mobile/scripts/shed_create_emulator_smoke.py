"""Emulator smoke: New Shed owner-managed vs farmer-managed + Add Farmer modal."""
from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
SCRIPTS = Path(__file__).resolve().parent
OWNER = json.loads((SCRIPTS / "pilot-owner.json").read_text(encoding="utf-8"))


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
        raise SystemExit(f"label not found: {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            assert m
            x = (int(m.group(1)) + int(m.group(3))) // 2
            y = (int(m.group(2)) + int(m.group(4))) // 2
            adb("shell", "input", "tap", str(x), str(y))
            return
        cur = parent.get(cur)
    raise SystemExit(f"no clickable for {label}")


def open_url(path: str) -> None:
    url = f"exp://127.0.0.1:8082/--{path}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{url}'")
    time.sleep(4)


def main() -> None:
    print("=== Open New Shed (expect owner session) ===")
    open_url("/(app)/sheds/create")
    p = dump("shed_create_om")
    t = texts(p)
    for line in t[:40]:
        print(repr(line))
    checks = {
        "HAS_OWNER_MANAGED": any("Owner-managed" in x for x in t),
        "HAS_CREATE": any(x == "Create shed" for x in t),
        "HAS_FARMER_SELECTOR": any(x == "Assigned farmer" or "Assigned farmer" in x for x in t),
        "HAS_ADD_FARMER": any("+ Add Farmer" in x or x == "+ Add Farmer" for x in t),
    }
    print("OWNER_MANAGED_DEFAULT", json.dumps(checks, indent=2))

    # Toggle off owner-managed — find Switch near Owner-managed. Prefer tapping switch via bounds.
    # Heuristic: look for clickable with Switch class
    root = ET.parse(p).getroot()
    switches = [
        n
        for n in root.iter("node")
        if "Switch" in (n.attrib.get("class") or "") or n.attrib.get("checkable") == "true"
    ]
    if switches:
        b = switches[-1].attrib["bounds"]
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
        assert m
        x = (int(m.group(1)) + int(m.group(3))) // 2
        y = (int(m.group(2)) + int(m.group(4))) // 2
        print("toggle switch", x, y)
        adb("shell", "input", "tap", str(x), str(y))
        time.sleep(2)
    p2 = dump("shed_create_fm")
    t2 = texts(p2)
    for line in t2[:45]:
        print(repr(line))
    fm_checks = {
        "HAS_ASSIGNED_FARMER": any("Assigned farmer" in x for x in t2),
        "HAS_ADD_FARMER": any("Add Farmer" in x for x in t2),
        "HAS_HELPER": any("responsible for managing" in x for x in t2),
        "CREATE_DISABLED_HINT": any(x == "Create shed" for x in t2),
    }
    print("FARMER_MANAGED", json.dumps(fm_checks, indent=2))

    if any("Add Farmer" in x for x in t2):
        tap_label(p2, "+ Add Farmer")
        time.sleep(2)
        p3 = dump("shed_add_farmer_modal")
        t3 = texts(p3)
        print("=== Add Farmer modal ===")
        for line in t3[:30]:
            print(repr(line))
        print(
            "MODAL",
            json.dumps(
                {
                    "HAS_ADD_TITLE": any(x == "Add farmer" for x in t3),
                    "HAS_EMAIL": any(x == "Email" for x in t3),
                    "HAS_CREATE_FARMER": any(x == "Create farmer" for x in t3),
                    "HAS_CLOSE": any(x == "Close" for x in t3),
                },
                indent=2,
            ),
        )
        if any(x == "Close" for x in t3):
            tap_label(p3, "Close")
            time.sleep(1)
            p4 = dump("shed_after_modal_close")
            t4 = texts(p4)
            print(
                "PRESERVED",
                json.dumps(
                    {
                        "STILL_CREATE_SHED": any(x == "Create shed" for x in t4),
                        "STILL_FARMER_SECTION": any("Assigned farmer" in x for x in t4),
                    },
                    indent=2,
                ),
            )


if __name__ == "__main__":
    main()
