from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.vaccine import MediaOut, MediaRegisterIn, MediaSignRequest, MediaUpdateIn
from app.services import media_service

router = APIRouter()


@router.post("/sign")
async def sign_upload(
    body: MediaSignRequest,
    ctx: AuthContext = Depends(require_permission("media.upload")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await media_service.sign_upload(
            db, ctx, shed_id=body.shed_id, folder_suffix=body.folder_suffix
        )
    except media_service.MediaError as exc:
        status_code = status.HTTP_404_NOT_FOUND if exc.code == "NOT_FOUND" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=exc.message) from exc


@router.post("", response_model=MediaOut, status_code=status.HTTP_201_CREATED)
async def register(
    body: MediaRegisterIn,
    ctx: AuthContext = Depends(require_permission("media.upload")),
    db: AsyncSession = Depends(get_db),
) -> MediaOut:
    try:
        row = await media_service.register_media(db, ctx, body)
    except media_service.MediaError as exc:
        status_code = status.HTTP_404_NOT_FOUND if exc.code == "NOT_FOUND" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=exc.message) from exc
    return MediaOut.model_validate(row)


@router.get("", response_model=list[MediaOut])
async def list_media(
    bird_id: UUID | None = Query(None),
    vaccination_event_id: UUID | None = Query(None),
    ctx: AuthContext = Depends(require_permission("media.view")),
    db: AsyncSession = Depends(get_db),
) -> list[MediaOut]:
    rows = await media_service.list_media(
        db, ctx, bird_id=bird_id, vaccination_event_id=vaccination_event_id
    )
    return [MediaOut.model_validate(r) for r in rows]


@router.patch("/{media_id}", response_model=MediaOut)
async def update_version(
    media_id: UUID,
    body: MediaUpdateIn,
    ctx: AuthContext = Depends(require_permission("media.upload")),
    db: AsyncSession = Depends(get_db),
) -> MediaOut:
    try:
        row = await media_service.update_media_version(db, ctx, media_id, body)
    except media_service.MediaError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return MediaOut.model_validate(row)


@router.delete("/{media_id}", response_model=MediaOut)
async def delete_media(
    media_id: UUID,
    ctx: AuthContext = Depends(require_permission("media.upload")),
    db: AsyncSession = Depends(get_db),
) -> MediaOut:
    try:
        row = await media_service.soft_delete_media(db, ctx, media_id)
    except media_service.MediaError as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    return MediaOut.model_validate(row)
