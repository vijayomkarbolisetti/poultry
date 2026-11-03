from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from typing import Literal

from app.models.enums import (
    BirdLifecycleStatus,
    DobConfidence,
    FlockStatus,
    LifecycleEventType,
    TrackingMode,
)
from app.services.sale_helpers import normalize_buyer_mobile, normalize_buyer_name


class BirdParentInput(BaseModel):
    """Optional sire/dam: link an existing bird or store descriptive details."""

    mode: Literal["unknown", "existing", "manual"] = "unknown"
    bird_id: UUID | None = None
    display_name: str | None = Field(default=None, max_length=120)
    band_number: str | None = Field(default=None, max_length=64)
    breed: str | None = Field(default=None, max_length=128)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_mode(self) -> "BirdParentInput":
        if self.mode == "existing" and self.bird_id is None:
            raise ValueError("bird_id is required when mode is existing")
        if self.mode != "existing":
            self.bird_id = None
        if self.mode == "unknown":
            self.display_name = None
            self.band_number = None
            self.breed = None
            self.notes = None
        return self


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
    # NULL / omitted = inherit farm default catalogue (A2′).
    vaccination_catalogue_id: UUID | None = None

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
    # Increment unbanded headcount (does not replace totals).
    add_unbanded: int | None = Field(default=None, ge=1)
    # Exact hatch correction for schedule recalculation (open doses only).
    hatch_date: date | None = None
    # Set to a catalogue id for override; omit to leave unchanged.
    # Clear override (inherit farm default) by sending explicit null via dedicated flag if needed —
    # use clear_vaccination_catalogue_override=True.
    vaccination_catalogue_id: UUID | None = None
    clear_vaccination_catalogue_override: bool = False

    @model_validator(mode="after")
    def _hatch_not_future(self):
        if self.hatch_date is not None and self.hatch_date > date.today():
            raise ValueError("hatch_date cannot be in the future")
        return self


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
    vaccination_catalogue_id: UUID | None = None
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
    sire: BirdParentInput | None = None
    dam: BirdParentInput | None = None
    # When true, DOB may be omitted and is copied from the flock (band-from-unbanded / inherit).
    inherit_flock_dob: bool = False

    @model_validator(mode="after")
    def validate_dob_fields(self) -> "BirdCreate":
        if self.hatch_date is not None and self.hatch_date > date.today():
            raise ValueError("hatch_date cannot be in the future")
        if self.inherit_flock_dob:
            return self
        # Net-new banded birds require an exact hatch date (no estimated-age shortcuts).
        if self.band_id:
            if self.hatch_date is None:
                raise ValueError("hatch_date is required for banded birds")
            if self.dob_confidence != DobConfidence.exact:
                raise ValueError("dob_confidence must be exact for banded birds")
            return self
        if self.dob_confidence == DobConfidence.exact and self.hatch_date is None:
            raise ValueError("hatch_date required when dob_confidence is exact")
        if self.dob_confidence == DobConfidence.estimated and self.estimated_age_days is None:
            raise ValueError("estimated_age_days required when dob_confidence is estimated")
        return self


class RegisterBandedInShedIn(BaseModel):
    """Shed-centric banded registration — flock is resolved/created internally."""

    shed_id: UUID
    band_id: str = Field(min_length=1, max_length=64)
    hatch_date: date
    breed: str | None = None
    sex: str | None = None
    notes: str | None = None
    sire: BirdParentInput | None = None
    dam: BirdParentInput | None = None

    @model_validator(mode="after")
    def validate_exact_dob(self) -> "RegisterBandedInShedIn":
        if self.hatch_date > date.today():
            raise ValueError("hatch_date cannot be in the future")
        return self


class AddUnbandedInShedIn(BaseModel):
    """Shed-centric unbanded headcount — cohort flock is resolved/created by exact DOB."""

    shed_id: UUID
    quantity: int = Field(ge=1, le=100_000)
    hatch_date: date
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_exact_dob(self) -> "AddUnbandedInShedIn":
        if self.hatch_date > date.today():
            raise ValueError("hatch_date cannot be in the future")
        return self


class AddUnbandedInShedOut(BaseModel):
    flock: FlockOut
    created_cohort: bool
    quantity_added: int
    idempotent_replay: bool = False


