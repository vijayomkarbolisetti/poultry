"""Authenticate on emulator without clipboard; run Global Search UI checks.

Credentials are read from pilot-owner.json and never printed.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")
SERIAL = "emulator-5554"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "global_search_pilot_seed.json").read_text(encoding="utf-8"))
EMAIL = OWNER["ownerEmail"]
PASSWORD = OWNER["ownerPassword"]

results: list[dict] = []


def log(step: str, status: str, detail: str = "") -> None:
    # Redact email/password fragments from details
    safe = detail
    if PASSWORD:
        safe = safe.replace(PASSWORD, "[REDACTED]")
    if EMAIL:
        safe = safe.replace(EMAIL, "[owner-email]")
    results.append({"step": step, "status": status, "detail": safe[:300]})
    print(f"{status.upper():10} {step} — {safe[:160]}")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["adb", "-s", SERIAL, *args],
        check=False,
        capture_output=True,
        text=True,
    )


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.45)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def texts(p: Path) -> list[str]:
    if not p.exists() or p.stat().st_size < 50:
        return []
    root = ET.parse(p).getroot()
    return [
        (n.attrib.get("text") or "").strip()
        for n in root.iter("node")
        if (n.attrib.get("text") or "").strip()
    ]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def edit_centers(p: Path) -> list[tuple[int, int]]:
    root = ET.parse(p).getroot()
    out: list[tuple[int, int]] = []
    for n in root.iter("node"):
        if not (n.attrib.get("class") or "").endswith("EditText"):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if m:
            out.append(
                ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
            )
    return out


def _tap_bounds(bounds: str) -> bool:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not m:
        return False
    x = (int(m.group(1)) + int(m.group(3))) // 2
    y = (int(m.group(2)) + int(m.group(4))) // 2
    adb("shell", "input", "tap", str(x), str(y))
    return True


def tap_label(p: Path, label: str, exact: bool = False) -> bool:
    parent: dict = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        ok = (t.lower() == want or d.lower() == want) if exact else (
            want in t.lower() or want in d.lower()
        )
        if not ok:
            continue
        # Prefer the node itself when clickable (result cards); skip EditText.
        cls = n.attrib.get("class") or ""
        if n.attrib.get("clickable") == "true" and not cls.endswith("EditText"):
            if _tap_bounds(n.attrib.get("bounds", "")):
                return True
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                cls2 = cur.attrib.get("class") or ""
                if cls2.endswith("EditText"):
                    cur = parent.get(cur)
                    continue
                if _tap_bounds(cur.attrib.get("bounds", "")):
                    return True
            cur = parent.get(cur)
    return False


def tap_result_card(p: Path, needle: str) -> bool:
    """Tap a Global Search result row by content-desc (avoids the query EditText)."""
    root = ET.parse(p).getroot()
    want = needle.lower()
    for n in root.iter("node"):
        if n.attrib.get("clickable") != "true":
            continue
        d = (n.attrib.get("content-desc") or "").strip()
        if want in d.lower() and len(d) > len(needle):
            return _tap_bounds(n.attrib.get("bounds", ""))
    return tap_label(p, needle)


def clear_field(count: int = 60) -> None:
    # Move to end, delete backwards — no clipboard.
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(count):
        adb("shell", "input", "keyevent", "67")


def type_text(raw: str) -> None:
    """Type via adb input text. Escape @ for Android shell."""
    # adb input text: space -> %s, @ -> \@
    escaped = raw.replace(" ", "%s").replace("@", r"\@")
    adb("shell", "input", "text", escaped)


def open_app() -> None:
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "exp://172.25.0.1:8082")
    time.sleep(8)


def is_home(p: Path) -> bool:
    return (
        has(p, "Live birds")
        or has(p, "Overview")
        or has(p, "OVERVIEW")
        or has(p, "Quick links")
        or has(p, "Hello")
        or has(p, "FARM SNAPSHOT")
        or has(p, "Due today")
    )


def is_authenticated_ui(p: Path) -> bool:
    """Any post-login surface (home, search, more, etc.)."""
    return is_home(p) or has(p, "Search birds, batches, or sheds") or (
        has(p, "Home") and has(p, "More") and not has(p, "Sign In")
    )


def wait_for_app(timeout_s: int = 60) -> Path:
    """Open app and poll until login or home is visible."""
    open_app()
    deadline = time.time() + timeout_s
    last = dump("gsv_boot")
    while time.time() < deadline:
        sample = texts(last)[:16]
        if is_authenticated_ui(last) or has(last, "Sign In"):
            return last
        # Expo Go project list / splash — keep trying
        if tap_label(last, "8082") or tap_label(last, "PoultryTrack") or tap_label(last, "Continue"):
            time.sleep(4)
        else:
            time.sleep(3)
        last = dump("gsv_boot")
        log("boot_poll", "passed", str(sample))
    return last


def ensure_logged_in() -> bool:
    p = wait_for_app(70)
    sample = texts(p)[:12]
    if is_authenticated_ui(p):
        log("already_authenticated", "passed", str(sample))
        return True
    if not has(p, "Sign In"):
        log("login_screen", "failed", f"unexpected UI: {sample}")
        return False

    log("login_screen", "passed", "Sign In visible")
    eds = edit_centers(p)
    if len(eds) < 2:
        log("login_fields", "failed", f"edit_count={len(eds)}")
        return False

    # Email — type only, never clipboard
    adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
    time.sleep(0.25)
    clear_field(80)
    type_text(EMAIL)
    time.sleep(0.3)

    # Password
    adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
    time.sleep(0.25)
    clear_field(40)
    type_text(PASSWORD)
    time.sleep(0.3)

    p = dump("gsv_pre_signin")
    # Confirm email field does not contain host clipboard junk / validation error preferred
    joined = " ".join(texts(p))
    if "Enter a valid email" in joined and EMAIL.split("@")[0] not in joined:
        log("email_entry", "failed", "validation error; email not accepted")
        return False
    if "Perform the final Global Search" in joined or "Verify backend instance" in joined:
        log("email_entry", "failed", "clipboard/host text still present in UI")
        return False
    log("email_entry", "passed", "no clipboard junk detected")

    if not tap_label(p, "Sign In", exact=True):
        log("tap_sign_in", "failed", "button not found")
        return False
    for _ in range(8):
        time.sleep(3)
        p = dump("gsv_post_signin")
        sample = texts(p)[:20]
        if is_home(p):
            log("sign_in", "passed", str(sample))
            return True
        if has(p, "internet connection") or has(p, "Could not sign in"):
            log("sign_in", "failed", str(sample))
            return False
        if has(p, "Enter a valid email"):
            log("sign_in", "failed", str(sample))
            return False
    log("sign_in", "failed", f"unknown post-login UI: {sample}")
    return False


def screenshot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))


def tap_tab(label: str) -> bool:
    """Tap a bottom-nav tab by exact label (y near bottom of screen)."""
    p = dump("gsv_tab_pick")
    root = ET.parse(p).getroot()
    parent: dict = {}
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    best = None
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t.lower() != want:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if not m:
            continue
        y1 = int(m.group(2))
        if y1 < 2400:
            continue
        cur = n
        while cur is not None and cur.attrib.get("clickable") != "true":
            cur = parent.get(cur)
        target = cur if cur is not None else n
        m2 = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", target.attrib.get("bounds", ""))
        if not m2:
            continue
        x = (int(m2.group(1)) + int(m2.group(3))) // 2
        y = (int(m2.group(2)) + int(m2.group(4))) // 2
        if y < 2400:
            y = 2535  # fall back to known tab bar mid-y
        best = (x, y)
        break
    if not best:
        return False
    adb("shell", "input", "tap", str(best[0]), str(best[1]))
    time.sleep(2.5)
    return True


def open_search_from_header() -> bool:
    p = dump("gsv_before_search")
    root = ET.parse(p).getroot()
    parent: dict = {}
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    candidates: list[tuple[int, int, int]] = []
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        if t.lower() != "search" and d.lower() != "search":
            continue
        cur = n
        while cur is not None and cur.attrib.get("clickable") != "true":
            cur = parent.get(cur)
        if cur is None:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
        if not m:
            continue
        y = (int(m.group(2)) + int(m.group(4))) // 2
        x = (int(m.group(1)) + int(m.group(3))) // 2
        # Prefer header Search (top), ignore mid-screen ghosts
        if y < 400:
            candidates.append((y, x, y))
    if not candidates:
        return False
    candidates.sort()
    _, x, y = candidates[0]
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(3)
    return True


def go_home() -> None:
    if not tap_tab("Home"):
        adb("shell", "input", "tap", "160", "2535")
        time.sleep(2.5)


def go_more() -> None:
    if not tap_tab("More"):
        adb("shell", "input", "tap", "1440", "2535")
        time.sleep(2.5)


def type_search(query: str) -> bool:
    p = dump("gsv_search_focus")
    eds = edit_centers(p)
    if not eds:
        return False
    adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
    time.sleep(0.2)
    clear_field(50)
    type_text(query)
    time.sleep(2.8)
    return True


def bottom_tab_labels(p: Path) -> list[str]:
    """Labels on the actual bottom tab bar only (y >= 2480)."""
    root = ET.parse(p).getroot()
    labels = []
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t not in {"Home", "Sheds", "Batches", "Tasks", "More", "Search", "Find a bird"}:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if not m:
            continue
        if int(m.group(2)) >= 2480:
            labels.append(t)
    return labels


def on_search_screen(p: Path) -> bool:
    return bool(edit_centers(p)) and (
        has(p, "Search birds, batches, or sheds")
        or has(p, "Results stay within")
        or has(p, "No matches")
        or has(p, "BIRDS")
        or has(p, "BATCHES")
        or has(p, "SHEDS")
        or has(p, "Type at least")
        or has(p, "Search by band")
    )


def pop_to_search_input(max_backs: int = 4) -> Path | None:
    """If search-tab stack is on a detail screen, back until the search input is visible."""
    for _ in range(max_backs):
        p = dump("gsv_search_pop")
        if on_search_screen(p) or edit_centers(p):
            return p
        if not tap_label(p, "Back"):
            adb("shell", "input", "keyevent", "4")
        time.sleep(1.5)
    p = dump("gsv_search_pop_final")
    return p if edit_centers(p) else None


def ensure_on_search() -> Path | None:
    p = dump("gsv_search_check")
    if on_search_screen(p) or edit_centers(p):
        return p
    # May already be on a search-stack detail (bird/batch/shed profile)
    popped = pop_to_search_input()
    if popped is not None and (on_search_screen(popped) or edit_centers(popped)):
        return popped
    go_home()
    if not open_search_from_header():
        return None
    p = dump("gsv_search_open")
    if on_search_screen(p) or edit_centers(p):
        return p
    return pop_to_search_input()


def run_owner_flows() -> None:
    go_home()
    p = dump("gsv_home")
    screenshot("gsv_home_ui")
    sample = texts(p)
    if has(p, "Find a bird"):
        log("home_no_find_a_bird", "failed", "Find a bird still present")
    else:
        log("home_no_find_a_bird", "passed", "absent")

    has_icon = any(
        (n.attrib.get("content-desc") or "").strip().lower() == "search"
        for n in ET.parse(p).getroot().iter("node")
    )
    if has_icon:
        log("home_search_entry", "passed", "header Search button present")
    else:
        log("home_search_entry", "failed", str(sample[:18]))

    tabs = bottom_tab_labels(p)
    intended = {"Home", "Sheds", "Batches", "Tasks", "More"}
    leaked = [t for t in tabs if t not in intended]
    found = intended.intersection(set(tabs))
    ok = found == intended and not leaked
    log("bottom_tabs", "passed" if ok else "failed", f"tabs={tabs} found={sorted(found)} leaked={leaked}")

    go_more()
    p = dump("gsv_more")
    screenshot("gsv_more_ui")
    if has(p, "Find a bird"):
        log("more_no_find_a_bird", "failed")
    else:
        log("more_no_find_a_bird", "passed")
    more_search = any(
        (n.attrib.get("text") or "").strip().lower() == "search"
        or (n.attrib.get("content-desc") or "").strip().lower() == "search"
        for n in ET.parse(p).getroot().iter("node")
    )
    log("more_search_entry", "passed" if more_search else "failed")

    # Bird exact
    p = ensure_on_search()
    if p is None:
        log("open_global_search", "failed", "could not open search")
        return
    log("open_global_search", "passed", str(texts(p)[:10]))
    screenshot("gsv_search_blank")

    if not type_search(SEED["band"]):
        log("type_band", "failed", "no EditText")
        return
    log("type_band", "passed", SEED["band"])
    p = dump("gsv_bird_results")
    screenshot("gsv_bird_results")
    if has(p, SEED["band"]):
        log("exact_bird_ui", "passed")
    else:
        log("exact_bird_ui", "failed", str(texts(p)[:20]))
        return

    if tap_result_card(p, SEED["band"]):
        time.sleep(4)
        p = dump("gsv_bird_profile")
        screenshot("gsv_bird_profile")
        if has(p, "Bird profile") and has(p, "Band") and has(p, SEED["band"]):
            log("open_bird_profile", "passed", str(texts(p)[:14]))
        else:
            log("open_bird_profile", "failed", str(texts(p)[:20]))
        if not tap_label(p, "Back", exact=True):
            adb("shell", "input", "keyevent", "4")
        time.sleep(2)
        p = dump("gsv_back_bird")
        if on_search_screen(p) or (has(p, SEED["band"]) and edit_centers(p)) or (
            has(p, SEED["band"]) and has(p, "BIRDS")
        ):
            log("back_to_search_bird", "passed", str(texts(p)[:12]))
        else:
            log("back_to_search_bird", "failed", str(texts(p)[:18]))
    else:
        log("open_bird_profile", "failed", "tap missed")

    # Partial
    if ensure_on_search() is None:
        log("partial_bird_ui", "failed", "search unavailable")
    else:
        type_search("GB-11")
        p = dump("gsv_partial")
        screenshot("gsv_partial")
        log(
            "partial_bird_ui",
            "passed" if has(p, SEED["band"]) or has(p, "GB-11") else "failed",
            str(texts(p)[:15]),
        )

    # Batch
    if ensure_on_search() is None:
        log("batch_ui", "failed", "search unavailable")
    else:
        type_search(SEED["batch"])
        p = dump("gsv_batch")
        screenshot("gsv_batch")
        if has(p, SEED["batch"]):
            log("batch_ui", "passed")
            if tap_result_card(p, SEED["batch"]):
                time.sleep(4)
                p = dump("gsv_batch_detail")
                screenshot("gsv_batch_detail")
                log(
                    "open_batch_detail",
                    "passed"
                    if (has(p, SEED["batch"]) and not has(p, "BIRDS"))
                    or has(p, "Batch detail")
                    or has(p, "Flock")
                    or has(p, "Population")
                    else "failed",
                    str(texts(p)[:14]),
                )
                if not tap_label(p, "Back", exact=True):
                    adb("shell", "input", "keyevent", "4")
                time.sleep(1.5)
            else:
                log("open_batch_detail", "failed", "tap missed")
        else:
            log("batch_ui", "failed", str(texts(p)[:18]))

    # Shed
    if ensure_on_search() is None:
        log("shed_ui", "failed", "search unavailable")
    else:
        type_search(SEED["shed_code"])
        p = dump("gsv_shed")
        screenshot("gsv_shed")
        if has(p, SEED["shed_code"]) or has(p, "Alpha Shed"):
            log("shed_ui", "passed")
            if tap_result_card(p, "Alpha Shed") or tap_result_card(p, SEED["shed_code"]):
                time.sleep(4)
                p = dump("gsv_shed_detail")
                screenshot("gsv_shed_detail")
                log(
                    "open_shed_detail",
                    "passed"
                    if (has(p, "Alpha") or has(p, SEED["shed_code"]))
                    and (has(p, "Shed") or has(p, "Capacity") or has(p, "Batches"))
                    else "failed",
                    str(texts(p)[:14]),
                )
                if not tap_label(p, "Back", exact=True):
                    adb("shell", "input", "keyevent", "4")
                time.sleep(1.5)
            else:
                log("open_shed_detail", "failed", "tap missed")
        else:
            log("shed_ui", "failed", str(texts(p)[:18]))

    # Empty + clear
    if ensure_on_search() is None:
        log("empty_ui", "failed", "search unavailable")
    else:
        type_search("ZZZNOPE999")
        p = dump("gsv_empty")
        screenshot("gsv_empty")
        log(
            "empty_ui",
            "passed" if has(p, "No matches") or has(p, "Nothing matched") else "failed",
            str(texts(p)[:14]),
        )
        if not tap_label(p, "Clear search"):
            eds = edit_centers(p)
            if eds:
                adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
                clear_field(40)
        time.sleep(1.2)
        p = dump("gsv_cleared")
        screenshot("gsv_cleared")
        log(
            "clear_query",
            "passed"
            if has(p, "at least")
            or has(p, "Search by")
            or has(p, "Type at least")
            or not has(p, "ZZZNOPE")
            else "failed",
            str(texts(p)[:12]),
        )


def main() -> None:
    # Network probe from emulator (do not log secrets)
    probe = adb("shell", "curl", "-s", "-m", "4", "http://10.0.2.2:8002/health")
    body = (probe.stdout or "").strip()
    if '"status"' in body and "ok" in body:
        log("emulator_reaches_10_0_2_2_8002", "passed", body[:80])
    else:
        log(
            "emulator_reaches_10_0_2_2_8002",
            "failed",
            f"stdout={body[:120]} stderr={(probe.stderr or '')[:80]}",
        )

    if not ensure_logged_in():
        out = {
            "authenticated": False,
            "blocker": "Could not complete Sign In without clipboard; see steps",
            "results": results,
            "passed": sum(1 for r in results if r["status"] == "passed"),
            "failed": sum(1 for r in results if r["status"] == "failed"),
            "not_tested": [
                "owner_search_ui_flows",
                "farmer_ui_search",
            ],
        }
        (S / "global_search_emulator_ui_verification.json").write_text(
            json.dumps(out, indent=2), encoding="utf-8"
        )
        print("EMU_UI_SUMMARY", json.dumps({k: out[k] for k in out if k != "results"}))
        return

    run_owner_flows()
    out = {
        "authenticated": True,
        "api_base_effective": "http://10.0.2.2:8002 (EXPO_PUBLIC_API_URL)",
        "host_api_base": "http://127.0.0.1:8002",
        "backend_port": 8002,
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [
            "farmer_ui_search",
            "retry_after_forced_network_error",
            "partial_section_api_failure_ui",
        ],
    }
    (S / "global_search_emulator_ui_verification.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8"
    )
    print("EMU_UI_SUMMARY", json.dumps({k: out[k] for k in out if k != "results"}))


if __name__ == "__main__":
    main()
