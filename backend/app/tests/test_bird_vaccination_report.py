"""Customer-facing individual bird vaccination PDF — authz, content, privacy."""

from datetime import date, datetime, timezone
from io import BytesIO
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models.enums import (
    BirdLifecycleStatus,
    DobConfidence,
    FlockStatus,
    LifecycleEventType,
    TrackingMode,
)
from app.schemas.flock import (
    BirdParentageOut,
    BirdParentRefOut,
    BirdProfileBatchDoseOut,
    BirdProfileLifecycleOut,
    BirdProfileOut,
    BirdProfileVaccinationEventOut,
    BirdSaleDetailsOut,
)
from app.services.bird_report_service import (
    build_bird_vaccination_pdf_bytes,
    format_lifecycle_label,
    lifecycle_badge_colors,
    sanitize_report_filename,
)


async def _owner(client: AsyncClient, email: str, org: str) -> dict:
    reg = await client.post(
        "/api/v1/auth/register-owner",
        json={
            "email": email,
            "password": "password123",
            "full_name": "Owner",
            "organization_name": org,
        },
    )
    assert reg.status_code == 201, reg.text
    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"}
    )
    owner_id = me.json()["memberships"][0]["owner_account_id"]
    return {
        "owner_id": owner_id,
        "headers": {
            "Authorization": f"Bearer {reg.json()['access_token']}",
            "X-Owner-Account-Id": owner_id,
        },
    }


async def _farmer_headers(client: AsyncClient, email: str, owner_id: str) -> dict:
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert login.status_code == 200
    return {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "X-Owner-Account-Id": owner_id,
    }


async def _setup_bird(client: AsyncClient, headers: dict, *, band: str, with_vax: bool) -> dict:
    shed = await client.post(
        "/api/v1/sheds",
        headers=headers,
        json={"name": "PDF Shed", "code": f"P{band[-3:]}", "is_owner_managed": True},
    )
    assert shed.status_code == 201, shed.text
    flock = await client.post(
        "/api/v1/flocks",
        headers=headers,
        json={
            "shed_id": shed.json()["id"],
            "batch_code": f"PB{band[-4:]}",
            "initial_count": 10,
            "tracking_mode": "mixed",
            "dob_confidence": "estimated",
            "estimated_age_days": 14,
            "age_reported_on": date.today().isoformat(),
            "unbanded_count": 10,
            "breed": "Layer",
        },
    )
    assert flock.status_code == 201, flock.text
    bird = await client.post(
        "/api/v1/birds",
        headers=headers,
        json={"flock_id": flock.json()["id"], "band_id": band, "dob_confidence": "exact", "hatch_date": "2026-01-15"},
    )
    assert bird.status_code == 201, bird.text
    out = {
        "shed_id": shed.json()["id"],
        "flock_id": flock.json()["id"],
        "bird_id": bird.json()["id"],
        "band": band,
    }
    if with_vax:
        vax = await client.post(
            "/api/v1/vaccines",
            headers=headers,
            json={
                "name": "PDF Vax",
                "rules": [
                    {
                        "dose_number": 1,
                        "target_age_days": 1,
                        "grace_period_days": 0,
                        "reminder_lead_days": 0,
                    },
                    {
                        "dose_number": 2,
                        "target_age_days": 50,
                        "grace_period_days": 0,
                        "reminder_lead_days": 0,
                    },
                ],
            },
        )
        assert vax.status_code == 201, vax.text
        gen = await client.post(
            "/api/v1/vaccines/generate-schedules",
            headers=headers,
            json={"flock_id": flock.json()["id"], "vaccine_definition_ids": [vax.json()["id"]]},
        )
        assert gen.status_code == 200, gen.text
        await client.post(
            "/api/v1/vaccination-events",
            headers=headers,
            json={
                "scheduled_dose_id": gen.json()[0]["id"],
                "birds_covered": 4,
                "administration_date": date.today().isoformat(),
            },
        )
        ind = await client.post(
            "/api/v1/vaccination-events",
            headers=headers,
            json={
                "flock_id": flock.json()["id"],
                "bird_id": bird.json()["id"],
                "vaccine_definition_id": vax.json()["id"],
                "birds_covered": 1,
                "administration_date": date.today().isoformat(),
                "lot_number": "PDF-LOT-9",
                "notes": "Individual only",
            },
        )
        assert ind.status_code == 201, ind.text
        out["vax_name"] = "PDF Vax"
        out["lot"] = "PDF-LOT-9"
    return out


