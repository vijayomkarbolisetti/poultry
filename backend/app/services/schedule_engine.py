"""Central schedule status engine (Phase 4). Pure helpers + generation."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models.enums import DobConfidence

# Status vocabulary from requirements
STATUS_UPCOMING = "upcoming"
STATUS_DUE_SOON = "due_soon"
STATUS_DUE_TODAY = "due_today"
STATUS_OVERDUE = "overdue"
STATUS_COMPLETED_ON_TIME = "completed_on_time"
STATUS_COMPLETED_LATE = "completed_late"
STATUS_COMPLETED_TIMING_UNKNOWN = "completed_timing_unknown"
STATUS_SKIPPED = "skipped"
STATUS_NOT_APPLICABLE = "not_applicable"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_INACTIVE = "inactive"


def _tz(timezone_name: str | None):
    """Resolve IANA TZ; use datetime.timezone.utc when unset (Windows-safe)."""
    from datetime import timezone as dt_timezone

    if not timezone_name or timezone_name.upper() == "UTC":
        return dt_timezone.utc
    return ZoneInfo(timezone_name)


def farm_local_today(timezone_name: str | None, utc_now: datetime | None = None) -> date:
    """D2: evaluate calendar days in farm-local TZ; fallback UTC if unset."""
    from datetime import timezone as dt_timezone

    now = utc_now or datetime.now(dt_timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt_timezone.utc)
    return now.astimezone(_tz(timezone_name)).date()


def farm_local_date(dt: datetime, timezone_name: str | None) -> date:
    from datetime import timezone as dt_timezone

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_timezone.utc)
    return dt.astimezone(_tz(timezone_name)).date()


def compute_dose_status(
    *,
    due_date: date,
    grace_period_days: int,
    reminder_lead_days: int,
    today: date,
    completed_admin_date: date | None = None,
    verification_status: str | None = None,
    is_void: bool = False,
    skipped: bool = False,
    inactive: bool = False,
    dob_confidence: DobConfidence | None = None,
    has_uncertain_history: bool = False,
) -> str:
    if inactive:
        return STATUS_INACTIVE
    if skipped:
        return STATUS_SKIPPED
    if is_void:
        # treat as open again
        completed_admin_date = None

    if dob_confidence == DobConfidence.unknown or has_uncertain_history:
        if completed_admin_date is None:
            return STATUS_NEEDS_REVIEW

    if completed_admin_date is not None:
        if verification_status == "unverified":
            # D4: still a completion record but timing may be unknown for compliance
            return STATUS_COMPLETED_TIMING_UNKNOWN
        if completed_admin_date <= due_date:
            return STATUS_COMPLETED_ON_TIME
        return STATUS_COMPLETED_LATE

    if today < due_date - timedelta(days=max(reminder_lead_days, 0)):
        return STATUS_UPCOMING
    if today < due_date:
        return STATUS_DUE_SOON
    if today == due_date:
        return STATUS_DUE_TODAY
    overdue_start = due_date + timedelta(days=max(grace_period_days, 0))
    if today <= overdue_start and grace_period_days > 0 and today > due_date:
        # still within grace after due day — keep as due_today-ish overdue pending
        return STATUS_OVERDUE if today > overdue_start else STATUS_DUE_TODAY
    if today > overdue_start:
        return STATUS_OVERDUE
    return STATUS_DUE_TODAY


def generate_due_dates(
    *,
    hatch_date: date | None,
    target_age_days: int | None,
    repeat_interval_days: int | None,
    max_repeats: int | None,
    dob_confidence: DobConfidence,
) -> tuple[list[date], bool]:
    """Return (due_dates, needs_review)."""
    if dob_confidence == DobConfidence.unknown or hatch_date is None:
        return [], True
    if target_age_days is None and not repeat_interval_days:
        return [], True

    dues: list[date] = []
    if target_age_days is not None:
        first = hatch_date + timedelta(days=target_age_days)
        dues.append(first)
        if repeat_interval_days and repeat_interval_days > 0:
            repeats = max_repeats if max_repeats is not None else 12
            current = first
            for _ in range(max(repeats - 1, 0)):
                current = current + timedelta(days=repeat_interval_days)
                dues.append(current)
    elif repeat_interval_days:
        # start at hatch + interval
        repeats = max_repeats if max_repeats is not None else 12
        current = hatch_date
        for i in range(repeats):
            current = hatch_date + timedelta(days=repeat_interval_days * (i + 1))
            dues.append(current)
    return dues, False


def compliance_counts(statuses: list[str]) -> tuple[int, int]:
    """On-time completed / eligible due. Excludes N/A, inactive; late separate from on-time."""
    excluded = {STATUS_NOT_APPLICABLE, STATUS_INACTIVE, STATUS_SKIPPED}
    eligible = [s for s in statuses if s not in excluded]
    # due = anything that reached due/completed/overdue/review
    due_like = {
        STATUS_DUE_TODAY,
        STATUS_DUE_SOON,
        STATUS_OVERDUE,
        STATUS_COMPLETED_ON_TIME,
        STATUS_COMPLETED_LATE,
        STATUS_COMPLETED_TIMING_UNKNOWN,
        STATUS_NEEDS_REVIEW,
    }
    denominator = sum(1 for s in eligible if s in due_like or s == STATUS_UPCOMING and False)
    # Better: denominator = doses whose due_date <= today OR completed
    denominator = sum(
        1
        for s in eligible
        if s
        in {
            STATUS_DUE_TODAY,
            STATUS_OVERDUE,
            STATUS_COMPLETED_ON_TIME,
            STATUS_COMPLETED_LATE,
            STATUS_COMPLETED_TIMING_UNKNOWN,
            STATUS_NEEDS_REVIEW,
            STATUS_DUE_SOON,
        }
    )
    numerator = sum(1 for s in eligible if s == STATUS_COMPLETED_ON_TIME)
    return numerator, denominator
