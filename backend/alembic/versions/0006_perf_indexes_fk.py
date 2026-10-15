"""Additional FK / inbox indexes for list filters.

Revision ID: 0006_perf_indexes_fk
Revises: 0005_perf_indexes
Create Date: 2026-10-15
"""

from alembic import op

revision = "0006_perf_indexes_fk"
down_revision = "0005_perf_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_scheduled_doses_shed_id", "scheduled_doses", ["shed_id"])
    op.create_index("ix_scheduled_doses_flock_id", "scheduled_doses", ["flock_id"])
    op.create_index(
        "ix_scheduled_doses_flock_rule_due",
        "scheduled_doses",
        ["flock_id", "schedule_rule_id", "due_date"],
    )
    op.create_index(
        "ix_notifications_inbox",
        "notifications",
        ["owner_account_id", "user_id", "is_active", "created_at"],
    )
    op.create_index(
        "ix_membership_permissions_lookup",
        "membership_permissions",
        ["owner_membership_id", "permission_code"],
    )
    op.create_index(
        "ix_shed_memberships_member_active",
        "shed_memberships",
        ["owner_membership_id", "is_active"],
    )


def downgrade() -> None:
    op.drop_index("ix_shed_memberships_member_active", table_name="shed_memberships")
    op.drop_index("ix_membership_permissions_lookup", table_name="membership_permissions")
    op.drop_index("ix_notifications_inbox", table_name="notifications")
    op.drop_index("ix_scheduled_doses_flock_rule_due", table_name="scheduled_doses")
    op.drop_index("ix_scheduled_doses_flock_id", table_name="scheduled_doses")
    op.drop_index("ix_scheduled_doses_shed_id", table_name="scheduled_doses")
