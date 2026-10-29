from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _optional_trimmed_text(value: object, *, max_len: int | None = None) -> str | None:
    """Trim optional strings; empty / whitespace-only → None."""
    if value is None:
        return None
    if not isinstance(value, str):
        return value  # type: ignore[return-value]
    cleaned = value.strip()
    if not cleaned:
        return None
    if max_len is not None and len(cleaned) > max_len:
        raise ValueError(f"must be at most {max_len} characters")
    return cleaned


class CatalogueRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dose_number: int
    target_age_days: int | None
    display_day_label: str | None
    repeat_interval_days: int | None
    max_repeats: int | None
    grace_period_days: int
    reminder_lead_days: int
    is_manual_only: bool
    label: str | None


class CatalogueRuleIn(BaseModel):
    dose_number: int = 1
    target_age_days: int | None = None
    display_day_label: str | None = None
    repeat_interval_days: int | None = None
    max_repeats: int | None = None
    grace_period_days: int = 0
    reminder_lead_days: int = 3
    is_manual_only: bool = False
    label: str | None = None


class CatalogueItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sort_order: int
    name: str
    category: str
    description: str | None
    disease_label: str | None
    instructions: str | None
    recommended_dose_text: str | None = None
    route: str | None = None
    diluent_instructions: str | None = None
    is_active: bool = True
    rules: list[CatalogueRuleOut] = Field(default_factory=list)


class CatalogueItemIn(BaseModel):
    # When set on update, upserts that catalogue item in place (stable PK / materialize link).
    # Omit on create or to append a new item. Never used for name/age matching.
    id: UUID | None = None
    sort_order: int = 0
    name: str = Field(min_length=1, max_length=255)
    category: str = "vaccine"
    description: str | None = None
    disease_label: str | None = None
    instructions: str | None = None
    recommended_dose_text: str | None = Field(default=None, max_length=128)
    route: str | None = Field(default=None, max_length=64)
    diluent_instructions: str | None = None
    rules: list[CatalogueRuleIn] = Field(default_factory=list)

    @field_validator(
        "description",
        "disease_label",
        "instructions",
        "recommended_dose_text",
        "route",
        "diluent_instructions",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        return _optional_trimmed_text(value)


class CatalogueSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    description: str | None
    version: int
    status: str
    is_example: bool
    requires_veterinary_review: bool = False
    owner_account_id: UUID | None = None
    cloned_from_catalogue_id: UUID | None = None
    is_platform: bool = True
    item_count: int = 0


class CatalogueDetailOut(CatalogueSummaryOut):
    items: list[CatalogueItemOut] = Field(default_factory=list)


class CatalogueCreateIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    items: list[CatalogueItemIn] = Field(default_factory=list)


class CatalogueUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: str | None = None
    items: list[CatalogueItemIn] | None = None
    # Soft-remove these item ids (must belong to the catalogue). Keeps provenance.
    remove_item_ids: list[UUID] = Field(default_factory=list)
    # D5 when items change and schedules should refresh for inheriting flocks.
    apply_scope: str = Field(default="new_flocks", description="new_flocks | all_active")
    effective_date: date | None = None
    confirm_change: bool = False
    # Stale-preview guards (required when items or remove_item_ids change).
    expected_version: int | None = None
    # Farm-default catalogue id at preview time; null means no current assignment.
    expected_assignment_catalogue_id: UUID | None = None
    expected_override_flock_count: int | None = None


class CataloguePreviewUpdateIn(BaseModel):
    """Proposed catalogue item edit for impact preview (read-only)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    items: list[CatalogueItemIn] | None = None
    remove_item_ids: list[UUID] = Field(default_factory=list)
    apply_scope: str = Field(default="new_flocks", description="new_flocks | all_active")
    effective_date: date | None = None


class CataloguePreviewUpdateOut(BaseModel):
    catalogue_id: UUID
    catalogue_name: str
    catalogue_version: int
    requires_veterinary_review: bool
    apply_scope: str
    effective_date: date
    is_farm_default: bool
    expected_assignment_catalogue_id: UUID | None
    expected_override_flock_count: int
    inheriting_flock_count_if_default: int
    items_added: list[str] = Field(default_factory=list)
    items_updated: list[UUID] = Field(default_factory=list)
    items_removed: list[UUID] = Field(default_factory=list)
    rule_changes: list[UUID] = Field(default_factory=list)
    open_doses_eligible_for_change: int
    completed_event_count: int
    flocks_affected_new_flocks: int = 0
    flocks_affected_all_active: int = 0
    warning: str
    all_active_gated: bool = True


class CatalogueCloneIn(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)


class CatalogueAssignIn(BaseModel):
    catalogue_id: UUID
    effective_date: date | None = None
    apply_scope: str = Field(default="all_active", description="new_flocks | all_active")
    notes: str | None = None
    confirm_change: bool = False


class CatalogueAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    catalogue_id: UUID
    catalogue_code: str
    catalogue_name: str
    assigned_at: datetime
    effective_date: date
    apply_scope: str
    is_current: bool
    notes: str | None
    materialized_definition_ids: list[UUID] = Field(default_factory=list)
    regenerated_doses: int = 0


class AssignPreviewOut(BaseModel):
    catalogue_id: UUID
    catalogue_name: str
    current_catalogue_id: UUID | None
    current_catalogue_name: str | None
    active_flock_count: int
    open_dose_count: int
    completed_event_count: int
    apply_scope: str
    effective_date: date
    warning: str
    inheriting_flock_count: int = 0
    override_flock_count: int = 0
