"""Catalogue item administration guidance fields (dose, route, diluent).

Revision ID: 0010_catalogue_item_admin_fields
Revises: 0009_owner_catalogues
Create Date: 2026-10-23

Additive nullable columns on vaccine_catalogue_items only.
No backfill and no product-specific seed data.
Does not alter vaccination_events recording fields.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_catalogue_item_admin_fields"
down_revision: str | None = "0009_owner_catalogues"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "vaccine_catalogue_items",
        sa.Column("recommended_dose_text", sa.String(128), nullable=True),
    )
    op.add_column(
        "vaccine_catalogue_items",
        sa.Column("route", sa.String(64), nullable=True),
    )
    op.add_column(
        "vaccine_catalogue_items",
        sa.Column("diluent_instructions", sa.Text(), nullable=True),
    )

    # Preserve 0009 posture: farm writes require DML on item tables.
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON vaccine_catalogue_items TO app_user;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_column("vaccine_catalogue_items", "diluent_instructions")
    op.drop_column("vaccine_catalogue_items", "route")
    op.drop_column("vaccine_catalogue_items", "recommended_dose_text")
