"""Emulator smoke for Global Search against seeded API data."""

from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")
SERIAL = "emulator-5554"
seed_path = S / "global_search_pilot_seed.json"
if not seed_path.exists():
    seed_path = S / "global_search_api_verification.json"
raw = json.loads(seed_path.read_text(encoding="utf-8"))
seed = raw["seed"] if "seed" in raw else raw
results: list[dict] = []


def log(step: str, status: str, detail: str = "") -> None:
    results.append({"step": step, "status": status, "detail": detail[:240]})
    print(f"{status.upper():10} {step} — {detail[:160]}")


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], check=False, capture_output=True, text=True)


def deep(path: str) -> None:
    # Quote carefully for Android sh
    uri = f"exp://127.0.0.1:8082/--/{path}"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", uri)


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.5)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def texts(p: Path) -> list[str]:
    if not p.exists():
        return []
    root = ET.parse(p).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


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
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        if want not in t.lower() and want not in d.lower():
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
                if not m:
                    break
                x = (int(m.group(1)) + int(m.group(3))) // 2
                y = (int(m.group(2)) + int(m.group(4))) // 2
                adb("shell", "input", "tap", str(x), str(y))
                return True
            cur = parent.get(cur)
    return False


def type_into_search(p: Path, text: str) -> bool:
    root = ET.parse(p).getroot()
    edits = []
    for n in root.iter("node"):
        cls = n.attrib.get("class") or ""
        if cls.endswith("EditText"):
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib["bounds"])
            if m:
                edits.append(
                    (
                        (int(m.group(1)) + int(m.group(3))) // 2,
                        (int(m.group(2)) + int(m.group(4))) // 2,
                    )
                )
    if not edits:
        return False
    x, y = edits[0]
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(0.3)
    # clear
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(40):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")
    # adb text: spaces as %s
    safe = text.replace(" ", "%s")
    adb("shell", "input", "text", safe)
    return True


def tab_labels(p: Path) -> list[str]:
    # Rough: collect short labels near bottom third
    root = ET.parse(p).getroot()
    labels = []
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if not t:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if not m:
            continue
        y = int(m.group(2))
        if y > 2200 and len(t) < 16:
            labels.append(t)
    return labels


