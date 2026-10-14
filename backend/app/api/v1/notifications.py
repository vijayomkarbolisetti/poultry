from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.vaccine import NotificationOut
from app.services import notification_service

router = APIRouter()


@router.post("/generate")
async def generate(
    ctx: AuthContext = Depends(require_permission("schedule.view")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    created = await notification_service.generate_dose_alerts(db, ctx)
    return {"created": created}


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread_only: bool = Query(False),
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationOut]:
    rows = await notification_service.list_notifications(db, ctx, unread_only=unread_only)
    return [NotificationOut.model_validate(r) for r in rows]


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> NotificationOut:
    row = await notification_service.mark_read(db, ctx, notification_id)
    if not row:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Not found")
    return NotificationOut.model_validate(row)
