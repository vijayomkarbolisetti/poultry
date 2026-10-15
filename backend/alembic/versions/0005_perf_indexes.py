"""Performance indexes for hot list/dashboard filters.

Revision ID: 0005_perf_indexes
Revises: 0004_phase48
Create Date: 2026-10-15
"""

from alembic import op

revision = "0005_perf_indexes"
down_revision = "0004_phase48"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_scheduled_doses_owner_active_status",
        "scheduled_doses",
        ["owner_account_id", "is_active", "status"],
    )
    op.create_index(
        "ix_scheduled_doses_owner_active_due",
        "scheduled_doses",
        ["owner_account_id", "is_active", "due_date"],
    )
    op.create_index(
        "ix_sheds_owner_active",
        "sheds",
        ["owner_account_id", "is_active"],
    )
    op.create_index(
        "ix_flocks_owner_status",
        "flocks",
        ["owner_account_id", "status"],
    )
    op.create_index(
        "ix_birds_owner_active_lifecycle",
        "birds",
        ["owner_account_id", "is_active", "lifecycle_status"],
    )
    op.create_index(
        "ix_owner_memberships_user_owner_active",
        "owner_memberships",
        ["user_id", "owner_account_id", "is_active"],
    )
    op.create_index(
        "ix_notifications_owner_user_unread",
        "notifications",
        ["owner_account_id", "user_id", "is_read"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_owner_user_unread", table_name="notifications")
    op.drop_index("ix_owner_memberships_user_owner_active", table_name="owner_memberships")
    op.drop_index("ix_birds_owner_active_lifecycle", table_name="birds")
    op.drop_index("ix_flocks_owner_status", table_name="flocks")
    op.drop_index("ix_sheds_owner_active", table_name="sheds")
    op.drop_index("ix_scheduled_doses_owner_active_due", table_name="scheduled_doses")
    op.drop_index("ix_scheduled_doses_owner_active_status", table_name="scheduled_doses")