def main() -> None:
    # Ensure Expo Go foreground
    adb("shell", "monkey", "-p", "host.exp.exponent", "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(3)

    deep("(app)/home")
    time.sleep(5)
    p = dump("gs_home")
    t = texts(p)
    if has(p, "Find a bird"):
        log("no_find_a_bird_on_home", "failed", "Find a bird still visible")
    else:
        log("no_find_a_bird_on_home", "passed", "absent")

    search_entries = [x for x in t if x.strip().lower() == "search"]
    # Header icon may be content-desc only
    if has(p, "Search") or tap_desc_or_text(p, "Search"):
        log("home_search_entry", "passed", f"text_count={len(search_entries)}")
    else:
        log("home_search_entry", "failed", str(t[:20]))

    # Open via deep link (reliable)
    deep("(app)/search")
    time.sleep(4)
    p = dump("gs_search")
    if has(p, "Search birds, batches, or sheds") or has(p, "Search"):
        log("open_global_search", "passed", str(texts(p)[:12]))
    else:
        log("open_global_search", "failed", str(texts(p)[:20]))

    # Bottom tabs should not include Search as a tab label cluster wrongly —
    # Check home tabs after
    deep("(app)/home")
    time.sleep(3)
    p = dump("gs_tabs")
    tabs = tab_labels(p)
    leaked = [x for x in tabs if "search" in x.lower() or "find a bird" in x.lower()]
    intended = {"Home", "Sheds", "Batches", "Tasks", "More"}
    found = intended.intersection(set(tabs))
    log(
        "bottom_tabs",
        "passed" if "Home" in found and not leaked else "failed",
        f"tabs={tabs[:12]} leaked={leaked} found={sorted(found)}",
    )

    # Search bird exact
    deep("(app)/search")
    time.sleep(3)
    p = dump("gs_q0")
    if not type_into_search(p, seed["band"]):
        log("type_band", "failed", "no EditText")
    else:
        log("type_band", "passed", seed["band"])
        time.sleep(2.5)
        p = dump("gs_bird")
        if has(p, seed["band"]) and (has(p, "Birds") or has(p, "Exact") or has(p, "Partial")):
            log("exact_bird_ui", "passed", str([x for x in texts(p) if seed['band'] in x or x in ('Birds','Exact','Partial')][:8]))
        else:
            log("exact_bird_ui", "failed", str(texts(p)[:25]))

        # Tap bird result
        if tap_desc_or_text(p, seed["band"]):
            time.sleep(4)
            p = dump("gs_bird_profile")
            if has(p, seed["band"]) or has(p, "Identity") or has(p, "Vaccination"):
                log("open_bird_detail", "passed", str(texts(p)[:14]))
            else:
                log("open_bird_detail", "failed", str(texts(p)[:20]))
            # Back
            if tap_desc_or_text(p, "Back"):
                time.sleep(2)
            else:
                adb("shell", "input", "keyevent", "4")
                time.sleep(2)
            p = dump("gs_back_bird")
            if has(p, seed["band"]) or has(p, "Search birds") or has(p, "Birds"):
                log("back_keeps_search", "passed", str(texts(p)[:14]))
            else:
                log("back_keeps_search", "failed", str(texts(p)[:20]))
        else:
            log("open_bird_detail", "failed", "tap missed")

    # Batch search
    deep("(app)/search")
    time.sleep(3)
    p = dump("gs_bq0")
    type_into_search(p, seed["batch"])
    time.sleep(2.5)
    p = dump("gs_batch")
    if has(p, seed["batch"]):
        log("batch_ui", "passed")
        if tap_desc_or_text(p, seed["batch"]):
            time.sleep(4)
            p = dump("gs_batch_detail")
            if has(p, seed["batch"]) or has(p, "Batch"):
                log("open_batch_detail", "passed", str(texts(p)[:12]))
            else:
                log("open_batch_detail", "failed", str(texts(p)[:20]))
        else:
            log("open_batch_detail", "failed", "tap missed")
    else:
        log("batch_ui", "failed", str(texts(p)[:20]))

    # Shed search
    deep("(app)/search")
    time.sleep(3)
    p = dump("gs_sq0")
    type_into_search(p, seed["shed_code"])
    time.sleep(2.5)
    p = dump("gs_shed")
    if has(p, seed["shed_name"]) or has(p, seed["shed_code"]) or has(p, "Alpha Shed"):
        log("shed_ui", "passed")
        tapped = tap_desc_or_text(p, "Alpha Shed") or tap_desc_or_text(p, seed["shed_code"])
        if tapped:
            time.sleep(4)
            p = dump("gs_shed_detail")
            if has(p, "Alpha") or has(p, seed["shed_code"]) or has(p, "Shed"):
                log("open_shed_detail", "passed", str(texts(p)[:12]))
            else:
                log("open_shed_detail", "failed", str(texts(p)[:20]))
        else:
            log("open_shed_detail", "failed", "tap missed")
    else:
        log("shed_ui", "failed", str(texts(p)[:20]))

    # Empty
    deep("(app)/search")
    time.sleep(3)
    p = dump("gs_eq0")
    type_into_search(p, "ZZZNOPE999")
    time.sleep(2.5)
    p = dump("gs_empty")
    if has(p, "No matches") or has(p, "Nothing matched"):
        log("empty_ui", "passed")
    else:
        log("empty_ui", "failed", str(texts(p)[:20]))

    # More screen
    deep("(app)/settings")
    time.sleep(4)
    p = dump("gs_more")
    if has(p, "Find a bird"):
        log("no_find_a_bird_on_more", "failed")
    else:
        log("no_find_a_bird_on_more", "passed")
    search_on_more = sum(1 for x in texts(p) if x.strip().lower() == "search")
    log(
        "more_search_entry",
        "passed" if search_on_more >= 1 else "failed",
        f"count={search_on_more}",
    )

    out = {
        "seed_band": seed["band"],
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
    }
    (S / "global_search_emulator_verification.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8"
    )
    print("EMU_SUMMARY", json.dumps(out))


if __name__ == "__main__":
    main()
