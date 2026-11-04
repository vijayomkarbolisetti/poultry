"""Drop users.admin_visible_password (plain-text password copy).

Revision ID: 0019_drop_admin_visible_pw
Revises: 0018_user_password_policy
Create Date: 2026-11-04

Passwords are only stored as bcrypt hashes. Super admins hand over the temporary
password they set (echoed once in the create/reset response) and reset it when
needed; they never read a stored password. Dropping the column also wipes any
plain-text values written by 0018 on databases that already ran it.
Downgrade restores an empty column; erased values are not recoverable.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_drop_admin_visible_pw"
down_revision: str | None = "0018_user_password_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("users", "admin_visible_password")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("admin_visible_password", sa.String(length=128), nullable=True),
    )
