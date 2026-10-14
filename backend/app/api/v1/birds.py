from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.flock import BirdBulkImport, BirdBulkResult, BirdCreate, BirdOut
from app.services import flock_service

router = APIRouter()


@router.post("", response_model=BirdOut, status_code=status.HTTP_201_CREATED)
async def create_bird(
    body: BirdCreate,
    ctx: AuthContext = Depends(require_permission("bird.create")),
    db: AsyncSession = Depends(get_db),
) -> BirdOut:
    try:
        bird = await flock_service.create_bird(db, ctx, body)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return BirdOut.model_validate(bird)


@router.get("", response_model=list[BirdOut])
async def list_birds(
    flock_id: UUID = Query(...),
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> list[BirdOut]:
    try:
        rows = await flock_service.list_birds(db, ctx, flock_id)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return [BirdOut.model_validate(r) for r in rows]


@router.get("/{bird_id}", response_model=BirdOut)
async def get_bird(
    bird_id: UUID,
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> BirdOut:
    try:
        bird = await flock_service.get_bird(db, ctx, bird_id)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return BirdOut.model_validate(bird)


@router.post("/bulk-import", response_model=BirdBulkResult)
async def bulk_import(
    body: BirdBulkImport,
    ctx: AuthContext = Depends(require_permission("bird.create")),
    db: AsyncSession = Depends(get_db),
) -> BirdBulkResult:
    try:
        result = await flock_service.bulk_import_birds(db, ctx, body)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return BirdBulkResult(
        created=result["created"],
        failed=result["failed"],
        errors=result["errors"],
        bird_ids=result["bird_ids"],
    )
