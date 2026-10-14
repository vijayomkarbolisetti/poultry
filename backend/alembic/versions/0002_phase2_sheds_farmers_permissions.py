"""phase2 sheds farmers permissions

Revision ID: 0002_phase2
Revises: 0001_phase1
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_phase2"
down_revision: str | None = "0001_phase1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = [
    ("shed.view", "View sheds"),
    ("shed.create", "Create sheds"),
    ("shed.update", "Update sheds"),
    ("farmer.manage", "Manage farmers and assignments"),
    ("flock.view", "View flocks"),
    ("flock.create", "Create flocks"),
    ("flock.update", "Update flocks"),
    ("bird.view", "View birds"),
    ("bird.create", "Create birds"),
    ("bird.update", "Update birds"),
    ("vaccination.view", "View vaccinations"),
    ("vaccination.record", "Record vaccinations"),
    ("vaccination.correct", "Correct vaccinations"),
    ("schedule.view", "View schedules"),
    ("schedule.manage", "Manage schedules"),
    ("report.view", "View reports"),
    ("media.view", "View media"),
    ("media.upload", "Upload media"),
    ("lifecycle.record", "Record lifecycle events"),
]


def upgrade() -> None:
    op.add_column("owner_accounts", sa.Column("timezone", sa.String(length=64), nullable=True))

    op.create_table(
        "permissions",
        sa.Column("code", sa.String(length=64), primary_key=True),
        sa.Column("description", sa.Text(), nullable=False),
    )
    for code, desc in PERMISSIONS:
        op.execute(
            sa.text("INSERT INTO permissions (code, description) VALUES (:c, :d)").bindparams(
                c=code, d=desc
            )
        )

    op.create_table(
        "sheds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("location_notes", sa.Text(), nullable=True),
        sa.Column("is_owner_managed", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("owner_account_id", "code", name="uq_shed_owner_code"),
    )
    op.create_index("ix_sheds_owner_account_id", "sheds", ["owner_account_id"])

    op.create_table(
        "shed_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "shed_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sheds.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_membership_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_memberships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_manager", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("shed_id", "owner_membership_id", name="uq_shed_membership"),
    )
    op.create_index("ix_shed_memberships_owner_account_id", "shed_memberships", ["owner_account_id"])
    op.create_index("ix_shed_memberships_shed_id", "shed_memberships", ["shed_id"])
    op.create_index("ix_shed_memberships_owner_membership_id", "shed_memberships", ["owner_membership_id"])

    op.create_table(
        "membership_permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_membership_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_memberships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "permission_code",
            sa.String(64),
            sa.ForeignKey("permissions.code", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "shed_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sheds.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "owner_membership_id", "permission_code", "shed_id", name="uq_membership_perm_shed"
        ),
    )
    op.create_index("ix_membership_permissions_owner_account_id", "membership_permissions", ["owner_account_id"])
    op.create_index(
        "ix_membership_permissions_owner_membership_id", "membership_permissions", ["owner_membership_id"]
    )
    op.create_index("ix_membership_permissions_shed_id", "membership_permissions", ["shed_id"])

    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
          END IF;
        END $$;
        """
    )

    for table in ("sheds", "shed_memberships", "membership_permissions"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_tenant ON {table}
              FOR ALL TO PUBLIC
              USING (
                current_setting('app.rls_bypass', true) = 'on'
                OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
                OR current_setting('app.current_role', true) = 'platform_super_admin'
              )
              WITH CHECK (
                current_setting('app.rls_bypass', true) = 'on'
                OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
                OR current_setting('app.current_role', true) = 'platform_super_admin'
              )
            """
        )

    # permissions catalog is global read
    op.execute("ALTER TABLE permissions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE permissions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY permissions_read ON permissions
          FOR SELECT TO PUBLIC USING (true)
        """
    )
    op.execute(
        """
        CREATE POLICY permissions_write ON permissions
          FOR ALL TO PUBLIC
          USING (current_setting('app.rls_bypass', true) = 'on')
          WITH CHECK (current_setting('app.rls_bypass', true) = 'on')
        """
    )


def downgrade() -> None:
    op.drop_table("membership_permissions")
    op.drop_table("shed_memberships")
    op.drop_table("sheds")
    op.drop_table("permissions")
    op.drop_column("owner_accounts", "timezone")
