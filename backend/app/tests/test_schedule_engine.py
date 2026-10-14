from datetime import date, datetime, timezone

from app.models.enums import DobConfidence
from app.services.schedule_engine import (
    STATUS_COMPLETED_LATE,
    STATUS_COMPLETED_ON_TIME,
    STATUS_DUE_TODAY,
    STATUS_NEEDS_REVIEW,
    STATUS_OVERDUE,
    STATUS_UPCOMING,
    compute_dose_status,
    farm_local_today,
    generate_due_dates,
)


def test_on_time_vs_late():
    due = date(2026, 1, 10)
    assert (
        compute_dose_status(
            due_date=due,
            grace_period_days=0,
            reminder_lead_days=3,
            today=due,
            completed_admin_date=due,
        )
        == STATUS_COMPLETED_ON_TIME
    )
    assert (
        compute_dose_status(
            due_date=due,
            grace_period_days=0,
            reminder_lead_days=3,
            today=due,
            completed_admin_date=date(2026, 1, 12),
        )
        == STATUS_COMPLETED_LATE
    )


def test_overdue_and_upcoming():
    due = date(2026, 6, 1)
    assert (
        compute_dose_status(due_date=due, grace_period_days=0, reminder_lead_days=3, today=date(2026, 5, 20))
        == STATUS_UPCOMING
    )
    assert (
        compute_dose_status(due_date=due, grace_period_days=0, reminder_lead_days=3, today=due) == STATUS_DUE_TODAY
    )
    assert (
        compute_dose_status(due_date=due, grace_period_days=0, reminder_lead_days=3, today=date(2026, 6, 5))
        == STATUS_OVERDUE
    )


def test_unknown_dob_needs_review():
    assert (
        compute_dose_status(
            due_date=date(2026, 1, 1),
            grace_period_days=0,
            reminder_lead_days=3,
            today=date(2026, 1, 1),
            dob_confidence=DobConfidence.unknown,
        )
        == STATUS_NEEDS_REVIEW
    )


def test_monthly_30_day_interval():
    dues, needs = generate_due_dates(
        hatch_date=date(2026, 1, 1),
        target_age_days=1,
        repeat_interval_days=30,
        max_repeats=3,
        dob_confidence=DobConfidence.exact,
    )
    assert needs is False
    assert dues == [date(2026, 1, 2), date(2026, 2, 1), date(2026, 3, 3)]


def test_leap_year_boundary():
    dues, _ = generate_due_dates(
        hatch_date=date(2024, 2, 28),
        target_age_days=1,
        repeat_interval_days=None,
        max_repeats=None,
        dob_confidence=DobConfidence.exact,
    )
    assert dues == [date(2024, 2, 29)]


def test_farm_local_today_utc_fallback():
    d = farm_local_today(None, utc_now=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc))
    assert d == date(2026, 3, 15)
    d2 = farm_local_today("UTC", utc_now=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc))
    assert d2 == date(2026, 3, 15)
