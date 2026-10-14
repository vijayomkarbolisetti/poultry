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


class VaccineDefinition(Base):
    __tablename__ = "vaccine_definitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, server_default=text("'vaccine'"))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    versions: Mapped[list["VaccineScheduleVersion"]] = relationship(back_populates="definition")


class VaccineScheduleVersion(Base):
    __tablename__ = "vaccine_schedule_versions"
    __table_args__ = (
        UniqueConstraint("vaccine_definition_id", "version_number", name="uq_vaccine_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vaccine_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_definitions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    definition: Mapped["VaccineDefinition"] = relationship(back_populates="versions")
    rules: Mapped[list["ScheduleRule"]] = relationship(back_populates="version")


class ScheduleRule(Base):
    __tablename__ = "schedule_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    schedule_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_schedule_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dose_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    # target age in days from hatch (one-time / first dose)
    target_age_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # recurring interval in days (D1: monthly = 30)
    repeat_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_repeats: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grace_period_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    reminder_lead_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("3"))
    is_manual_only: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)

    version: Mapped["VaccineScheduleVersion"] = relationship(back_populates="rules")


class DoseStatus(str):
    pass


class ScheduledDose(Base):
    __tablename__ = "scheduled_doses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shed_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    flock_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flocks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bird_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="CASCADE"), nullable=True, index=True
    )
    vaccine_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_definitions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    schedule_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_schedule_versions.id", ondelete="RESTRICT"), nullable=False
    )
    schedule_rule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_rules.id", ondelete="RESTRICT"), nullable=False
    )
    dose_number: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    grace_period_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    reminder_lead_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("3"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'upcoming'"), index=True)
    eligible_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    completed_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