class BandFromUnbandedIn(BaseModel):
    """Convert one unbanded headcount into a banded individual (atomic)."""

    flock_id: UUID
    band_id: str = Field(min_length=1, max_length=64)
    idempotency_key: str = Field(min_length=8, max_length=128)
    breed: str | None = None
    sex: str | None = None
    notes: str | None = None


class _CohortAgeMixin(BaseModel):
    """XOR: hatch_date OR (estimated_age_days + age_reported_on). Unknown rejected."""

    hatch_date: date | None = None
    estimated_age_days: int | None = Field(default=None, ge=0)
    age_reported_on: date | None = None

    @model_validator(mode="after")
    def validate_cohort_age(self) -> "_CohortAgeMixin":
        exact = self.hatch_date is not None
        estimated = self.estimated_age_days is not None and self.age_reported_on is not None
        if exact and (self.estimated_age_days is not None or self.age_reported_on is not None):
            raise ValueError("Use either hatch_date or estimated age fields, not both")
        if not exact and not estimated:
            raise ValueError("Provide hatch_date or both estimated_age_days and age_reported_on")
        if exact and self.hatch_date is not None and self.hatch_date > date.today():
            raise ValueError("hatch_date cannot be in the future")
        if estimated and self.age_reported_on is not None and self.age_reported_on > date.today():
            raise ValueError("age_reported_on cannot be in the future")
        if self.estimated_age_days is not None and self.age_reported_on is None:
            raise ValueError("age_reported_on required with estimated_age_days")
        if self.age_reported_on is not None and self.estimated_age_days is None:
            raise ValueError("estimated_age_days required with age_reported_on")
        return self


class BandFromUnbandedByCohortIn(_CohortAgeMixin):
    """Shed-centric banding — resolves active cohort by exact or estimated age key."""

    shed_id: UUID
    band_id: str = Field(min_length=1, max_length=64)
    idempotency_key: str = Field(min_length=8, max_length=128)
    breed: str | None = None
    sex: str | None = None
    notes: str | None = None


class UnbandedLifecycleByCohortIn(_CohortAgeMixin):
    """Count-only mortality/sale/exit-transfer for an unbanded shed cohort."""

    shed_id: UUID
    event_type: LifecycleEventType
    effective_date: date
    quantity: int = Field(ge=1)
    reason: str | None = None
    buyer_name: str | None = None
    buyer_mobile: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_event(self) -> "UnbandedLifecycleByCohortIn":
        allowed = {
            LifecycleEventType.mortality,
            LifecycleEventType.sale,
            LifecycleEventType.transfer,
        }
        if self.event_type not in allowed:
            raise ValueError("event_type must be mortality, sale, or transfer")
        if self.event_type == LifecycleEventType.sale:
            self.buyer_name = normalize_buyer_name(self.buyer_name)
            self.buyer_mobile = normalize_buyer_mobile(self.buyer_mobile)
        else:
            self.buyer_name = None
            self.buyer_mobile = None
        return self


class ShedTransferByCohortIn(_CohortAgeMixin):
    """Shed-centric transfer; server resolves/creates destination cohort under lifecycle.record."""

    destination_shed_id: UUID
    effective_date: date
    bird_ids: list[UUID] = Field(default_factory=list, max_length=100)
    source_shed_id: UUID | None = None
    quantity: int | None = Field(default=None, ge=1)
    reason: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_transfer_scope(self) -> "ShedTransferByCohortIn":
        has_birds = bool(self.bird_ids)
        has_count = self.source_shed_id is not None and self.quantity is not None
        if has_birds == has_count:
            raise ValueError(
                "Provide either bird_ids or (source_shed_id + quantity), not both or neither"
            )
        return self


class BirdUpdate(BaseModel):
    """Editable identity fields only. Lifecycle / batch placement use dedicated APIs."""

    band_id: str | None = Field(default=None, max_length=64)
    hatch_date: date | None = None
    estimated_age_days: int | None = Field(default=None, ge=0)
    age_reported_on: date | None = None
    dob_confidence: DobConfidence | None = None
    breed: str | None = None
    sex: str | None = None
    notes: str | None = None
    sire: BirdParentInput | None = None
    dam: BirdParentInput | None = None

    @model_validator(mode="after")
    def validate_dob(self) -> "BirdUpdate":
        if self.dob_confidence == DobConfidence.exact and self.hatch_date is None:
            # Allow omitting hatch_date when only other fields change; enforced in service if confidence set to exact.
            pass
        if self.dob_confidence == DobConfidence.estimated and self.estimated_age_days is None:
            pass
        return self


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


