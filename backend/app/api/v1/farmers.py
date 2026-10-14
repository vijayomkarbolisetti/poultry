from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.farmer import (
    FarmerCreate,
    FarmerOut,
    FarmerUpdate,
    PermissionOut,
    PermissionsUpdate,
)
from app.services import farmer_service

router = APIRouter()


@router.get("/permissions", response_model=list[PermissionOut])
async def permission_catalog(
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> list[PermissionOut]:
    rows = await farmer_service.list_permission_catalog(db)
    return [PermissionOut(code=r.code, description=r.description) for r in rows]


@router.post("", response_model=FarmerOut, status_code=status.HTTP_201_CREATED)
async def create_farmer(
    body: FarmerCreate,
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> FarmerOut:
    try:
        data = await farmer_service.create_farmer(
            db,
            ctx,
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            role=body.role,
            permission_codes=body.permission_codes,
            shed_ids=body.shed_ids,
        )
    except farmer_service.FarmerError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return FarmerOut.model_validate(data)


@router.get("", response_model=list[FarmerOut])
async def list_farmers(
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> list[FarmerOut]:
    rows = await farmer_service.list_farmers(db, ctx)
    return [FarmerOut.model_validate(r) for r in rows]


@router.get("/{membership_id}", response_model=FarmerOut)
async def get_farmer(
    membership_id: UUID,
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> FarmerOut:
    try:
        data = await farmer_service.get_farmer(db, ctx, membership_id)
    except farmer_service.FarmerError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return FarmerOut.model_validate(data)


@router.patch("/{membership_id}", response_model=FarmerOut)
async def update_farmer(
    membership_id: UUID,
    body: FarmerUpdate,
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> FarmerOut:
    try:
        data = await farmer_service.update_farmer(
            db, ctx, membership_id, full_name=body.full_name, is_active=body.is_active
        )
    except farmer_service.FarmerError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return FarmerOut.model_validate(data)


@router.put("/{membership_id}/permissions", response_model=FarmerOut)
async def set_permissions(
    membership_id: UUID,
    body: PermissionsUpdate,
    ctx: AuthContext = Depends(require_permission("farmer.manage")),
    db: AsyncSession = Depends(get_db),
) -> FarmerOut:
    try:
        data = await farmer_service.set_permissions(db, ctx, membership_id, body.permission_codes)
    except farmer_service.FarmerError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    return FarmerOut.model_validate(data)
