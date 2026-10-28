import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class VaccinationEvent(Base):
    __tablename__ = "vaccination_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shed_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheds.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    flock_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flocks.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    bird_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="SET NULL"), nullable=True, index=True
    )
    scheduled_dose_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scheduled_doses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    vaccine_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_definitions.id", ondelete="RESTRICT"), nullable=False
    )
    schedule_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_schedule_versions.id", ondelete="SET NULL"), nullable=True
    )
    administered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    administration_date: Mapped[date] = mapped_column(Date, nullable=False)  # farm-local calendar date (D2)
    birds_covered: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    lot_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    manufacturer_or_brand: Mapped[str | None] = mapped_column(String(128), nullable=True)
    vaccine_type_or_strain: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dose_amount: Mapped[str | None] = mapped_column(String(64), nullable=True)
    route: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'verified'")
    )  # verified | unverified
    timing_status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'completed_on_time'")
    )
    is_void: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VaccinationCorrection(Base):
    __tablename__ = "vaccination_corrections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vaccination_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccination_events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    before: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    after: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
