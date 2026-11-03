from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.vaccine import (
    ManualVaccinationBatchIn,
    ManualVaccinationBatchOut,
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
    enriched = await vaccination_service.enrich_vaccination_events(db, [event])
    return VaccinationEventOut.model_validate(enriched[0])


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
    enriched = await vaccination_service.enrich_vaccination_events(db, events)
    return [VaccinationEventOut.model_validate(row) for row in enriched]


@router.post(
    "/manual-batch",
    response_model=ManualVaccinationBatchOut,
    status_code=status.HTTP_201_CREATED,
)
async def record_manual_batch(
    body: ManualVaccinationBatchIn,
    ctx: AuthContext = Depends(require_permission("vaccination.record")),
    db: AsyncSession = Depends(get_db),
) -> ManualVaccinationBatchOut:
    """Record the same ad-hoc vaccine details for one or more selected birds."""
    try:
        return await vaccination_service.record_manual_vaccination_batch(db, ctx, body)
    except vaccination_service.VaccinationError as exc:
        code = 409 if exc.code == "IDEMPOTENCY_CONFLICT" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.get("", response_model=list[VaccinationEventOut])
async def list_events(
    flock_id: UUID | None = Query(None),
    ctx: AuthContext = Depends(require_permission("vaccination.view")),
    db: AsyncSession = Depends(get_db),
) -> list[VaccinationEventOut]:
    rows = await vaccination_service.list_events(db, ctx, flock_id=flock_id)
    enriched = await vaccination_service.enrich_vaccination_events(db, rows)
    return [VaccinationEventOut.model_validate(row) for row in enriched]


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
    enriched = await vaccination_service.enrich_vaccination_events(db, [event])
    return VaccinationEventOut.model_validate(enriched[0])
