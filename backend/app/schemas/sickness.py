from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import BirdLifecycleStatus, SicknessSeverity, SicknessStatus


class SicknessCreate(BaseModel):
    sick_date: date
    symptoms: str = Field(min_length=1, max_length=4000)
    severity: SicknessSeverity
    notes: str | None = Field(default=None, max_length=4000)
    treatment: str | None = Field(default=None, max_length=4000)
    follow_up_date: date | None = None
    idempotency_key: str | None = Field(default=None, max_length=128)

    @field_validator("symptoms")
    @classmethod
    def _symptoms_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("symptoms is required")
        return value


class SicknessBulkCreate(SicknessCreate):
    bird_ids: list[UUID] = Field(min_length=1, max_length=100)

    @field_validator("bird_ids")
    @classmethod
    def _unique_bird_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("bird_ids must be unique")
        return value


class SicknessUpdate(BaseModel):
    sick_date: date | None = None
    symptoms: str | None = Field(default=None, min_length=1, max_length=4000)
    severity: SicknessSeverity | None = None
    notes: str | None = Field(default=None, max_length=4000)
    treatment: str | None = Field(default=None, max_length=4000)
    follow_up_date: date | None = None

    @field_validator("symptoms")
    @classmethod
    def _symptoms_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("symptoms cannot be blank")
        return value

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "SicknessUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        for field in ("sick_date", "symptoms", "severity"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class SicknessRecover(BaseModel):
    recovery_date: date
    notes: str | None = Field(default=None, max_length=4000)


class SicknessEpisodeOut(BaseModel):
    id: UUID
    bird_id: UUID
    sick_date: date
    symptoms: str
    severity: SicknessSeverity
    notes: str | None
    treatment: str | None
    follow_up_date: date | None
    recovery_date: date | None
    status: SicknessStatus
    recorded_shed_id: UUID
    recorded_shed_name: str | None = None
    created_by_user_id: UUID
    recovered_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    follow_up_state: str = "none"


class SicknessRecordOut(BaseModel):
    id: UUID
    bird_id: UUID
    band_id: str | None
    display_code: str | None
    breed: str | None
    batch_code: str
    current_shed_id: UUID
    current_shed_name: str | None
    recorded_shed_id: UUID
    recorded_shed_name: str | None
    sick_date: date
    symptoms: str
    severity: SicknessSeverity
    notes: str | None
    treatment: str | None
    follow_up_date: date | None
    recovery_date: date | None
    status: SicknessStatus
    bird_is_active: bool
    bird_lifecycle_status: BirdLifecycleStatus
    created_by_user_id: UUID
    recovered_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    follow_up_state: str = "none"
    days_sick: int | None = None


class SicknessListOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[SicknessRecordOut]


class SicknessBulkResultOut(BaseModel):
    success_count: int
    recorded: list[SicknessRecordOut]
    idempotent_replay: bool = False


class BirdHealthOverviewOut(BaseModel):
    status: str
    total_episodes: int
    last_sickness_date: date | None
    last_recovery_date: date | None
    active_episode_id: UUID | None = None


class SicknessHistoryOut(BaseModel):
    bird_id: UUID
    band_id: str | None
    display_code: str | None
    current_health_status: str
    total_episodes: int
    last_sickness_date: date | None
    last_recovery_date: date | None
    active_episode: SicknessEpisodeOut | None
    episodes: list[SicknessEpisodeOut]


class SicknessShedBreakdownOut(BaseModel):
    shed_id: UUID
    shed_name: str | None
    active_birds: int
    active_episodes: int
    due: int
    overdue: int


class SicknessSummaryOut(BaseModel):
    as_of: date
    from_date: date | None
    to_date: date | None
    currently_sick_birds: int
    active_episodes: int
    follow_ups_due: int
    follow_ups_overdue: int
    recovered_birds: int
    recovered_episodes: int
    new_episodes: int
    new_unique_birds: int
    unresolved_inactive_episodes: int
    severity_breakdown: dict[str, int]
    new_severity_breakdown: dict[str, int]
    shed_breakdown: list[SicknessShedBreakdownOut]
