from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.models.enums import SicknessSeverity, SicknessStatus
from app.schemas.sickness import (
    SicknessBulkCreate,
    SicknessBulkResultOut,
    SicknessListOut,
    SicknessRecover,
    SicknessRecordOut,
    SicknessSummaryOut,
    SicknessUpdate,
)
from app.services import sickness_service

router = APIRouter()

_STATUS_BY_CODE = {
    "INVALID": 400,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "BIRD_INACTIVE": 409,
    "ACTIVE_SICKNESS_EXISTS": 409,
    "ALREADY_RECOVERED": 409,
    "IDEMPOTENCY_CONFLICT": 409,
    "PARTIAL_IDEMPOTENCY": 409,
    "CONFLICT": 409,
}


def raise_sickness_http(exc: sickness_service.SicknessError) -> None:
    raise HTTPException(
        status_code=_STATUS_BY_CODE.get(exc.code, 400), detail=exc.message
    ) from exc


@router.get("/summary", response_model=SicknessSummaryOut)
async def get_sickness_summary(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    ctx: AuthContext = Depends(require_permission("sickness.view")),
    db: AsyncSession = Depends(get_db),
) -> SicknessSummaryOut:
    try:
        return await sickness_service.get_sickness_summary(
            db, ctx, from_date=from_date, to_date=to_date
        )
    except sickness_service.SicknessError as exc:
        raise_sickness_http(exc)


@router.get("", response_model=SicknessListOut)
async def list_sickness(
    q: str | None = Query(None, max_length=64),
    status: SicknessStatus | None = Query(None),
    severity: SicknessSeverity | None = Query(None),
    bird_id: UUID | None = Query(None),
    shed_id: UUID | None = Query(None),
    sick_from: date | None = Query(None),
    sick_to: date | None = Query(None),
    follow_up_from: date | None = Query(None),
    follow_up_to: date | None = Query(None),
    follow_up_state: str | None = Query(
        None, pattern="^(none|upcoming|due|overdue)$"
    ),
    include_inactive: bool = Query(False),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    ctx: AuthContext = Depends(require_permission("sickness.view")),
    db: AsyncSession = Depends(get_db),
) -> SicknessListOut:
    try:
        return await sickness_service.list_sickness(
            db,
            ctx,
            query=q,
            status=status,
            severity=severity,
            bird_id=bird_id,
            shed_id=shed_id,
            sick_from=sick_from,
            sick_to=sick_to,
            follow_up_from=follow_up_from,
            follow_up_to=follow_up_to,
            follow_up_state=follow_up_state,
            include_inactive=include_inactive,
            limit=limit,
            offset=offset,
        )
    except sickness_service.SicknessError as exc:
        raise_sickness_http(exc)


@router.post(
    "/bulk",
    response_model=SicknessBulkResultOut,
    status_code=http_status.HTTP_201_CREATED,
)
async def bulk_record_sickness(
    body: SicknessBulkCreate,
    ctx: AuthContext = Depends(require_permission("sickness.record")),
    db: AsyncSession = Depends(get_db),
) -> SicknessBulkResultOut:
    try:
        return await sickness_service.bulk_create_sickness(db, ctx, body)
    except sickness_service.SicknessError as exc:
        raise_sickness_http(exc)


@router.patch("/{record_id}", response_model=SicknessRecordOut)
async def update_sickness(
    record_id: UUID,
    body: SicknessUpdate,
    ctx: AuthContext = Depends(require_permission("sickness.record")),
    db: AsyncSession = Depends(get_db),
) -> SicknessRecordOut:
    try:
        return await sickness_service.update_sickness(db, ctx, record_id, body)
    except sickness_service.SicknessError as exc:
        raise_sickness_http(exc)


@router.post("/{record_id}/recover", response_model=SicknessRecordOut)
async def recover_sickness(
    record_id: UUID,
    body: SicknessRecover,
    ctx: AuthContext = Depends(require_permission("sickness.recover")),
    db: AsyncSession = Depends(get_db),
) -> SicknessRecordOut:
    try:
        return await sickness_service.recover_sickness(db, ctx, record_id, body)
    except sickness_service.SicknessError as exc:
        raise_sickness_http(exc)
