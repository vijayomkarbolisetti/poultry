"""Buyer-facing Bird Profile & Health Record PDF (identity, parents, sale, vax, ownership)."""

from __future__ import annotations

import io
import re
from datetime import date, datetime, timezone
from uuid import UUID

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
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
from app.models.lifecycle import LifecycleEvent
from app.models.owner import OwnerAccount
from app.models.user import User
from app.models.vaccination import VaccinationEvent
from app.models.vaccine import ScheduledDose, VaccineDefinition
from app.schemas.flock import (
    BirdParentageOut,
    BirdProfileLifecycleOut,
    BirdProfileOut,
    BirdProfileVaccinationEventOut,
    BirdSaleDetailsOut,
)
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

# PoultryTrack buyer-facing theme
_MINT = colors.HexColor("#EFFFEB")
_BRAND = colors.HexColor("#176B45")
_BRAND_DARK = colors.HexColor("#176B45")
_BRAND_SOFT = colors.HexColor("#E3F4EA")
_COPPER = colors.HexColor("#B96F3B")
_COPPER_SOFT = colors.HexColor("#F8EEE6")
_INK = colors.HexColor("#15342C")
_MUTED = colors.HexColor("#71837C")
_BORDER = colors.HexColor("#D7E8E0")
_AMBER = colors.HexColor("#B96F3B")
_AMBER_SOFT = colors.HexColor("#F8EEE6")
_RED = colors.HexColor("#C0392B")
_RED_SOFT = colors.HexColor("#FDECEA")
_GREEN_SOFT = colors.HexColor("#DDF4EA")
_ROW_ALT = colors.HexColor("#F7FAF8")

_BATCH_NOTE = (
    "These are planned doses for birds that share this hatch date in the same shed. "
    "Upcoming or overdue here means not yet recorded as given for this bird."
)
_HISTORY_CONTEXT = (
    "Only administered, saved doses appear below — including vaccinations recorded for "
    "the batch when every banded bird present was covered. Partial batch coverage is "
    "omitted. Upcoming or overdue planned doses are listed separately and are never "
    "shown as already given."
)
_DISCLAIMER = (
    "This report summarises PoultryTrack farm records for a prospective buyer. "
    "It is not a veterinary certificate. Missing values are shown as Not recorded."
)


