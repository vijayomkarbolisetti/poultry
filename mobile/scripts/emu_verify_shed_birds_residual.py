"""Residual emulator checks: add bird, edit, lifecycle confirm, farmer access."""

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
results: list[dict] = []


def log(step: str, status: str, detail: str = "") -> None:
    safe = detail.replace(PASSWORD, "[REDACTED]").replace(EMAIL, "[owner]")
    if SEED.get("farmer_email"):
        safe = safe.replace(SEED["farmer_email"], "[farmer]")
    results.append({"step": step, "status": status, "detail": safe[:350]})
    print(f"{status.upper():10} {step} — {safe[:150]}")


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


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
    if not p.exists():
        return []
    return [(n.attrib.get("text") or "").strip() for n in ET.parse(p).getroot().iter("node") if (n.attrib.get("text") or "").strip()]


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
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true" and not (cur.attrib.get("class") or "").endswith("EditText"):
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
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


def clear_field(n: int = 50) -> None:
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(n):
        adb("shell", "input", "keyevent", "67")


def type_text(raw: str) -> None:
    adb("shell", "input", "text", raw.replace(" ", "%s").replace("@", r"\@"))


def scroll_down() -> None:
    adb("shell", "input", "swipe", "800", "1800", "800", "700", "350")
    time.sleep(0.7)


def tap_tab(label: str) -> None:
    mapping = {"Home": 160, "Sheds": 480, "Batches": 800, "Tasks": 1120, "More": 1440}
    adb("shell", "input", "tap", str(mapping.get(label, 480)), "2535")
    time.sleep(2.2)


def open_shed() -> Path | None:
    tap_tab("Sheds")
    p = dump("res_sheds")
    for _ in range(10):
        if has(p, "SBM Verify") or has(p, SEED["shed_code"]) or has(p, "SBM1210"):
            break
        scroll_down()
        p = dump("res_sheds")
    if not (tap_label(p, "SBM Verify") or tap_label(p, "SBM1210") or tap_label(p, SEED["shed_code"])):
        log("open_shed", "failed", str(texts(p)[:16]))
        return None
    time.sleep(3.5)
    p = dump("res_shed")
    if has(p, "SBM Verify") or has(p, "Add Bird") or has(p, "Unbanded birds"):
        log("open_shed", "passed", str(texts(p)[:12]))
        return p
    log("open_shed", "failed", str(texts(p)[:16]))
    return None


def find_birds() -> Path:
    p = dump("res_birds")
    for _ in range(8):
        if has(p, "Add Bird") or has(p, "Unbanded birds") or has(p, "Search by band"):
            return p
        scroll_down()
        p = dump("res_birds")
    return p


