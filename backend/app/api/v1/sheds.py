from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.search import ShedSearchOut
from app.schemas.shed import (
    ShedAssignRequest,
    ShedAssignmentOut,
    ShedCreate,
    ShedDependenciesOut,
    ShedListItemOut,
    ShedOut,
    ShedOverviewOut,
    ShedUpdate,
)
from app.services import shed_service

router = APIRouter()


@router.get("/search", response_model=ShedSearchOut)
async def search_sheds(
    q: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(10, ge=1, le=25),
    include_inactive: bool = Query(True),
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> ShedSearchOut:
    try:
        return await shed_service.search_sheds(
            db, ctx, query=q, limit=limit, include_inactive=include_inactive
        )
    except shed_service.ShedError as exc:
        code = 400 if exc.code == "INVALID" else 403
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.post("", response_model=ShedOut, status_code=status.HTTP_201_CREATED)
async def create_shed(
    body: ShedCreate,
    ctx: AuthContext = Depends(require_permission("shed.create")),
    db: AsyncSession = Depends(get_db),
) -> ShedOut:
    try:
        shed = await shed_service.create_shed(
            db,
            ctx,
            name=body.name,
            code=body.code,
            location_notes=body.location_notes,
            is_owner_managed=body.is_owner_managed,
            initial_farmer_membership_id=body.initial_farmer_membership_id,
        )
    except shed_service.ShedError as exc:
        code = 409 if exc.code == "DUPLICATE_CODE" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return ShedOut.model_validate(shed)


@router.get("", response_model=list[ShedListItemOut])
async def list_sheds(
    include_inactive: bool = Query(False),
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> list[ShedListItemOut]:
    try:
        return await shed_service.list_sheds(db, ctx, include_inactive=include_inactive)
    except shed_service.ShedError as exc:
        code = 403 if exc.code == "FORBIDDEN" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.get("/{shed_id}", response_model=ShedOut)
async def get_shed(
    shed_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> ShedOut:
    try:
        shed = await shed_service.get_shed(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 403
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return ShedOut.model_validate(shed)


@router.get("/{shed_id}/overview", response_model=ShedOverviewOut)
async def get_shed_overview(
    shed_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> ShedOverviewOut:
    try:
        return await shed_service.get_shed_overview(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 403
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.get("/{shed_id}/dependencies", response_model=ShedDependenciesOut)
async def get_shed_dependencies(
    shed_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> ShedDependenciesOut:
    try:
        return await shed_service.get_shed_dependencies(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 403
        raise HTTPException(status_code=code, detail=exc.message) from exc


@router.patch("/{shed_id}", response_model=ShedOut)
async def update_shed(
    shed_id: UUID,
    body: ShedUpdate,
    ctx: AuthContext = Depends(require_permission("shed.update")),
    db: AsyncSession = Depends(get_db),
) -> ShedOut:
    try:
        shed = await shed_service.update_shed(
            db,
            ctx,
            shed_id,
            name=body.name,
            code=body.code,
            location_notes=body.location_notes,
            is_owner_managed=body.is_owner_managed,
            is_active=body.is_active,
            initial_farmer_membership_id=body.initial_farmer_membership_id,
        )
    except shed_service.ShedError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return ShedOut.model_validate(shed)


@router.post("/{shed_id}/deactivate", response_model=ShedOut)
async def deactivate_shed(
    shed_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.update")),
    db: AsyncSession = Depends(get_db),
) -> ShedOut:
    try:
        shed = await shed_service.deactivate_shed(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return ShedOut.model_validate(shed)


@router.post("/{shed_id}/reactivate", response_model=ShedOut)
async def reactivate_shed(
    shed_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.update")),
    db: AsyncSession = Depends(get_db),
) -> ShedOut:
    try:
        shed = await shed_service.reactivate_shed(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        code = 404 if exc.code == "NOT_FOUND" else 400
        raise HTTPException(status_code=code, detail=exc.message) from exc
    return ShedOut.model_validate(shed)


@router.post("/{shed_id}/assignments", response_model=ShedAssignmentOut, status_code=201)
async def assign_farmer(
    shed_id: UUID,
    body: ShedAssignRequest,
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> ShedAssignmentOut:
    try:
        row = await shed_service.assign_farmer(
            db,
            ctx,
            shed_id,
            owner_membership_id=body.owner_membership_id,
            is_manager=body.is_manager,
        )
    except shed_service.ShedError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    assignments = await shed_service.list_assignments(db, ctx, shed_id)
    match = next(a for a in assignments if a["id"] == row.id)
    return ShedAssignmentOut.model_validate(match)


@router.get("/{shed_id}/assignments", response_model=list[ShedAssignmentOut])
async def list_assignments(
    shed_id: UUID,
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> list[ShedAssignmentOut]:
    try:
        rows = await shed_service.list_assignments(db, ctx, shed_id)
    except shed_service.ShedError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return [ShedAssignmentOut.model_validate(r) for r in rows]


@router.delete("/{shed_id}/assignments/{assignment_id}", status_code=204)
async def unassign_farmer(
    shed_id: UUID,
    assignment_id: UUID,
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        await shed_service.unassign_farmer(db, ctx, shed_id, assignment_id)
    except shed_service.ShedError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
