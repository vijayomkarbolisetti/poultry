"""Customer-facing individual bird vaccination PDF."""

from __future__ import annotations

import io
import re
from datetime import date, datetime, timezone
from uuid import UUID

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.models.enums import BirdLifecycleStatus
from app.models.owner import OwnerAccount
from app.models.user import User
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import ScheduledDose
from app.schemas.flock import BirdProfileOut
from app.services import flock_service
from app.services.schedule_engine import (
    STATUS_COMPLETED_LATE,
    STATUS_COMPLETED_ON_TIME,
    STATUS_COMPLETED_TIMING_UNKNOWN,
    STATUS_DUE_SOON,
    STATUS_DUE_TODAY,
    STATUS_NEEDS_REVIEW,
    STATUS_OVERDUE,
    STATUS_UPCOMING,
    _tz,
)

# Brand colors aligned with mobile tokens
_BRAND = colors.HexColor("#0F7A45")
_BRAND_DARK = colors.HexColor("#0A5A32")
_BRAND_SOFT = colors.HexColor("#E3F4EA")
_INK = colors.HexColor("#12241A")
_MUTED = colors.HexColor("#5F7268")
_BORDER = colors.HexColor("#C8D9CF")
_AMBER = colors.HexColor("#E67E22")
_AMBER_SOFT = colors.HexColor("#FFF4E5")
_RED = colors.HexColor("#C0392B")
_RED_SOFT = colors.HexColor("#FDECEA")
_GREEN_SOFT = colors.HexColor("#E3F4EA")

_BATCH_NOTE = (
    "Some upcoming vaccinations are scheduled for birds that share this bird's hatch date in the same shed. "
    "The schedule below does not confirm that an individual vaccination has been administered to this bird."
)
_HISTORY_CONTEXT = (
    "Individual vaccination records are available for the vaccinations listed below. "
    "Some vaccination activities are recorded for the shed hatch-date population rather than for each bird "
    "individually, so this report may not represent the bird's complete vaccination history."
)


class BirdReportError(Exception):
    def __init__(self, message: str, code: str = "REPORT_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def sanitize_report_filename(band_id: str | None, bird_id: UUID, when: datetime | None = None) -> str:
    stamp = (when or datetime.now(timezone.utc)).strftime("%Y%m%d")
    raw = (band_id or "Unbanded").strip()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._") or "Unbanded"
    return f"Bird_Report_{safe}_{stamp}.pdf"


def _enum_value(value: object) -> str:
    if value is None:
        return ""
    if hasattr(value, "value"):
        return str(getattr(value, "value"))
    return str(value)


def format_lifecycle_label(status: object) -> str:
    """Map BirdLifecycleStatus to customer-facing labels (actual enum values)."""
    raw = _enum_value(status).lower().strip()
    mapping = {
        BirdLifecycleStatus.active.value: "Active",
        BirdLifecycleStatus.dead.value: "Dead",
        BirdLifecycleStatus.sold.value: "Sold",
        BirdLifecycleStatus.transferred_out.value: "Transferred out",
        BirdLifecycleStatus.inactive.value: "Inactive",
    }
    if raw in mapping:
        return mapping[raw]
    # Safe fallback — never expose EnumClass.value form
    return raw.replace("_", " ").strip().title() or "Not recorded"


def lifecycle_badge_colors(status: object) -> tuple[colors.Color, colors.Color]:
    """Return (background, text) for status badge."""
    raw = _enum_value(status).lower().strip()
    if raw == BirdLifecycleStatus.active.value:
        return _GREEN_SOFT, _BRAND_DARK
    if raw == BirdLifecycleStatus.dead.value:
        return _RED_SOFT, _RED
    # sold / transferred_out / inactive / unknown → amber
    return _AMBER_SOFT, _AMBER


def format_dose_status_label(status: str | None) -> str:
    raw = (status or "").lower().strip()
    mapping = {
        STATUS_UPCOMING: "Upcoming",
        STATUS_DUE_SOON: "Due soon",
        STATUS_DUE_TODAY: "Due today",
        STATUS_OVERDUE: "Overdue",
        STATUS_NEEDS_REVIEW: "Needs review",
        STATUS_COMPLETED_ON_TIME: "Completed on time",
        STATUS_COMPLETED_LATE: "Completed late",
        STATUS_COMPLETED_TIMING_UNKNOWN: "Completed",
    }
    if raw in mapping:
        return mapping[raw]
    return raw.replace("_", " ").strip().title() or "—"


def format_timing_label(timing: str | None) -> str:
    raw = (timing or "").lower().strip()
    mapping = {
        STATUS_COMPLETED_ON_TIME: "On time",
        STATUS_COMPLETED_LATE: "Late",
        STATUS_COMPLETED_TIMING_UNKNOWN: "Timing not recorded",
    }
    if raw in mapping:
        return mapping[raw]
    return raw.replace("_", " ").strip().title() or "—"


def format_display_date(value: date | datetime | None) -> str:
    if value is None:
        return "Not recorded"
    if isinstance(value, datetime):
        value = value.date()
    return value.strftime("%d %b %Y")


def format_generated_at(when: datetime, tz_name: str | None) -> tuple[str, str]:
    """Return (display_string, timezone_label) using the farm timezone policy."""
    label = (tz_name or "UTC").strip() or "UTC"
    if label.upper() == "UTC":
        local = when.astimezone(timezone.utc)
        return local.strftime("%d %b %Y, %H:%M"), "UTC"
    tzinfo = _tz(label)
    local = when.astimezone(tzinfo)
    # _tz falls back to UTC when IANA data is missing; label clearly as UTC.
    if getattr(tzinfo, "key", None) == label:
        return local.strftime("%d %b %Y, %H:%M"), label
    return local.strftime("%d %b %Y, %H:%M"), "UTC"


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe.replace("\n", "<br/>"), style)


