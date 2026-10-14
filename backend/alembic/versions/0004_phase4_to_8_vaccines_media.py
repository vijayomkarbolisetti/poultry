"""phase4-8 vaccines vaccinations notifications media

Revision ID: 0004_phase48
Revises: 0003_phase3
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_phase48"
down_revision: str | None = "0003_phase3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tenant_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {table}_tenant ON {table}
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


def upgrade() -> None:
    op.create_table(
        "vaccine_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(64), server_default="vaccine", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_vaccine_definitions_owner_account_id", "vaccine_definitions", ["owner_account_id"])

    op.create_table(
        "vaccine_schedule_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vaccine_definition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccine_definitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_current", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("vaccine_definition_id", "version_number", name="uq_vaccine_version"),
    )
    op.create_index("ix_vaccine_schedule_versions_owner_account_id", "vaccine_schedule_versions", ["owner_account_id"])

    op.create_table(
        "schedule_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("schedule_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccine_schedule_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dose_number", sa.Integer(), server_default="1", nullable=False),
        sa.Column("target_age_days", sa.Integer(), nullable=True),
        sa.Column("repeat_interval_days", sa.Integer(), nullable=True),
        sa.Column("max_repeats", sa.Integer(), nullable=True),
        sa.Column("grace_period_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("reminder_lead_days", sa.Integer(), server_default="3", nullable=False),
        sa.Column("is_manual_only", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("label", sa.String(128), nullable=True),
    )
    op.create_index("ix_schedule_rules_owner_account_id", "schedule_rules", ["owner_account_id"])

    op.create_table(
        "scheduled_doses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sheds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("flock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("flocks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bird_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("birds.id", ondelete="CASCADE"), nullable=True),
        sa.Column("vaccine_definition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccine_definitions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("schedule_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccine_schedule_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("schedule_rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("schedule_rules.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("dose_number", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("grace_period_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("reminder_lead_days", sa.Integer(), server_default="3", nullable=False),
        sa.Column("status", sa.String(32), server_default="upcoming", nullable=False),
        sa.Column("eligible_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column("completed_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("needs_review", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_scheduled_doses_owner_account_id", "scheduled_doses", ["owner_account_id"])
    op.create_index("ix_scheduled_doses_due_date", "scheduled_doses", ["due_date"])
    op.create_index("ix_scheduled_doses_status", "scheduled_doses", ["status"])

    op.create_table(
        "vaccination_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sheds.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("flock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("flocks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("bird_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("birds.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scheduled_dose_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("scheduled_doses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("vaccine_definition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccine_definitions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("schedule_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccine_schedule_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("administered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("administration_date", sa.Date(), nullable=False),
        sa.Column("birds_covered", sa.Integer(), server_default="1", nullable=False),
        sa.Column("recorded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lot_number", sa.String(64), nullable=True),
        sa.Column("product_expiry", sa.Date(), nullable=True),
        sa.Column("dose_amount", sa.String(64), nullable=True),
        sa.Column("route", sa.String(64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("verification_status", sa.String(32), server_default="verified", nullable=False),
        sa.Column("timing_status", sa.String(32), server_default="completed_on_time", nullable=False),
        sa.Column("is_void", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_vaccination_events_owner_account_id", "vaccination_events", ["owner_account_id"])

    op.create_table(
        "vaccination_corrections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vaccination_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vaccination_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=False),
        sa.Column("after", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("flock_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("scheduled_dose_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("scheduled_doses.id", ondelete="CASCADE"), nullable=True),
        sa.Column("alert_type", sa.String(64), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(16), server_default="info", nullable=False),
        sa.Column("is_read", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "owner_account_id", "user_id", "scheduled_dose_id", "alert_type", name="uq_notification_dose_type_user"
        ),
    )

    op.create_table(
        "animal_media",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("flock_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("bird_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("vaccination_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cloudinary_public_id", sa.String(512), nullable=False),
        sa.Column("resource_type", sa.String(32), server_default="image", nullable=False),
        sa.Column("format", sa.String(32), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("versions_meta", postgresql.JSONB(), nullable=True),
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    for t in (
        "vaccine_definitions",
        "vaccine_schedule_versions",
        "schedule_rules",
        "scheduled_doses",
        "vaccination_events",
        "vaccination_corrections",
        "notifications",
        "animal_media",
    ):
        _tenant_rls(t)

    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    for t in (
        "animal_media",
        "notifications",
        "vaccination_corrections",
        "vaccination_events",
        "scheduled_doses",
        "schedule_rules",
        "vaccine_schedule_versions",
        "vaccine_definitions",
    ):
        op.drop_table(t)
