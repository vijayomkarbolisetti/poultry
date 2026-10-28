from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.vaccine import (
    GenerateSchedulesRequest,
    ScheduledDoseOut,
    VaccineCreate,
    VaccineOut,
    VaccineVersionCreate,
)
from app.services import vaccine_service

router = APIRouter()


@router.post("", response_model=VaccineOut, status_code=status.HTTP_201_CREATED)
async def create_vaccine(
    body: VaccineCreate,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> VaccineOut:
    try:
        row = await vaccine_service.create_definition(db, ctx, body)
    except vaccine_service.VaccineError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return VaccineOut.model_validate(row)


@router.get("", response_model=list[VaccineOut])
async def list_vaccines(
    include_archived: bool = Query(False),
    ctx: AuthContext = Depends(require_permission("schedule.view")),
    db: AsyncSession = Depends(get_db),
) -> list[VaccineOut]:
    rows = await vaccine_service.list_definitions(db, ctx, include_archived=include_archived)
    return [VaccineOut.model_validate(r) for r in rows]


@router.post("/{definition_id}/archive", response_model=VaccineOut)
async def archive_vaccine(
    definition_id: UUID,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> VaccineOut:
    try:
        row = await vaccine_service.archive_definition(db, ctx, definition_id)
    except vaccine_service.VaccineError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return VaccineOut.model_validate(row)


@router.post("/{definition_id}/versions", status_code=201)
async def new_version(
    definition_id: UUID,
    body: VaccineVersionCreate,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if body.apply_scope not in {"new_flocks", "selected_flocks", "all_active"}:
        raise HTTPException(status_code=400, detail="Invalid apply_scope")
    if body.apply_scope == "selected_flocks" and not body.flock_ids:
        raise HTTPException(status_code=400, detail="flock_ids required for selected_flocks")
    try:
        version = await vaccine_service.create_new_version(db, ctx, definition_id, body)
    except vaccine_service.VaccineError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    regenerated = 0
    if body.apply_scope in {"selected_flocks", "all_active"}:
        from app.models.enums import FlockStatus
        from app.models.flock import Flock
        from sqlalchemy import select

        stmt = select(Flock).where(
            Flock.owner_account_id == ctx.owner_account_id,
            Flock.status == FlockStatus.active,
        )
        if body.apply_scope == "selected_flocks":
            stmt = stmt.where(Flock.id.in_(body.flock_ids))
        flocks = list(await db.scalars(stmt))
        for flock in flocks:
            doses = await vaccine_service.generate_schedules_for_flock(
                db, ctx, flock.id, vaccine_definition_ids=[definition_id]
            )
            regenerated += len(doses)
    return {"version_id": str(version.id), "version_number": version.version_number, "regenerated_doses": regenerated}


@router.post("/generate-schedules", response_model=list[ScheduledDoseOut])
async def generate_schedules(
    body: GenerateSchedulesRequest,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> list[ScheduledDoseOut]:
    try:
        doses = await vaccine_service.generate_schedules_for_flock(
            db, ctx, body.flock_id, vaccine_definition_ids=body.vaccine_definition_ids
        )
    except vaccine_service.VaccineError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return await vaccine_service.enrich_scheduled_doses(db, ctx, doses)


@router.get("/scheduled-doses", response_model=list[ScheduledDoseOut])
async def list_doses(
    flock_id: UUID | None = None,
    shed_id: UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    ctx: AuthContext = Depends(require_permission("vaccination.view")),
    db: AsyncSession = Depends(get_db),
) -> list[ScheduledDoseOut]:
    # Shed/flock-scoped lists refresh open statuses for that shed (matches overview).
    # Org-wide unfiltered lists stay pure — use POST /vaccines/refresh-statuses.
    rows = await vaccine_service.list_scheduled_doses(
        db, ctx, flock_id=flock_id, shed_id=shed_id, status=status_filter, limit=limit
    )
    return await vaccine_service.enrich_scheduled_doses(db, ctx, rows)


@router.post("/refresh-statuses")
async def refresh_statuses(
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    updated = await vaccine_service.refresh_dose_statuses(db, ctx, commit=True)
    return {"updated": updated}
