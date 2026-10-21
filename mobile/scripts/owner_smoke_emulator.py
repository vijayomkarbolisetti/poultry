"""Drive a minimal owner smoke path on emulator-5554 via adb + uiautomator dumps."""
from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ADB = "adb"
SERIAL = "emulator-5554"
SCRIPTS = Path(__file__).resolve().parent
OWNER = json.loads((SCRIPTS / "pilot-owner.json").read_text(encoding="utf-8"))
MISMATCH = json.loads((SCRIPTS / "pilot-mismatch.json").read_text(encoding="utf-8"))


def adb(*args: str) -> str:
    out = subprocess.check_output([ADB, "-s", SERIAL, *args], stderr=subprocess.STDOUT)
    return out.decode("utf-8", errors="replace")


def dump(name: str) -> Path:
    remote = f"/sdcard/{name}.xml"
    local = SCRIPTS / f"{name}.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(local))
    return local


def texts(path: Path) -> list[str]:
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def tap_text(path: Path, label: str) -> None:
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
        raise SystemExit(f"label not found: {label} in {path}")
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
    # Device-side single quotes preserve Expo Router group parentheses.
    url = f"exp://127.0.0.1:8082/--{path}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{url}'")
    time.sleep(4)


def main() -> None:
    print("=== Owner deep-link shed overview ===")
    open_url(f"/(app)/sheds/{OWNER['shedId']}")
    p = dump("owner_overview")
    t = texts(p)
    for line in t[:40]:
        print(repr(line))
    checks = {
        "HAS_PILOT_SHED": any(x == "Pilot Shed" for x in t),
        "HAS_ADD_BATCH": any(x == "Add Batch" for x in t),
        "HAS_VACCINATION_TASKS": any(x == "Vaccination Tasks" for x in t),
        "HAS_MISMATCH_WARN": any("Count mismatch" in x or "Data quality" in x for x in t),
        "HAS_MISMATCH_BATCH": any(x == "MISMATCH-UI" for x in t),
        "HAS_ASSIGN": any("Assign" in x for x in t) or any(x == "FARM MANAGEMENT" for x in t),
    }
    print("CHECKS", json.dumps(checks, indent=2))

    print("=== Open MISMATCH-UI batch detail ===")
    open_url(f"/(app)/flocks/{MISMATCH['flockId']}")
    p2 = dump("owner_mismatch_batch")
    t2 = texts(p2)
    for line in t2[:35]:
        print(repr(line))
    batch_checks = {
        "HAS_MISMATCH_DETAIL": any("Count mismatch" in x for x in t2),
        "HAS_ADD_HEN": any(x == "Add hen" for x in t2),
        "HAS_IMPORT": any(x == "Import bands" for x in t2),
        "BATCH_CODE": any(x == "MISMATCH-UI" for x in t2),
    }
    print("BATCH_CHECKS", json.dumps(batch_checks, indent=2))

    print("=== Add Batch preselected shed ===")
    open_url(f"/(app)/flocks/create?shedId={OWNER['shedId']}")
    p3 = dump("owner_create_batch")
    t3 = texts(p3)
    for line in t3[:30]:
        print(repr(line))
    print(
        "CREATE_CHECKS",
        json.dumps(
            {
                "HAS_CREATE_UI": any("batch" in x.lower() or "Batch" in x for x in t3),
                "LOCKED_OR_SHED": any("Pilot Shed" in x or "shed" in x.lower() for x in t3),
            },
            indent=2,
        ),
    )

    print("=== Vaccination tasks shed scoped ===")
    open_url(f"/(app)/doses?shedId={OWNER['shedId']}")
    p4 = dump("owner_doses")
    t4 = texts(p4)
    for line in t4[:25]:
        print(repr(line))
    print(
        "DOSES_CHECKS",
        json.dumps(
            {
                "HAS_TASKS_TITLE": any("Vaccination tasks" in x for x in t4),
                "SHED_SCOPE": any("this shed" in x.lower() for x in t4),
            },
            indent=2,
        ),
    )


if __name__ == "__main__":
    main()
