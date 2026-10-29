"""Optional descriptive parentage for birds (sire/dam without inventing bird rows)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import BirdParentRole


class BirdParentDescriptor(Base):
    """One optional sire and one optional dam descriptor per child bird."""

    __tablename__ = "bird_parent_descriptors"
    __table_args__ = (
        UniqueConstraint("child_bird_id", "role", name="uq_bird_parent_child_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    child_bird_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[BirdParentRole] = mapped_column(
        Enum(BirdParentRole, name="bird_parent_role", native_enum=True),
        nullable=False,
    )
    linked_bird_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("birds.id", ondelete="SET NULL"), nullable=True, index=True
    )
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    band_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    breed: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
