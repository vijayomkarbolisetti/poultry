"""Bird parent descriptors for sire/dam without requiring band numbers.

Revision ID: 0015_bird_parent_descriptors
Revises: 0014_lifecycle_sale_buyer
Create Date: 2026-10-28

Stores optional descriptive parentage (name, band label, breed, notes)
and/or a link to an existing farm bird. Does not invent placeholder birds.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_bird_parent_descriptors"
down_revision: str | None = "0014_lifecycle_sale_buyer"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

parent_role = postgresql.ENUM("sire", "dam", name="bird_parent_role", create_type=False)


def upgrade() -> None:
    op.execute("CREATE TYPE bird_parent_role AS ENUM ('sire', 'dam')")
    op.create_table(
        "bird_parent_descriptors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "child_bird_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("birds.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", parent_role, nullable=False),
        sa.Column(
            "linked_bird_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("birds.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("band_number", sa.String(length=64), nullable=True),
        sa.Column("breed", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("child_bird_id", "role", name="uq_bird_parent_child_role"),
    )


def downgrade() -> None:
    op.drop_table("bird_parent_descriptors")
    op.execute("DROP TYPE bird_parent_role")
