from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.models.enums import BirdLifecycleStatus
from app.schemas.flock import (
    AddUnbandedInShedIn,
    AddUnbandedInShedOut,
    BandFromUnbandedByCohortIn,
    BandFromUnbandedIn,
    BandFromUnbandedOut,
    BirdBulkImport,
    BirdBulkResult,
    BirdCreate,
    BirdListOut,
    BirdOut,
    BirdProfileOut,
    BirdSearchOut,
    BirdUpdate,
    RegisterBandedInShedIn,
    SoldBirdListOut,
)
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


@router.post(
    "/register-in-shed",
    response_model=BirdOut,
    status_code=status.HTTP_201_CREATED,
)
async def register_banded_in_shed(
    body: RegisterBandedInShedIn,
    ctx: AuthContext = Depends(require_permission("bird.create")),
    db: AsyncSession = Depends(get_db),
) -> BirdOut:
    """Register a banded bird by shed + exact DOB (internal cohort flock hidden from the client)."""
    try:
        bird = await flock_service.register_banded_in_shed(db, ctx, body)
    except flock_service.FlockError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return BirdOut.model_validate(bird)


@router.post(
    "/add-unbanded-in-shed",
    response_model=AddUnbandedInShedOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_unbanded_in_shed(
    body: AddUnbandedInShedIn,
    ctx: AuthContext = Depends(require_permission("flock.create")),
    db: AsyncSession = Depends(get_db),
) -> AddUnbandedInShedOut:
    """Add unbanded headcount by shed + exact DOB (find-or-create internal cohort)."""
    try:
        result = await flock_service.add_unbanded_in_shed(db, ctx, body)
    except flock_service.FlockError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return AddUnbandedInShedOut.model_validate(result)


def _flock_http(exc: flock_service.FlockError) -> HTTPException:
    # Legacy band-from-unbanded returned 400 for all FlockError codes; preserve that.
    if exc.code == "IDEMPOTENCY_KEY_CONFLICT":
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message)
    return HTTPException(status_code=400, detail=exc.message)


@router.post(
    "/band-from-unbanded",
    response_model=BandFromUnbandedOut,
    status_code=status.HTTP_201_CREATED,
)
async def band_from_unbanded(
    body: BandFromUnbandedIn,
    ctx: AuthContext = Depends(require_permission("bird.create")),
    db: AsyncSession = Depends(get_db),
) -> BandFromUnbandedOut:
    """Convert one unbanded headcount into a banded individual (atomic, idempotent)."""
    try:
        result = await flock_service.band_from_unbanded(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return BandFromUnbandedOut.model_validate(result)


@router.post(
    "/band-from-unbanded-by-cohort",
    response_model=BandFromUnbandedOut,
    status_code=status.HTTP_201_CREATED,
)
async def band_from_unbanded_by_cohort(
    body: BandFromUnbandedByCohortIn,
    ctx: AuthContext = Depends(require_permission("bird.create")),
    db: AsyncSession = Depends(get_db),
) -> BandFromUnbandedOut:
    """Shed-centric banding: resolve active cohort by exact/estimated age key (no flock_id)."""
    try:
        result = await flock_service.band_from_unbanded_by_cohort(db, ctx, body)
    except flock_service.FlockError as exc:
        raise _flock_http(exc) from exc
    return BandFromUnbandedOut.model_validate(result)


@router.get("/search", response_model=BirdSearchOut)
async def search_birds(
    q: str = Query(..., min_length=1, max_length=64, description="Exact or partial band number"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    include_inactive: bool = Query(True),
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> BirdSearchOut:
    try:
        return await flock_service.search_birds(
            db,
            ctx,
            query=q,
            limit=limit,
            offset=offset,
            include_inactive=include_inactive,
        )
    except flock_service.FlockError as exc:
        code = 400 if exc.code == "INVALID" else 404
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.get("/sold", response_model=SoldBirdListOut)
async def list_sold_birds(
    q: str | None = Query(None, max_length=64, description="Band, breed, buyer name, or mobile"),
    sold_from: date | None = Query(None),
    sold_to: date | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> SoldBirdListOut:
    """List sold birds with sale details; tenant-scoped and searchable."""
    try:
        return await flock_service.list_sold_birds(
            db,
            ctx,
            query=q,
            sold_from=sold_from,
            sold_to=sold_to,
            limit=limit,
            offset=offset,
        )
    except flock_service.FlockError as exc:
        code = 400 if exc.code == "INVALID" else 404
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.get("/in-shed", response_model=BirdListOut)
async def list_birds_in_shed(
    shed_id: UUID = Query(...),
    flock_id: UUID | None = Query(None),
    q: str | None = Query(None, max_length=64),
    lifecycle_status: BirdLifecycleStatus | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    include_inactive: bool = Query(False),
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> BirdListOut:
    """Registered individual birds in a shed (paginated). Unbanded counts are summary-only."""
    try:
        return await flock_service.list_birds_in_shed(
            db,
            ctx,
            shed_id=shed_id,
            flock_id=flock_id,
            query=q,
            lifecycle_status=lifecycle_status,
            limit=limit,
            offset=offset,
            include_inactive=include_inactive,
        )
    except flock_service.FlockError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc


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


@router.get("/{bird_id}/profile", response_model=BirdProfileOut)
async def get_bird_profile(
    bird_id: UUID,
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> BirdProfileOut:
    try:
        return await flock_service.get_bird_profile(db, ctx, bird_id)
    except flock_service.FlockError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc


@router.get("/{bird_id}/vaccination-report.pdf")
async def bird_vaccination_report_pdf(
    bird_id: UUID,
    ctx: AuthContext = Depends(require_permission("bird.view")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from app.services.bird_report_service import BirdReportError, generate_bird_vaccination_report

    try:
        pdf_bytes, filename = await generate_bird_vaccination_report(db, ctx, bird_id)
    except BirdReportError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{bird_id}", response_model=BirdOut)
async def update_bird(
    bird_id: UUID,
    body: BirdUpdate,
    ctx: AuthContext = Depends(require_permission("bird.update")),
    db: AsyncSession = Depends(get_db),
) -> BirdOut:
    try:
        bird = await flock_service.update_bird(db, ctx, bird_id, body)
    except flock_service.FlockError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return BirdOut.model_validate(bird)


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