class BirdReportError(Exception):
    def __init__(self, message: str, code: str = "REPORT_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def sanitize_report_filename(band_id: str | None, bird_id: UUID, when: datetime | None = None) -> str:
    """Meaningful download name, e.g. bird-report-1222dsd-2026-10-28.pdf."""
    stamp = (when or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    raw = (band_id or "unbanded").strip().lower()
    safe = re.sub(r"[^a-z0-9._-]+", "-", raw).strip(".-") or "unbanded"
    return f"bird-report-{safe}-{stamp}.pdf"


def _enum_value(value: object) -> str:
    if value is None:
        return ""
    if hasattr(value, "value"):
        return str(getattr(value, "value"))
    return str(value)


def format_lifecycle_label(status: object) -> str:
    """Map BirdLifecycleStatus / event types to customer-facing labels."""
    raw = _enum_value(status).lower().strip()
    mapping = {
        BirdLifecycleStatus.active.value: "Active",
        BirdLifecycleStatus.dead.value: "Dead",
        BirdLifecycleStatus.sold.value: "Sold",
        BirdLifecycleStatus.transferred_out.value: "Transferred out",
        BirdLifecycleStatus.inactive.value: "Inactive",
        "mortality": "Mortality",
        "sale": "Sale",
        "transfer": "Transfer",
        "registration": "Registration",
        "intake": "Intake",
        "onboarding": "Record created",
        "adjustment": "Adjustment",
        "band_assignment": "Band assigned",
        "count_adjustment": "Count adjustment",
        "flock_closure": "Batch closed",
    }
    if raw in mapping:
        return mapping[raw]
    return raw.replace("_", " ").strip().title() or "Not recorded"


def lifecycle_badge_colors(status: object) -> tuple[colors.Color, colors.Color]:
    """Return (background, text) for status badge."""
    raw = _enum_value(status).lower().strip()
    if raw == BirdLifecycleStatus.active.value:
        return _GREEN_SOFT, _BRAND_DARK
    if raw == BirdLifecycleStatus.dead.value:
        return _RED_SOFT, _RED
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
    if getattr(tzinfo, "key", None) == label:
        return local.strftime("%d %b %Y, %H:%M"), label
    return local.strftime("%d %b %Y, %H:%M"), "UTC"


def age_as_of_report(
    hatch_date: date | None,
    estimated_age_days: int | None,
    as_of: date,
) -> str:
    if hatch_date is not None:
        days = (as_of - hatch_date).days
        if days >= 0:
            return f"{days} days (as of {format_display_date(as_of)})"
        return "Not recorded"
    if estimated_age_days is not None:
        return f"About {estimated_age_days} days (estimated)"
    return "Not recorded"


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe.replace("\n", "<br/>"), style)


def _blank(value: str | None, fallback: str = "Not recorded") -> str:
    text = (value or "").strip()
    return text if text else fallback


def format_record_status(ev: BirdProfileVaccinationEventOut) -> str:
    """Plain-language status for an administered vaccination row."""
    bits: list[str] = []
    if ev.coverage_scope == "cohort":
        bits.append(f"Vaccinations recorded for the batch ({ev.birds_covered} birds)")
    else:
        bits.append("Recorded for this bird")
    timing = format_timing_label(ev.timing_status)
    if timing and timing != "—":
        bits.append(timing)
    ver = (ev.verification_status or "").strip().lower()
    if ver == "unverified":
        bits.append("Needs verification")
    elif ver == "verified":
        bits.append("Verified")
    return " · ".join(bits)


def _parent_label(parent) -> str | None:
    if parent is None:
        return None
    if parent.band_id:
        return parent.band_id
    if parent.display_code and parent.display_code != parent.band_id:
        code = parent.display_code.strip()
        if len(code) >= 8 and "-" in code and all(c in "0123456789abcdef-" for c in code.lower()):
            return None
        return code
    return None


def _parentage_display(parentage: BirdParentageOut | None, legacy_label: str | None) -> str:
    if parentage is not None and parentage.source != "unknown":
        label = (parentage.label or "").strip()
        if label and label not in {"Unknown", "Not recorded"}:
            # Prefer the pre-built buyer label; append notes only when not already included.
            if parentage.notes and parentage.notes not in label:
                return f"{label} · {parentage.notes}"
            return label
        bits: list[str] = []
        if parentage.display_name:
            bits.append(parentage.display_name)
        if parentage.band_id and parentage.band_id not in " · ".join(bits):
            bits.append(parentage.band_id)
        if parentage.breed:
            bits.append(parentage.breed)
        if parentage.notes:
            bits.append(parentage.notes)
        if bits:
            return " · ".join(bits)
    if legacy_label:
        return legacy_label
    return "Not recorded"


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
        # Page numbers only when the report spans more than one page.
        if page_count > 1:
            self.drawCentredString(width / 2, 10 * mm, f"Page {self._pageNumber} of {page_count}")
        if self._footer_note:
            y = 14 * mm if page_count > 1 else 10 * mm
            self.drawString(14 * mm, y, self._footer_note[:110])
        self.restoreState()


def _kv_table(pairs: list[tuple[str, object]], muted: ParagraphStyle, body: ParagraphStyle) -> Table:
    rows = []
    for label, value in pairs:
        if isinstance(value, Table):
            rows.append([_p(label, muted), value])
        else:
            rows.append([_p(label, muted), _p(str(value), body)])
    table = Table(rows, colWidths=[40 * mm, 136 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), _MINT),
                ("BOX", (0, 0), (-1, -1), 0.4, _BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, _BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table



def _section_heading(text: str, h2: ParagraphStyle) -> list:
    """Section title + copper rule as flowables; callers should ``story.extend(...)``."""
    rule = Table([[""]], colWidths=[182 * mm], rowHeights=[1])
    rule.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), _COPPER),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return [_p(text, h2), rule, Spacer(1, 2)]


def _vaccine_display_name(ev: BirdProfileVaccinationEventOut) -> str:
    """Use saved catalogue/event name only — never invent expansions."""
    name = (ev.vaccine_name or "").strip()
    strain = (ev.vaccine_type_or_strain or "").strip()
    if name and strain and strain.lower() not in name.lower():
        return f"{name} ({strain})"
    return name or "Not recorded"


