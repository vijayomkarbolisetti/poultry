"""Re-check inactive overview UI after focus-refetch fix. Uses quoted deep links."""
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
SID = "a127d7e3-25e6-485e-a8de-7e1fb90a2dc8"


def adb(*a, check=True):
    p = subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(p.stdout + p.stderr)
    return (p.stdout or "") + (p.stderr or "")


def deep_link(path: str):
    # Device-side quotes protect Expo route parentheses from the Android shell.
    url = f"exp://127.0.0.1:8082/--/{path}"
    adb("shell", f"am start -a android.intent.action.VIEW -d '{url}'")


def dump(n: str) -> Path:
    remote = f"/sdcard/{n}.xml"
    local = S / f"{n}.xml"
    for _ in range(3):
        adb("shell", "uiautomator", "dump", remote, check=False)
        time.sleep(0.35)
        adb("pull", remote, str(local), check=False)
        if local.exists() and local.stat().st_size > 80:
            return local
        time.sleep(0.6)
    raise RuntimeError("dump fail")


def texts(path: Path):
    root = ET.parse(path).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def has(path: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(path))


def tap_label(path: Path, label: str):
    root = ET.parse(path).getroot()
    parent = {}
    for p in root.iter("node"):
        for c in list(p):
            parent[c] = p
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
                return
            cur = parent.get(cur)
    raise RuntimeError(f"missing {label}")


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
    st, login = api(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    assert st == 200, login
    oh = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }

    api("POST", f"/api/v1/sheds/{SID}/deactivate", headers=oh)
    deep_link(f"(app)/sheds/{SID}")
    time.sleep(6)
    p = dump("fix_inactive_ov")
    inactive_ui = {
        "has_inactive_label": has(p, "Inactive") or has(p, "inactive"),
        "has_reactivate": has(p, "Reactivate"),
        "has_deactivate": has(p, "Deactivate"),
        "has_add_batch": has(p, "Add Batch"),
        "sample": texts(p)[:22],
    }
    print("INACTIVE_UI", inactive_ui)

    deep_link("(app)/sheds")
    time.sleep(4)
    p = dump("fix_list")
    tap_label(p, "Inactive")
    time.sleep(3)
    p = dump("fix_inactive_list")
    inactive_list = {
        "has_shed": has(p, "VerifyShed235435Edit") or has(p, "VS5435E"),
        "sample": [t for t in texts(p) if "Verify" in t or "VS5435" in t or "Inactive" in t][:12],
    }
    print("INACTIVE_LIST", inactive_list)

    api("POST", f"/api/v1/sheds/{SID}/reactivate", headers=oh)
    deep_link("(app)/sheds")
    time.sleep(4)
    p = dump("fix_active_list")
    tap_label(p, "Active")
    time.sleep(1.5)
    # Search
    root = ET.parse(dump("fix_search0")).getroot()
    eds = []
    for n in root.iter("node"):
        if n.attrib.get("class", "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            eds.append(
                ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            )
    if eds:
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        time.sleep(0.3)
        adb("shell", "input", "text", "VS5435E")
        time.sleep(2)
    p = dump("fix_search")
    active_search = {
        "has_shed": has(p, "VerifyShed235435Edit") or has(p, "VS5435E"),
        "sample": [t for t in texts(p) if "Verify" in t or "VS5435" in t or "Edit" in t][:12],
    }
    print("ACTIVE_SEARCH", active_search)

    out = {
        "inactive_ui_ok": inactive_ui["has_reactivate"]
        and inactive_ui["has_inactive_label"]
        and not inactive_ui["has_add_batch"]
        and not inactive_ui["has_deactivate"],
        "inactive_list_ok": inactive_list["has_shed"],
        "active_search_ok": active_search["has_shed"],
        "inactive_ui": inactive_ui,
        "inactive_list": inactive_list,
        "active_search": active_search,
    }
    (S / "verify_inactive_ui_fix.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("RESULT", {k: out[k] for k in ("inactive_ui_ok", "inactive_list_ok", "active_search_ok")})
    if not all(out[k] for k in ("inactive_ui_ok", "inactive_list_ok", "active_search_ok")):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
