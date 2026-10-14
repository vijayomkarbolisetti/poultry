import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

PERMISSION_CODES = [
    "shed.view",
    "shed.create",
    "shed.update",
    "farmer.manage",
    "flock.view",
    "flock.create",
    "flock.update",
    "bird.view",
    "bird.create",
    "bird.update",
    "vaccination.view",
    "vaccination.record",
    "vaccination.correct",
    "schedule.view",
    "schedule.manage",
    "report.view",
    "media.view",
    "media.upload",
    "lifecycle.record",
]


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class MembershipPermission(Base):
    __tablename__ = "membership_permissions"
    __table_args__ = (
        UniqueConstraint(
            "owner_membership_id",
            "permission_code",
            "shed_id",
            name="uq_membership_perm_shed",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_membership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_memberships.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("permissions.code", ondelete="RESTRICT"), nullable=False
    )
    # NULL = org-wide grant for this membership; set for shed-scoped grants when needed
    shed_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sheds.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
