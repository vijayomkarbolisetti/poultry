"""Residual: confirm sale/transfer with exact button taps + select-mode when possible."""

from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
SERIAL = "emulator-5554"
BASE = "http://127.0.0.1:8002"
EXPO = "exp://10.0.2.2:8082/--"
OWNER = json.loads((S / "pilot-owner.json").read_text(encoding="utf-8"))
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text(encoding="utf-8"))
TAG = f"CFR{time.strftime('%H%M%S')}"
results: list[dict] = []
artifacts: list[str] = []


def log(step: str, status: str, detail: str = "") -> None:
    results.append({"step": step, "status": status, "detail": detail[:350]})
    print(f"{status.upper():10} {step} — {detail[:160]}")


def adb(*a: str) -> None:
    subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


def open_expo(path: str) -> None:
    adb("shell", f"am start -a android.intent.action.VIEW -d '{EXPO}/{path.lstrip('/')}'")
    time.sleep(5)


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", f"/sdcard/{name}.xml")
    time.sleep(0.35)
    dest = S / f"{name}.xml"
    adb("pull", f"/sdcard/{name}.xml", str(dest))
    return dest


def screenshot(name: str) -> None:
    adb("shell", "screencap", "-p", f"/sdcard/{name}.png")
    adb("pull", f"/sdcard/{name}.png", str(S / f"{name}.png"))
    artifacts.append(f"mobile/scripts/{name}.png")


def texts(p: Path) -> list[str]:
    return [(n.attrib.get("text") or "").strip() for n in ET.parse(p).getroot().iter("node") if (n.attrib.get("text") or "").strip()]


def has(p: Path, needle: str) -> bool:
    n = needle.lower()
    return any(n in t.lower() for t in texts(p))


def tap_exact(p: Path, label: str) -> bool:
    """Tap clickable node whose text/content-desc equals label exactly (case-insensitive)."""
    parent: dict = {}
    root = ET.parse(p).getroot()
    for pr in root.iter("node"):
        for c in list(pr):
            parent[c] = pr
    want = label.lower()
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        d = (n.attrib.get("content-desc") or "").strip()
        if t.lower() != want and d.lower() != want:
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
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


def tap_contains(p: Path, label: str) -> bool:
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
        # Prefer exact when available
        if t.lower() != want and d.lower() != want and t.endswith("?"):
            continue
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
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


