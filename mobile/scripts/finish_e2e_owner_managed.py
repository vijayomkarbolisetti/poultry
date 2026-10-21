"""Finish E2E: verify no orphan KP shed + owner-managed create on emulator."""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8001"
S = Path(__file__).resolve().parent
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
STAMP = "345316"


def adb(*a, check=True):
    p = subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(p.stdout + p.stderr)
    return (p.stdout or "") + (p.stderr or "")


def dump(n: str) -> Path:
    remote = f"/sdcard/{n}.xml"
    local = S / f"{n}.xml"
    for _ in range(3):
        adb("shell", "uiautomator", "dump", remote, check=False)
        time.sleep(0.3)
        adb("pull", remote, str(local), check=False)
        if local.exists() and local.stat().st_size > 100:
            return local
        time.sleep(0.8)
    raise RuntimeError("dump fail")


def texts(path: Path):
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def has(path, needle):
    return any(needle.lower() in t.lower() for t in texts(path))


def edit_texts(path):
    root = ET.parse(path).getroot()
    out = []
    for n in root.iter("node"):
        if n.attrib.get("class", "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            out.append(
                ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            )
    return out


def tap(x, y):
    adb("shell", "input", "tap", str(x), str(y))


def tap_label(path, label):
    root = ET.parse(path).getroot()
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
    target = None
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t == label or label in t:
            target = n
            break
    if target is None:
        raise RuntimeError(f"missing {label}")
    cur = target
    while cur is not None:
        if cur.attrib.get("clickable") == "true":
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
            tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            return
        cur = parent.get(cur)
    raise RuntimeError("nc")


def clear():
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(30):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill(x, y, v):
    tap(x, y)
    time.sleep(0.25)
    clear()
    adb("shell", "input", "text", v.replace("@", "\\@").replace(" ", "%s"))
    time.sleep(0.2)
    tap(800, 120)
    time.sleep(0.25)


def toggle(path):
    root = ET.parse(path).getroot()
    switches = [
        n
        for n in root.iter("node")
        if "Switch" in (n.attrib.get("class") or "") or n.attrib.get("checkable") == "true"
    ]
    b = switches[-1].attrib["bounds"]
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
    tap((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
    time.sleep(1.4)


def api(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main():
    results = []

    def log(step, ok, detail=""):
        results.append({"step": step, "ok": ok, "detail": detail})
        print(("PASS" if ok else "FAIL"), "-", step, "-", detail[:180])

    st, login = api(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    oh = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }
    _, sheds = api("GET", "/api/v1/sheds", headers=oh)
    log(
        "no orphan KP5316 shed after failed farmer",
        not any(s["code"] in {"KP5316", "kp5316"} for s in sheds),
        str([s["code"] for s in sheds if "KP" in s["code"] or "E2" in s["code"] or "OM" in s["code"]]),
    )

    # Owner-managed create
    adb(
        "shell",
        "am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082/--/(app)/sheds/create'",
    )
    time.sleep(4)
    p = dump("om0")
    eds = edit_texts(p)
    omc = f"OM{STAMP[-4:]}"
    fill(eds[0][0], eds[0][1], f"OwnerOnly{STAMP}")
    fill(eds[1][0], eds[1][1], omc)
    p = dump("om1")
    for _ in range(2):
        if has(p, "Assigned farmer"):
            toggle(p)
            p = dump("omt")
        else:
            break
    log("owner-managed hides farmer section", not has(p, "Assigned farmer"), str(texts(p)[:14]))
    tap_label(p, "Create shed")
    time.sleep(6)
    p = dump("omdone")
    log(
        "owner-managed overview navigation",
        has(p, "Shed overview") or has(p, f"OwnerOnly{STAMP}") or has(p, omc),
        str(texts(p)[:16]),
    )
    _, sheds3 = api("GET", "/api/v1/sheds", headers=oh)
    om = next((s for s in sheds3 if s["code"] in {omc, omc.upper()}), None)
    log(
        "owner-managed API",
        om is not None and om.get("is_owner_managed") is True,
        str(om)[:180] if om else "",
    )
    if om:
        _, oa = api("GET", f"/api/v1/sheds/{om['id']}/assignments", headers=oh)
        log("owner-managed zero assignments", oa == [], str(oa))

    out = {
        "pass": sum(1 for r in results if r["ok"]),
        "fail": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    (S / "e2e_new_shed_finish.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("FINISH", out["pass"], "pass /", out["fail"], "fail")


if __name__ == "__main__":
    main()