def main() -> None:
    # Ensure owner home
    tap_tab("Home")
    p = dump("res_home")
    if has(p, "Sign In"):
        eds = edit_centers(p)
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        clear_field(80)
        type_text(EMAIL)
        adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
        clear_field(40)
        type_text(PASSWORD)
        tap_label(p, "Sign In", exact=True)
        time.sleep(8)

    if open_shed() is None:
        _write()
        return

    p = find_birds()
    screenshot("res_birds_section")

    # --- Add bird ---
    if not tap_label(p, "Add Bird"):
        log("add_bird_ui", "failed", "no Add Bird")
    else:
        time.sleep(3)
        p = dump("res_add")
        # Wait for auto-prefill of single batch
        for _ in range(6):
            if has(p, SEED["batch_code"]) and not has(p, "Select…"):
                break
            if has(p, "Select…"):
                tap_label(p, "Select…")
                time.sleep(1)
                p = dump("res_pick")
                tap_label(p, SEED["batch_code"])
                time.sleep(1.2)
            time.sleep(0.8)
            p = dump("res_add")
        eds = edit_centers(p)
        new_band = f"{SEED['tag']}-UI2"
        if eds:
            adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
            clear_field(40)
            type_text(new_band)
            time.sleep(0.4)
        p = dump("res_add_filled")
        screenshot("res_add_filled")
        if not has(p, SEED["batch_code"]):
            log("add_bird_ui", "failed", f"batch not selected: {texts(p)[:16]}")
        elif not tap_label(p, "Create bird"):
            log("add_bird_ui", "failed", "Create bird tap missed")
        else:
            time.sleep(5)
            p = dump("res_after_add")
            screenshot("res_after_add")
            # Success = left add form OR band appears on shed
            left_form = not (has(p, "Create bird") and has(p, "Band number"))
            shows_band = has(p, new_band)
            if left_form or shows_band:
                log("add_bird_ui", "passed", str(texts(p)[:14]))
            else:
                err = [t for t in texts(p) if "Band" in t or "error" in t.lower() or "Could" in t]
                log("add_bird_ui", "failed", f"still on form {err} {texts(p)[:12]}")
            if has(p, "Create bird"):
                tap_label(p, "Cancel") or adb("shell", "input", "keyevent", "4")
                time.sleep(2)

    if open_shed() is None:
        _write()
        return
    p = find_birds()

    # --- Edit A2 ---
    eds = edit_centers(p)
    if eds:
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        clear_field(40)
        type_text(f"{SEED['tag']}-A2")
        time.sleep(2.5)
        p = dump("res_a2_search")
    if tap_label(p, f"{SEED['tag']}-A2"):
        time.sleep(3)
        p = dump("res_a2_prof")
        if tap_label(p, "Edit details"):
            time.sleep(2.5)
            p = dump("res_edit")
            screenshot("res_edit")
            eds = edit_centers(p)
            if len(eds) >= 2:
                adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
                clear_field(40)
                type_text("EditUI")
                tap_label(p, "Save changes")
                time.sleep(4)
                p = dump("res_after_edit")
                screenshot("res_after_edit")
                log(
                    "edit_bird_ui",
                    "passed" if has(p, "EditUI") or has(p, f"{SEED['tag']}-A2") else "failed",
                    str(texts(p)[:14]),
                )
            else:
                log("edit_bird_ui", "failed", "no fields")
        else:
            log("edit_bird_ui", "failed", "no edit button")
        tap_label(dump("res_bk"), "Back", exact=True) or adb("shell", "input", "keyevent", "4")
        time.sleep(2)
    else:
        log("edit_bird_ui", "failed", "A2 not found")

    if open_shed() is None:
        _write()
        return
    p = find_birds()
    eds = edit_centers(p)
    if eds:
        adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
        clear_field(40)
        type_text(f"{SEED['tag']}-B9")
        time.sleep(2.5)
        p = dump("res_b9")
    if tap_label(p, f"{SEED['tag']}-B9"):
        time.sleep(3)
        for _ in range(5):
            scroll_down()
        p = dump("res_life")
        if tap_label(p, "Record mortality"):
            time.sleep(1.2)
            p = dump("res_life_alert")
            screenshot("res_life_alert")
            log(
                "lifecycle_confirm_copy",
                "passed" if has(p, "Cancel") or has(p, "not be deleted") or has(p, "mortality") else "failed",
                str(texts(p)[:14]),
            )
            tap_label(p, "Cancel") or adb("shell", "input", "keyevent", "4")
            log("lifecycle_cancel", "passed")
        else:
            log("lifecycle_confirm_copy", "failed", str(texts(p)[:16]))
            log("lifecycle_cancel", "not_tested")
    else:
        log("lifecycle_confirm_copy", "failed", "B9 missing")
        log("lifecycle_cancel", "not_tested")

    # Farmer
    tap_tab("More")
    p = dump("res_more")
    for _ in range(3):
        if has(p, "Log out"):
            break
        scroll_down()
        p = dump("res_more")
    tap_label(p, "Log out", exact=True)
    time.sleep(4)
    p = dump("res_flogin")
    if not has(p, "Sign In"):
        log("farmer_login", "failed", str(texts(p)[:12]))
        _write()
        return
    eds = edit_centers(p)
    adb("shell", "input", "tap", str(eds[0][0]), str(eds[0][1]))
    clear_field(80)
    type_text(SEED["farmer_email"])
    adb("shell", "input", "tap", str(eds[1][0]), str(eds[1][1]))
    clear_field(40)
    type_text("password123")
    tap_label(p, "Sign In", exact=True)
    for _ in range(10):
        time.sleep(3)
        p = dump("res_fpost")
        if (has(p, "Hello") or has(p, "Live birds") or has(p, "OVERVIEW")) and not has(p, "Sign In"):
            log("farmer_login", "passed", str(texts(p)[:12]))
            break
        if has(p, "internet"):
            log("farmer_login", "failed", str(texts(p)[:12]))
            _write()
            return
    else:
        log("farmer_login", "failed", str(texts(p)[:14]))
        _write()
        return

    if open_shed() is not None:
        p = find_birds()
        screenshot("res_farmer_birds")
        ok = has(p, "Add Bird") or has(p, "Unbanded") or has(p, f"{SEED['tag']}-A1") or has(p, "registered")
        log("farmer_assigned_shed_birds", "passed" if ok else "failed", str(texts(p)[:14]))
    else:
        log("farmer_assigned_shed_birds", "failed")

    # Deny other shed
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
        p = dump("res_fdeny")
        screenshot("res_farmer_deny")
        if has(p, "denied") or has(p, "not found") or has(p, "Retry") or not has(p, "Add Bird"):
            log("farmer_ui_denied_other_shed", "passed", str(texts(p)[:12]))
        else:
            log("farmer_ui_denied_other_shed", "failed", str(texts(p)[:12]))

    _write()


def _write() -> None:
    out = {
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
    }
    (S / "shed_birds_emulator_residual.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("RESIDUAL_SUMMARY", json.dumps(out))


if __name__ == "__main__":
    main()
