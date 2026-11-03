"""Parentage validation and persistence helpers (sire/dam)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authorization.deps import AuthContext
from app.models.enums import BirdParentRole
from app.models.flock import Bird
from app.models.parentage import BirdParentDescriptor


class ParentageError(Exception):
    def __init__(self, message: str, code: str = "INVALID_PARENTAGE") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


def _norm_sex(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = raw.strip().lower()
    if s in {"m", "male"}:
        return "male"
    if s in {"f", "female"}:
        return "female"
    return s or None


def _trim(raw: str | None, *, max_len: int) -> str | None:
    if raw is None:
        return None
    v = raw.strip()
    if not v:
        return None
    return v[:max_len]


def parent_input_is_empty(data) -> bool:
    """True when the client sent no parent information for this role."""
    if data is None:
        return True
    mode = getattr(data, "mode", None) or "unknown"
    if mode == "unknown":
        return True
    if mode == "existing":
        return getattr(data, "bird_id", None) is None
    # manual
    return not any(
        [
            _trim(getattr(data, "display_name", None), max_len=120),
            _trim(getattr(data, "band_number", None), max_len=64),
            _trim(getattr(data, "breed", None), max_len=128),
            _trim(getattr(data, "notes", None), max_len=2000),
        ]
    )


async def resolve_linked_parent(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    child_bird_id: UUID,
    role: BirdParentRole,
    bird_id: UUID,
) -> Bird:
    assert ctx.owner_account_id is not None
    if bird_id == child_bird_id:
        raise ParentageError("A bird cannot be its own parent", "SELF_PARENT")
    parent = await db.scalar(
        select(Bird).where(Bird.id == bird_id, Bird.owner_account_id == ctx.owner_account_id)
    )
    if parent is None:
        raise ParentageError("Parent bird not found", "NOT_FOUND")
    sex = _norm_sex(parent.sex)
    if role == BirdParentRole.sire and sex == "female":
        raise ParentageError("Sire must not be a female bird", "SEX_MISMATCH")
    if role == BirdParentRole.dam and sex == "male":
        raise ParentageError("Dam must not be a male bird", "SEX_MISMATCH")
    return parent


async def upsert_parentage(
    db: AsyncSession,
    ctx: AuthContext,
    *,
    child: Bird,
    role: BirdParentRole,
    data,
) -> None:
    """Apply one parent role from input. Clears when unknown/empty."""
    assert ctx.owner_account_id is not None
    existing = await db.scalar(
        select(BirdParentDescriptor).where(
            BirdParentDescriptor.child_bird_id == child.id,
            BirdParentDescriptor.role == role,
            BirdParentDescriptor.owner_account_id == ctx.owner_account_id,
        )
    )

    if parent_input_is_empty(data):
        if role == BirdParentRole.sire:
            child.sire_bird_id = None
        else:
            child.dam_bird_id = None
        if existing is not None:
            await db.delete(existing)
        return

    mode = getattr(data, "mode", "manual") or "manual"
    if mode == "existing":
        bird_id = getattr(data, "bird_id", None)
        if bird_id is None:
            raise ParentageError("bird_id is required when selecting an existing parent", "INVALID")
        parent = await resolve_linked_parent(
            db, ctx, child_bird_id=child.id, role=role, bird_id=bird_id
        )
        if role == BirdParentRole.sire:
            child.sire_bird_id = parent.id
        else:
            child.dam_bird_id = parent.id
        # Linked parents use bird FK; drop any manual descriptor to avoid duplicates.
        if existing is not None:
            await db.delete(existing)
        return

    # Manual descriptive parent — do not invent a bird row.
    if role == BirdParentRole.sire:
        child.sire_bird_id = None
    else:
        child.dam_bird_id = None

    display_name = _trim(getattr(data, "display_name", None), max_len=120)
    band_number = _trim(getattr(data, "band_number", None), max_len=64)
    breed = _trim(getattr(data, "breed", None), max_len=128)
    notes = _trim(getattr(data, "notes", None), max_len=2000)

    if existing is None:
        existing = BirdParentDescriptor(
            owner_account_id=ctx.owner_account_id,
            child_bird_id=child.id,
            role=role,
        )
        db.add(existing)

    existing.linked_bird_id = None
    existing.display_name = display_name
    existing.band_number = band_number
    existing.breed = breed
    existing.notes = notes


async def load_parent_descriptors(
    db: AsyncSession, ctx: AuthContext, child_bird_id: UUID
) -> dict[BirdParentRole, BirdParentDescriptor]:
    assert ctx.owner_account_id is not None
    rows = await db.scalars(
        select(BirdParentDescriptor).where(
            BirdParentDescriptor.child_bird_id == child_bird_id,
            BirdParentDescriptor.owner_account_id == ctx.owner_account_id,
        )
    )
    return {r.role: r for r in rows}
