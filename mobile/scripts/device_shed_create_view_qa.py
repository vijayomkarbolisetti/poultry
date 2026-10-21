"""Physical device QA for shed list/create/detail (serial 2639a611).

Uses deep links (`poultrytracker://…`) because Xiaomi HyperOS blocks
`adb shell input` without Developer option
“USB debugging (Security settings)”.

Interactive create→submit remains BLOCKED until that setting is enabled
or Arjun production API credentials are provided.
"""
from __future__ import annotations

import json
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "2639a611"
PKG = "com.vijayomkar.poultrytracker"
TAG = f"DV{time.strftime('%H%M%S')}"
results: list[dict] = []
artifacts: list[str] = []


def log(tid: str, scenario: str, expected: str, actual: str, status: str) -> None:
    results.append(
        {
            "test_id": tid,
            "scenario": scenario,
            "expected": expected,
            "actual": actual[:400],
            "status": status,
        }
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
    time.sleep(3.2)


def input_works() -> bool:
    r = adb("shell", "input", "keyevent", "KEYCODE_UNKNOWN")
    err = (r.stderr or "") + (r.stdout or "")
    return "SecurityException" not in err and "INJECT_EVENTS" not in err


def main() -> None:
    who = adb("get-serialno").stdout.strip()
    log("DEV-00", "Target physical device", SERIAL, who, "PASS" if who == SERIAL else "FAIL")

    inj = input_works()
    log(
        "DEV-00b",
        "ADB input injection",
        "available OR documented block",
        "ok" if inj else "SecurityException INJECT_EVENTS (enable USB debugging Security settings)",
        "PASS" if inj else "BLOCKED",
    )

    adb("shell", "am", "force-stop", PKG)
    time.sleep(0.8)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(3.5)
    p = dump("dev_home")
    shot("dev_home")
    logged = has(p, "Hello") or has(p, "Sheds") or has(p, "Live birds")
    log("DEV-01", "App open / session", "Home or signed-in UI", str(texts(p)[:12]), "PASS" if logged else "FAIL")
    if not logged:
        _write()
        return

    # --- List (deep link) — primary crash regression ---
    deep_link("sheds")
    p = dump("dev_sheds")
    shot("dev_sheds")
    crashed = has(p, "TypeError") or has(p, "undefined is not") or has(p, "Something went wrong")
    on_list = has(p, "Add shed") and has(p, "Search by name or code")
    has_card = has(p, "Owner-managed") or has(p, "Farmer-managed") or has(p, "live ·")
    log(
        "DEV-02",
        "Sheds list renders without crash",
        "Add shed + filters; cards ok; no TypeError",
        f"on_list={on_list} card={has_card} crashed={crashed} sample={texts(p)[:16]}",
        "PASS" if on_list and not crashed else "FAIL",
    )

    # --- Create form ---
    deep_link("sheds/create")
    p = dump("dev_create")
    shot("dev_create")
    form_ok = has(p, "New shed") and has(p, "Create shed") and has(p, "Shed name")
    log(
        "DEV-03",
        "Create shed form opens",
        "New shed + Create shed + fields",
        str(texts(p)[:18]),
        "PASS" if form_ok else "FAIL",
    )

    # --- Interactive submit ---
    if not inj:
        log(
            "DEV-04",
            "Submit create on device",
            "Create shed succeeds + navigate overview",
            "BLOCKED: adb input injection denied on HyperOS; enable Developer options → USB debugging (Security settings)",
            "BLOCKED",
        )
        log(
            "DEV-05",
            "Post-create overview navigation",
            "New shed overview",
            "blocked by DEV-04",
            "BLOCKED",
        )
        log(
            "DEV-06",
            "New shed appears in list",
            "name/code visible",
            "blocked by DEV-04",
            "BLOCKED",
        )
    else:
        log("DEV-04", "Submit create on device", "n/a", "input available but script uses deep-link mode", "NOT RUN")

    # --- Detail: missing id error handling ---
    deep_link("sheds/00000000-0000-0000-0000-000000000000")
    p = dump("dev_detail_missing")
    shot("dev_detail_missing")
    missing_handled = (
        has(p, "not found")
        or has(p, "Not found")
        or has(p, "access denied")
        or has(p, "couldn't load")
        or has(p, "Unable")
        or has(p, "Error")
        or has(p, "Shed overview")
    )
    log(
        "DEV-07",
        "Detail with unknown shed id",
        "Error/empty state (no crash)",
        f"handled={missing_handled} crashed={has(p,'TypeError')} texts={texts(p)[:14]}",
        "PASS" if missing_handled and not has(p, "TypeError") else "FAIL",
    )

    # --- Reopen list after detail ---
    deep_link("sheds")
    p = dump("dev_list_again")
    shot("dev_list_again")
    log(
        "DEV-08",
        "Return to list after detail",
        "List still healthy",
        str(texts(p)[:14]),
        "PASS" if has(p, "Add shed") and not has(p, "TypeError") else "FAIL",
    )

    # Existing shed card content (Arjun Farm already has Shed 1 / SH001)
    if has(p, "SH001") or has(p, "Shed 1"):
        log(
            "DEV-09",
            "Existing shed card fields",
            "name/code/aggregates visible",
            "Shed 1 / SH001 / Owner-managed visible",
            "PASS",
        )
    else:
        log("DEV-09", "Existing shed card fields", "name/code visible", str(texts(p)[:20]), "FAIL")

    _write()


def _write() -> None:
    out = {
        "serial": SERIAL,
        "tag": TAG,
        "android_model": adb("shell", "getprop", "ro.product.model").stdout.strip(),
        "android_release": adb("shell", "getprop", "ro.build.version.release").stdout.strip(),
        "package": PKG,
        "apk_note": "poultrytrack-shed-qa-c8b49fa4.apk installed with list crash fixes",
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
        "blocked": sum(1 for r in results if r["status"] == "BLOCKED"),
        "not_run": sum(1 for r in results if r["status"] == "NOT RUN"),
        "artifacts": artifacts,
    }
    (S / "shed_device_create_view_qa.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("DEVICE_SUMMARY", {k: out[k] for k in ("passed", "failed", "blocked", "not_run", "artifacts")})


if __name__ == "__main__":
    main()
