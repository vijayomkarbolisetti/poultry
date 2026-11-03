"""User first-login password change + admin-visible password for farm owners.

Revision ID: 0018_user_password_policy
Revises: 0017_shed_auto_vax_manual_name
Create Date: 2026-11-03

- users.must_change_password: force password change after super-admin provisioning
- users.admin_visible_password: latest password recoverable by platform super admin
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_user_password_policy"
down_revision: str | None = "0017_shed_auto_vax_manual_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("admin_visible_password", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "admin_visible_password")
    op.drop_column("users", "must_change_password")
