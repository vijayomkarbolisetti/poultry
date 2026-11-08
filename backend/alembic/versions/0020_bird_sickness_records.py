"""bird sickness records

Revision ID: 0020_bird_sickness_records
Revises: 0019_drop_admin_visible_pw
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_bird_sickness_records"
down_revision: str | None = "0019_drop_admin_visible_pw"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = [
    ("sickness.view", "View sick birds and sickness history"),
    ("sickness.record", "Record and edit sickness episodes"),
    ("sickness.recover", "Record sickness recovery"),
]


def upgrade() -> None:
    severity = postgresql.ENUM(
        "mild", "moderate", "severe", name="sickness_severity", create_type=False
    )
    status = postgresql.ENUM(
        "active", "recovered", name="sickness_status", create_type=False
    )
    bind = op.get_bind()
    severity.create(bind, checkfirst=True)
    status.create(bind, checkfirst=True)

    op.create_table(
        "bird_sickness_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bird_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("birds.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "shed_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sheds.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("sick_date", sa.Date(), nullable=False),
        sa.Column("symptoms", sa.Text(), nullable=False),
        sa.Column("severity", severity, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("treatment", sa.Text(), nullable=True),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
        sa.Column("recovery_date", sa.Date(), nullable=True),
        sa.Column("status", status, nullable=False, server_default="active"),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recovered_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("idempotency_payload_hash", sa.String(64), nullable=True),
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
        sa.CheckConstraint(
            "follow_up_date IS NULL OR follow_up_date >= sick_date",
            name="ck_bird_sickness_follow_up",
        ),
        sa.CheckConstraint(
            "(status = 'active' AND recovery_date IS NULL AND recovered_by_user_id IS NULL) OR "
            "(status = 'recovered' AND recovery_date IS NOT NULL AND recovered_by_user_id IS NOT NULL)",
            name="ck_bird_sickness_recovery",
        ),
        sa.CheckConstraint(
            "recovery_date IS NULL OR recovery_date >= sick_date",
            name="ck_bird_sickness_recovery_date",
        ),
    )
    op.create_index(
        "ix_bird_sickness_owner_account_id", "bird_sickness_records", ["owner_account_id"]
    )
    op.create_index("ix_bird_sickness_bird_id", "bird_sickness_records", ["bird_id"])
    op.create_index("ix_bird_sickness_shed_id", "bird_sickness_records", ["shed_id"])
    op.create_index("ix_bird_sickness_status", "bird_sickness_records", ["status"])
    op.create_index("ix_bird_sickness_sick_date", "bird_sickness_records", ["sick_date"])
    op.create_index(
        "ix_bird_sickness_follow_up_date", "bird_sickness_records", ["follow_up_date"]
    )
    op.create_index(
        "ix_bird_sickness_owner_status_sick_date",
        "bird_sickness_records",
        ["owner_account_id", "status", "sick_date"],
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_bird_sickness_active_bird
        ON bird_sickness_records (bird_id)
        WHERE status = 'active'
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_bird_sickness_owner_idem
        ON bird_sickness_records (owner_account_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        """
    )

    for code, desc in PERMISSIONS:
        op.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:c, :d)"
            ).bindparams(c=code, d=desc)
        )

    op.execute("ALTER TABLE bird_sickness_records ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE bird_sickness_records FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY bird_sickness_records_tenant ON bird_sickness_records
          FOR ALL TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
        """
    )
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON bird_sickness_records TO app_user;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_table("bird_sickness_records")
    op.execute(
        """
        DELETE FROM membership_permissions
        WHERE permission_code IN ('sickness.view', 'sickness.record', 'sickness.recover')
        """
    )
    op.execute(
        """
        DELETE FROM permissions
        WHERE code IN ('sickness.view', 'sickness.record', 'sickness.recover')
        """
    )
    bind = op.get_bind()
    postgresql.ENUM(name="sickness_status", create_type=False).drop(bind, checkfirst=True)
    postgresql.ENUM(name="sickness_severity", create_type=False).drop(bind, checkfirst=True)
