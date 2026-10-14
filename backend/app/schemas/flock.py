from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import (
    BirdLifecycleStatus,
    DobConfidence,
    FlockStatus,
    LifecycleEventType,
    TrackingMode,
)


class FlockCreate(BaseModel):
    shed_id: UUID
    batch_code: str = Field(min_length=1, max_length=64)
    breed: str | None = None
    hatch_date: date | None = None
    estimated_age_days: int | None = Field(default=None, ge=0)
    age_reported_on: date | None = None
    dob_confidence: DobConfidence = DobConfidence.unknown
    initial_count: int = Field(ge=0)
    tracking_mode: TrackingMode
    notes: str | None = None
    unbanded_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_age(self) -> "FlockCreate":
        if self.dob_confidence == DobConfidence.exact and self.hatch_date is None:
            raise ValueError("hatch_date required when dob_confidence is exact")
        if self.dob_confidence == DobConfidence.estimated and self.estimated_age_days is None:
            raise ValueError("estimated_age_days required when dob_confidence is estimated")
        if self.initial_count < 0:
            raise ValueError("initial_count cannot be negative")
        return self


class FlockUpdate(BaseModel):
    breed: str | None = None
    notes: str | None = None
    status: FlockStatus | None = None
    current_count: int | None = Field(default=None, ge=0)


class FlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_account_id: UUID
    shed_id: UUID
    batch_code: str
    breed: str | None
    hatch_date: date | None
    estimated_age_days: int | None
    age_reported_on: date | None
    dob_confidence: DobConfidence
    initial_count: int
    current_count: int
    banded_count: int
    unbanded_count: int
    tracking_mode: TrackingMode
    status: FlockStatus
    onboarded_at: datetime
    count_mismatch: bool
    notes: str | None
    created_at: datetime


class BirdCreate(BaseModel):
    flock_id: UUID
    band_id: str | None = Field(default=None, max_length=64)
    hatch_date: date | None = None
    estimated_age_days: int | None = Field(default=None, ge=0)
    age_reported_on: date | None = None
    dob_confidence: DobConfidence = DobConfidence.unknown
    breed: str | None = None
    sex: str | None = None
    notes: str | None = None


class BirdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_account_id: UUID
    shed_id: UUID
    flock_id: UUID
    band_id: str | None
    display_code: str | None
    hatch_date: date | None
    estimated_age_days: int | None
    dob_confidence: DobConfidence
    breed: str | None
    sex: str | None
    lifecycle_status: BirdLifecycleStatus
    notes: str | None
    is_active: bool
    created_at: datetime


class BirdBulkRow(BaseModel):
    band_id: str = Field(min_length=1, max_length=64)
    hatch_date: date | None = None
    estimated_age_days: int | None = None
    breed: str | None = None
    sex: str | None = None
    notes: str | None = None


class BirdBulkImport(BaseModel):
    flock_id: UUID
    idempotency_key: str | None = None
    rows: list[BirdBulkRow] = Field(min_length=1, max_length=500)
    dob_confidence: DobConfidence = DobConfidence.estimated


class BirdBulkResult(BaseModel):
    created: int
    failed: int
    errors: list[dict]
    bird_ids: list[UUID]


class LifecycleCreate(BaseModel):
    event_type: LifecycleEventType
    effective_date: date
    flock_id: UUID | None = None
    bird_id: UUID | None = None
    quantity: int = Field(default=1, ge=1)
    reason: str | None = None
    idempotency_key: str | None = None


class LifecycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: LifecycleEventType
    effective_date: date
    flock_id: UUID | None
    bird_id: UUID | None
    quantity: int
    reason: str | None
    created_at: datetime
