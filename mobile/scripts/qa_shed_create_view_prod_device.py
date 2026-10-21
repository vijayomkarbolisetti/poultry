"""Create shed via production API + verify on physical device via deep links.

Credentials: set env POULTRY_QA_EMAIL and POULTRY_QA_PASSWORD for this session only.
Never writes secrets to disk. Targets adb serial 2639a611 and EXPO preview API.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "2639a611"
PKG = "com.vijayomkar.poultrytracker"
BASE = os.environ.get("POULTRY_QA_API", "https://3.6.160.64.sslip.io")
TAG = time.strftime("%m%d%H%M%S")
NAME = f"QA-SHED-{TAG}"
CODE = f"Q{TAG[-5:]}"
results: list[dict] = []
artifacts: list[str] = []


def log(tid: str, scenario: str, expected: str, actual: str, status: str) -> None:
    results.append(
        {"test_id": tid, "scenario": scenario, "expected": expected, "actual": actual[:350], "status": status}
    )
    print(f"{status:8} {tid} — {scenario}: {actual[:140]}")


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.4)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def shot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))
    artifacts.append(f"mobile/scripts/{name}.png")


def texts(p: Path) -> list[str]:
    return [
        (n.attrib.get("text") or "").strip()
        for n in ET.parse(p).getroot().iter("node")
        if (n.attrib.get("text") or "").strip()
    ]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def deep_link(path: str) -> None:
    uri = f"poultrytracker://{path.lstrip('/')}"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", uri)
    time.sleep(3.5)


def api(method: str, path: str, headers: dict, body=None):
    import urllib.error
    import urllib.request

    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={**headers, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:200]}


def main() -> None:
    email = (os.environ.get("POULTRY_QA_EMAIL") or "").strip()
    password = os.environ.get("POULTRY_QA_PASSWORD") or ""
    if not email or not password:
        log(
            "CV-00",
            "Credentials from env",
            "POULTRY_QA_EMAIL + POULTRY_QA_PASSWORD set",
            "missing — cannot create on production API",
            "BLOCKED",
        )
        _write()
        return

    who = adb("get-serialno").stdout.strip()
    log("CV-00", "Target device", SERIAL, who, "PASS" if who == SERIAL else "FAIL")

    c, body = api("POST", "/api/v1/auth/login", {}, {"email": email, "password": password})
    if c != 200:
        log("CV-01", "Login production API", "200", f"{c}", "FAIL")
        _write()
        return
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    owner_id = me["memberships"][0]["owner_account_id"]
    h = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner_id}
    log("CV-01", "Login production API", "200", f"role={me['memberships'][0].get('role')}", "PASS")

    # Ensure name not already present
    _, listed = api("GET", "/api/v1/sheds", h)
    if isinstance(listed, list) and any(s.get("name") == NAME for s in listed):
        log("CV-02", "Pre-check unique name", "not exists", "already exists", "FAIL")
        _write()
        return
    log("CV-02", "Pre-check unique name", "not exists", NAME, "PASS")

    c, shed = api(
        "POST",
        "/api/v1/sheds",
        h,
        {"name": NAME, "code": CODE, "is_owner_managed": True, "location_notes": "DeviceQA disposable"},
    )
    sid = shed.get("id") if isinstance(shed, dict) else None
    log("CV-03", "API create shed", "201 + id", f"{c} id={sid}", "PASS" if c in (200, 201) and sid else "FAIL")
    if not sid:
        _write()
        return

    c, ov = api("GET", f"/api/v1/sheds/{sid}/overview", h)
    match = c == 200 and ov.get("shed", {}).get("id") == sid and ov.get("shed", {}).get("name") == NAME
    log("CV-04", "API overview matches create", "name+id", f"{c} name={ov.get('shed',{}).get('name')}", "PASS" if match else "FAIL")

    # Device: open detail by deep link (no adb input required)
    deep_link(f"sheds/{sid}")
    p = dump("cv_detail")
    shot("cv_detail")
    detail_ok = has(p, NAME) or has(p, CODE)
    denied = has(p, "not found") or has(p, "access denied")
    log(
        "CV-05",
        "Device detail shows new shed",
        "name/code visible",
        f"ok={detail_ok} denied={denied} texts={texts(p)[:12]}",
        "PASS" if detail_ok and not denied else "FAIL",
    )

    deep_link("sheds")
    p = dump("cv_list")
    shot("cv_list")
    # scroll a few times if needed
    found = has(p, NAME) or has(p, CODE)
    # cannot swipe without input injection — search field also needs input
    log(
        "CV-06",
        "Device list shows new shed",
        "name/code on first screen or note scroll blocked",
        f"found={found} texts={texts(p)[:16]}",
        "PASS" if found else ("BLOCKED" if "INJECT" in (adb("shell", "input", "keyevent", "KEYCODE_UNKNOWN").stderr or "") else "FAIL"),
    )

    # Reopen detail
    deep_link(f"sheds/{sid}")
    p = dump("cv_reopen")
    shot("cv_reopen")
    log(
        "CV-07",
        "Reopen shed detail",
        "same name/code",
        str(texts(p)[:12]),
        "PASS" if (has(p, NAME) or has(p, CODE)) and not has(p, "access denied") else "FAIL",
    )

    # Force-stop + relaunch + deep link (persistence)
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    deep_link(f"sheds/{sid}")
    p = dump("cv_persist")
    shot("cv_persist")
    log(
        "CV-08",
        "After app restart, detail persists",
        "name/code",
        str(texts(p)[:12]),
        "PASS" if has(p, NAME) or has(p, CODE) else "FAIL",
    )

    # Cross-tenant: register disposable other owner — should 404
    other_email = f"other.qa.{TAG}@example.com"
    c, reg2 = api(
        "POST",
        "/api/v1/auth/register-owner",
        {},
        {
            "email": other_email,
            "password": "password123",
            "full_name": "Other QA",
            "organization_name": f"Other QA {TAG}",
        },
    )
    if c in (200, 201):
        t2 = reg2["access_token"]
        _, me2 = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {t2}"})
        h2 = {
            "Authorization": f"Bearer {t2}",
            "X-Owner-Account-Id": me2["memberships"][0]["owner_account_id"],
        }
        c3, _ = api("GET", f"/api/v1/sheds/{sid}/overview", h2)
        log("CV-09", "Other org cannot overview", "404", str(c3), "PASS" if c3 == 404 else "FAIL")
    else:
        log("CV-09", "Other org cannot overview", "404", f"register failed {c}", "BLOCKED")

    _write(sid)


def _write(sid: str | None = None) -> None:
    out = {
        "serial": SERIAL,
        "api": BASE,
        "name": NAME,
        "code": CODE,
        "shed_id": sid,
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
        "blocked": sum(1 for r in results if r["status"] == "BLOCKED"),
        "artifacts": artifacts,
        "note": "Credentials read from env only; not stored.",
    }
    (S / "shed_create_view_prod_device_qa.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("SUMMARY", {k: out[k] for k in ("passed", "failed", "blocked", "name", "shed_id")})


if __name__ == "__main__":
    main()