def _two_col_kv(
    left: list[tuple[str, object]],
    right: list[tuple[str, object]],
    muted: ParagraphStyle,
    body: ParagraphStyle,
) -> Table:
    """Compact two-column key/value layout for identity fields."""

    def _side(pairs: list[tuple[str, object]]) -> Table:
        rows = []
        for label, value in pairs:
            if isinstance(value, Table):
                rows.append([_p(label, muted), value])
            else:
                rows.append([_p(label, muted), _p(str(value), body)])
        t = Table(rows, colWidths=[28 * mm, 58 * mm])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), _MINT),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                    ("BOX", (0, 0), (-1, -1), 0.3, _BORDER),
                    ("INNERGRID", (0, 0), (-1, -1), 0.2, _BORDER),
                ]
            )
        )
        return t

    grid = Table([[_side(left), _side(right)]], colWidths=[90 * mm, 92 * mm])
    grid.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 4),
                ("LEFTPADDING", (1, 0), (1, 0), 4),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return grid


def build_bird_vaccination_pdf_bytes(
    profile: BirdProfileOut,
    *,
    generated_at: datetime,
    timezone_name: str | None = None,
    recorder_names: dict[UUID, str | None] | None = None,
    scheduled_dues: dict[UUID, date | None] | None = None,
) -> bytes:
    """Build a buyer-friendly Bird Profile & Health Record PDF."""
    recorder_names = recorder_names or {}
    scheduled_dues = scheduled_dues or {}
    gen_str, tz_label = format_generated_at(generated_at, timezone_name)
    as_of = generated_at.astimezone(timezone.utc).date()

    buf = io.BytesIO()
    footer_note = "PoultryTrack · Bird Profile & Health Record"
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=16 * mm,
        title="Bird Profile & Health Record",
        author="PoultryTrack",
    )
    styles = getSampleStyleSheet()
    brand = ParagraphStyle(
        "PTBrand",
        parent=styles["Normal"],
        fontSize=9,
        textColor=_BRAND,
        alignment=TA_LEFT,
        fontName="Helvetica-Bold",
    )
    title = ParagraphStyle(
        "PTTitle",
        parent=styles["Heading1"],
        fontSize=13,
        textColor=_BRAND_DARK,
        alignment=TA_LEFT,
        fontName="Helvetica-Bold",
        leading=15,
    )
    meta = ParagraphStyle(
        "PTMeta",
        parent=styles["Normal"],
        fontSize=7.5,
        textColor=_MUTED,
        alignment=TA_RIGHT,
        leading=9,
    )
    h2 = ParagraphStyle(
        "PTH2",
        parent=styles["Heading2"],
        fontSize=9.5,
        textColor=_BRAND_DARK,
        spaceBefore=6,
        spaceAfter=1,
        fontName="Helvetica-Bold",
    )
    body = ParagraphStyle(
        "PTBody", parent=styles["Normal"], fontSize=8, leading=10, textColor=_INK, alignment=TA_LEFT
    )
    small = ParagraphStyle("PTSmall", parent=styles["Normal"], fontSize=7, leading=9, textColor=_INK)
    table_header = ParagraphStyle(
        "PTTableHeader",
        parent=styles["Normal"],
        fontSize=7,
        leading=8.5,
        textColor=colors.white,
        fontName="Helvetica-Bold",
    )
    muted = ParagraphStyle("PTMuted", parent=styles["Normal"], fontSize=7.5, leading=9, textColor=_MUTED)
    note = ParagraphStyle(
        "PTNote",
        parent=styles["Normal"],
        fontSize=7,
        leading=9,
        textColor=_COPPER,
    )
    badge_style = ParagraphStyle(
        "PTBadge",
        parent=styles["Normal"],
        fontSize=8,
        leading=9,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
    )

    story: list = []
    band_for_meta = profile.band_id or profile.display_code or "Unbanded"
    status_label = format_lifecycle_label(profile.lifecycle_status)
    badge_bg, badge_fg = lifecycle_badge_colors(profile.lifecycle_status)
    badge_style.textColor = badge_fg
    status_cell = Table([[_p(status_label, badge_style)]], colWidths=[28 * mm])
    status_cell.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), badge_bg),
                ("BOX", (0, 0), (-1, -1), 0.5, badge_fg),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    # --- Compact header: brand + title + generated date ---
    header = Table(
        [
            [_p("PoultryTrack", brand), _p(f"Generated {gen_str} ({tz_label})", meta)],
            [_p("Bird Profile & Health Record", title), status_cell],
            [
                _p(
                    f"Band {band_for_meta} · {_blank(profile.breed)} · "
                    f"{(str(profile.sex).replace('_', ' ').title() if profile.sex else 'Sex not recorded')}",
                    muted,
                ),
                "",
            ],
        ],
        colWidths=[150 * mm, 32 * mm],
    )
    header.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), _MINT),
                ("BOX", (0, 0), (-1, -1), 0.6, _BRAND),
                ("SPAN", (0, 2), (1, 2)),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("ALIGN", (1, 1), (1, 1), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(header)

    band = profile.band_id or "Not recorded"
    breed = _blank(profile.breed)
    sex_label = (
        str(profile.sex).replace("_", " ").strip().title() if profile.sex else "Not recorded"
    )
    age_label = age_as_of_report(profile.hatch_date, profile.estimated_age_days, as_of)
    display_code = profile.display_code if profile.display_code != profile.band_id else None
    shed_bits = [b for b in [profile.shed_name, profile.shed_code] if b]
    father = _parentage_display(profile.sire_parentage, _parent_label(profile.sire))
    mother = _parentage_display(profile.dam_parentage, _parent_label(profile.dam))

    # --- Bird details (two columns) + parents inline ---
    story.extend(_section_heading("Bird details", h2))
    left_pairs: list[tuple[str, object]] = [
        ("Band number", band),
        ("Name / code", _blank(display_code)),
        ("Breed", breed),
        ("Sex", sex_label),
        ("Date hatched", format_display_date(profile.hatch_date)),
        ("Age", age_label),
    ]
    right_pairs: list[tuple[str, object]] = [
        ("Farm", _blank(profile.organization_name)),
        ("Shed", " · ".join(shed_bits) if shed_bits else "Not recorded"),
        ("Batch", _blank(profile.batch_code)),
        ("Record created on", format_display_date(profile.created_at)),
        ("Father", father),
        ("Mother", mother),
    ]
    story.append(_two_col_kv(left_pairs, right_pairs, muted, body))
    if profile.notes:
        story.append(Spacer(1, 2))
        story.append(_kv_table([("Notes", _blank(profile.notes))], muted, body))

    if not profile.is_active:
        story.append(Spacer(1, 2))
        story.append(
            _p(
                f"This bird is marked {status_label}. Past vaccination and ownership records "
                "are included below. New vaccinations cannot be recorded for inactive birds.",
                note,
            )
        )

    # --- Sale (only when relevant) ---
    sale: BirdSaleDetailsOut | None = profile.sale
    if profile.lifecycle_status == BirdLifecycleStatus.sold or sale is not None:
        story.extend(_section_heading("Sale details", h2))
        if sale is None:
            story.append(_p("Sale details are not recorded for this bird.", muted))
        else:
            story.append(
                _two_col_kv(
                    [
                        ("Sold on", format_display_date(sale.sold_on)),
                        ("Buyer", _blank(sale.buyer_name)),
                    ],
                    [
                        ("Mobile", _blank(sale.buyer_mobile)),
                        ("Recorded on", format_display_date(sale.recorded_at)),
                    ],
                    muted,
                    body,
                )
            )

    # --- Vaccination overview ---
    story.extend(_section_heading("Vaccination overview", h2))
    n_ind = len(profile.individual_vaccinations)
    n_up = len(profile.batch_upcoming_doses)
    n_overdue = sum(
        1 for d in profile.batch_upcoming_doses if (d.status or "").lower() == STATUS_OVERDUE
    )
    last_vax = None
    if profile.individual_vaccinations:
        last = max(profile.individual_vaccinations, key=lambda e: e.administration_date)
        last_vax = (
            f"{last.vaccine_name or 'Vaccine'} on {format_display_date(last.administration_date)}"
        )
    next_due = None
    if profile.batch_upcoming_doses:
        nxt = min(profile.batch_upcoming_doses, key=lambda d: d.due_date)
        next_due = (
            f"{nxt.vaccine_name or 'Vaccine'} due {format_display_date(nxt.due_date)} "
            f"({format_dose_status_label(nxt.status)})"
        )
    n_cohort = sum(1 for e in profile.individual_vaccinations if e.coverage_scope == "cohort")
    n_banded = n_ind - n_cohort
    batch_phrase = (
        f"{n_cohort} vaccination recorded for the batch"
        if n_cohort == 1
        else f"{n_cohort} vaccinations recorded for the batch"
    )
    summary_bits = [
        f"Administered vaccinations on record: {n_ind} "
        f"({n_banded} for this banded bird, {batch_phrase}).",
        f"Upcoming vaccinations: {n_up}.",
    ]
    if n_overdue:
        summary_bits.append(
            f"Overdue (past the due date, not yet recorded as given): {n_overdue}."
        )
    if last_vax:
        summary_bits.append(f"Most recent administered: {last_vax}.")
    if next_due:
        summary_bits.append(f"Next upcoming: {next_due}.")
    story.append(_p(" ".join(summary_bits), body))
    story.append(Spacer(1, 2))
    story.append(_p(_HISTORY_CONTEXT, note))

    # --- Vaccination record (compact) ---
    story.extend(_section_heading("Vaccination record", h2))
    if not profile.individual_vaccinations:
        story.append(
            _p(
                "No vaccination records have been recorded for this bird yet.",
                muted,
            )
        )
    else:
        header = [
            _p("Vaccine", table_header),
            _p("Date given", table_header),
            _p("Manufacturer / brand", table_header),
            _p("Batch / lot", table_header),
            _p("Expiry", table_header),
            _p("Vaccination record", table_header),
        ]
        rows = [header]
        for ev in profile.individual_vaccinations:
            extra_bits: list[str] = []
            if ev.dose_amount:
                extra_bits.append(f"Dose {ev.dose_amount}")
            if ev.route:
                extra_bits.append(f"Route {ev.route}")
            due = scheduled_dues.get(ev.scheduled_dose_id) if ev.scheduled_dose_id else None
            if due:
                extra_bits.append(f"Was due {format_display_date(due)}")
            if ev.notes:
                extra_bits.append(ev.notes[:80])
            status_text = format_record_status(ev)
            if extra_bits:
                status_text = f"{status_text} · " + " · ".join(extra_bits)
            rows.append(
                [
                    _p(_vaccine_display_name(ev), small),
                    _p(format_display_date(ev.administration_date), small),
                    _p(ev.manufacturer_or_brand or "Not recorded", small),
                    _p(ev.lot_number or "Not recorded", small),
                    _p(
                        format_display_date(ev.product_expiry) if ev.product_expiry else "Not recorded",
                        small,
                    ),
                    _p(status_text, small),
                ]
            )
        hist = Table(
            rows,
            colWidths=[32 * mm, 22 * mm, 32 * mm, 24 * mm, 22 * mm, 50 * mm],
            repeatRows=1,
        )
        hist.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, _BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(hist)

    # --- Upcoming vaccinations ---
    story.extend(_section_heading("Upcoming vaccinations", h2))
    upcoming_body: object
    if not profile.batch_upcoming_doses:
        upcoming_body = _p("No upcoming vaccinations are currently scheduled.", muted)
    else:
        story.append(_p(_BATCH_NOTE, note))
        story.append(Spacer(1, 3))
        header = [
            _p("Vaccine", table_header),
            _p("Dose", table_header),
            _p("Due date", table_header),
            _p("Status", table_header),
            _p("Batch progress", table_header),
        ]
        rows = [header]
        for d in profile.batch_upcoming_doses:
            rows.append(
                [
                    _p(d.vaccine_name or "Not recorded", small),
                    _p(str(d.dose_number), small),
                    _p(format_display_date(d.due_date), small),
                    _p(format_dose_status_label(d.status), small),
                    _p(f"{d.completed_count} of {d.eligible_count} birds covered", small),
                ]
            )
        upcoming_body = Table(
            rows, colWidths=[42 * mm, 16 * mm, 28 * mm, 28 * mm, 68 * mm], repeatRows=1
        )
        upcoming_body.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _COPPER),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E8C9B0")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_COPPER_SOFT, colors.white]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )

    # --- Transfer & ownership history + disclaimer ---
    # Keep the last meaningful block with the disclaimer so leftover frame height
    # cannot orphan the disclaimer alone on a nearly blank final page.
    life_events = list(profile.lifecycle_events or [])
    closing: list = []
    if life_events:
        # Upcoming body flows on the prior page; ownership + disclaimer stay together.
        story.append(upcoming_body)
        closing.extend(_section_heading("Transfer & ownership history", h2))
        ordered = sorted(
            life_events,
            key=lambda e: (e.effective_date, e.created_at),
        )
        header = [
            _p("Event", table_header),
            _p("Date", table_header),
            _p("Details", table_header),
        ]
        rows = [header]
        for ev in ordered:
            detail_bits = []
            if ev.reason:
                detail_bits.append(ev.reason)
            if ev.buyer_name:
                detail_bits.append(f"Buyer {ev.buyer_name}")
            if ev.buyer_mobile:
                detail_bits.append(f"Mobile {ev.buyer_mobile}")
            if ev.quantity and ev.quantity != 1:
                detail_bits.append(f"Qty {ev.quantity}")
            rows.append(
                [
                    _p(format_lifecycle_label(ev.event_type), small),
                    _p(format_display_date(ev.effective_date), small),
                    _p(" · ".join(detail_bits) if detail_bits else "—", small),
                ]
            )
        life = Table(rows, colWidths=[36 * mm, 28 * mm, 118 * mm], repeatRows=1)
        life.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.25, _BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT]),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                ]
            )
        )
        closing.append(life)
    else:
        closing.append(upcoming_body)

    closing.append(Spacer(1, 4))
    closing.append(_p(_DISCLAIMER, muted))
    story.append(KeepTogether(closing))

    doc.build(
        story,
        canvasmaker=lambda *a, **k: _NumberedCanvas(*a, footer_note=footer_note, **k),
    )
    return buf.getvalue()



