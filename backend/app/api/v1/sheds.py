from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.shed import (
    ShedAssignRequest,
    ShedAssignmentOut,
    ShedCreate,
    ShedOut,
    ShedUpdate,
)
from app.services import shed_service

router = APIRouter()


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
        )
    except shed_service.ShedError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return ShedOut.model_validate(shed)


@router.get("", response_model=list[ShedOut])
async def list_sheds(
    ctx: AuthContext = Depends(require_permission("shed.view")),
    db: AsyncSession = Depends(get_db),
) -> list[ShedOut]:
    # Owners have implicit shed.view via require_permission
    # Farmers need shed.view grant + assignment filtering in service
    sheds = await shed_service.list_sheds(db, ctx)
    return [ShedOut.model_validate(s) for s in sheds]


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
            location_notes=body.location_notes,
            is_owner_managed=body.is_owner_managed,
            is_active=body.is_active,
        )
    except shed_service.ShedError as exc:
        raise HTTPException(status_code=404 if exc.code == "NOT_FOUND" else 400, detail=exc.message) from exc
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