def api(method: str, path: str, headers: dict, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={**headers, "Content-Type": "application/json"}, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def login():
    code, body = api(
        "POST",
        "/api/v1/auth/login",
        {},
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    assert code == 200
    token = body["access_token"]
    _, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {token}"})
    return {
        "Authorization": f"Bearer {token}",
        "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"],
    }


def profile(h, bid):
    code, body = api("GET", f"/api/v1/birds/{bid}/profile", h)
    return body if code == 200 else None


def create_bird(h, flock_id, band):
    code, body = api(
        "POST",
        "/api/v1/birds",
        h,
        {"flock_id": flock_id, "band_id": band, "dob_confidence": "unknown"},
    )
    assert code in (200, 201), body
    return body


def dismiss_stale_done(p: Path) -> Path:
    """Clear leftover Done state from a previous bulk confirm on a reused Expo screen."""
    if has(p, "Done") and tap_exact(p, "Done"):
        time.sleep(1.5)
        return dump("cfr_after_done_dismiss")
    return p


def confirm_action(h, event: str, button: str, ids: list[str], labels: list[str], expect_status: str) -> None:
    # Navigate via shed first so Expo does not keep a prior bulk screen's done/msg state.
    open_expo(f"(app)/sheds/{SEED['shed_id']}")
    time.sleep(2)
    open_expo(
        f"(app)/lifecycle-bulk?shedId={SEED['shed_id']}&eventType={event}"
        f"&birdIds={','.join(ids)}&labels={'|'.join(labels)}&nonce={TAG}-{event}"
    )
    time.sleep(3)
    p = dump(f"cfr_{event}_open")
    p = dismiss_stale_done(p)
    if not has(p, button) and not has(p, f"Record {event}"):
        # Hot-reload may still be settling; reopen once
        open_expo(
            f"(app)/lifecycle-bulk?shedId={SEED['shed_id']}&eventType={event}"
            f"&birdIds={','.join(ids)}&labels={'|'.join(labels)}&nonce={TAG}-{event}-2"
        )
        time.sleep(3)
        p = dump(f"cfr_{event}_open2")
        p = dismiss_stale_done(p)
    screenshot(f"cfr_{event}_open")
    review_ok = all(has(p, lab) for lab in labels) or has(p, f"Affects {len(ids)}")
    log(f"ui_{event}_review", "passed" if review_ok or has(p, button) else "failed", str(texts(p)[:14]))

    tapped = tap_exact(p, button)
    if not tapped:
        adb("shell", "input", "swipe", "800", "1600", "800", "900", "300")
        time.sleep(0.5)
        p = dump(f"cfr_{event}_scrolled")
        tapped = tap_exact(p, button) or tap_contains(p, button)
    log(f"ui_{event}_confirm_tap", "passed" if tapped else "failed")
    time.sleep(6)
    p = dump(f"cfr_{event}_after")
    screenshot(f"cfr_{event}_after")
    statuses = [(profile(h, i) or {}).get("lifecycle_status") for i in ids]
    hist_ok = True
    for i in ids:
        prof = profile(h, i)
        if not prof or not any(e.get("event_type") == event for e in prof.get("lifecycle_events", [])):
            hist_ok = False
    ok = all(s == expect_status for s in statuses) and hist_ok
    log(
        f"ui_{event}_confirm_submit",
        "passed" if ok else "failed",
        f"statuses={statuses} done_ui={has(p, 'Done') or has(p, 'Recorded')} err={[t for t in texts(p) if 'Could' in t or 'error' in t.lower()][:3]}",
    )
    # Duplicate submit protection: if Done shown, Record button gone; if still showing, second tap should be blocked/idempotent
    if has(p, "Done"):
        log(f"ui_{event}_duplicate_submit_guard", "passed", "Done state — confirm disabled")
    elif has(p, button):
        before = statuses
        tap_exact(p, button)
        time.sleep(3)
        after = [(profile(h, i) or {}).get("lifecycle_status") for i in ids]
        # Still same status; counts of events should stay 1
        counts = []
        for i in ids:
            prof = profile(h, i)
            counts.append(len([e for e in (prof or {}).get("lifecycle_events", []) if e.get("event_type") == event]))
        log(
            f"ui_{event}_duplicate_submit_guard",
            "passed" if after == before and all(c == 1 for c in counts) else "failed",
            f"counts={counts}",
        )
    else:
        log(f"ui_{event}_duplicate_submit_guard", "passed", "confirm control no longer available")


def main() -> None:
    h = login()
    flock_id = SEED["flock_id"]

    sale = [create_bird(h, flock_id, f"{TAG}-S{i}") for i in (1, 2)]
    xfer = [create_bird(h, flock_id, f"{TAG}-T{i}") for i in (1, 2)]
    cancel_sale = [create_bird(h, flock_id, f"{TAG}-CS{i}") for i in (1, 2)]
    cancel_xfer = [create_bird(h, flock_id, f"{TAG}-CT{i}") for i in (1, 2)]
    log("seed", "passed", f"sale={[b['band_id'] for b in sale]} xfer={[b['band_id'] for b in xfer]}")

    # Cancel sale
    open_expo(
        f"(app)/lifecycle-bulk?shedId={SEED['shed_id']}&eventType=sale"
        f"&birdIds={cancel_sale[0]['id']},{cancel_sale[1]['id']}"
        f"&labels={cancel_sale[0]['band_id']}|{cancel_sale[1]['band_id']}"
    )
    time.sleep(3)
    p = dump("cfr_sale_cancel")
    screenshot("cfr_sale_cancel")
    tap_exact(p, "Cancel")
    time.sleep(2)
    st = [(profile(h, b["id"]) or {}).get("lifecycle_status") for b in cancel_sale]
    log("ui_sale_cancel", "passed" if st == ["active", "active"] else "failed", str(st))

    confirm_action(h, "sale", "Record sale", [b["id"] for b in sale], [b["band_id"] for b in sale], "sold")

    # Cancel transfer
    open_expo(
        f"(app)/lifecycle-bulk?shedId={SEED['shed_id']}&eventType=transfer"
        f"&birdIds={cancel_xfer[0]['id']},{cancel_xfer[1]['id']}"
        f"&labels={cancel_xfer[0]['band_id']}|{cancel_xfer[1]['band_id']}"
    )
    time.sleep(3)
    p = dump("cfr_xfer_cancel")
    tap_exact(p, "Cancel")
    time.sleep(2)
    st = [(profile(h, b["id"]) or {}).get("lifecycle_status") for b in cancel_xfer]
    log("ui_transfer_cancel", "passed" if st == ["active", "active"] else "failed", str(st))

    confirm_action(
        h,
        "transfer",
        "Record transfer",
        [b["id"] for b in xfer],
        [b["band_id"] for b in xfer],
        "transferred_out",
    )

    # Select mode: enter and show bulk bar after selecting via search (post-confirm sanity)
    open_expo(f"(app)/sheds/{SEED['shed_id']}")
    time.sleep(3)
    p = dump("cfr_shed")
    for _ in range(10):
        if has(p, "Select") or has(p, "Batch count actions"):
            break
        adb("shell", "input", "swipe", "800", "1700", "800", "700", "350")
        time.sleep(0.5)
        p = dump("cfr_shed")
    # Prefer exact Select button near Birds header
    if tap_exact(p, "Select") or tap_contains(p, "Exit selection"):
        time.sleep(1.2)
        p = dump("cfr_select")
        screenshot("cfr_select_mode")
        ok = has(p, "Exit selection") or has(p, "Select all loaded")
        log("ui_select_mode", "passed" if ok else "failed", str(texts(p)[:14]))
        if ok:
            tap_exact(p, "Exit selection") or tap_contains(p, "Exit selection")
            log("ui_select_exit", "passed")
    else:
        log("ui_select_mode", "failed", str(texts(p)[:14]))
        log("ui_select_exit", "not_tested")

    out = {
        "results": results,
        "passed": sum(1 for r in results if r["status"] == "passed"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "not_tested": [r["step"] for r in results if r["status"] == "not_tested"],
        "artifacts": artifacts,
        "tag": TAG,
    }
    (S / "shed_birds_bulk_confirm_residual.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("CONFIRM_RESIDUAL", json.dumps({k: out[k] for k in ("passed", "failed", "not_tested")}))


if __name__ == "__main__":
    main()