async def _load_complete_vaccinations(
    db: AsyncSession, ctx: AuthContext, bird_id: UUID
) -> list[BirdProfileVaccinationEventOut]:
    """Complete vaccination history for PDF (individual + attributable cohort)."""
    from app.models.flock import Bird
    from app.services.bird_vaccination_history import load_bird_vaccination_history

    bird = await db.get(Bird, bird_id)
    if bird is None or bird.owner_account_id != ctx.owner_account_id:
        return []
    return await load_bird_vaccination_history(db, ctx, bird, limit=None, ascending=True)


async def _load_complete_lifecycle(
    db: AsyncSession, ctx: AuthContext, bird_id: UUID
) -> list[BirdProfileLifecycleOut]:
    """All lifecycle events for the bird (no UI pagination limit)."""
    life_rows = list(
        await db.scalars(
            select(LifecycleEvent)
            .where(
                LifecycleEvent.owner_account_id == ctx.owner_account_id,
                LifecycleEvent.bird_id == bird_id,
            )
            .order_by(LifecycleEvent.effective_date.asc(), LifecycleEvent.created_at.asc())
        )
    )
    return [
        BirdProfileLifecycleOut(
            id=e.id,
            event_type=e.event_type,
            effective_date=e.effective_date,
            quantity=e.quantity,
            reason=e.reason,
            buyer_name=e.buyer_name,
            buyer_mobile=e.buyer_mobile,
            created_at=e.created_at,
        )
        for e in life_rows
    ]


async def generate_bird_vaccination_report(
    db: AsyncSession, ctx: AuthContext, bird_id: UUID
) -> tuple[bytes, str]:
    """Authorize via profile service, enrich full history, return (pdf_bytes, filename)."""
    try:
        profile = await flock_service.get_bird_profile(db, ctx, bird_id)
    except flock_service.FlockError as exc:
        raise BirdReportError(exc.message, exc.code) from exc

    # Replace truncated profile lists with complete export queries (no N+1).
    complete_vax = await _load_complete_vaccinations(db, ctx, bird_id)
    complete_life = await _load_complete_lifecycle(db, ctx, bird_id)
    profile = profile.model_copy(
        update={
            "individual_vaccinations": complete_vax,
            "lifecycle_events": complete_life,
        }
    )

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