def _assert_pdf(resp) -> bytes:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    cd = resp.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert "bird-report-" in cd
    assert cd.endswith('.pdf"') or ".pdf" in cd
    body = resp.content
    assert body[:4] == b"%PDF"
    assert len(body) > 500
    return body


def _pdf_text(body: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(body))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _pdf_page_count(body: bytes) -> int:
    from pypdf import PdfReader

    return len(PdfReader(BytesIO(body)).pages)


def _pdf_page_texts(body: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(body))
    return [(page.extract_text() or "") for page in reader.pages]


def _assert_no_orphan_disclaimer_page(pdf: bytes) -> None:
    """No page may contain only the closing disclaimer / footer chrome."""
    pages = _pdf_page_texts(pdf)
    assert pages, "PDF has no pages"
    for i, text in enumerate(pages):
        compact = " ".join(text.split()).strip().lower()
        stripped = compact
        for noise in (
            "poultrytrack · bird profile & health record",
            "poultrytrack · bird profile &amp; health record",
            f"page {i + 1} of {len(pages)}",
        ):
            stripped = stripped.replace(noise, " ")
        stripped = " ".join(stripped.split())
        body_without_disclaimer = stripped
        for fragment in (
            "this report summarises poultrytrack farm records",
            "this document summarises poultrytrack farm records",
            "it is not a veterinary certificate",
            "it is not a veterinary health certificate",
            "missing values are shown as not recorded",
            "makes no guarantee of health status",
            "for a prospective buyer",
            "for sharing with a prospective buyer",
        ):
            body_without_disclaimer = body_without_disclaimer.replace(fragment, " ")
        body_without_disclaimer = " ".join(body_without_disclaimer.split())
        assert body_without_disclaimer, (
            f"Page {i + 1} of {len(pages)} is an orphan disclaimer/footer page"
        )


def _forbidden_leaks(text: str, bird_id: str) -> None:
    assert bird_id not in text
    assert "As-of bird id" not in text
    assert "Internal bird ID" not in text
    assert "Display code" not in text
    assert "DOB confidence" not in text
    assert "DobConfidence" not in text
    assert "BirdLifecycleStatus" not in text
    assert "Data integrity" not in text
    assert "attribution" not in text.lower()
    assert "bird_id" not in text
    assert "flock-level" not in text.lower()
    assert "available records are insufficient" not in text.lower()
    assert "compliance percentage" not in text.lower()


def _minimal_profile(**overrides) -> BirdProfileOut:
    base = dict(
        id=uuid4(),
        band_id="BAND-A1",
        display_code="BAND-A1",
        breed="Rhode Island Red",
        sex=None,
        hatch_date=date(2025, 1, 15),
        estimated_age_days=90,
        dob_confidence=DobConfidence.unknown,
        lifecycle_status=BirdLifecycleStatus.active,
        is_active=True,
        notes=None,
        created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        organization_name="Customer Farm",
        shed_id=uuid4(),
        shed_name="North Shed",
        shed_code="NS1",
        flock_id=uuid4(),
        batch_code="BATCH-1",
        flock_tracking_mode=TrackingMode.mixed,
        flock_status=FlockStatus.active,
        flock_unbanded_count=0,
        flock_banded_count=1,
        flock_current_count=1,
        flock_count_mismatch=False,
        sire=None,
        dam=None,
        individual_vaccinations=[],
        batch_upcoming_doses=[],
        lifecycle_events=[],
    )
    base.update(overrides)
    return BirdProfileOut(**base)


@pytest.mark.asyncio
async def test_pdf_owner_access_and_customer_content(client: AsyncClient) -> None:
    a = await _owner(client, "pdf-owner@example.com", "PDF Farm")
    s = await _setup_bird(client, a["headers"], band="PDF-BAND-1", with_vax=True)
    resp = await client.get(
        f"/api/v1/birds/{s['bird_id']}/vaccination-report.pdf", headers=a["headers"]
    )
    pdf = _assert_pdf(resp)
    text = _pdf_text(pdf)

    assert "PoultryTrack" in text
    assert "Bird Profile & Health Record" in text or "Bird Profile &amp; Health Record" in text
    assert "PDF-BAND-1" in text
    assert text.count("PDF-BAND-1") >= 1
    assert "PDF-LOT-9" in text or "PDF-LOT" in text
    assert "Active" in text
    assert "Vaccination record" in text or "Vaccination Record" in text
    # pypdf may insert newlines inside wrapped headings
    assert "upcoming" in text.lower() and "vaccination" in text.lower()
    assert "Father" in text and "Mother" in text
    assert "Administered vaccinations on record" in text
    assert "not a veterinary certificate" in text.lower()
    # Modest profiles should fit one page (page numbers only on multi-page reports)
    assert _pdf_page_count(pdf) == 1
    assert "Page " not in text

    _forbidden_leaks(text, s["bird_id"])
    assert "bird-report-pdf-band-1-" in resp.headers.get("content-disposition", "").lower()


