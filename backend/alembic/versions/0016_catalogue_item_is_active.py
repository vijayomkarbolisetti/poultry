"""Add is_active soft-removal flag on vaccine_catalogue_items.

Revision ID: 0016_catalogue_item_is_active
Revises: 0015_bird_parent_descriptors
Create Date: 2026-10-29

Preserves catalogue item rows (and source_catalogue_item_id provenance) when
entries are removed from an editable farm programme. Default true for all
existing rows. Additive only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_catalogue_item_is_active"
down_revision: str | None = "0015_bird_parent_descriptors"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "vaccine_catalogue_items",
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_vaccine_catalogue_items_catalogue_active",
        "vaccine_catalogue_items",
        ["catalogue_id", "is_active"],
    )


def downgrade() -> None:
    op.drop_index("ix_vaccine_catalogue_items_catalogue_active", table_name="vaccine_catalogue_items")
    op.drop_column("vaccine_catalogue_items", "is_active")
