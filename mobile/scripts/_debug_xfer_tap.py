import json, time, urllib.request, subprocess, re, xml.etree.ElementTree as ET
from pathlib import Path

S = Path(__file__).resolve().parent
OWNER = json.loads((S / "pilot-owner.json").read_text())
SEED = json.loads((S / "shed_birds_verify_seed.json").read_text())
BASE = "http://127.0.0.1:8002"
SERIAL = "emulator-5554"


def api(method, path, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={**headers, "Content-Type": "application/json"}, method=method
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode() or "{}")


def adb(*a):
    subprocess.run(["adb", "-s", SERIAL, *a], capture_output=True, text=True)


code, body = api("POST", "/api/v1/auth/login", {}, {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]})
tok = body["access_token"]
_, me = api("GET", "/api/v1/auth/me", {"Authorization": f"Bearer {tok}"})
h = {"Authorization": f"Bearer {tok}", "X-Owner-Account-Id": me["memberships"][0]["owner_account_id"]}
tag = f"TX{int(time.time()) % 100000}"
ids, labels = [], []
for i in (1, 2):
    band = f"{tag}-T{i}"
    _, b = api("POST", "/api/v1/birds", h, {"flock_id": SEED["flock_id"], "band_id": band, "dob_confidence": "unknown"})
    ids.append(b["id"])
    labels.append(band)

uri = (
    f"exp://172.25.0.1:8082/--/(app)/lifecycle-bulk?shedId={SEED['shed_id']}"
    f"&eventType=transfer&birdIds={','.join(ids)}&labels={'|'.join(labels)}"
)
adb("shell", f"am start -a android.intent.action.VIEW -d '{uri}'")
time.sleep(4)
for _ in range(3):
    adb("shell", "input", "swipe", "800", "1600", "800", "900", "300")
    time.sleep(0.4)
adb("shell", "uiautomator", "dump", "/sdcard/tx.xml")
adb("pull", "/sdcard/tx.xml", str(S / "tx.xml"))
root = ET.parse(S / "tx.xml").getroot()
print("TEXTS", [(n.attrib.get("text") or "").strip() for n in root.iter("node") if (n.attrib.get("text") or "").strip()][:30])
parent = {}
for pr in root.iter("node"):
    for c in list(pr):
        parent[c] = pr
tapped = False
for n in root.iter("node"):
    t = (n.attrib.get("text") or "").strip()
    if t.lower() == "record transfer":
        cur = n
        while cur is not None:
            if cur.attrib.get("clickable") == "true":
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", cur.attrib["bounds"])
                print("TAP", t, cur.attrib["bounds"])
                adb(
                    "shell",
                    "input",
                    "tap",
                    str((int(m.group(1)) + int(m.group(3))) // 2),
                    str((int(m.group(2)) + int(m.group(4))) // 2),
                )
                tapped = True
                break
            cur = parent.get(cur)
        break
if not tapped:
    print("NO_EXACT_BUTTON")
    for n in root.iter("node"):
        t = (n.attrib.get("text") or "").strip()
        if "transfer" in t.lower():
            print("CANDIDATE", repr(t), n.attrib.get("clickable"), n.attrib.get("bounds"))
time.sleep(6)
for i, bid in enumerate(ids):
    _, p = api("GET", f"/api/v1/birds/{bid}/profile", h)
    print(labels[i], p.get("lifecycle_status"), [e["event_type"] for e in p.get("lifecycle_events", [])])