@pytest.mark.asyncio
async def test_pdf_farmer_assigned_ok_unassigned_denied(client: AsyncClient) -> None:
    a = await _owner(client, "pdf-farmer-o@example.com", "PDF Farmer Farm")
    s = await _setup_bird(client, a["headers"], band="PDF-FARM-1", with_vax=False)
    other = await _setup_bird(client, a["headers"], band="PDF-OTHER-1", with_vax=False)
    farmer = await client.post(
        "/api/v1/farmers",
        headers=a["headers"],
        json={
            "email": "pdf-farmer@example.com",
            "password": "password123",
            "full_name": "PDF Farmer",
            "role": "farmer",
            "permission_codes": ["bird.view", "shed.view", "flock.view"],
            "shed_ids": [s["shed_id"]],
        },
    )
    assert farmer.status_code == 201, farmer.text
    fh = await _farmer_headers(client, "pdf-farmer@example.com", a["owner_id"])

    ok = await client.get(f"/api/v1/birds/{s['bird_id']}/vaccination-report.pdf", headers=fh)
    _assert_pdf(ok)

    deny = await client.get(f"/api/v1/birds/{other['bird_id']}/vaccination-report.pdf", headers=fh)
    assert deny.status_code in {403, 404}


@pytest.mark.asyncio
async def test_pdf_tenant_isolation_and_missing(client: AsyncClient) -> None:
    a = await _owner(client, "pdf-ten-a@example.com", "PDF Ten A")
    b = await _owner(client, "pdf-ten-b@example.com", "PDF Ten B")
    s = await _setup_bird(client, a["headers"], band="PDF-TEN-1", with_vax=False)
    cross = await client.get(
        f"/api/v1/birds/{s['bird_id']}/vaccination-report.pdf", headers=b["headers"]
    )
    assert cross.status_code == 404

    missing = await client.get(
        f"/api/v1/birds/{uuid4()}/vaccination-report.pdf", headers=a["headers"]
    )
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_pdf_empty_individual_history_and_upcoming(client: AsyncClient) -> None:
    a = await _owner(client, "pdf-empty@example.com", "PDF Empty Farm")
    s = await _setup_bird(client, a["headers"], band="PDF-EMPTY-1", with_vax=False)
    resp = await client.get(
        f"/api/v1/birds/{s['bird_id']}/vaccination-report.pdf", headers=a["headers"]
    )
    pdf = _assert_pdf(resp)
    text = _pdf_text(pdf)
    assert "No vaccination records have been recorded" in text
    assert "No upcoming vaccinations are currently scheduled" in text
    assert "PDF-EMPTY-1" in text
    _forbidden_leaks(text, s["bird_id"])


@pytest.mark.asyncio
async def test_sanitize_filename_unsafe_chars() -> None:
    name = sanitize_report_filename('A/B\\C:D*?"<>|', uuid4())
    assert name.startswith("bird-report-")
    assert name.endswith(".pdf")
    assert "/" not in name and "\\" not in name and "*" not in name


def test_lifecycle_labels_and_badge_colors() -> None:
    assert format_lifecycle_label(BirdLifecycleStatus.active) == "Active"
    assert format_lifecycle_label(BirdLifecycleStatus.dead) == "Dead"
    assert format_lifecycle_label(BirdLifecycleStatus.sold) == "Sold"
    assert format_lifecycle_label(BirdLifecycleStatus.inactive) == "Inactive"
    assert format_lifecycle_label(BirdLifecycleStatus.transferred_out) == "Transferred out"
    assert "BirdLifecycleStatus" not in format_lifecycle_label("weird_value")

    bg, fg = lifecycle_badge_colors(BirdLifecycleStatus.active)
    assert bg is not None and fg is not None
    dead_bg, dead_fg = lifecycle_badge_colors(BirdLifecycleStatus.dead)
    assert dead_bg != bg


