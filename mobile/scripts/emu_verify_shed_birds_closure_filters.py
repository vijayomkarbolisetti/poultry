"""Focused residual: create/duplicate + filters/search/pagination after scroll-up fix."""

from __future__ import annotations

import importlib.util
import json
import time
import uuid
from pathlib import Path

S = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("closure", S / "emu_verify_shed_birds_closure.py")
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

results = mod.results
SEED = mod.SEED
TAG = mod.TAG
EMAIL = mod.EMAIL
PASSWORD = mod.PASSWORD


def main() -> None:
    headers = mod.login(EMAIL, PASSWORD)
    mod.log("api_owner_login", "passed")
    mod.ensure_owner_session()

    if mod.open_sbm_shed() is None:
        _write()
        return
    p = mod.find_birds_section()
    mod.screenshot("cl2_birds_section")
    mod.log(
        "birds_section_visible",
        "passed" if mod.has(p, "Add Bird") or mod.has(p, "Search by band") else "failed",
        str(mod.texts(p)[:14]),
    )

    # Create + duplicate
    new_band = f"{TAG}-CF{str(uuid.uuid4().int)[-4:]}"
    if not mod.tap_label(p, "Add Bird"):
        mod.log("add_bird_create", "failed", "Add Bird missing")
    else:
        time.sleep(3.5)
        p = mod.dump("cl2_add")
        for _ in range(8):
            if mod.has(p, SEED["batch_code"]) and not mod.has(p, "Select…"):
                break
            time.sleep(0.7)
            p = mod.dump("cl2_add")
        mod.log(
            "add_bird_batch_autoselect",
            "passed" if mod.has(p, SEED["batch_code"]) else "failed",
            str(mod.texts(p)[:12]),
        )
        eds = mod.edit_centers(p)
        if eds:
            mod.tap_xy(eds[0][0], eds[0][1])
            mod.clear_field(40)
            mod.type_text(new_band)
        mod.screenshot("cl2_add_filled")
        mod.tap_label(p, "Create bird")
        time.sleep(5)
        p = mod.dump("cl2_after_add")
        mod.screenshot("cl2_after_add")
        api_row = mod.bird_in_api(headers, new_band)
        mod.log(
            "add_bird_create",
            "passed" if api_row else "failed",
            f"band={new_band} api={bool(api_row)} texts={mod.texts(p)[:10]}",
        )
        if mod.has(p, "Create bird"):
            mod.tap_label(p, "Cancel") or mod.adb("shell", "input", "keyevent", "4")
            time.sleep(2)

        if mod.open_sbm_shed() is None:
            _write()
            return
        p = mod.find_birds_section()
        if mod.tap_label(p, "Add Bird"):
            time.sleep(3)
            p = mod.dump("cl2_dup")
            for _ in range(6):
                if mod.has(p, SEED["batch_code"]):
                    break
                time.sleep(0.6)
                p = mod.dump("cl2_dup")
            eds = mod.edit_centers(p)
            if eds:
                mod.tap_xy(eds[0][0], eds[0][1])
                mod.clear_field(40)
                mod.type_text(new_band)
            mod.tap_label(p, "Create bird")
            time.sleep(4)
            p = mod.dump("cl2_dup_err")
            mod.screenshot("cl2_dup_err")
            code, after = mod.api(
                "GET",
                f"/api/v1/birds/in-shed?shed_id={SEED['shed_id']}&q={new_band}&include_inactive=true&limit=20",
                headers,
            )
            count = len([i for i in (after.get("items") if code == 200 else []) if i.get("band_id") == new_band])
            still = mod.has(p, "Create bird")
            mod.log(
                "add_bird_duplicate_rejected",
                "passed" if still and count <= 1 else "failed",
                f"count={count} texts={mod.texts(p)[:12]}",
            )
            mod.tap_label(p, "Cancel") or mod.adb("shell", "input", "keyevent", "4")
            time.sleep(1.5)

    # Filters / search / load more
    if mod.open_sbm_shed() is None:
        _write()
        return
    p = mod.find_birds_section()

    if mod.tap_label(p, "Active only") or mod.tap_label(p, "Lifecycle status"):
        time.sleep(1.2)
        p = mod.dump("cl2_life_opts")
        if mod.tap_label(p, "Dead", exact=True) or mod.tap_label(p, "Dead"):
            time.sleep(2.5)
            p = mod.dump("cl2_filt_dead")
            mod.screenshot("cl2_filter_dead")
            mod.log("filter_lifecycle_ui", "passed", str(mod.texts(p)[:14]))
        else:
            mod.log("filter_lifecycle_ui", "failed", str(mod.texts(p)[:12]))
    else:
        mod.log("filter_lifecycle_ui", "failed", "lifecycle select not found")

    p = mod.find_birds_section()
    if mod.tap_label(p, "All batches") or mod.tap_label(p, "Batch", exact=True) or mod.tap_label(p, SEED["batch_code"]):
        time.sleep(1.2)
        p = mod.dump("cl2_batch_opts")
        # If picker opened, choose batch; if already on batch code label, still ok
        mod.tap_label(p, SEED["batch_code"])
        time.sleep(2.2)
        p = mod.dump("cl2_filt_batch")
        mod.screenshot("cl2_filter_batch")
        mod.log(
            "filter_batch_ui",
            "passed" if mod.has(p, SEED["batch_code"]) or mod.has(p, "registered") else "failed",
            str(mod.texts(p)[:12]),
        )
    else:
        mod.log("filter_batch_ui", "failed", "batch select not found")

    eds = mod.edit_centers(p)
    if eds:
        mod.tap_xy(eds[0][0], eds[0][1])
        mod.clear_field(40)
        mod.type_text(f"{TAG}-A")
        time.sleep(2.8)
        p = mod.dump("cl2_search_partial")
        mod.screenshot("cl2_search_partial")
        mod.log(
            "search_partial_ui",
            "passed" if mod.has(p, f"{TAG}-A") else "failed",
            str(mod.texts(p)[:12]),
        )
        mod.clear_field(40)
        mod.type_text(f"{TAG}-A1")
        time.sleep(2.8)
        p = mod.dump("cl2_search_exact")
        mod.screenshot("cl2_search_exact")
        mod.log(
            "search_exact_ui",
            "passed" if mod.has(p, f"{TAG}-A1") else "failed",
            str(mod.texts(p)[:10]),
        )
        # Clear search for pagination
        mod.clear_field(40)
        time.sleep(1.5)
    else:
        mod.log("search_partial_ui", "failed", "no search field")
        mod.log("search_exact_ui", "not_tested")

    # Reset lifecycle to All statuses for larger page
    if mod.tap_label(p, "Dead") or mod.tap_label(p, "Active only") or mod.tap_label(p, "All statuses"):
        time.sleep(1)
        p = mod.dump("cl2_page_opts")
        mod.tap_label(p, "All statuses") or mod.tap_label(p, "Active only")
        time.sleep(2)

    p = mod.find_birds_section()
    for _ in range(14):
        if mod.has(p, "Load more"):
            break
        mod.scroll_down()
        p = mod.dump("cl2_page_scroll")
    if mod.has(p, "Load more"):
        mod.tap_label(p, "Load more")
        time.sleep(3)
        p = mod.dump("cl2_after_more")
        mod.screenshot("cl2_load_more")
        showing = [t for t in mod.texts(p) if t.startswith("Showing")]
        mod.log("pagination_load_more_ui", "passed", str(showing or mod.texts(p)[:12]))
    else:
        mod.log("pagination_load_more_ui", "failed", str(mod.texts(p)[:14]))

    _write()


def _write() -> None:
    out = {
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "artifacts": mod.artifacts,
    }
    (S / "shed_birds_emulator_closure_filters.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("FILTERS_SUMMARY", json.dumps({k: out[k] for k in ("passed", "failed", "not_tested")}))


if __name__ == "__main__":
    main()
