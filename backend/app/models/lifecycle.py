import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import LifecycleEventType


class LifecycleEvent(Base):
    __tablename__ = "lifecycle_events"
    __table_args__ = (
        # Mirrors migration 0007; create_all (pytest) must match Alembic.
        Index(
            "uq_lifecycle_owner_idempotency_key",
            "owner_account_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shed_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheds.id", ondelete="SET NULL"), nullable=True, index=True
    )
    flock_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flocks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    bird_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[LifecycleEventType] = mapped_column(
        Enum(LifecycleEventType, name="lifecycle_event_type", native_enum=True),
        nullable=False,
    )
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    buyer_name: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    buyer_mobile: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # Uniqueness is owner-scoped via partial index uq_lifecycle_owner_idempotency_key (migration 0007).
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    idempotency_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
