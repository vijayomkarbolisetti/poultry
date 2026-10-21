"""Final B5 visual + deployment verification (no commit)."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import fitz
from httpx import Client
from pypdf import PdfReader

from app.models.enums import BirdLifecycleStatus, DobConfidence, FlockStatus, TrackingMode
from app.schemas.flock import BirdProfileOut, BirdProfileVaccinationEventOut
from app.services.bird_report_service import build_bird_vaccination_pdf_bytes

BASE = "http://127.0.0.1:8001"
OUT = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")


def main() -> None:
    report: dict = {"visual": {}, "deploy": {}, "leaks": []}

    with Client(timeout=30) as c:
        health = c.get(f"{BASE}/health")
        report["deploy"]["health"] = health.status_code
        openapi = c.get(f"{BASE}/openapi.json")
        paths = openapi.json().get("paths", {}) if openapi.status_code == 200 else {}
        report["deploy"]["pdf_route"] = [p for p in paths if "vaccination-report" in p]
        report["deploy"]["openapi"] = openapi.status_code

    sample = OUT / "verify_bird_report_094450.pdf"
    doc = fitz.open(sample)
    report["visual"]["sample_pages"] = doc.page_count
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        img_path = OUT / f"verify_bird_report_094450_page{i + 1}.png"
        pix.save(str(img_path))
        report["visual"][f"page{i + 1}_png"] = str(img_path)
        report["visual"][f"page{i + 1}_size"] = f"{pix.width}x{pix.height}"
    doc.close()

    text = "\n".join((p.extract_text() or "") for p in PdfReader(str(sample)).pages)
    forbidden = [
        "As-of bird id",
        "Internal bird ID",
        "Display code",
        "DOB confidence",
        "BirdLifecycleStatus",
        "DobConfidence",
        "Data integrity",
        "attribution",
        "compliance percentage",
        "bird_id",
        "flock-level",
    ]
    report["leaks"] = [f for f in forbidden if f.lower() in text.lower() or f in text]
    report["visual"]["has_brand"] = "PoultryTrack" in text
    report["visual"]["has_title"] = "Individual Bird Vaccination Report" in text
    report["visual"]["has_batch_note"] = "does not confirm" in text.lower()
    report["visual"]["has_page_footer"] = "Page 1 of 1" in text
    report["visual"]["timezone_labeled"] = "Asia/Kolkata" in text or "(UTC)" in text

    events = [
        BirdProfileVaccinationEventOut(
            id=uuid4(),
            vaccine_definition_id=uuid4(),
            vaccine_name=f"Vaccine Series Dose {i + 1}",
            administration_date=date(2025, 1, 1),
            birds_covered=1,
            lot_number=f"LOT-{i}",
            timing_status="completed_on_time",
            verification_status="verified",
            notes=f"Note {i} long enough to wrap",
            scheduled_dose_id=None,
            created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        for i in range(40)
    ]
    profile = BirdProfileOut(
        id=uuid4(),
        band_id="LONG-094450",
        display_code="LONG-094450",
        breed="Layer",
        sex=None,
        hatch_date=date(2025, 1, 15),
        estimated_age_days=90,
        dob_confidence=DobConfidence.unknown,
        lifecycle_status=BirdLifecycleStatus.active,
        is_active=True,
        notes=None,
        created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        organization_name="Farm",
        shed_id=uuid4(),
        shed_name="Shed",
        shed_code="S1",
        flock_id=uuid4(),
        batch_code="B1",
        flock_tracking_mode=TrackingMode.mixed,
        flock_status=FlockStatus.active,
        flock_unbanded_count=0,
        flock_banded_count=1,
        flock_current_count=1,
        flock_count_mismatch=False,
        sire=None,
        dam=None,
        individual_vaccinations=events,
        batch_upcoming_doses=[],
        lifecycle_events=[],
    )
    long_bytes = build_bird_vaccination_pdf_bytes(
        profile,
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc),
        timezone_name="Asia/Kolkata",
    )
    (OUT / "verify_bird_report_long_history.pdf").write_bytes(long_bytes)
    ldoc = fitz.open(stream=long_bytes, filetype="pdf")
    report["visual"]["long_pages"] = ldoc.page_count
    for i, page in enumerate(ldoc):
        if i > 2:
            break
        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        p = OUT / f"verify_bird_report_long_page{i + 1}.png"
        pix.save(str(p))
        report["visual"][f"long_page{i + 1}_png"] = str(p)
    ldoc.close()

    login = None
    with Client(timeout=60) as c:
        for email, password in [
            ("vfy.pdf.owner.094450@example.com", "password123"),
            ("pdf-owner@example.com", "password123"),
        ]:
            r = c.post(f"{BASE}/api/v1/auth/login", json={"email": email, "password": password})
            if r.status_code == 200:
                login = {"email": email, "token": r.json()["access_token"]}
                break
        report["deploy"]["login_attempt"] = login["email"] if login else None
        if login:
            me = c.get(
                f"{BASE}/api/v1/auth/me",
                headers={"Authorization": f"Bearer {login['token']}"},
            )
            owner = me.json()["memberships"][0]["owner_account_id"]
            headers = {
                "Authorization": f"Bearer {login['token']}",
                "X-Owner-Account-Id": owner,
            }
            bird_id = "423e9d5c-d91d-49aa-8645-06d145aa0c0b"
            pdf = c.get(
                f"{BASE}/api/v1/birds/{bird_id}/vaccination-report.pdf",
                headers=headers,
            )
            report["deploy"]["live_pdf_status"] = pdf.status_code
            report["deploy"]["live_pdf_ct"] = pdf.headers.get("content-type")
            report["deploy"]["live_pdf_cd"] = pdf.headers.get("content-disposition")
            if pdf.status_code == 200:
                (OUT / "verify_bird_report_live_api.pdf").write_bytes(pdf.content)
                live_text = "\n".join(
                    (p.extract_text() or "") for p in PdfReader(BytesIO(pdf.content)).pages
                )
                report["deploy"]["live_customer_ready"] = {
                    "no_as_of": "As-of bird id" not in live_text,
                    "no_internal_id": "Internal bird ID" not in live_text,
                    "no_display_code": "Display code" not in live_text,
                    "no_dob_conf": "DOB confidence" not in live_text,
                    "no_enum": "BirdLifecycleStatus" not in live_text
                    and "DobConfidence" not in live_text,
                    "no_integrity": "Data integrity" not in live_text,
                    "has_upcoming_section": "Upcoming Vaccinations" in live_text,
                    "has_batch_note": "does not confirm" in live_text.lower(),
                    "no_compliance": "compliance" not in live_text.lower(),
                    "uuid_absent": bird_id not in live_text,
                }
                d = fitz.open(stream=pdf.content, filetype="pdf")
                pix = d[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                lp = OUT / "verify_bird_report_live_api_page1.png"
                pix.save(str(lp))
                report["visual"]["live_page1_png"] = str(lp)
                d.close()
                report["deploy"]["stale_generator"] = (
                    "Data integrity" in live_text or "As-of bird id" in live_text
                )
            elif pdf.status_code in {401, 403, 404}:
                # Seed may be gone; create a fresh bird and pull PDF
                report["deploy"]["seeded_bird_missing"] = True

    (OUT / "bird_pdf_visual_deploy_verification.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
