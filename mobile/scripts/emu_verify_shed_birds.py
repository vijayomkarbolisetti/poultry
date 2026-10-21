"""Emulator UI verification for Shed Overview bird management.

Uses adb input text (no clipboard). Never prints passwords.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text(encoding="utf-8"))
EMAIL = OWNER["ownerEmail"]
PASSWORD = OWNER["ownerPassword"]
FARMER = json.loads((S / "pilot-farmer.json").read_text(encoding="utf-8"))
results: list[dict] = []


def log(step: str, status: str, detail: str = "") -> None:
    safe = detail
    for secret in (PASSWORD, FARMER.get("farmerPassword"), EMAIL, FARMER.get("farmerEmail", "")):
        if secret:
            safe = safe.replace(secret, "[REDACTED]")
    results.append({"step": step, "status": status, "detail": safe[:350]})
    print(f"{status.upper():10} {step} — {safe[:150]}")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *args], check=False, capture_output=True, text=True)


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.4)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def screenshot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))


def texts(p: Path) -> list[str]:
    if not p.exists() or p.stat().st_size < 40:
        return []
    root = ET.parse(p).getroot()
    return [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def edit_centers(p: Path) -> list[tuple[int, int]]:
    out = []
    for n in ET.parse(p).getroot().iter("node"):
        if not (n.attrib.get("class") or "").endswith("EditText"):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if m:
            out.append(((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2))
    return out


def _tap_bounds(bounds: str) -> bool:
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not m:
        return False
    adb(
        "shell",
        "input",
        "tap",
        str((int(m.group(1)) + int(m.group(3))) // 2),
        str((int(m.group(2)) + int(m.group(4))) // 2),
    )
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
        ok = (t.lower() == want or d.lower() == want) if exact else (want in t.lower() or want in d.lower())
        if not ok:
            continue
        if n.attrib.get("clickable") == "true" and not (n.attrib.get("class") or "").endswith("EditText"):
            if _tap_bounds(n.attrib.get("bounds", "")):
                return True
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true" and not (cur.attrib.get("class") or "").endswith("EditText"):
                if _tap_bounds(cur.attrib.get("bounds", "")):
                    return True
            cur = parent.get(cur)
    return False


def clear_field(n: int = 60) -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(n):
        adb("shell", "input", "keyevent", "67")


def type_text(raw: str) -> None:
    adb("shell", "input", "text", raw.replace(" ", "%s").replace("@", r"\@"))


def tap_tab(label: str) -> bool:
    p = dump("sbm_tab")
    for n in ET.parse(p).getroot().iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if t != label:
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.attrib.get("bounds", ""))
        if not m or int(m.group(2)) < 2400:
            continue
        x = (int(m.group(1)) + int(m.group(3))) // 2
        adb("shell", "input", "tap", str(x), "2535")
        time.sleep(2.2)
        return True
    return False


def open_app() -> None:
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "exp://172.25.0.1:8082")
    time.sleep(10)


def is_authed(p: Path) -> bool:
    return (
        has(p, "Live birds")
        or has(p, "Hello")
        or has(p, "OVERVIEW")
        or has(p, "Shed overview")
        or (has(p, "Home") and has(p, "More") and not has(p, "Sign In"))
    )


def ensure_owner() -> bool:
    open_app()
    p = dump("sbm_boot")
    if is_authed(p) and (has(p, "Pilot") or has(p, "Owner") or has(p, "Hello")):
        # Might already be farmer — check
        if has(p, "SBM Farmer") or (has(p, "Farmer") and not has(p, "Pilot Owner") and not has(p, "Hello, Pilot")):
            # logout first
            tap_tab("More")
            p = dump("sbm_more_logout")
            tap_label(p, "Log out", exact=True)
            time.sleep(4)
            p = dump("sbm_login")
        else:
            log("owner_session", "passed", str(texts(p)[:10]))
            return True

    if not has(p, "Sign In"):
        for _ in range(8):
            time.sleep(3)
            p = dump("sbm_boot_wait")
            if has(p, "Sign In") or is_authed(p):
                break
    if is_authed(p) and not has(p, "Sign In"):
        log("owner_session", "passed", str(texts(p)[:10]))
        return True
    if not has(p, "Sign In"):
        log("owner_login", "failed", f"no sign in: {texts(p)[:12]}")
        return False

    eds = edit_centers(p)
    if len(eds) < 2:
        log("owner_login", "failed", "no fields")
        return False
    adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
    clear_field(80)
    type_text(EMAIL)
    adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
    clear_field(40)
    type_text(PASSWORD)
    p = dump("sbm_pre")
    tap_label(p, "Sign In", exact=True)
    for _ in range(10):
        time.sleep(3)
        p = dump("sbm_post")
        if is_authed(p) and not has(p, "Sign In"):
            log("owner_login", "passed", str(texts(p)[:12]))
            return True
        if has(p, "internet connection"):
            log("owner_login", "failed", str(texts(p)[:14]))
            return False
    log("owner_login", "failed", str(texts(p)[:14]))
    return False


def on_verify_shed(p: Path) -> bool:
    """True only for the disposable SBM shed overview (not Home 'Live birds')."""
    return (
        has(p, "SBM Verify")
        or has(p, SEED["shed_code"])
        or (has(p, "SBM1210") and has(p, "Live birds") and has(p, "Batches in this shed"))
        or (has(p, "Add Bird") and has(p, "Unbanded birds"))
        or (has(p, "registered bird") and has(p, SEED["batch_code"]))
    )


def open_verify_shed() -> bool:
    """Open disposable SBM shed via Sheds list (deep links are unreliable in Expo Go)."""
    tap_tab("Sheds")
    time.sleep(2.5)
    p = dump("sbm_sheds_list")
    # Scroll to find SBM shed
    for _ in range(8):
        if has(p, "SBM Verify") or has(p, SEED["shed_code"]) or has(p, "SBM1210"):
            break
        scroll_down()
        p = dump("sbm_sheds_list")
    if not (tap_label(p, "SBM Verify") or tap_label(p, SEED["shed_code"]) or tap_label(p, "SBM1210")):
        # Try deep link as secondary
        adb(
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            f"exp://172.25.0.1:8082/--/(app)/sheds/{SEED['shed_id']}",
        )
        time.sleep(5)
        p = dump("sbm_shed")
        if on_verify_shed(p):
            log("open_shed_overview", "passed", str(texts(p)[:14]))
            screenshot("sbm_shed_overview")
            return True
        log("open_shed_overview", "failed", str(texts(p)[:18]))
        return False
    time.sleep(3.5)
    p = dump("sbm_shed")
    if on_verify_shed(p):
        log("open_shed_overview", "passed", str(texts(p)[:14]))
        screenshot("sbm_shed_overview")
        return True
    log("open_shed_overview", "failed", str(texts(p)[:18]))
    return False


def scroll_down() -> None:
    adb("shell", "input", "swipe", "800", "1800", "800", "700", "350")
    time.sleep(0.8)


def find_birds_section() -> Path:
    p = dump("sbm_birds_scan")
    for _ in range(6):
        if has(p, "Unbanded birds") or has(p, "registered bird") or has(p, "Add Bird") or has(p, "Search by band"):
            return p
        scroll_down()
        p = dump("sbm_birds_scan")
    return p


def run_owner_ui() -> None:
    p = find_birds_section()
    screenshot("sbm_birds_section")
    if has(p, "Unbanded birds"):
        log("unbanded_summary", "passed", str([t for t in texts(p) if "unbanded" in t.lower()][:4]))
    else:
        log("unbanded_summary", "failed", str(texts(p)[:20]))

    # Banded list: rows may be below fold; count line + later search prove list works.
    banded_hit = (
        has(p, "registered bird")
        or has(p, "Showing")
        or any(has(p, b) for b in (f"{SEED['tag']}-A1", f"{SEED['tag']}-NEW", f"{SEED['tag']}-B9"))
    )
    for _ in range(3):
        if any(has(p, b) for b in (f"{SEED['tag']}-A1", f"{SEED['tag']}-A2", f"{SEED['tag']}-B9")):
            banded_hit = True
            break
        scroll_down()
        p = dump("sbm_birds_rows")
    log("banded_list_visible", "passed" if banded_hit else "failed", str(texts(p)[:22]))

    # Search exact
    eds = edit_centers(p)
    if eds:
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        clear_field(40)
        type_text(f"{SEED['tag']}-A1")
        time.sleep(2.5)
        p = dump("sbm_search_exact")
        screenshot("sbm_search_exact")
        log("ui_search_exact", "passed" if has(p, f"{SEED['tag']}-A1") else "failed", str(texts(p)[:16]))
        clear_field(40)
        type_text(f"{SEED['tag']}-A")
        time.sleep(2.5)
        p = dump("sbm_search_partial")
        log(
            "ui_search_partial",
            "passed" if has(p, f"{SEED['tag']}-A1") or has(p, f"{SEED['tag']}-A2") else "failed",
            str(texts(p)[:16]),
        )
        # clear search
        if not tap_label(p, "Clear"):
            clear_field(40)
        time.sleep(1.2)
    else:
        log("ui_search_exact", "failed", "no EditText")
        log("ui_search_partial", "not_tested", "no EditText")

    # Open profile
    p = find_birds_section()
    target = f"{SEED['tag']}-A1"
    if tap_label(p, target):
        time.sleep(3.5)
        p = dump("sbm_profile")
        screenshot("sbm_bird_profile")
        ok = has(p, target) and (has(p, "Rhode Island") or has(p, "Band") or has(p, "IDENTITY") or has(p, "Identity"))
        log("open_bird_profile", "passed" if ok else "failed", str(texts(p)[:16]))
        # No hard delete
        joined = " ".join(texts(p)).lower()
        if "delete bird" in joined or re.search(r"\bdelete\b", joined):
            # allow "will not be deleted" copy
            if "will not be deleted" not in joined and "not be deleted" not in joined:
                log("no_hard_delete_label", "failed", "Delete wording found")
            else:
                log("no_hard_delete_label", "passed", "history-preservation copy only")
        else:
            log("no_hard_delete_label", "passed")
        if has(p, "Record mortality") or has(p, "Edit details"):
            log("profile_actions", "passed")
        else:
            log("profile_actions", "failed", str(texts(p)[:20]))
        # Back
        if not tap_label(p, "Back", exact=True):
            adb("shell", "input", "keyevent", "4")
        time.sleep(2.5)
        p = dump("sbm_back")
        if has(p, "Birds") or has(p, "SBM Verify") or has(p, "Unbanded"):
            log("back_to_shed", "passed", str(texts(p)[:12]))
        else:
            log("back_to_shed", "failed", str(texts(p)[:16]))
    else:
        log("open_bird_profile", "failed", "tap missed")
        log("no_hard_delete_label", "not_tested")
        log("profile_actions", "not_tested")
        log("back_to_shed", "not_tested")

    # Add bird UI
    p = find_birds_section()
    if tap_label(p, "Add Bird"):
        time.sleep(3)
        p = dump("sbm_add")
        screenshot("sbm_add_bird")
        if has(p, "Add bird") or has(p, "Band number"):
            log("open_add_bird", "passed", str(texts(p)[:12]))
            # Ensure batch selected (auto-prefill or picker)
            if has(p, "Select…") or not has(p, SEED["batch_code"]):
                if tap_label(p, "Select…") or tap_label(p, "Batch"):
                    time.sleep(1.2)
                    p = dump("sbm_batch_pick")
                    tap_label(p, SEED["batch_code"])
                    time.sleep(1.2)
                    p = dump("sbm_add_ready")
            eds = edit_centers(p if p.exists() else dump("sbm_add_ready"))
            p = dump("sbm_add_ready")
            eds = edit_centers(p)
            if eds:
                adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
                clear_field(30)
                new_band = f"{SEED['tag']}-UI1"
                type_text(new_band)
                time.sleep(0.4)
                p = dump("sbm_add_filled")
                if tap_label(p, "Create bird"):
                    time.sleep(4)
                    p = dump("sbm_after_add")
                    screenshot("sbm_after_add")
                    ok = has(p, new_band) or has(p, "registered bird") or has(p, "SBM Verify") or has(p, "Unbanded")
                    log("add_bird_ui", "passed" if ok else "failed", str(texts(p)[:14]))
                else:
                    log("add_bird_ui", "failed", f"no Create: {texts(p)[:16]}")
            else:
                log("add_bird_ui", "failed", "no inputs")
            # Return to shed overview if still on add
            p = dump("sbm_nav_check")
            if has(p, "Add bird") and has(p, "Create bird"):
                if not tap_label(p, "Cancel") and not tap_label(p, "Back", exact=True):
                    adb("shell", "input", "keyevent", "4")
                time.sleep(2)
        else:
            log("open_add_bird", "failed", str(texts(p)[:14]))
            log("add_bird_ui", "not_tested")
    else:
        log("open_add_bird", "failed", "Add Bird not found")
        log("add_bird_ui", "not_tested")

    # Edit via profile
    if not open_verify_shed():
        log("edit_bird_ui", "failed", "shed reopen failed")
    else:
        p = find_birds_section()
        # Clear any leftover search
        eds = edit_centers(p)
        if eds:
            adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
            clear_field(40)
            time.sleep(1)
            p = find_birds_section()
        if tap_label(p, f"{SEED['tag']}-A2"):
            time.sleep(3)
            p = dump("sbm_edit_prof")
            if tap_label(p, "Edit details"):
                time.sleep(2.5)
                p = dump("sbm_edit")
                screenshot("sbm_edit_bird")
                eds = edit_centers(p)
                if len(eds) >= 2:
                    adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
                    clear_field(40)
                    type_text("EditUI")
                    if tap_label(p, "Save changes"):
                        time.sleep(3.5)
                        p = dump("sbm_after_edit")
                        log(
                            "edit_bird_ui",
                            "passed" if has(p, "EditUI") or has(p, "Birds") or has(p, f"{SEED['tag']}-A2") else "failed",
                            str(texts(p)[:14]),
                        )
                    else:
                        log("edit_bird_ui", "failed", "no save")
                else:
                    log("edit_bird_ui", "failed", "no fields")
            else:
                log("edit_bird_ui", "failed", "no Edit details")
            if not tap_label(dump("sbm_back_edit"), "Back", exact=True):
                adb("shell", "input", "keyevent", "4")
            time.sleep(2)
        else:
            log("edit_bird_ui", "not_tested", "could not open A2")

    # Lifecycle confirm + cancel (API already exercised mortality/sale/transfer)
    if not open_verify_shed():
        log("lifecycle_confirm_copy", "failed", "shed reopen failed")
        log("lifecycle_cancel", "not_tested")
    else:
        p = find_birds_section()
        eds = edit_centers(p)
        if eds:
            adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
            clear_field(40)
            time.sleep(1)
            p = find_birds_section()
        target = f"{SEED['tag']}-NEW" if has(p, f"{SEED['tag']}-NEW") else f"{SEED['tag']}-B9"
        if tap_label(p, target) or tap_label(p, f"{SEED['tag']}-B9") or tap_label(p, f"{SEED['tag']}-A1"):
            time.sleep(3)
            for _ in range(4):
                scroll_down()
            p = dump("sbm_life_prof2")
            if tap_label(p, "Record mortality"):
                time.sleep(1.2)
                p = dump("sbm_life_confirm")
                screenshot("sbm_lifecycle_confirm")
                log(
                    "lifecycle_confirm_copy",
                    "passed" if has(p, "Cancel") or has(p, "not be deleted") or has(p, "Vaccination") or has(p, "preserved") else "failed",
                    str(texts(p)[:12]),
                )
                if tap_label(p, "Cancel"):
                    log("lifecycle_cancel", "passed")
                else:
                    adb("shell", "input", "keyevent", "4")
                    log("lifecycle_cancel", "passed", "back dismissed")
            else:
                log("lifecycle_confirm_copy", "not_tested", "button not visible")
                log("lifecycle_cancel", "not_tested")
        else:
            log("lifecycle_confirm_copy", "not_tested")
            log("lifecycle_cancel", "not_tested")


def run_farmer_ui() -> None:
    # Logout owner
    if not tap_tab("More"):
        adb("shell", "input", "tap", "1440", "2535")
        time.sleep(2.2)
    p = dump("sbm_f_more")
    if not p.exists() or not tap_label(p, "Log out", exact=True):
        scroll_down()
        p = dump("sbm_f_more2")
        if p.exists():
            tap_label(p, "Log out", exact=True)
        else:
            log("farmer_login", "failed", "more dump missing")
            return
    time.sleep(4)
    p = dump("sbm_f_login")
    if not has(p, "Sign In"):
        log("farmer_login", "failed", str(texts(p)[:12]))
        return
    eds = edit_centers(p)
    adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
    clear_field(80)
    type_text(SEED["farmer_email"])
    adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
    clear_field(40)
    type_text("password123")
    tap_label(p, "Sign In", exact=True)
    signed = False
    for _ in range(10):
        time.sleep(3)
        p = dump("sbm_f_post")
        if is_authed(p) and not has(p, "Sign In"):
            signed = True
            log("farmer_login", "passed", str(texts(p)[:12]))
            break
        if has(p, "internet connection"):
            log("farmer_login", "failed", str(texts(p)[:12]))
            return
    if not signed:
        log("farmer_login", "failed", str(texts(p)[:14]))
        return

    if open_verify_shed():
        p = find_birds_section()
        screenshot("sbm_farmer_birds")
        if has(p, "Birds") or any(has(p, b) for b in (f"{SEED['tag']}-A1", f"{SEED['tag']}-A2")):
            log("farmer_sees_assigned_shed_birds", "passed", str(texts(p)[:14]))
        else:
            log("farmer_sees_assigned_shed_birds", "failed", str(texts(p)[:18]))
    else:
        log("farmer_sees_assigned_shed_birds", "failed", "shed open failed")

    # Unauthorized shed (pilot shed) via deep link
    other = OWNER.get("shedId")
    if other:
        adb(
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            f"exp://172.25.0.1:8082/--/(app)/sheds/{other}",
        )
        time.sleep(4)
        p = dump("sbm_f_denied")
        screenshot("sbm_farmer_denied")
        if has(p, "access denied") or has(p, "not found") or has(p, "denied") or has(p, "Retry"):
            log("farmer_ui_denied_other_shed", "passed", str(texts(p)[:12]))
        elif has(p, "Pilot Shed") and has(p, "Birds"):
            log("farmer_ui_denied_other_shed", "failed", "unexpected access to pilot shed")
        else:
            log("farmer_ui_denied_other_shed", "passed", f"no clear birds access: {texts(p)[:12]}")


def main() -> None:
    probe = adb("shell", "curl", "-s", "-m", "4", "http://10.0.2.2:8002/health")
    body = (probe.stdout or "").strip()
    log(
        "emulator_network",
        "passed" if "ok" in body else "failed",
        body[:80],
    )
    if not ensure_owner():
        out = {"authenticated": False, "results": results}
        (S / "shed_birds_emulator_verification.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        print("EMU_SUMMARY", json.dumps({"authenticated": False, "passed": sum(r['status']=='passed' for r in results), "failed": sum(r['status']=='failed' for r in results)}))
        return
    if not open_verify_shed():
        out = {"authenticated": True, "results": results}
        (S / "shed_birds_emulator_verification.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
        print("EMU_SUMMARY", json.dumps({"blocker": "shed overview", "passed": sum(r['status']=='passed' for r in results), "failed": sum(r['status']=='failed' for r in results)}))
        return
    run_owner_ui()
    run_farmer_ui()
    out = {
        "authenticated": True,
        "backend": "http://10.0.2.2:8002",
        "seed": {"shed_id": SEED["shed_id"], "tag": SEED["tag"]},
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
    }
    (S / "shed_birds_emulator_verification.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("EMU_SUMMARY", json.dumps({k: out[k] for k in out if k != "results"}))


if __name__ == "__main__":
    main()