def test_pdf_omits_internal_fields_and_enums() -> None:
    bird_id = uuid4()
    profile = _minimal_profile(
        id=bird_id,
        dob_confidence="unknown",
        lifecycle_status=BirdLifecycleStatus.active,
        sex=None,
        sire=None,
        dam=None,
    )
    pdf = build_bird_vaccination_pdf_bytes(
        profile,
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc),
        timezone_name="UTC",
    )
    text = _pdf_text(pdf)
    _forbidden_leaks(text, str(bird_id))
    assert "Active" in text
    assert "Band number" in text
    assert "Not recorded" in text or "About 90 days" in text
    assert "compliance" not in text.lower()
    assert "Bird Profile & Health Record" in text or "Bird Profile &amp; Health Record" in text


def test_pdf_status_styling_active_vs_dead() -> None:
    """Status badge uses different fill colors for Active vs Dead (visual assertion)."""
    active_bg, active_fg = lifecycle_badge_colors(BirdLifecycleStatus.active)
    dead_bg, dead_fg = lifecycle_badge_colors(BirdLifecycleStatus.dead)
    assert (active_bg.red, active_bg.green, active_bg.blue) != (
        dead_bg.red,
        dead_bg.green,
        dead_bg.blue,
    )
    assert (active_fg.red, active_fg.green, active_fg.blue) != (
        dead_fg.red,
        dead_fg.green,
        dead_fg.blue,
    )

    active_pdf = build_bird_vaccination_pdf_bytes(
        _minimal_profile(lifecycle_status=BirdLifecycleStatus.active),
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc),
    )
    dead_pdf = build_bird_vaccination_pdf_bytes(
        _minimal_profile(band_id="BAND-DEAD", lifecycle_status=BirdLifecycleStatus.dead),
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc),
    )
    assert "Active" in _pdf_text(active_pdf)
    assert "Dead" in _pdf_text(dead_pdf)
    assert active_pdf != dead_pdf


def test_pdf_long_history_paginates() -> None:
    events = []
    for i in range(40):
        events.append(
            BirdProfileVaccinationEventOut(
                id=uuid4(),
                vaccine_definition_id=uuid4(),
                vaccine_name=f"Vaccine Series Dose {i + 1}",
                administration_date=date(2025, 1, 1),
                birds_covered=1,
                lot_number=f"LOT-{i}",
                timing_status="completed_on_time",
                verification_status="verified",
                notes=f"Note line {i} with enough text to wrap across columns in the table",
                scheduled_dose_id=None,
                created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
            )
        )
    profile = _minimal_profile(individual_vaccinations=events)
    pdf = build_bird_vaccination_pdf_bytes(
        profile,
        generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc),
    )
    assert _pdf_page_count(pdf) >= 2
    text = _pdf_text(pdf)
    # pypdf may insert line breaks inside wrapped vaccine names
    assert "Dose 1" in text and "Dose 40" in text
    assert "Page" in text and "of" in text
    _assert_no_orphan_disclaimer_page(pdf)


def test_pdf_long_notes_no_orphan_disclaimer_page() -> None:
    """QA case: 11 vax rows + long notes + upcoming/overdue must not orphan disclaimer."""
    events = [
        BirdProfileVaccinationEventOut(
            id=uuid4(),
            vaccine_definition_id=uuid4(),
            vaccine_name=f"Vaccine Series Dose {i}",
            administration_date=date(2025, 1, 1),
            birds_covered=1,
            lot_number=f"LOT-{i}",
            manufacturer_or_brand="Venky's",
            product_expiry=date(2026, 12, 31),
            timing_status="completed_on_time",
            verification_status="verified",
            notes=None,
            scheduled_dose_id=None,
            created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        for i in range(1, 12)
    ]
    profile = _minimal_profile(
        band_id="GF-LONG",
        notes=("Health observation note. " * 40).strip(),
        individual_vaccinations=events,
        batch_upcoming_doses=[
            BirdProfileBatchDoseOut(
                id=uuid4(),
                vaccine_definition_id=uuid4(),
                vaccine_name="Marek's",
                dose_number=1,
                due_date=date(2026, 1, 10),
                status="overdue",
                eligible_count=40,
                completed_count=5,
                needs_review=False,
            ),
            BirdProfileBatchDoseOut(
                id=uuid4(),
                vaccine_definition_id=uuid4(),
                vaccine_name="ND booster",
                dose_number=3,
                due_date=date(2026, 5, 1),
                status="due_soon",
                eligible_count=40,
                completed_count=0,
                needs_review=False,
            ),
        ],
        lifecycle_events=[
            BirdProfileLifecycleOut(
                id=uuid4(),
                event_type=LifecycleEventType.onboarding,
                effective_date=date(2025, 6, 20),
                quantity=1,
                reason="Record created at hatch",
                buyer_name=None,
                buyer_mobile=None,
                created_at=datetime(2025, 6, 20, tzinfo=timezone.utc),
            )
        ],
    )
    pdf = build_bird_vaccination_pdf_bytes(
        profile,
        generated_at=datetime(2026, 3, 20, 10, 30, tzinfo=timezone.utc),
        timezone_name="Asia/Kolkata",
    )
    text = _pdf_text(pdf)
    assert "Upcoming vaccinations" in text
    assert "Overdue" in text
    assert "vaccinations recorded for the batch" in text.lower() or "for this banded bird" in text
    assert "Dose 1" in text and "Dose 11" in text
    _assert_no_orphan_disclaimer_page(pdf)
    pages = _pdf_page_texts(pdf)
    if len(pages) > 1:
        assert f"Page 1 of {len(pages)}" in pages[0] or "Page 1 of" in pages[0]
        assert f"Page {len(pages)} of {len(pages)}" in pages[-1] or "of" in pages[-1]


def test_pdf_parentage_without_uuid_leak() -> None:
    sire_id = uuid4()
    profile = _minimal_profile(
        sire=BirdParentRefOut(id=sire_id, band_id=None, display_code=None),
        dam=BirdParentRefOut(id=uuid4(), band_id="DAM-99", display_code="DAM-99"),
        dam_parentage=BirdParentageOut(
            source="linked",
            bird_id=uuid4(),
            band_id="DAM-99",
            display_name=None,
            breed="Aseel",
            notes=None,
            label="DAM-99",
        ),
    )
    text = _pdf_text(
        build_bird_vaccination_pdf_bytes(
            profile,
            generated_at=datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc),
        )
    )
    assert str(sire_id) not in text
    assert str(sire_id)[:8] not in text
    assert "Mother" in text and "DAM-99" in text
    assert "Father" in text
    assert "Not recorded" in text


