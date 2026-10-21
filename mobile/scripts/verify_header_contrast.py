"""Regenerate sample PDF and assert header pixels are light (white text)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

import pymupdf
from pypdf import PdfReader

from app.models.enums import BirdLifecycleStatus, DobConfidence, FlockStatus, TrackingMode
from app.schemas.flock import (
    BirdParentRefOut,
    BirdProfileBatchDoseOut,
    BirdProfileOut,
    BirdProfileVaccinationEventOut,
)
from app.services.bird_report_service import build_bird_vaccination_pdf_bytes

OUT = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")


def _max_luma(pix: pymupdf.Pixmap, x0: int, y0: int, x1: int, y1: int) -> float:
    """Max luminance in region — white glyphs on dark fill score high."""
    peak = 0.0
    n = pix.n
    for y in range(max(0, y0), min(pix.height, y1)):
        for x in range(max(0, x0), min(pix.width, x1)):
            i = (y * pix.width + x) * n
            r, g, b = pix.samples[i], pix.samples[i + 1], pix.samples[i + 2]
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if luma > peak:
                peak = luma
    return peak


def main() -> None:
    bird_id = uuid4()
    events = [
        BirdProfileVaccinationEventOut(
            id=uuid4(),
            vaccine_definition_id=uuid4(),
            vaccine_name="Newcastle Disease",
            administration_date=date(2025, 11, 2),
            birds_covered=1,
            lot_number="LOT-ND-12",
            timing_status="completed_on_time",
            verification_status="verified",
            notes="Administered on farm",
            scheduled_dose_id=None,
            created_at=datetime(2025, 11, 2, tzinfo=timezone.utc),
        ),
        BirdProfileVaccinationEventOut(
            id=uuid4(),
            vaccine_definition_id=uuid4(),
            vaccine_name="IBD",
            administration_date=date(2025, 12, 10),
            birds_covered=1,
            lot_number="LOT-IBD-3",
            timing_status="completed_late",
            verification_status="verified",
            notes=None,
            scheduled_dose_id=None,
            created_at=datetime(2025, 12, 10, tzinfo=timezone.utc),
        ),
    ]
    upcoming = [
        BirdProfileBatchDoseOut(
            id=uuid4(),
            vaccine_definition_id=uuid4(),
            vaccine_name="Fowl Pox",
            dose_number=1,
            due_date=date(2026, 4, 5),
            status="upcoming",
            eligible_count=120,
            completed_count=0,
            needs_review=False,
        ),
        BirdProfileBatchDoseOut(
            id=uuid4(),
            vaccine_definition_id=uuid4(),
            vaccine_name="Newcastle Booster",
            dose_number=2,
            due_date=date(2026, 3, 20),
            status="due_today",
            eligible_count=120,
            completed_count=40,
            needs_review=False,
        ),
    ]
    profile = BirdProfileOut(
        id=bird_id,
        band_id="094450",
        display_code="094450",
        breed="Layer",
        sex="female",
        hatch_date=date(2025, 10, 1),
        estimated_age_days=169,
        dob_confidence=DobConfidence.estimated,
        lifecycle_status=BirdLifecycleStatus.active,
        is_active=True,
        notes=None,
        created_at=datetime(2025, 10, 1, tzinfo=timezone.utc),
        organization_name="Green Valley Poultry",
        shed_id=uuid4(),
        shed_name="Shed A",
        shed_code="SA-01",
        flock_id=uuid4(),
        batch_code="BATCH-OCT25",
        flock_tracking_mode=TrackingMode.mixed,
        flock_status=FlockStatus.active,
        flock_unbanded_count=80,
        flock_banded_count=40,
        flock_current_count=120,
        flock_count_mismatch=False,
        sire=BirdParentRefOut(id=uuid4(), band_id="SIRE-12", display_code="SIRE-12"),
        dam=BirdParentRefOut(id=uuid4(), band_id="DAM-08", display_code="DAM-08"),
        individual_vaccinations=events,
        batch_upcoming_doses=upcoming,
        lifecycle_events=[],
    )
    pdf = build_bird_vaccination_pdf_bytes(
        profile,
        generated_at=datetime(2026, 3, 19, 4, 45, tzinfo=timezone.utc),
        timezone_name="Asia/Kolkata",
        recorder_names={events[0].id: "Ravi Kumar", events[1].id: "Meera Devi"},
    )
    path = OUT / "verify_bird_report_094450.pdf"
    path.write_bytes(pdf)
    text = "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    leaks = [
        x
        for x in [
            str(bird_id),
            "As-of bird id",
            "Internal bird ID",
            "Data integrity",
        ]
        if x in text
    ]

    doc = pymupdf.open(stream=pdf, filetype="pdf")
    page = doc[0]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
    png = OUT / "verify_bird_report_094450_page1.png"
    pix.save(str(png))

    # Locate header bands via text search rectangles (page coords → pixmap coords @2x)
    hist_rects = page.search_for("Date administered")
    up_rects = page.search_for("Batch progress")
    assert hist_rects, "history header not found"
    assert up_rects, "upcoming header not found"

    def sample_header(rect) -> float:
        x0 = int(rect.x0 * 2)
        y0 = int(rect.y0 * 2)
        x1 = int(rect.x1 * 2)
        y1 = int(rect.y1 * 2)
        return _max_luma(pix, x0, y0, x1, y1)

    hist_luma = sample_header(hist_rects[0])
    up_luma = sample_header(up_rects[0])
    # White (#fff) glyphs → peak luminance near 255
    print(
        {
            "png": str(png),
            "leaks": leaks,
            "hist_header_peak_luma": round(hist_luma, 1),
            "upcoming_header_peak_luma": round(up_luma, 1),
            "hist_ok": hist_luma > 220,
            "upcoming_ok": up_luma > 220,
        }
    )
    doc.close()
    assert not leaks
    assert hist_luma > 220, f"history header not white enough: {hist_luma}"
    assert up_luma > 220, f"upcoming header not white enough: {up_luma}"


if __name__ == "__main__":
    main()
