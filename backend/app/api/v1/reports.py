from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.models.vaccine import ScheduledDose
from app.schemas.vaccine import ReportComplianceOut
from app.services.schedule_engine import (
    STATUS_COMPLETED_LATE,
    STATUS_COMPLETED_ON_TIME,
    STATUS_DUE_TODAY,
    STATUS_NEEDS_REVIEW,
    STATUS_OVERDUE,
)

router = APIRouter()


@router.get("/compliance", response_model=ReportComplianceOut)
async def compliance_report(
    ctx: AuthContext = Depends(require_permission("report.view")),
    db: AsyncSession = Depends(get_db),
) -> ReportComplianceOut:
    # Status refresh is owned by GET /vaccines/scheduled-doses — avoid double write on this path.
    rows = (
        await db.execute(
            select(ScheduledDose.status, func.count().label("n"))
            .where(
                ScheduledDose.owner_account_id == ctx.owner_account_id,
                ScheduledDose.is_active.is_(True),
            )
            .group_by(ScheduledDose.status)
        )
    ).all()
    by_status = {row.status: int(row.n) for row in rows}
    on_time = by_status.get(STATUS_COMPLETED_ON_TIME, 0)
    late = by_status.get(STATUS_COMPLETED_LATE, 0)
    overdue = by_status.get(STATUS_OVERDUE, 0)
    return ReportComplianceOut(
        on_time=on_time,
        late=late,
        overdue=overdue,
        due_today=by_status.get(STATUS_DUE_TODAY, 0),
        needs_review=by_status.get(STATUS_NEEDS_REVIEW, 0),
        compliance_numerator=on_time,
        compliance_denominator=on_time + late + overdue,
    )
