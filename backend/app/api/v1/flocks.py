from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.flock import FlockCreate, FlockOut, FlockUpdate
from app.services import flock_service

router = APIRouter()


@router.post("", response_model=FlockOut, status_code=status.HTTP_201_CREATED)
async def create_flock(
    body: FlockCreate,
    ctx: AuthContext = Depends(require_permission("flock.create")),
    db: AsyncSession = Depends(get_db),
) -> FlockOut:
    try:
        flock = await flock_service.create_flock(db, ctx, body)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FlockOut.model_validate(flock)


@router.get("", response_model=list[FlockOut])
async def list_flocks(
    shed_id: UUID | None = Query(default=None),
    ctx: AuthContext = Depends(require_permission("flock.view")),
    db: AsyncSession = Depends(get_db),
) -> list[FlockOut]:
    rows = await flock_service.list_flocks(db, ctx, shed_id=shed_id)
    return [FlockOut.model_validate(r) for r in rows]


@router.get("/{flock_id}", response_model=FlockOut)
async def get_flock(
    flock_id: UUID,
    ctx: AuthContext = Depends(require_permission("flock.view")),
    db: AsyncSession = Depends(get_db),
) -> FlockOut:
    try:
        flock = await flock_service.get_flock(db, ctx, flock_id)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return FlockOut.model_validate(flock)


@router.patch("/{flock_id}", response_model=FlockOut)
async def update_flock(
    flock_id: UUID,
    body: FlockUpdate,
    ctx: AuthContext = Depends(require_permission("flock.update")),
    db: AsyncSession = Depends(get_db),
) -> FlockOut:
    try:
        flock = await flock_service.update_flock(db, ctx, flock_id, body)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return FlockOut.model_validate(flock)
