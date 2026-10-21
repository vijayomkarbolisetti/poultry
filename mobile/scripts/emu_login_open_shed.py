"""Emulator login + open shed. Uses _emu_local_account.json or env creds."""
from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
acct_path = S / "_emu_local_account.json"
if acct_path.exists():
    acct = json.loads(acct_path.read_text(encoding="utf-8"))
    EMAIL = acct["email"]
    PASSWORD = acct["password"]
    WANT_NAME = acct["shed_name"]
    WANT_CODE = acct["shed_code"]
else:
    import os

    EMAIL = os.environ["POULTRY_QA_EMAIL"]
    PASSWORD = os.environ["POULTRY_QA_PASSWORD"]
    WANT_NAME = "QA-SHED"
    WANT_CODE = "QA"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump(name: str) -> Path:
    for _ in range(4):
        adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
        time.sleep(0.6)
        dest = S / f"{name}.xml"
        pull = adb("pull", f"/sdcard/{name}.xml", str(dest))
        if dest.exists() and dest.stat().st_size > 100:
            return dest
        time.sleep(0.5)
    raise FileNotFoundError(f"uiautomator dump failed: {name}")


def shot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))


def texts(p: Path) -> list[str]:
    return [
        (n.attrib.get("text") or "").strip()
        for n in ET.parse(p).getroot().iter("node")
        if (n.attrib.get("text") or "").strip()
    ]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def tap_desc_or_text(p: Path, label: str) -> bool:
    parent: dict = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    # Prefer clickable content-desc / text equals
    for n in root.iter("node"):
        if n.attrib.get("clickable") != "true":
            continue
        d = (n.attrib.get("content-desc") or "").strip().lower()
        t = (n.attrib.get("text") or "").strip().lower()
        if d == want or t == want or d.endswith(", " + want) or want in d:
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
            if m:
                adb(
                    "shell",
                    "input",
                    "tap",
                    str((int(m.group(1)) + int(m.group(3))) // 2),
                    str((int(m.group(2)) + int(m.group(4))) // 2),
                )
                return True
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip().lower()
        if want not in t:
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib.get("bounds", ""))
                if m:
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


def edit_centers(p: Path) -> list[tuple[int, int]]:
    out = []
    for n in ET.parse(p).getroot().iter("node"):
        if not (n.attrib.get("class") or "").endswith("EditText"):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if m:
            out.append(((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2))
    return out


def type_text(raw: str) -> None:
    esc = raw.replace(" ", "%s").replace("@", r"\@")
    adb("shell", "input", "text", esc)


def clear_field(n: int = 50) -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(n):
        adb("shell", "input", "keyevent", "67")


def main() -> None:
    time.sleep(3)
    p = dump("emu_login")
    shot("emu_login")
    print("start", texts(p)[:10])

    if has(p, "Sign In") or has(p, "Email"):
        eds = edit_centers(p)
        if len(eds) >= 2:
            adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
            clear_field(80)
            type_text(EMAIL)
            time.sleep(0.2)
            p = dump("emu_e")
            eds = edit_centers(p)
            adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
            clear_field(40)
            type_text(PASSWORD)
            adb("shell", "input", "keyevent", "4")
            time.sleep(0.3)
            p = dump("emu_filled")
            if not tap_desc_or_text(p, "Sign In"):
                print("no_signin_btn")
                return
            time.sleep(6)
            p = dump("emu_home")
            shot("emu_home")
            print("home", texts(p)[:14])

    if not (has(p, "Hello") or has(p, "Sheds") or has(p, "Live birds")):
        print("RESULT LOGIN_FAIL")
        return

    if not tap_desc_or_text(p, "Sheds"):
        # tablet: try mid-bottom tabs
        adb("shell", "input", "tap", "900", "1500")
    time.sleep(3)
    p = dump("emu_sheds")
    shot("emu_sheds")
    print("sheds", texts(p)[:18])

    if not tap_desc_or_text(p, WANT_NAME):
        tap_desc_or_text(p, "Open shed")
    time.sleep(4)
    p = dump("emu_overview")
    shot("emu_overview")
    ts = texts(p)
    print("overview", ts[:22])
    joined = " ".join(ts)
    bad = "not found" in joined.lower() or "access denied" in joined.lower()
    good = WANT_NAME in joined or WANT_CODE in joined
    print("RESULT", "FAIL_NOT_FOUND" if bad else ("PASS" if good else "UNKNOWN"))


if __name__ == "__main__":
    main()
