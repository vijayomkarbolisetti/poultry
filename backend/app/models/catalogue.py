"""Platform and farm-owned vaccine programme catalogues and farm assignments."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VaccineCatalogue(Base):
    __tablename__ = "vaccine_catalogues"
    # Uniqueness is enforced by partial indexes in migration 0009 (NULL-safe).

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NULL = platform template; set = farm-owned catalogue.
    owner_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'active'"))
    is_example: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # Technical availability ≠ veterinary approval. True = show review warning; not auto-approved.
    requires_veterinary_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    cloned_from_catalogue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vaccine_catalogues.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    items: Mapped[list["VaccineCatalogueItem"]] = relationship(back_populates="catalogue")


class VaccineCatalogueItem(Base):
    __tablename__ = "vaccine_catalogue_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    catalogue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_catalogues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, server_default=text("'vaccine'"))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    disease_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Product guidance for Catalogues UI (not vaccination-event recording fields).
    recommended_dose_text: Mapped[str | None] = mapped_column(String(128), nullable=True)
    route: Mapped[str | None] = mapped_column(String(64), nullable=True)
    diluent_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Soft-removal: false keeps the row for provenance / materialize links (no hard delete).
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    catalogue: Mapped["VaccineCatalogue"] = relationship(back_populates="items")
    rules: Mapped[list["VaccineCatalogueItemRule"]] = relationship(back_populates="item")


class VaccineCatalogueItemRule(Base):
    __tablename__ = "vaccine_catalogue_item_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    catalogue_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vaccine_catalogue_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dose_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    target_age_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    display_day_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    repeat_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_repeats: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grace_period_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    reminder_lead_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("3"))
    is_manual_only: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)

    item: Mapped["VaccineCatalogueItem"] = relationship(back_populates="rules")


class OwnerCatalogueAssignment(Base):
    __tablename__ = "owner_catalogue_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    catalogue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaccine_catalogues.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    apply_scope: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'all_active'"))
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    catalogue: Mapped["VaccineCatalogue"] = relationship()
