"""Global search response contracts (birds, batches, sheds)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import FlockStatus
from app.schemas.flock import BirdSearchHitOut


class ShedSearchHitOut(BaseModel):
    id: UUID
    name: str
    code: str
    organization_name: str | None = None
    manager_names: list[str] = Field(default_factory=list)
    is_active: bool
    total_live_birds: int = 0
    match_kind: str  # exact | partial


class ShedSearchOut(BaseModel):
    query: str
    total: int
    limit: int
    exact_count: int
    items: list[ShedSearchHitOut]


class BatchSearchHitOut(BaseModel):
    id: UUID
    batch_code: str
    breed: str | None
    shed_id: UUID
    shed_name: str | None
    shed_code: str | None
    current_count: int
    status: FlockStatus
    match_kind: str  # exact | partial


class BatchSearchOut(BaseModel):
    query: str
    total: int
    limit: int
    exact_count: int
    items: list[BatchSearchHitOut]


class BirdSearchSection(BaseModel):
    total: int
    exact_count: int
    items: list[BirdSearchHitOut]
    error: str | None = None


class BatchSearchSection(BaseModel):
    total: int
    exact_count: int
    items: list[BatchSearchHitOut]
    error: str | None = None


class ShedSearchSection(BaseModel):
    total: int
    exact_count: int
    items: list[ShedSearchHitOut]
    error: str | None = None


class GlobalSearchOut(BaseModel):
    query: str
    limit: int
    birds: BirdSearchSection | None = None
    batches: BatchSearchSection | None = None
    sheds: ShedSearchSection | None = None
