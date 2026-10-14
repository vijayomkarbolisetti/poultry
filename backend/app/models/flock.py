import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import BirdLifecycleStatus, DobConfidence, FlockStatus, TrackingMode


class Flock(Base):
    __tablename__ = "flocks"
    __table_args__ = (UniqueConstraint("owner_account_id", "batch_code", name="uq_flock_owner_batch"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shed_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheds.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    batch_code: Mapped[str] = mapped_column(String(64), nullable=False)
    breed: Mapped[str | None] = mapped_column(String(128), nullable=True)
    hatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_age_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age_reported_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    dob_confidence: Mapped[DobConfidence] = mapped_column(
        Enum(DobConfidence, name="dob_confidence", native_enum=True),
        nullable=False,
        server_default=text("'unknown'"),
    )
    initial_count: Mapped[int] = mapped_column(Integer, nullable=False)
    current_count: Mapped[int] = mapped_column(Integer, nullable=False)
    banded_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    unbanded_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    tracking_mode: Mapped[TrackingMode] = mapped_column(
        Enum(TrackingMode, name="tracking_mode", native_enum=True),
        nullable=False,
    )
    status: Mapped[FlockStatus] = mapped_column(
        Enum(FlockStatus, name="flock_status", native_enum=True),
        nullable=False,
        server_default=text("'active'"),
    )
    onboarded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    count_mismatch: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    birds: Mapped[list["Bird"]] = relationship(back_populates="flock")


class Bird(Base):
    __tablename__ = "birds"
    # Active band uniqueness enforced via partial unique index in migration.

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
    band_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    display_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_age_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age_reported_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    dob_confidence: Mapped[DobConfidence] = mapped_column(
        Enum(DobConfidence, name="dob_confidence", native_enum=True, create_type=False),
        nullable=False,
        server_default=text("'unknown'"),
    )
    breed: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sex: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sire_bird_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="SET NULL"), nullable=True
    )
    dam_bird_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="SET NULL"), nullable=True
    )
    lifecycle_status: Mapped[BirdLifecycleStatus] = mapped_column(
        Enum(BirdLifecycleStatus, name="bird_lifecycle_status", native_enum=True),
        nullable=False,
        server_default=text("'active'"),
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    flock: Mapped["Flock"] = relationship(back_populates="birds")
