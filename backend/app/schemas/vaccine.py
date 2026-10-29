from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScheduleRuleIn(BaseModel):
    dose_number: int | None = 1
    target_age_days: int | None = None
    repeat_interval_days: int | None = None  # D1: monthly = 30
    max_repeats: int | None = None
    grace_period_days: int | None = 0
    reminder_lead_days: int | None = 3
    is_manual_only: bool = False
    label: str | None = None


class VaccineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    category: str = "vaccine"
    description: str | None = None
    instructions: str | None = None
    effective_date: date | None = None
    notes: str | None = None
    rules: list[ScheduleRuleIn] = Field(default_factory=list)


class VaccineVersionCreate(BaseModel):
    effective_date: date
    notes: str | None = None
    apply_scope: str = Field(description="new_flocks | selected_flocks | all_active")
    flock_ids: list[UUID] = Field(default_factory=list)
    rules: list[ScheduleRuleIn] = Field(default_factory=list)


class VaccineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    category: str
    description: str | None
    instructions: str | None
    is_active: bool
    created_at: datetime


class ScheduledDoseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shed_id: UUID
    flock_id: UUID
    bird_id: UUID | None
    vaccine_definition_id: UUID
    dose_number: int
    due_date: date
    status: str
    eligible_count: int
    completed_count: int
    needs_review: bool
    # Display labels resolved server-side under owner scope (vaccination.view).
    # Farmers do not need schedule.view to read these.
    vaccine_name: str | None = None
    shed_name: str | None = None
    flock_label: str | None = None
    # Population context from the flock (not individual bird identity).
    banded_count: int | None = None
    unbanded_count: int | None = None
    remaining_count: int | None = None


class GenerateSchedulesRequest(BaseModel):
    flock_id: UUID
    vaccine_definition_ids: list[UUID] | None = None


class VaccinationRecordIn(BaseModel):
    scheduled_dose_id: UUID | None = None
    flock_id: UUID | None = None
    bird_id: UUID | None = None
    vaccine_definition_id: UUID | None = None
    schedule_version_id: UUID | None = None
    administered_at: datetime | None = None
    administration_date: date | None = None
    birds_covered: int = 1
    lot_number: str | None = None
    product_expiry: date | None = None
    manufacturer_or_brand: str | None = Field(default=None, max_length=128)
    vaccine_type_or_strain: str | None = Field(default=None, max_length=128)
    dose_amount: str | None = None
    route: str | None = None
    notes: str | None = None
    verification_status: str = "verified"
    idempotency_key: str | None = None


class VaccinationBatchItemIn(BaseModel):
    scheduled_dose_id: UUID
    birds_covered: int = Field(ge=1)


class VaccinationBatchRecordIn(BaseModel):
    """Record coverage across one or more population doses in a single transaction."""

    items: list[VaccinationBatchItemIn] = Field(min_length=1)
    administration_date: date | None = None
    idempotency_key: str = Field(min_length=8, max_length=100)
    lot_number: str | None = None
    product_expiry: date | None = None
    manufacturer_or_brand: str | None = Field(default=None, max_length=128)
    vaccine_type_or_strain: str | None = Field(default=None, max_length=128)
    dose_amount: str | None = None
    route: str | None = None
    notes: str | None = None
    verification_status: str = "verified"


class VaccinationCorrectionIn(BaseModel):
    reason: str = Field(min_length=1)
    void: bool = False
    birds_covered: int | None = None
    administration_date: date | None = None
    notes: str | None = None


class VaccinationEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shed_id: UUID
    flock_id: UUID
    bird_id: UUID | None
    scheduled_dose_id: UUID | None
    vaccine_definition_id: UUID
    administration_date: date
    birds_covered: int
    lot_number: str | None = None
    product_expiry: date | None = None
    manufacturer_or_brand: str | None = None
    vaccine_type_or_strain: str | None = None
    dose_amount: str | None = None
    route: str | None = None
    notes: str | None = None
    verification_status: str
    timing_status: str
    is_void: bool
    created_at: datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    alert_type: str
    title: str
    body: str
    severity: str
    is_read: bool
    created_at: datetime


class MediaSignRequest(BaseModel):
    shed_id: UUID | None = None
    folder_suffix: str = "general"


class MediaRegisterIn(BaseModel):
    public_id: str
    shed_id: UUID | None = None
    flock_id: UUID | None = None
    bird_id: UUID | None = None
    vaccination_event_id: UUID | None = None
    resource_type: str = "image"
    format: str | None = None
    version: int = 1
    notes: str | None = None


class MediaUpdateIn(BaseModel):
    version: int
    public_id: str | None = None


class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    cloudinary_public_id: str
    resource_type: str
    version: int
    versions_meta: list | None
    is_deleted: bool
    bird_id: UUID | None
    shed_id: UUID | None = None
    flock_id: UUID | None = None
    vaccination_event_id: UUID | None = None
    created_at: datetime


class ReportComplianceOut(BaseModel):
    on_time: int
    late: int
    overdue: int
    due_today: int
    needs_review: int
    compliance_numerator: int
    compliance_denominator: int
