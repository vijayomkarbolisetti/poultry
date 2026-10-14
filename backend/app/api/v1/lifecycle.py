from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.flock import LifecycleCreate, LifecycleOut
from app.services import flock_service

router = APIRouter()


@router.post("", response_model=LifecycleOut, status_code=status.HTTP_201_CREATED)
async def create_lifecycle_event(
    body: LifecycleCreate,
    ctx: AuthContext = Depends(require_permission("lifecycle.record")),
    db: AsyncSession = Depends(get_db),
) -> LifecycleOut:
    try:
        event = await flock_service.record_lifecycle(db, ctx, body)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return LifecycleOut.model_validate(event)
