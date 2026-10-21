import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
SHED = "6f5bda54-9468-475a-9295-2b03b90a7e49"


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


def has(p, s):
    s = s.lower()
    return any(s in t.lower() for t in texts(p))


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


adb(
    "shell",
    f"am start -a android.intent.action.VIEW -d 'exp://10.0.2.2:8082/--/(app)/sheds/{SHED}'",
)
time.sleep(5)
p = dump("fa_shed")
for _ in range(12):
    if has(p, "Select"):
        break
    adb("shell", "input", "swipe", "800", "1700", "800", "650", "350")
    time.sleep(0.4)
    p = dump("fa_shed")
print("SELECT_VISIBLE", has(p, "Select"))
tap_exact(p, "Select")
time.sleep(1.2)
p = dump("fa_sel")
print("MODE", [t for t in texts(p) if "elect" in t.lower() or t.lower().startswith("record")])
tap_exact(p, "Select all loaded") or tap_exact(p, "Select all")
time.sleep(1.2)
p = dump("fa_all")
adb("shell", "screencap", "-p", "/sdcard/fa_all.png")
adb("pull", "/sdcard/fa_all.png", str(S / "fa_all.png"))
print("ACTIONS", [t for t in texts(p) if t.lower().startswith("record ") or "selected" in t.lower()])
print("HARD_DELETE", any(t.lower() == "delete" for t in texts(p)))
print("ALL_SEL_TEXTS", [t for t in texts(p) if "elect" in t.lower() or "record" in t.lower() or "batch" in t.lower()][:20])
