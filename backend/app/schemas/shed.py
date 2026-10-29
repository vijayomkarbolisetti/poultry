from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import DobConfidence, FlockStatus, TrackingMode


def _strip_required_text(value: object) -> object:
    """Reject whitespace-only strings at the API boundary (min_length alone allows '   ')."""
    if isinstance(value, str):
        return value.strip()
    return value


class ShedCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=64)
    location_notes: str | None = None
    capacity: int | None = Field(default=None, ge=0, le=1_000_000)
    is_owner_managed: bool = True
    # Required when is_owner_managed is False — validated below and in the service.
    initial_farmer_membership_id: UUID | None = None

    @field_validator("name", "code", mode="before")
    @classmethod
    def strip_name_code(cls, value: object) -> object:
        return _strip_required_text(value)

    @model_validator(mode="after")
    def validate_initial_farmer(self) -> "ShedCreate":
        if self.is_owner_managed and self.initial_farmer_membership_id is not None:
            raise ValueError("initial_farmer_membership_id must be omitted for owner-managed sheds")
        if not self.is_owner_managed and self.initial_farmer_membership_id is None:
            raise ValueError("initial_farmer_membership_id is required for farmer-managed sheds")
        return self


class ShedUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, min_length=1, max_length=64)
    location_notes: str | None = None
    # When present in the JSON body (including null), capacity is updated.
    capacity: int | None = Field(default=None, ge=0, le=1_000_000)
    is_owner_managed: bool | None = None
    is_active: bool | None = None
    # When flipping to farmer-managed (or replacing manager), pass farmer membership id.
    initial_farmer_membership_id: UUID | None = None

    @field_validator("name", "code", mode="before")
    @classmethod
    def strip_name_code(cls, value: object) -> object:
        if value is None:
            return value
        return _strip_required_text(value)

    @model_validator(mode="after")
    def validate_mode_farmer(self) -> "ShedUpdate":
        if self.is_owner_managed is True and self.initial_farmer_membership_id is not None:
            raise ValueError("initial_farmer_membership_id must be omitted when switching to owner-managed")
        if self.is_owner_managed is False and self.initial_farmer_membership_id is None:
            # Allowed if shed already has an assignment — service enforces.
            pass
        return self


class ShedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_account_id: UUID
    name: str
    code: str
    location_notes: str | None
    capacity: int | None = None
    is_owner_managed: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ShedListItemOut(ShedOut):
    """List card metadata — population/vax use the same rules as shed overview."""

    organization_name: str | None = None
    manager_names: list[str] = Field(default_factory=list)
    active_batch_count: int = 0
    total_live_birds: int = 0
    banded_birds: int = 0
    unbanded_birds: int = 0
    count_mismatch: bool = False
    overdue_tasks: int = 0
    due_today_tasks: int = 0
    upcoming_tasks: int = 0
    needs_review_tasks: int = 0


class ShedDependenciesOut(BaseModel):
    """Counts shown before deactivation — never implies hard delete is available."""

    shed_id: UUID
    is_active: bool
    active_batch_count: int
    closed_batch_count: int
    total_live_birds: int
    banded_birds: int
    unbanded_birds: int
    count_mismatch: bool
    open_dose_tasks: int
    vaccination_event_count: int
    active_assignment_count: int
    can_deactivate: bool = True
    can_reactivate: bool = False
    note: str = (
        "Deactivation preserves birds, vaccination history, and schedules. "
        "Permanent deletion is not supported."
    )


class ShedAssignRequest(BaseModel):
    owner_membership_id: UUID
    is_manager: bool = False


class ShedAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shed_id: UUID
    owner_membership_id: UUID
    is_manager: bool
    is_active: bool
    farmer_name: str | None = None
    farmer_email: str | None = None


class ShedOverviewPopulationOut(BaseModel):
    total_live_birds: int
    active_batch_count: int
    banded_birds: int
    unbanded_birds: int


class ShedOverviewVaccinationOut(BaseModel):
    """Counts of scheduled dose *tasks* (not birds) for this shed."""

    overdue: int
    due_today: int
    upcoming: int
    needs_review: int


class ShedOverviewBatchOut(BaseModel):
    id: UUID
    batch_code: str
    breed: str | None
    hatch_date: date | None
    estimated_age_days: int | None
    dob_confidence: DobConfidence
    current_count: int
    banded_count: int
    unbanded_count: int
    tracking_mode: TrackingMode
    status: FlockStatus
    count_mismatch: bool
    overdue_tasks: int = 0
    due_today_tasks: int = 0
    upcoming_tasks: int = 0
    needs_review_tasks: int = 0


class ShedOverviewOut(BaseModel):
    shed: ShedOut
    organization_name: str | None = None
    assignments: list[ShedAssignmentOut]
    population: ShedOverviewPopulationOut
    vaccination: ShedOverviewVaccinationOut
    batches: list[ShedOverviewBatchOut]