class BandFromUnbandedOut(BaseModel):
    bird: BirdOut
    idempotent_replay: bool
    flock_unbanded_count: int
    flock_banded_count: int
    flock_current_count: int


class BirdListItemOut(BaseModel):
    """Shed-scoped registered bird row (never synthesizes unbanded individuals)."""

    id: UUID
    band_id: str | None
    display_code: str | None
    breed: str | None
    sex: str | None
    hatch_date: date | None
    estimated_age_days: int | None
    dob_confidence: DobConfidence
    lifecycle_status: BirdLifecycleStatus
    is_active: bool
    flock_id: UUID
    batch_code: str
    shed_id: UUID
    individual_vaccination_count: int = 0
    notes: str | None = None


class BirdUnbandedBatchOut(BaseModel):
    flock_id: UUID
    batch_code: str
    unbanded_count: int
    tracking_mode: TrackingMode
    status: FlockStatus


class BirdListOut(BaseModel):
    shed_id: UUID
    total: int
    limit: int
    offset: int
    items: list[BirdListItemOut]
    unbanded_total: int
    unbanded_batches: list[BirdUnbandedBatchOut]


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


class BirdSearchHitOut(BaseModel):
    """One bird matching a band search (exact or partial)."""

    id: UUID
    band_id: str | None
    display_code: str | None
    shed_id: UUID
    shed_name: str | None
    shed_code: str | None
    flock_id: UUID
    batch_code: str
    breed: str | None
    lifecycle_status: BirdLifecycleStatus
    is_active: bool
    match_kind: str  # exact | partial


class BirdSearchOut(BaseModel):
    query: str
    total: int
    limit: int
    offset: int
    exact_count: int
    items: list[BirdSearchHitOut]


class BirdParentRefOut(BaseModel):
    """Legacy linked-parent shape (kept for older clients). Prefer BirdParentageOut."""

    id: UUID
    band_id: str | None
    display_code: str | None


class BirdParentageOut(BaseModel):
    """Unified parentage view for profile UI."""

    source: Literal["unknown", "linked", "manual"] = "unknown"
    bird_id: UUID | None = None
    band_id: str | None = None
    display_name: str | None = None
    breed: str | None = None
    notes: str | None = None
    label: str = "Unknown"


class BirdProfileVaccinationEventOut(BaseModel):
    """Vaccination history row for a bird profile / PDF report.

    ``coverage_scope``:
    - ``individual`` — event tagged to this bird_id
    - ``cohort`` — flock population recording that fully covered every banded bird
      already present in the hatch cohort (not an ambiguous partial)
    """

    id: UUID
    vaccine_definition_id: UUID
    vaccine_name: str | None
    administration_date: date
    birds_covered: int
    lot_number: str | None
    product_expiry: date | None = None
    manufacturer_or_brand: str | None = None
    vaccine_type_or_strain: str | None = None
    dose_amount: str | None = None
    route: str | None = None
    timing_status: str
    verification_status: str
    notes: str | None
    scheduled_dose_id: UUID | None
    created_at: datetime
    coverage_scope: str = "individual"


class BirdProfileBatchDoseOut(BaseModel):
    """Flock-level scheduled dose — not confirmed as an individual vaccination."""

    id: UUID
    vaccine_definition_id: UUID
    vaccine_name: str | None
    dose_number: int
    due_date: date
    status: str
    eligible_count: int
    completed_count: int
    needs_review: bool
    attribution_note: str = (
        "Batch schedule — not confirmed as an individual vaccination"
    )


class BirdProfileLifecycleOut(BaseModel):
    id: UUID
    event_type: LifecycleEventType
    effective_date: date
    quantity: int
    reason: str | None
    buyer_name: str | None = None
    buyer_mobile: str | None = None
    created_at: datetime


class BirdSaleDetailsOut(BaseModel):
    """Latest sale event details when lifecycle_status is sold."""

    event_id: UUID
    sold_on: date
    buyer_name: str | None
    buyer_mobile: str | None
    recorded_at: datetime


