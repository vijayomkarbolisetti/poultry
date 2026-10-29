"""Optional shed capacity (birds) for Create/Edit Shed Screen 5.

Revision ID: 0011_shed_capacity
Revises: 0010_catalogue_item_admin_fields
Create Date: 2026-10-27

Additive nullable column only. No backfill.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_shed_capacity"
down_revision: str | None = "0010_catalogue_item_admin_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sheds",
        sa.Column("capacity", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sheds", "capacity")
