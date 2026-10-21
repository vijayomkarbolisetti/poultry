"""Confirm farmer batch detail hides bird.create / lifecycle actions."""
from __future__ import annotations

import json
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
SCRIPTS = Path(__file__).resolve().parent
FARMER = json.loads((SCRIPTS / "pilot-farmer.json").read_text(encoding="utf-8"))


def adb(*args: str) -> None:
    subprocess.check_call(["adb", "-s", SERIAL, *args])


def dump(name: str) -> Path:
    remote = f"/sdcard/{name}.xml"
    local = SCRIPTS / f"{name}.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(local))
    return local


def texts(path: Path) -> list[str]:
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def main() -> None:
    url = f"exp://127.0.0.1:8082/--/(app)/flocks/{FARMER['flockId']}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{url}'")
    time.sleep(5)
    t = texts(dump("farmer_batch_perms"))
    for line in t[:40]:
        print(repr(line))
    print(
        json.dumps(
            {
                "HAS_ADD_HEN": any(x == "Add hen" for x in t),
                "HAS_IMPORT": any(x == "Import bands" for x in t),
                "HAS_LIFECYCLE_SECTION": any(x == "LIFECYCLE EVENT DEFAULTS" for x in t),
                "HAS_BATCH": any("PILOT-B1" in x for x in t),
                "DENIED": any("denied" in x.lower() or "not found" in x.lower() for x in t),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
