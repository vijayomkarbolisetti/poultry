from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.models.flock import Flock
from app.models.membership import OwnerMembership
from app.models.notification import Notification
from app.models.shed import ShedMembership
from app.models.vaccine import ScheduledDose
from app.services.schedule_engine import (
    STATUS_DUE_SOON,
    STATUS_DUE_TODAY,
    STATUS_NEEDS_REVIEW,
    STATUS_OVERDUE,
)


def format_dose_alert_body(*, due_date: date, batch_code: str | None) -> str:
    """Build user-facing dose alert body using Batch terminology (never raw flock UUIDs)."""
    due = due_date.isoformat()
    code = (batch_code or "").strip()
    if code:
        return f"Dose due {due} (batch {code})"
    return f"Dose due {due}"


async def generate_dose_alerts(db: AsyncSession, ctx: AuthContext) -> int:
    """Create in-app notifications for due/overdue/review doses; skip duplicates."""
    assert ctx.owner_account_id
    doses = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.owner_account_id == ctx.owner_account_id,
                ScheduledDose.is_active.is_(True),
                ScheduledDose.status.in_(
                    [STATUS_DUE_TODAY, STATUS_DUE_SOON, STATUS_OVERDUE, STATUS_NEEDS_REVIEW]
                ),
            )
        )
    )
    memberships = list(
        await db.scalars(
            select(OwnerMembership).where(
                OwnerMembership.owner_account_id == ctx.owner_account_id,
                OwnerMembership.is_active.is_(True),
            )
        )
    )
    flock_ids = {dose.flock_id for dose in doses if dose.flock_id is not None}
    batch_codes: dict[UUID, str] = {}
    if flock_ids:
        rows = await db.execute(select(Flock.id, Flock.batch_code).where(Flock.id.in_(flock_ids)))
        batch_codes = {row.id: row.batch_code for row in rows}

    created = 0
    for dose in doses:
        alert_type = dose.status
        title = f"Vaccine {dose.status.replace('_', ' ')}"
        body = format_dose_alert_body(
            due_date=dose.due_date,
            batch_code=batch_codes.get(dose.flock_id) if dose.flock_id else None,
        )
        severity = "warning" if dose.status == STATUS_OVERDUE else "info"
        for mem in memberships:
            if mem.role.value == "farmer":
                assigned = await db.scalar(
                    select(ShedMembership.id).where(
                        ShedMembership.owner_membership_id == mem.id,
                        ShedMembership.shed_id == dose.shed_id,
                        ShedMembership.is_active.is_(True),
                    )
                )
                if not assigned:
                    continue
            stmt = (
                insert(Notification)
                .values(
                    owner_account_id=ctx.owner_account_id,
                    user_id=mem.user_id,
                    shed_id=dose.shed_id,
                    flock_id=dose.flock_id,
                    scheduled_dose_id=dose.id,
                    alert_type=alert_type,
                    title=title,
                    body=body,
                    severity=severity,
                    is_read=False,
                    is_active=True,
                )
                .on_conflict_do_nothing(
                    index_elements=["owner_account_id", "user_id", "scheduled_dose_id", "alert_type"]
                )
            )
            result = await db.execute(stmt)
            if result.rowcount:
                created += 1
    await db.commit()
    return created


async def list_notifications(db: AsyncSession, ctx: AuthContext, unread_only: bool = False) -> list[Notification]:
    stmt = select(Notification).where(
        Notification.owner_account_id == ctx.owner_account_id,
        Notification.user_id == ctx.user.id,
        Notification.is_active.is_(True),
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    return list(await db.scalars(stmt.order_by(Notification.created_at.desc())))


async def mark_read(db: AsyncSession, ctx: AuthContext, notification_id) -> Notification | None:
    row = await db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == ctx.user.id,
            Notification.owner_account_id == ctx.owner_account_id,
        )
    )
    if row:
        row.is_read = True
        await db.commit()
        await db.refresh(row)
    return row
