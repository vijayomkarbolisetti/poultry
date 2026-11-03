"""Add buyer_name and buyer_mobile on lifecycle_events for sales.

Revision ID: 0014_lifecycle_sale_buyer
Revises: 0013_general_schedule_copy
Create Date: 2026-10-28

Sold birds already use lifecycle_status=sold / event_type=sale.
These columns store required buyer contact details for sale events
and enable Sold Birds search by person name / mobile.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_lifecycle_sale_buyer"
down_revision: str | None = "0013_general_schedule_copy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "lifecycle_events",
        sa.Column("buyer_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "lifecycle_events",
        sa.Column("buyer_mobile", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_lifecycle_events_buyer_name",
        "lifecycle_events",
        ["buyer_name"],
        unique=False,
    )
    op.create_index(
        "ix_lifecycle_events_buyer_mobile",
        "lifecycle_events",
        ["buyer_mobile"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_lifecycle_events_buyer_mobile", table_name="lifecycle_events")
    op.drop_index("ix_lifecycle_events_buyer_name", table_name="lifecycle_events")
    op.drop_column("lifecycle_events", "buyer_mobile")
    op.drop_column("lifecycle_events", "buyer_name")
