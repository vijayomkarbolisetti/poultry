"""Org-scoped global search across birds, batches, and sheds."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.authorization.permissions import membership_has_permission
from app.models.enums import MembershipRole
from app.schemas.search import (
    BatchSearchSection,
    BirdSearchSection,
    GlobalSearchOut,
    ShedSearchSection,
)
from app.services import flock_service, shed_service


class SearchError(Exception):
    def __init__(self, message: str, code: str = "SEARCH_ERROR") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


async def _may(db: AsyncSession, ctx: AuthContext, permission_code: str) -> bool:
    assert ctx.membership is not None
    if ctx.membership.role == MembershipRole.owner:
        return True
    return await membership_has_permission(
        db, membership_id=ctx.membership.id, permission_code=permission_code
    )


def _parse_types(raw: str | None) -> set[str]:
    allowed = {"birds", "batches", "sheds"}
    if not raw or not raw.strip():
        return set(allowed)
    parts = {p.strip().lower() for p in raw.split(",") if p.strip()}
    unknown = parts - allowed
    if unknown:
        raise SearchError(f"Unknown search types: {', '.join(sorted(unknown))}", "INVALID")
    return parts or set(allowed)


async def global_search(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    query: str,
    types: str | None = None,
    limit: int = 10,
    include_inactive: bool = True,
) -> GlobalSearchOut:
    assert ctx.owner_account_id is not None and ctx.membership is not None
    q = (query or "").strip()
    if not q:
        raise SearchError("Search query is required", "INVALID")
    if len(q) > 64:
        raise SearchError("Search query is too long", "INVALID")
    limit = max(1, min(limit, 25))
    wanted = _parse_types(types)

    out = GlobalSearchOut(query=q, limit=limit)

    if "birds" in wanted and await _may(db, ctx, "bird.view"):
        try:
            birds = await flock_service.search_birds(
                db,
                ctx,
                query=q,
                limit=limit,
                offset=0,
                include_inactive=include_inactive,
            )
            out.birds = BirdSearchSection(
                total=birds.total,
                exact_count=birds.exact_count,
                items=birds.items,
            )
        except flock_service.FlockError as exc:
            out.birds = BirdSearchSection(total=0, exact_count=0, items=[], error=exc.message)
        except Exception:
            out.birds = BirdSearchSection(
                total=0, exact_count=0, items=[], error="Bird search failed"
            )

    if "batches" in wanted and await _may(db, ctx, "flock.view"):
        try:
            batches = await flock_service.search_batches(
                db, ctx, query=q, limit=limit, include_inactive=include_inactive
            )
            out.batches = BatchSearchSection(
                total=batches.total,
                exact_count=batches.exact_count,
                items=batches.items,
            )
        except flock_service.FlockError as exc:
            out.batches = BatchSearchSection(total=0, exact_count=0, items=[], error=exc.message)
        except Exception:
            out.batches = BatchSearchSection(
                total=0, exact_count=0, items=[], error="Population search failed"
            )

    if "sheds" in wanted and await _may(db, ctx, "shed.view"):
        try:
            sheds = await shed_service.search_sheds(
                db, ctx, query=q, limit=limit, include_inactive=include_inactive
            )
            out.sheds = ShedSearchSection(
                total=sheds.total,
                exact_count=sheds.exact_count,
                items=sheds.items,
            )
        except shed_service.ShedError as exc:
            out.sheds = ShedSearchSection(total=0, exact_count=0, items=[], error=exc.message)
        except Exception:
            out.sheds = ShedSearchSection(
                total=0, exact_count=0, items=[], error="Shed search failed"
            )

    return out
