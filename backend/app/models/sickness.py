import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import SicknessSeverity, SicknessStatus


class BirdSicknessRecord(Base):
    """One sickness episode for one individually registered (banded) bird."""

    __tablename__ = "bird_sickness_records"
    __table_args__ = (
        CheckConstraint(
            "follow_up_date IS NULL OR follow_up_date >= sick_date",
            name="ck_bird_sickness_follow_up",
        ),
        CheckConstraint(
            "(status = 'active' AND recovery_date IS NULL AND recovered_by_user_id IS NULL) OR "
            "(status = 'recovered' AND recovery_date IS NOT NULL AND recovered_by_user_id IS NOT NULL)",
            name="ck_bird_sickness_recovery",
        ),
        CheckConstraint(
            "recovery_date IS NULL OR recovery_date >= sick_date",
            name="ck_bird_sickness_recovery_date",
        ),
        Index("ix_bird_sickness_owner_account_id", "owner_account_id"),
        Index("ix_bird_sickness_bird_id", "bird_id"),
        Index("ix_bird_sickness_shed_id", "shed_id"),
        Index("ix_bird_sickness_status", "status"),
        Index("ix_bird_sickness_sick_date", "sick_date"),
        Index("ix_bird_sickness_follow_up_date", "follow_up_date"),
        Index(
            "ix_bird_sickness_owner_status_sick_date",
            "owner_account_id",
            "status",
            "sick_date",
        ),
        Index(
            "uq_bird_sickness_active_bird",
            "bird_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "uq_bird_sickness_owner_idem",
            "owner_account_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("owner_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    bird_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("birds.id", ondelete="RESTRICT"),
        nullable=False,
    )
    shed_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sheds.id", ondelete="RESTRICT"),
        nullable=False,
    )
    sick_date: Mapped[date] = mapped_column(Date, nullable=False)
    symptoms: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[SicknessSeverity] = mapped_column(
        Enum(SicknessSeverity, name="sickness_severity", native_enum=True),
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    treatment: Mapped[str | None] = mapped_column(Text, nullable=True)
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recovery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[SicknessStatus] = mapped_column(
        Enum(SicknessStatus, name="sickness_status", native_enum=True),
        nullable=False,
        server_default=text("'active'"),
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    recovered_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    idempotency_payload_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
