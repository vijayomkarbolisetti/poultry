from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_org_context
from app.core.database import get_db
from app.schemas.dashboard import DashboardSummary
from app.services import dashboard_service

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(
    ctx: AuthContext = Depends(require_org_context),
    db: AsyncSession = Depends(get_db),
) -> DashboardSummary:
    """Any active org member can load a scoped summary (farmers are shed-filtered in the service)."""
    data = await dashboard_service.summary(db, ctx)
    return DashboardSummary.model_validate(data)