def _parent_label(parent) -> str | None:
    if parent is None:
        return None
    if parent.band_id:
        return parent.band_id
    if parent.display_code and parent.display_code != parent.band_id:
        # display_code often mirrors band; only show if it looks like a band, never a UUID
        code = parent.display_code.strip()
        if len(code) >= 8 and "-" in code and all(c in "0123456789abcdef-" for c in code.lower()):
            return None
        return code
    return None


class _NumberedCanvas(pdf_canvas.Canvas):
    def __init__(self, *args, footer_note: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []
        self._footer_note = footer_note

    def showPage(self) -> None:  # noqa: N802
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_footer(page_count)
            pdf_canvas.Canvas.showPage(self)
        pdf_canvas.Canvas.save(self)

    def _draw_footer(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(_MUTED)
        width, _ = A4
        self.drawCentredString(width / 2, 10 * mm, f"Page {self._pageNumber} of {page_count}")
        if self._footer_note:
            self.drawString(16 * mm, 14 * mm, self._footer_note[:110])
        self.restoreState()


def build_bird_vaccination_pdf_bytes(
    profile: BirdProfileOut,
    *,
    generated_at: datetime,
    timezone_name: str | None = None,
    recorder_names: dict[UUID, str | None] | None = None,
    scheduled_dues: dict[UUID, date | None] | None = None,
) -> bytes:
    """Build a customer-facing PDF from an authorized BirdProfileOut."""
    recorder_names = recorder_names or {}
    scheduled_dues = scheduled_dues or {}
    gen_str, tz_label = format_generated_at(generated_at, timezone_name)

    buf = io.BytesIO()
    footer_note = "Reflects vaccination records available when this report was generated."
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=20 * mm,
        title="Individual Bird Vaccination Report",
        author="PoultryTrack",
    )
    styles = getSampleStyleSheet()
    brand = ParagraphStyle(
        "PTBrand",
        parent=styles["Normal"],
        fontSize=12,
        textColor=_BRAND,
        alignment=TA_CENTER,
        spaceAfter=2,
        fontName="Helvetica-Bold",
    )
    title = ParagraphStyle(
        "PTTitle",
        parent=styles["Heading1"],
        fontSize=17,
        textColor=_BRAND_DARK,
        spaceAfter=4,
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    )
    meta = ParagraphStyle(
        "PTMeta",
        parent=styles["Normal"],
        fontSize=8,
        textColor=_MUTED,
        alignment=TA_CENTER,
        spaceAfter=10,
    )
    h2 = ParagraphStyle(
        "PTH2",
        parent=styles["Heading2"],
        fontSize=11,
        textColor=_BRAND_DARK,
        spaceBefore=12,
        spaceAfter=6,
        fontName="Helvetica-Bold",
    )
    body = ParagraphStyle("PTBody", parent=styles["Normal"], fontSize=9, leading=12, textColor=_INK, alignment=TA_LEFT)
    small = ParagraphStyle("PTSmall", parent=styles["Normal"], fontSize=8, leading=10, textColor=_INK)
    # Paragraph textColor wins over TableStyle TEXTCOLOR — headers must be white explicitly.
    table_header = ParagraphStyle(
        "PTTableHeader",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        textColor=colors.white,
        fontName="Helvetica-Bold",
    )
    muted = ParagraphStyle("PTMuted", parent=styles["Normal"], fontSize=8, leading=11, textColor=_MUTED)
    note = ParagraphStyle(
        "PTNote",
        parent=styles["Normal"],
        fontSize=8,
        leading=11,
        textColor=_AMBER,
    )
    badge_style = ParagraphStyle(
        "PTBadge",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
    )

    story: list = []
    story.append(_p("PoultryTrack", brand))
    story.append(_p("Individual Bird Vaccination Report", title))
    story.append(_p(f"Generated {gen_str} ({tz_label})", meta))

    # --- Identity ---
    story.append(_p("Bird Identity", h2))
    status_label = format_lifecycle_label(profile.lifecycle_status)
    badge_bg, badge_fg = lifecycle_badge_colors(profile.lifecycle_status)
    badge_style.textColor = badge_fg
    status_cell = Table(
        [[_p(status_label, badge_style)]],
        colWidths=[32 * mm],
    )
    status_cell.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), badge_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, badge_fg),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    band = profile.band_id or "Not recorded"
    identity_pairs: list[tuple[str, object]] = [
        ("Band number", band),
        ("Breed", profile.breed or "Not recorded"),
    ]
    if profile.sex:
        identity_pairs.append(("Sex", str(profile.sex).replace("_", " ").strip().title()))
    identity_pairs.append(("Hatch date", format_display_date(profile.hatch_date)))
    if profile.estimated_age_days is not None:
        identity_pairs.append(("Age", f"About {profile.estimated_age_days} days"))
    else:
        identity_pairs.append(("Age", "Not recorded"))
    identity_pairs.append(("Status", status_cell))
    identity_pairs.append(("Farm", profile.organization_name or "Not recorded"))
    shed_bits = [b for b in [profile.shed_name, profile.shed_code] if b]
    identity_pairs.append(("Shed", " · ".join(shed_bits) if shed_bits else "Not recorded"))
    father = _parent_label(profile.sire)
    mother = _parent_label(profile.dam)
    if father:
        identity_pairs.append(("Father", father))
    if mother:
        identity_pairs.append(("Mother", mother))

    id_rows = []
    for label, value in identity_pairs:
        if isinstance(value, Table):
            id_rows.append([_p(label, muted), value])
        else:
            id_rows.append([_p(label, muted), _p(str(value), body)])
    id_table = Table(id_rows, colWidths=[40 * mm, 130 * mm])
    id_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), _BRAND_SOFT),
                ("BOX", (0, 0), (-1, -1), 0.4, _BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, _BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(id_table)

    # --- Summary ---
    story.append(_p("Vaccination Summary", h2))
    n_ind = len(profile.individual_vaccinations)
    n_up = len(profile.batch_upcoming_doses)
    last_vax = None
    if profile.individual_vaccinations:
        last = max(profile.individual_vaccinations, key=lambda e: e.administration_date)
        last_vax = f"{last.vaccine_name or 'Vaccine'} on {format_display_date(last.administration_date)}"
    next_due = None
    if profile.batch_upcoming_doses:
        nxt = min(profile.batch_upcoming_doses, key=lambda d: d.due_date)
        next_due = (
            f"{nxt.vaccine_name or 'Vaccine'} due {format_display_date(nxt.due_date)} "
            f"({format_dose_status_label(nxt.status)})"
        )

    summary_lines = [
        f"Individual vaccinations recorded for this bird: {n_ind}.",
        f"Upcoming vaccination requirements: {n_up}.",
    ]
    if last_vax:
        summary_lines.append(f"Most recent recorded vaccination: {last_vax}.")
    if next_due:
        summary_lines.append(f"Next scheduled vaccination: {next_due}.")
    story.append(_p(" ".join(summary_lines), body))
    story.append(Spacer(1, 4))
    story.append(_p(_HISTORY_CONTEXT, note))

    # --- Individual history ---
    story.append(_p("Vaccination History", h2))
    if not profile.individual_vaccinations:
        story.append(
            _p(
                "No individual vaccinations have been recorded for this bird yet. "
                "Shed hatch-date vaccination activity is listed separately under Upcoming Vaccinations when applicable.",
                muted,
            )
        )
    else:
        header = [
            _p("Vaccine", table_header),
            _p("Date administered", table_header),
            _p("Scheduled date", table_header),
            _p("Result", table_header),
            _p("Lot number", table_header),
            _p("Administered by", table_header),
            _p("Notes", table_header),
        ]
        rows = [header]
        for ev in profile.individual_vaccinations:
            due = scheduled_dues.get(ev.scheduled_dose_id) if ev.scheduled_dose_id else None
            rows.append(
                [
                    _p(ev.vaccine_name or "—", small),
                    _p(format_display_date(ev.administration_date), small),
                    _p(format_display_date(due) if due else "—", small),
                    _p(format_timing_label(ev.timing_status), small),
                    _p(ev.lot_number or "—", small),
                    _p(recorder_names.get(ev.id) or "—", small),
                    _p((ev.notes or "—")[:90], small),
                ]
            )
        hist = Table(
            rows,
            colWidths=[28 * mm, 24 * mm, 24 * mm, 22 * mm, 20 * mm, 26 * mm, 26 * mm],
            repeatRows=1,
        )
        hist.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _BRAND_DARK),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, _BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAF8")]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(hist)

    # --- Upcoming ---
    story.append(_p("Upcoming Vaccinations", h2))
    if not profile.batch_upcoming_doses:
        story.append(_p("No upcoming vaccinations are currently scheduled.", muted))
    else:
        story.append(_p(_BATCH_NOTE, note))
        story.append(Spacer(1, 4))
        header = [
            _p("Vaccine", table_header),
            _p("Dose", table_header),
            _p("Due date", table_header),
            _p("Status", table_header),
            _p("Population progress", table_header),
        ]
        rows = [header]
        for d in profile.batch_upcoming_doses:
            rows.append(
                [
                    _p(d.vaccine_name or "—", small),
                    _p(str(d.dose_number), small),
                    _p(format_display_date(d.due_date), small),
                    _p(format_dose_status_label(d.status), small),
                    _p(f"{d.completed_count} of {d.eligible_count} birds covered", small),
                ]
            )
        up = Table(rows, colWidths=[40 * mm, 16 * mm, 28 * mm, 28 * mm, 58 * mm], repeatRows=1)
        up.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _AMBER),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E0C98A")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_AMBER_SOFT, colors.white]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(KeepTogether([up]))

    story.append(Spacer(1, 8))
    story.append(
        _p(
            "This report is intended for farm owners and customers. "
            "It reflects PoultryTrack records available at the generation time shown above.",
            muted,
        )
    )

    doc.build(
        story,
        canvasmaker=lambda *a, **k: _NumberedCanvas(*a, footer_note=footer_note, **k),
    )
    return buf.getvalue()