class BirdProfileOut(BaseModel):
    id: UUID
    band_id: str | None
    display_code: str | None
    breed: str | None
    sex: str | None
    hatch_date: date | None
    estimated_age_days: int | None
    dob_confidence: DobConfidence
    lifecycle_status: BirdLifecycleStatus
    is_active: bool
    notes: str | None
    created_at: datetime
    organization_name: str | None
    shed_id: UUID
    shed_name: str | None
    shed_code: str | None
    flock_id: UUID
    batch_code: str
    flock_tracking_mode: TrackingMode
    flock_status: FlockStatus
    flock_unbanded_count: int
    flock_banded_count: int
    flock_current_count: int
    flock_count_mismatch: bool
    sire: BirdParentRefOut | None = None
    dam: BirdParentRefOut | None = None
    sire_parentage: BirdParentageOut = Field(default_factory=lambda: BirdParentageOut())
    dam_parentage: BirdParentageOut = Field(default_factory=lambda: BirdParentageOut())
    sale: BirdSaleDetailsOut | None = None
    individual_vaccinations: list[BirdProfileVaccinationEventOut]
    batch_upcoming_doses: list[BirdProfileBatchDoseOut]
    lifecycle_events: list[BirdProfileLifecycleOut]


class SoldBirdHitOut(BaseModel):
    id: UUID
    band_id: str | None
    display_code: str | None
    breed: str | None
    batch_code: str
    shed_id: UUID
    shed_name: str | None
    shed_code: str | None
    sold_on: date
    buyer_name: str | None
    buyer_mobile: str | None
    lifecycle_status: BirdLifecycleStatus
    is_active: bool


class SoldBirdListOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[SoldBirdHitOut]


class LifecycleCreate(BaseModel):
    event_type: LifecycleEventType
    effective_date: date
    flock_id: UUID | None = None
    bird_id: UUID | None = None
    quantity: int = Field(default=1, ge=1)
    reason: str | None = None
    buyer_name: str | None = None
    buyer_mobile: str | None = None
    idempotency_key: str | None = None

    @model_validator(mode="after")
    def validate_sale_buyer(self) -> "LifecycleCreate":
        if self.event_type == LifecycleEventType.sale:
            self.buyer_name = normalize_buyer_name(self.buyer_name)
            self.buyer_mobile = normalize_buyer_mobile(self.buyer_mobile)
        else:
            self.buyer_name = None
            self.buyer_mobile = None
        return self


class LifecycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: LifecycleEventType
    effective_date: date
    flock_id: UUID | None
    bird_id: UUID | None
    quantity: int
    reason: str | None
    buyer_name: str | None = None
    buyer_mobile: str | None = None
    created_at: datetime


class LifecycleBulkCreate(BaseModel):
    """All-or-nothing lifecycle for multiple registered (banded) birds."""

    event_type: LifecycleEventType
    effective_date: date
    bird_ids: list[UUID] = Field(min_length=1, max_length=100)
    reason: str | None = None
    buyer_name: str | None = None
    buyer_mobile: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_sale_buyer(self) -> "LifecycleBulkCreate":
        if self.event_type == LifecycleEventType.sale:
            self.buyer_name = normalize_buyer_name(self.buyer_name)
            self.buyer_mobile = normalize_buyer_mobile(self.buyer_mobile)
        else:
            self.buyer_name = None
            self.buyer_mobile = None
        return self


class LifecycleBulkItemOut(BaseModel):
    bird_id: UUID
    event_id: UUID
    lifecycle_status: BirdLifecycleStatus
    band_id: str | None = None
    idempotent_replay: bool = False


class LifecycleBulkOut(BaseModel):
    applied: int
    event_type: LifecycleEventType
    items: list[LifecycleBulkItemOut]
    idempotent_replay: bool = False


class ShedTransferCreate(BaseModel):
    """Move birds between sheds while preserving identity (not an exit transfer)."""

    destination_flock_id: UUID
    effective_date: date
    bird_ids: list[UUID] = Field(default_factory=list, max_length=100)
    source_flock_id: UUID | None = None
    quantity: int | None = Field(default=None, ge=1)
    reason: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_scope(self) -> "ShedTransferCreate":
        has_birds = bool(self.bird_ids)
        has_count = self.source_flock_id is not None and self.quantity is not None
        if has_birds == has_count:
            raise ValueError("Provide either bird_ids or (source_flock_id + quantity), not both or neither")
        if has_birds and len(self.bird_ids) == 0:
            raise ValueError("bird_ids cannot be empty")
        return self


class ShedTransferOut(BaseModel):
    moved: int
    destination_flock_id: UUID
    destination_shed_id: UUID
    bird_ids: list[UUID] = Field(default_factory=list)
    idempotent_replay: bool = False
