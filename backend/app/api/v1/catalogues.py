from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import require_permission
from app.core.database import get_db
from app.schemas.catalogue import (
    AssignPreviewOut,
    CatalogueAssignIn,
    CatalogueAssignmentOut,
    CatalogueCloneIn,
    CatalogueCreateIn,
    CatalogueDetailOut,
    CatalogueItemOut,
    CataloguePreviewUpdateIn,
    CataloguePreviewUpdateOut,
    CatalogueRuleOut,
    CatalogueSummaryOut,
    CatalogueUpdateIn,
)
from app.services import catalogue_service

router = APIRouter()


def _summary(cat, item_count: int) -> CatalogueSummaryOut:
    return CatalogueSummaryOut(
        id=cat.id,
        code=cat.code,
        name=cat.name,
        description=cat.description,
        version=cat.version,
        status=cat.status,
        is_example=cat.is_example,
        requires_veterinary_review=bool(getattr(cat, "requires_veterinary_review", False)),
        owner_account_id=cat.owner_account_id,
        cloned_from_catalogue_id=cat.cloned_from_catalogue_id,
        is_platform=cat.owner_account_id is None,
        item_count=item_count,
    )


def _detail(cat) -> CatalogueDetailOut:
    items = []
    for item in sorted(cat.items, key=lambda i: (i.sort_order, i.name)):
        if not getattr(item, "is_active", True):
            continue
        items.append(
            CatalogueItemOut(
                id=item.id,
                sort_order=item.sort_order,
                name=item.name,
                category=item.category,
                description=item.description,
                disease_label=item.disease_label,
                instructions=item.instructions,
                recommended_dose_text=item.recommended_dose_text,
                route=item.route,
                diluent_instructions=item.diluent_instructions,
                is_active=bool(getattr(item, "is_active", True)),
                rules=[CatalogueRuleOut.model_validate(r) for r in sorted(item.rules, key=lambda x: x.dose_number)],
            )
        )
    base = _summary(cat, len(items))
    return CatalogueDetailOut(**base.model_dump(), items=items)


def _http_for(exc: catalogue_service.CatalogueError) -> HTTPException:
    code = 400
    if exc.code == "NOT_FOUND":
        code = 404
    elif exc.code in {"CONFIRM_REQUIRED", "STALE_PREVIEW"}:
        code = 409
    elif exc.code == "PLATFORM_IMMUTABLE":
        code = 403
    elif exc.code == "SCOPE_ALL_ACTIVE_GATED":
        code = 403
    elif exc.code == "DUPLICATE_CODE":
        code = 409
    return HTTPException(status_code=code, detail=exc.message)


@router.get("", response_model=list[CatalogueSummaryOut])
async def list_catalogues(
    include_inactive: bool = Query(False),
    ctx: AuthContext = Depends(require_permission("schedule.view")),
    db: AsyncSession = Depends(get_db),
) -> list[CatalogueSummaryOut]:
    rows = await catalogue_service.list_catalogues(db, ctx, include_inactive=include_inactive)
    counts = await catalogue_service.catalogue_item_counts(db, [r.id for r in rows])
    return [_summary(r, counts.get(r.id, 0)) for r in rows]


@router.post("", response_model=CatalogueDetailOut, status_code=status.HTTP_201_CREATED)
async def create_catalogue(
    body: CatalogueCreateIn,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> CatalogueDetailOut:
    try:
        cat = await catalogue_service.create_catalogue(db, ctx, body)
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    return _detail(cat)


@router.post("/{catalogue_id}/clone", response_model=CatalogueDetailOut, status_code=status.HTTP_201_CREATED)
async def clone_catalogue(
    catalogue_id: UUID,
    body: CatalogueCloneIn,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> CatalogueDetailOut:
    try:
        cat = await catalogue_service.clone_catalogue(db, ctx, catalogue_id, body)
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    return _detail(cat)


@router.patch("/{catalogue_id}", response_model=CatalogueDetailOut)
async def update_catalogue(
    catalogue_id: UUID,
    body: CatalogueUpdateIn,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> CatalogueDetailOut:
    try:
        cat, _regenerated = await catalogue_service.update_catalogue(db, ctx, catalogue_id, body)
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    return _detail(cat)


@router.get("/assignment", response_model=CatalogueAssignmentOut | None)
async def get_assignment(
    ctx: AuthContext = Depends(require_permission("schedule.view")),
    db: AsyncSession = Depends(get_db),
) -> CatalogueAssignmentOut | None:
    assert ctx.owner_account_id is not None
    row = await catalogue_service.current_assignment(db, ctx.owner_account_id)
    if not row:
        return None
    cat = row.catalogue
    return CatalogueAssignmentOut(
        id=row.id,
        catalogue_id=row.catalogue_id,
        catalogue_code=cat.code if cat else "",
        catalogue_name=cat.name if cat else "",
        assigned_at=row.assigned_at,
        effective_date=row.effective_date,
        apply_scope=row.apply_scope,
        is_current=row.is_current,
        notes=row.notes,
    )


@router.get("/{catalogue_id}", response_model=CatalogueDetailOut)
async def get_catalogue(
    catalogue_id: UUID,
    ctx: AuthContext = Depends(require_permission("schedule.view")),
    db: AsyncSession = Depends(get_db),
) -> CatalogueDetailOut:
    try:
        cat = await catalogue_service.get_catalogue_for_owner(db, ctx, catalogue_id, allow_platform=True)
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    return _detail(cat)


@router.get("/{catalogue_id}/preview-assign", response_model=AssignPreviewOut)
async def preview_assign(
    catalogue_id: UUID,
    apply_scope: str = Query("all_active"),
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> AssignPreviewOut:
    try:
        data = await catalogue_service.preview_assign(
            db, ctx, catalogue_id, apply_scope=apply_scope, effective_date=None
        )
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    return AssignPreviewOut(**data)


@router.post("/{catalogue_id}/preview-update", response_model=CataloguePreviewUpdateOut)
async def preview_update(
    catalogue_id: UUID,
    body: CataloguePreviewUpdateIn,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> CataloguePreviewUpdateOut:
    try:
        data = await catalogue_service.preview_update(db, ctx, catalogue_id, body)
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    return CataloguePreviewUpdateOut(**data)


@router.post("/assign", response_model=CatalogueAssignmentOut, status_code=status.HTTP_200_OK)
async def assign_catalogue(
    body: CatalogueAssignIn,
    ctx: AuthContext = Depends(require_permission("schedule.manage")),
    db: AsyncSession = Depends(get_db),
) -> CatalogueAssignmentOut:
    try:
        assignment, def_ids, regenerated = await catalogue_service.assign_catalogue(db, ctx, body)
    except catalogue_service.CatalogueError as exc:
        raise _http_for(exc) from exc
    cat = await catalogue_service.get_catalogue(db, assignment.catalogue_id)
    return CatalogueAssignmentOut(
        id=assignment.id,
        catalogue_id=assignment.catalogue_id,
        catalogue_code=cat.code if cat else "",
        catalogue_name=cat.name if cat else "",
        assigned_at=assignment.assigned_at,
        effective_date=assignment.effective_date,
        apply_scope=assignment.apply_scope,
        is_current=assignment.is_current,
        notes=assignment.notes,
        materialized_definition_ids=def_ids,
        regenerated_doses=regenerated,
    )