async def generate_bird_vaccination_report(
    db: AsyncSession, ctx: AuthContext, bird_id: UUID
) -> tuple[bytes, str]:
    """Authorize via profile service, enrich event metadata, return (pdf_bytes, filename)."""
    try:
        profile = await flock_service.get_bird_profile(db, ctx, bird_id)
    except flock_service.FlockError as exc:
        raise BirdReportError(exc.message, exc.code) from exc

    owner = await db.get(OwnerAccount, ctx.owner_account_id) if ctx.owner_account_id else None
    tz_name = owner.timezone if owner else None

    dose_ids = [e.scheduled_dose_id for e in profile.individual_vaccinations if e.scheduled_dose_id]
    scheduled_dues: dict[UUID, date | None] = {}
    if dose_ids:
        rows = await db.execute(
            select(ScheduledDose.id, ScheduledDose.due_date).where(ScheduledDose.id.in_(dose_ids))
        )
        scheduled_dues = {rid: due for rid, due in rows}

    event_ids = [e.id for e in profile.individual_vaccinations]
    recorder_names: dict[UUID, str | None] = {}
    if event_ids:
        rows = await db.execute(
            select(VaccinationEvent.id, User.full_name)
            .outerjoin(User, User.id == VaccinationEvent.recorded_by_user_id)
            .where(VaccinationEvent.id.in_(event_ids))
        )
        recorder_names = {eid: name for eid, name in rows}

    generated_at = datetime.now(timezone.utc)
    pdf = build_bird_vaccination_pdf_bytes(
        profile,
        generated_at=generated_at,
        timezone_name=tz_name,
        recorder_names=recorder_names,
        scheduled_dues=scheduled_dues,
    )
    filename = sanitize_report_filename(profile.band_id, profile.id, generated_at)
    return pdf, filename
