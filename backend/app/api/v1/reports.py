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
    compliance_counts,
)
from app.services import vaccine_service

router = APIRouter()


@router.get("/compliance", response_model=ReportComplianceOut)
async def compliance_report(
    ctx: AuthContext = Depends(require_permission("report.view")),
    db: AsyncSession = Depends(get_db),
) -> ReportComplianceOut:
    await vaccine_service.refresh_dose_statuses(db, ctx)
    rows = list(
        await db.scalars(
            select(ScheduledDose).where(
                ScheduledDose.owner_account_id == ctx.owner_account_id,
                ScheduledDose.is_active.is_(True),
            )
        )
    )
    statuses = [r.status for r in rows]
    num, den = compliance_counts(statuses)
    return ReportComplianceOut(
        on_time=sum(1 for s in statuses if s == STATUS_COMPLETED_ON_TIME),
        late=sum(1 for s in statuses if s == STATUS_COMPLETED_LATE),
        overdue=sum(1 for s in statuses if s == STATUS_OVERDUE),
        due_today=sum(1 for s in statuses if s == STATUS_DUE_TODAY),
        needs_review=sum(1 for s in statuses if s == STATUS_NEEDS_REVIEW),
        compliance_numerator=num,
        compliance_denominator=den,
    )
