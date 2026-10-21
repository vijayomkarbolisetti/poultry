"""Emulator + API verification for Shed Management (owner + farmer)."""
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
FARMER = json.loads((S / "pilot-farmer.json").read_text(encoding="utf-8"))
STAMP = time.strftime("%H%M%S")


def adb(*a, check=True):
    p = subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError((p.stdout or "") + (p.stderr or ""))
    return (p.stdout or "") + (p.stderr or "")


def dump(n: str) -> Path:
    remote = f"/sdcard/{n}.xml"
    local = S / f"{n}.xml"
    for _ in range(4):
        adb("shell", "uiautomator", "dump", remote, check=False)
        time.sleep(0.3)
        adb("pull", remote, str(local), check=False)
        if local.exists() and local.stat().st_size > 80:
            return local
        time.sleep(0.6)
    raise RuntimeError(f"dump fail {n}")


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
    raise RuntimeError(f"nc {label}")


def tap(x, y):
    adb("shell", "input", "tap", str(x), str(y))


def edit_centers(path: Path):
    root = ET.parse(path).getroot()
    out = []
    for n in root.iter("node"):
        if n.attrib.get("class", "").endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            out.append(
                ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            )
    return out


def clear_field():
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(40):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")


def fill(x, y, value: str):
    tap(x, y)
    time.sleep(0.2)
    clear_field()
    adb("shell", "input", "text", value.replace("@", "\\@").replace(" ", "%s"))
    time.sleep(0.2)
    tap(800, 100)
    time.sleep(0.2)


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


def log(results, step, ok, detail=""):
    results.append({"step": step, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), "-", step, "-", str(detail)[:200])


