from datetime import date
from io import BytesIO

from httpx import Client
from pypdf import PdfReader

BASE = "http://127.0.0.1:8001"
stamp = "103100"
email = f"restart.check.{stamp}@example.com"

with Client(timeout=60) as c:
    r = c.post(
        f"{BASE}/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "R",
            "organization_name": f"R{stamp}",
        },
    )
    if r.status_code in (200, 201):
        token = r.json()["access_token"]
    else:
        token = c.post(
            f"{BASE}/api/v1/auth/login",
            json={"email": email, "password": "password123"},
        ).json()["access_token"]
    me = c.get(f"{BASE}/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    owner = me["memberships"][0]["owner_account_id"]
    h = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner}
    shed = c.post(
        f"{BASE}/api/v1/sheds",
        headers=h,
        json={"name": "S", "code": f"R{stamp[-3:]}", "is_owner_managed": True},
    ).json()
    flock = c.post(
        f"{BASE}/api/v1/flocks",
        headers=h,
        json={
            "shed_id": shed["id"],
            "batch_code": f"RB{stamp[-4:]}",
            "initial_count": 5,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 10,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": 5,
            "breed": "Layer",
        },
    ).json()
    bird = c.post(
        f"{BASE}/api/v1/birds",
        headers=h,
        json={"flock_id": flock["id"], "band_id": f"CHK-{stamp}", "dob_confidence": "unknown"},
    ).json()
    pdf = c.get(f"{BASE}/api/v1/birds/{bird['id']}/vaccination-report.pdf", headers=h)
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(pdf.content)).pages)
    stale = (
        "As-of bird id" in text
        or "Internal bird ID" in text
        or "Data integrity" in text
    )
    print(
        "status",
        pdf.status_code,
        "stale",
        stale,
        "history",
        "Vaccination History" in text,
        "upcoming",
        "Upcoming Vaccinations" in text,
    )
