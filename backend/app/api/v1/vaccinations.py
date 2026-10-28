from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.vaccine import (
    VaccinationBatchRecordIn,
    VaccinationCorrectionIn,
    VaccinationEventOut,
    VaccinationRecordIn,
)
from app.services import vaccination_service

router = APIRouter()


@router.post("", response_model=VaccinationEventOut, status_code=status.HTTP_201_CREATED)
async def record(
    body: VaccinationRecordIn,
    ctx: AuthContext = Depends(require_permission("vaccination.record")),
    db: AsyncSession = Depends(get_db),
) -> VaccinationEventOut:
    try:
        event = await vaccination_service.record_vaccination(db, ctx, body)
    except vaccination_service.VaccinationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return VaccinationEventOut.model_validate(event)


@router.post("/batch", response_model=list[VaccinationEventOut], status_code=status.HTTP_201_CREATED)
async def record_batch(
    body: VaccinationBatchRecordIn,
    ctx: AuthContext = Depends(require_permission("vaccination.record")),
    db: AsyncSession = Depends(get_db),
) -> list[VaccinationEventOut]:
    """Shed-wide / multi-population confirm — same business rules as single record."""
    try:
        events = await vaccination_service.record_vaccination_batch(db, ctx, body)
    except vaccination_service.VaccinationError as exc:
        code = 409 if exc.code == "IDEMPOTENCY_CONFLICT" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return [VaccinationEventOut.model_validate(e) for e in events]


@router.get("", response_model=list[VaccinationEventOut])
async def list_events(
    flock_id: UUID | None = Query(None),
    ctx: AuthContext = Depends(require_permission("vaccination.view")),
    db: AsyncSession = Depends(get_db),
) -> list[VaccinationEventOut]:
    rows = await vaccination_service.list_events(db, ctx, flock_id=flock_id)
    return [VaccinationEventOut.model_validate(r) for r in rows]


@router.post("/{event_id}/correct", response_model=VaccinationEventOut)
async def correct(
    event_id: UUID,
    body: VaccinationCorrectionIn,
    ctx: AuthContext = Depends(require_permission("vaccination.correct")),
    db: AsyncSession = Depends(get_db),
) -> VaccinationEventOut:
    try:
        event = await vaccination_service.void_or_correct(db, ctx, event_id, body)
    except vaccination_service.VaccinationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return VaccinationEventOut.model_validate(event)
