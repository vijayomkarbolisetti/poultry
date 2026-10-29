from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.flock import (
    LifecycleBulkCreate,
    LifecycleBulkOut,
    LifecycleCreate,
    LifecycleOut,
    ShedTransferByCohortIn,
    ShedTransferCreate,
    ShedTransferOut,
    UnbandedLifecycleByCohortIn,
)
from app.services import flock_service

router = APIRouter()


def _flock_http(exc: flock_service.FlockError) -> HTTPException:
    # Legacy lifecycle routes always returned 400 for FlockError; keep that contract.
    # Only the new idempotency conflict signal uses 409.
    if exc.code == "IDEMPOTENCY_KEY_CONFLICT":
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message)
    return HTTPException(status_code=400, detail=exc.message)


@router.post("", response_model=LifecycleOut, status_code=status.HTTP_201_CREATED)
async def create_lifecycle_event(
    body: LifecycleCreate,
    ctx: AuthContext = Depends(require_permission("lifecycle.record")),
    db: AsyncSession = Depends(get_db),
) -> LifecycleOut:
    try:
        event = await flock_service.record_lifecycle(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return LifecycleOut.model_validate(event)


@router.post("/bulk", response_model=LifecycleBulkOut, status_code=status.HTTP_201_CREATED)
async def create_lifecycle_events_bulk(
    body: LifecycleBulkCreate,
    ctx: AuthContext = Depends(require_permission("lifecycle.record")),
    db: AsyncSession = Depends(get_db),
) -> LifecycleBulkOut:
    try:
        result = await flock_service.record_lifecycle_bulk(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return LifecycleBulkOut.model_validate(result)


@router.post(
    "/unbanded-by-cohort",
    response_model=LifecycleOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_unbanded_lifecycle_by_cohort(
    body: UnbandedLifecycleByCohortIn,
    ctx: AuthContext = Depends(require_permission("lifecycle.record")),
    db: AsyncSession = Depends(get_db),
) -> LifecycleOut:
    """Count-only mortality/sale/exit-transfer by shed + exact/estimated age key."""
    try:
        event = await flock_service.record_unbanded_lifecycle_by_cohort(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return LifecycleOut.model_validate(event)


@router.post("/transfer-to-shed", response_model=ShedTransferOut, status_code=status.HTTP_201_CREATED)
async def transfer_birds_to_shed(
    body: ShedTransferCreate,
    ctx: AuthContext = Depends(require_permission("lifecycle.record")),
    db: AsyncSession = Depends(get_db),
) -> ShedTransferOut:
    """Move birds or unbanded headcount into a destination group (keeps birds active)."""
    try:
        result = await flock_service.transfer_to_shed(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return ShedTransferOut.model_validate(result)


@router.post(
    "/transfer-to-shed-by-cohort",
    response_model=ShedTransferOut,
    status_code=status.HTTP_201_CREATED,
)
async def transfer_birds_to_shed_by_cohort(
    body: ShedTransferByCohortIn,
    ctx: AuthContext = Depends(require_permission("lifecycle.record")),
    db: AsyncSession = Depends(get_db),
) -> ShedTransferOut:
    """Shed-centric transfer; destination cohort created under lifecycle.record when missing."""
    try:
        result = await flock_service.transfer_to_shed_by_cohort(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return ShedTransferOut.model_validate(result)
