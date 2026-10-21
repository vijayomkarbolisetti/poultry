from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_org_context
from app.core.database import get_db
from app.schemas.search import GlobalSearchOut
from app.services import search_service

router = APIRouter()


@router.get("", response_model=GlobalSearchOut)
async def global_search(
    q: str = Query(..., min_length=1, max_length=64, description="Search birds, batches, or sheds"),
    types: str | None = Query(
        default="birds,batches,sheds",
        description="Comma-separated: birds,batches,sheds",
    ),
    limit: int = Query(10, ge=1, le=25),
    include_inactive: bool = Query(True),
    ctx: AuthContext = Depends(require_org_context),
    db: AsyncSession = Depends(get_db),
) -> GlobalSearchOut:
    try:
        return await search_service.global_search(
            db,
            ctx,
            query=q,
            types=types,
            limit=limit,
            include_inactive=include_inactive,
        )
    except search_service.SearchError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