def test_pdf_sale_and_lifecycle_sections() -> None:
    sale_id = uuid4()
    profile = _minimal_profile(
        band_id="SOLD-1",
        lifecycle_status=BirdLifecycleStatus.sold,
        is_active=False,
        sale=BirdSaleDetailsOut(
            event_id=sale_id,
            sold_on=date(2026, 10, 28),
            buyer_name="Ramesh Kumar",
            buyer_mobile="9876543210",
            recorded_at=datetime(2026, 10, 28, tzinfo=timezone.utc),
        ),
        lifecycle_events=[
            BirdProfileLifecycleOut(
                id=uuid4(),
                event_type=LifecycleEventType.sale,
                effective_date=date(2026, 10, 28),
                quantity=1,
                reason="Bird was sold",
                buyer_name="Ramesh Kumar",
                buyer_mobile="9876543210",
                created_at=datetime(2026, 10, 28, tzinfo=timezone.utc),
            )
        ],
        batch_upcoming_doses=[],
    )
    text = _pdf_text(
        build_bird_vaccination_pdf_bytes(
            profile,
            generated_at=datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc),
        )
    )
    assert "Sale details" in text
    assert "Ramesh Kumar" in text
    assert "9876543210" in text
    assert "Sold" in text
    assert "Transfer" in text and "ownership" in text.lower()
    assert "Bird was sold" in text
    assert str(sale_id) not in text
    assert "inactive" in text.lower() or "sold" in text.lower()


@pytest.mark.asyncio
async def test_pdf_sold_bird_export_via_api(client: AsyncClient) -> None:
    a = await _owner(client, "pdf-sold@example.com", "PDF Sold Farm")
    s = await _setup_bird(client, a["headers"], band="PDF-SOLD-1", with_vax=True)
    sale = await client.post(
        "/api/v1/lifecycle-events",
        headers=a["headers"],
        json={
            "event_type": "sale",
            "effective_date": "2026-10-28",
            "bird_id": s["bird_id"],
            "buyer_name": "Ramesh Kumar",
            "buyer_mobile": "9876543210",
            "reason": "Bird was sold",
            "idempotency_key": f"pdf-sale-{uuid4().hex}",
        },
    )
    assert sale.status_code in {200, 201}, sale.text
    resp = await client.get(
        f"/api/v1/birds/{s['bird_id']}/vaccination-report.pdf", headers=a["headers"]
    )
    pdf = _assert_pdf(resp)
    text = _pdf_text(pdf)
    assert "PDF-SOLD-1" in text
    assert "Ramesh Kumar" in text
    assert "9876543210" in text
    assert "Sale details" in text
    assert "PDF-LOT-9" in text or "PDF-LOT" in text
    assert "Transfer" in text or "Sale" in text
    _forbidden_leaks(text, s["bird_id"])