def owner_headers():
    st, login = api(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    if st != 200:
        raise RuntimeError(f"owner login {st}")
    return {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }


def farmer_headers():
    st, login = api(
        "POST",
        "/api/v1/auth/login",
        {"email": FARMER["farmerEmail"], "password": FARMER["farmerPassword"]},
    )
    if st != 200:
        raise RuntimeError(f"farmer login {st}")
    return {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }


def main():
    results = []
    oh = owner_headers()
    name = f"VerifyShed{STAMP}"
    code = f"VS{STAMP[-4:]}"
    notes = f"Notes{STAMP}"

    # Seed via API: farmer-managed shed with batch so deactivate warning has content
    st, f1 = api(
        "POST",
        "/api/v1/farmers",
        {
            "email": f"verify.mgr.{STAMP}@example.com",
            "password": "password123",
            "full_name": f"VerifyMgr{STAMP}",
            "role": "farmer",
            "permission_codes": ["shed.view", "flock.view", "vaccination.view"],
            "shed_ids": [],
        },
        oh,
    )
    log(results, "API create manager farmer", st == 201, f1 if st != 201 else f1.get("membership_id"))
    mem = f1["membership_id"]

    st, shed = api(
        "POST",
        "/api/v1/sheds",
        {
            "name": name,
            "code": code,
            "location_notes": notes,
            "is_owner_managed": False,
            "initial_farmer_membership_id": mem,
        },
        oh,
    )
    log(results, "API create verify shed", st == 201, shed.get("id") if isinstance(shed, dict) else shed)
    sid = shed["id"]

    st, flock = api(
        "POST",
        "/api/v1/flocks",
        {
            "shed_id": sid,
            "batch_code": f"VB{STAMP[-4:]}",
            "initial_count": 25,
            "unbanded_count": 25,
            "tracking_mode": "batch",
            "dob_confidence": "unknown",
        },
        oh,
    )
    log(results, "API seed batch", st == 201, flock.get("id") if isinstance(flock, dict) else flock)

    # List/overview consistency
    st, listed = api("GET", "/api/v1/sheds", headers=oh)
    item = next(s for s in listed if s["id"] == sid)
    st, ov = api("GET", f"/api/v1/sheds/{sid}/overview", headers=oh)
    log(
        results,
        "list/overview population match",
        item["total_live_birds"] == ov["population"]["total_live_birds"] == 25
        and item["active_batch_count"] == ov["population"]["active_batch_count"] == 1,
        f"list={item['total_live_birds']}/{item['active_batch_count']} ov={ov['population']}",
    )
    log(
        results,
        "list/overview vax task keys present",
        all(k in item for k in ("overdue_tasks", "due_today_tasks"))
        and set(ov["vaccination"]) >= {"overdue", "due_today", "upcoming", "needs_review"},
        "",
    )

    # Edit via API (emulator form fill is flaky for long notes; verify persistence here + UI list)
    st, edited = api(
        "PATCH",
        f"/api/v1/sheds/{sid}",
        {"name": f"{name}Edit", "code": f"{code}E", "location_notes": f"{notes}-edited"},
        oh,
    )
    log(
        results,
        "API edit name/code/notes",
        st == 200
        and edited["name"] == f"{name}Edit"
        and edited["code"] == f"{code}E"
        and edited["location_notes"] == f"{notes}-edited",
        edited if st != 200 else "",
    )

    # Replace manager
    st, f2 = api(
        "POST",
        "/api/v1/farmers",
        {
            "email": f"verify.mgr2.{STAMP}@example.com",
            "password": "password123",
            "full_name": f"VerifyMgr2{STAMP}",
            "role": "farmer",
            "permission_codes": ["shed.view", "flock.view"],
            "shed_ids": [],
        },
        oh,
    )
    mem2 = f2["membership_id"]
    # Keep helper non-manager
    api(
        "POST",
        f"/api/v1/sheds/{sid}/assignments",
        {"owner_membership_id": mem, "is_manager": False},
        oh,
    )
    st, rep = api(
        "PATCH",
        f"/api/v1/sheds/{sid}",
        {"is_owner_managed": False, "initial_farmer_membership_id": mem2},
        oh,
    )
    st, asg = api("GET", f"/api/v1/sheds/{sid}/assignments", headers=oh)
    managers = [a for a in asg if a["is_manager"]]
    helpers = [a for a in asg if a["owner_membership_id"] == mem]
    log(
        results,
        "replace manager demotes old preserves helper",
        st == 200
        and len(managers) == 1
        and managers[0]["owner_membership_id"] == mem2
        and helpers
        and helpers[0]["is_manager"] is False
        and helpers[0]["is_active"] is True,
        str(asg)[:180],
    )

    # Owner-managed switch revokes access
    st, om = api("PATCH", f"/api/v1/sheds/{sid}", {"is_owner_managed": True}, oh)
    st, asg2 = api("GET", f"/api/v1/sheds/{sid}/assignments", headers=oh)
    # Login as mem2 farmer
    st, flog = api(
        "POST",
        "/api/v1/auth/login",
        {"email": f"verify.mgr2.{STAMP}@example.com", "password": "password123"},
    )
    fh2 = {
        "Authorization": f"Bearer {flog['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }
    st_den, _ = api("GET", f"/api/v1/sheds/{sid}/overview", headers=fh2)
    log(
        results,
        "owner-managed revokes farmer overview",
        om.get("is_owner_managed") is True and asg2 == [] and st_den == 403,
        f"asg={asg2} den={st_den}",
    )

    # Restore farmer-managed for deactivate UI path
    api(
        "PATCH",
        f"/api/v1/sheds/{sid}",
        {"is_owner_managed": False, "initial_farmer_membership_id": mem2},
        oh,
    )

    st, deps = api("GET", f"/api/v1/sheds/{sid}/dependencies", headers=oh)
    log(
        results,
        "dependencies before deactivate",
        st == 200 and deps["active_batch_count"] >= 1 and deps["total_live_birds"] >= 1 and deps["can_deactivate"],
        deps,
    )

    # --- Emulator UI ---
    adb(
        "shell",
        "am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082/--/(app)/sheds'",
    )
    time.sleep(5)
    p = dump("vm_sheds")
    log(results, "emulator sheds list", has(p, "Sheds") and has(p, "Active"), str(texts(p)[:18]))
    log(results, "emulator filters present", has(p, "Inactive") and has(p, "All status"), "")
    log(
        results,
        "emulator card shows edited shed",
        has(p, f"{name}Edit") or has(p, f"{code}E"),
        str([t for t in texts(p) if "Verify" in t or code in t][:10]),
    )

    # Open overview via deep link
    adb(
        "shell",
        f"am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082/--/(app)/sheds/{sid}'",
    )
    time.sleep(5)
    p = dump("vm_ov")
    log(
        results,
        "emulator overview open",
        has(p, "Shed overview") or has(p, f"{name}Edit") or has(p, f"{code}E"),
        str(texts(p)[:16]),
    )
    log(results, "emulator owner has Edit/Deactivate", has(p, "Edit shed") and has(p, "Deactivate"), "")
    log(results, "emulator Add Batch visible while active", has(p, "Add Batch"), "")

    # Deactivate via API then check UI inactive filter (Alert dialogs are hard to automate reliably)
    st, d = api("POST", f"/api/v1/sheds/{sid}/deactivate", headers=oh)
    log(results, "API deactivate", st == 200 and d.get("is_active") is False, d)
    st, active = api("GET", "/api/v1/sheds", headers=oh)
    st, inactive = api("GET", "/api/v1/sheds?include_inactive=true", headers=oh)
    log(
        results,
        "inactive hidden from active list",
        sid not in {s["id"] for s in active} and sid in {s["id"] for s in inactive},
        "",
    )

    adb(
        "shell",
        f"am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082/--/(app)/sheds/{sid}'",
    )
    time.sleep(5)
    p = dump("vm_inactive_ov")
    log(
        results,
        "emulator inactive overview banner / no Add Batch",
        (has(p, "Inactive") or has(p, "inactive")) and not has(p, "Add Batch"),
        str(texts(p)[:18]),
    )
    log(results, "emulator Reactivate control", has(p, "Reactivate"), "")

    # Farmer API auth checks (pilot farmer — may not have shed.update)
    fh = farmer_headers()
    st_p, _ = api("PATCH", f"/api/v1/sheds/{sid}", {"name": "Hijack"}, fh)
    st_d, _ = api("POST", f"/api/v1/sheds/{sid}/deactivate", headers=fh)
    st_r, _ = api("POST", f"/api/v1/sheds/{sid}/reactivate", headers=fh)
    log(
        results,
        "pilot farmer denied edit/deactivate/reactivate",
        st_p == 403 and st_d == 403 and st_r == 403,
        f"patch={st_p} deact={st_d} react={st_r}",
    )

    # Reactivate + memberships intact
    st, r = api("POST", f"/api/v1/sheds/{sid}/reactivate", headers=oh)
    st, asg3 = api("GET", f"/api/v1/sheds/{sid}/assignments", headers=oh)
    st, ov2 = api("GET", f"/api/v1/sheds/{sid}/overview", headers=oh)
    log(
        results,
        "reactivate restores active + history + memberships",
        r.get("is_active") is True
        and len(asg3) >= 1
        and ov2["population"]["total_live_birds"] == 25
        and ov2["population"]["active_batch_count"] == 1,
        f"asg={len(asg3)} live={ov2['population']['total_live_birds']}",
    )

    # Emulator list Active after reactivate
    adb(
        "shell",
        "am start -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082/--/(app)/sheds'",
    )
    time.sleep(4)
    p = dump("vm_sheds2")
    log(
        results,
        "emulator reactivated shed on list",
        has(p, f"{name}Edit") or has(p, f"{code}E"),
        str([t for t in texts(p) if "Verify" in t or code in t][:8]),
    )

    out = {
        "stamp": STAMP,
        "shed_id": sid,
        "pass": sum(1 for r in results if r["ok"]),
        "fail": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    (S / "verify_shed_mgmt_emulator.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("SUMMARY", out["pass"], "pass /", out["fail"], "fail")
    if out["fail"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
