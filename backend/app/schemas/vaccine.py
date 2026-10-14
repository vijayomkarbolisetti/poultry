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
    flock_id: UUID
    bird_id: UUID | None
    vaccine_definition_id: UUID
    dose_number: int
    due_date: date
    status: str
    eligible_count: int
    completed_count: int
    needs_review: bool


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
    dose_amount: str | None = None
    route: str | None = None
    notes: str | None = None
    verification_status: str = "verified"
    idempotency_key: str | None = None


class VaccinationCorrectionIn(BaseModel):
    reason: str = Field(min_length=1)
    void: bool = False
    birds_covered: int | None = None
    administration_date: date | None = None
    notes: str | None = None


class VaccinationEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    flock_id: UUID
    bird_id: UUID | None
    scheduled_dose_id: UUID | None
    vaccine_definition_id: UUID
    administration_date: date
    birds_covered: int
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
    created_at: datetime


class ReportComplianceOut(BaseModel):
    on_time: int
    late: int
    overdue: int
    due_today: int
    needs_review: int
    compliance_numerator: int
    compliance_denominator: int
