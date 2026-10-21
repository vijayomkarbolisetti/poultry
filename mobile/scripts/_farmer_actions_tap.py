import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"


def adb(*a):
    subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump(n):
    adb("shell", "uiautomator", "dump", f"/sdcard/{n}.xml")
    time.sleep(0.3)
    d = S / f"{n}.xml"
    adb("pull", f"/sdcard/{n}.xml", str(d))
    return d


def texts(p):
    return [(n.attrib.get("text") or "").strip() for n in ET.parse(p).getroot().iter("node") if (n.attrib.get("text") or "").strip()]


def tap_exact(p, label):
    parent = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    for n in root.iter("node"):
        if (n.attrib.get("text") or "").strip() != label:
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
                return True
            cur = parent.get(cur)
    return False


p = dump("fa_ready")
assert tap_exact(p, "Select all loaded"), "missing Select all loaded"
time.sleep(1.5)
p = dump("fa_selected")
adb("shell", "screencap", "-p", "/sdcard/fa_selected.png")
adb("pull", "/sdcard/fa_selected.png", str(S / "fa_selected.png"))
ts = texts(p)
actions = [t for t in ts if t.lower().startswith("record ")]
selected = [t for t in ts if "selected" in t.lower()]
hard = any(t.lower() == "delete" for t in ts)
out = {
    "actions": actions,
    "selected_copy": selected,
    "hard_delete": hard,
    "passed_actions": bool(actions)
    and all(a.lower() in ("record mortality", "record sale", "record transfer") for a in actions)
    and not hard,
    "artifact": "mobile/scripts/fa_selected.png",
}
(S / "shed_birds_farmer_actions.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
print(json.dumps(out, indent=2))
