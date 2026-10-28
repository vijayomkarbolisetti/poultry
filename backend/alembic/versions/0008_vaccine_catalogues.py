"""Vaccine programme catalogues + farm assignment + materialize link.

Revision ID: 0008_vaccine_catalogues
Revises: 0007_p5_cohort_idempotency
Create Date: 2026-10-23

Platform catalogues are global (no owner_account_id). Tenant assignments and
materialized definitions remain owner-scoped with RLS.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_vaccine_catalogues"
down_revision: str | None = "0007_p5_cohort_idempotency"
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
        "vaccine_catalogues",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("status", sa.String(32), server_default="active", nullable=False),
        sa.Column("is_example", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("code", name="uq_vaccine_catalogues_code"),
    )

    op.create_table(
        "vaccine_catalogue_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "catalogue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaccine_catalogues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(64), server_default="vaccine", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("disease_label", sa.String(128), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_vaccine_catalogue_items_catalogue_id", "vaccine_catalogue_items", ["catalogue_id"])

    op.create_table(
        "vaccine_catalogue_item_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "catalogue_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaccine_catalogue_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("dose_number", sa.Integer(), server_default="1", nullable=False),
        sa.Column("target_age_days", sa.Integer(), nullable=True),
        sa.Column("display_day_label", sa.String(64), nullable=True),
        sa.Column("repeat_interval_days", sa.Integer(), nullable=True),
        sa.Column("max_repeats", sa.Integer(), nullable=True),
        sa.Column("grace_period_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("reminder_lead_days", sa.Integer(), server_default="3", nullable=False),
        sa.Column("is_manual_only", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("label", sa.String(128), nullable=True),
    )
    op.create_index(
        "ix_vaccine_catalogue_item_rules_item_id",
        "vaccine_catalogue_item_rules",
        ["catalogue_item_id"],
    )

    op.create_table(
        "owner_catalogue_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "catalogue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaccine_catalogues.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("assigned_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("apply_scope", sa.String(32), server_default="all_active", nullable=False),
        sa.Column("is_current", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index(
        "ix_owner_catalogue_assignments_owner",
        "owner_catalogue_assignments",
        ["owner_account_id"],
    )
    op.create_index(
        "ix_owner_catalogue_assignments_current",
        "owner_catalogue_assignments",
        ["owner_account_id", "is_current"],
    )
    _tenant_rls("owner_catalogue_assignments")

    op.add_column(
        "vaccine_definitions",
        sa.Column(
            "source_catalogue_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaccine_catalogue_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_vaccine_definitions_source_item",
        "vaccine_definitions",
        ["owner_account_id", "source_catalogue_item_id"],
        unique=True,
        postgresql_where=sa.text("source_catalogue_item_id IS NOT NULL"),
    )

    # Seed an illustrative (non-veterinary) example programme for development/QA.
    # target_age_days uses elapsed-day offsets: Day 1 (hatch) => 0, Day 21 => 20.
    op.execute(
        """
        INSERT INTO vaccine_catalogues (id, code, name, description, version, status, is_example)
        VALUES (
          'a1000000-0000-4000-8000-000000000001',
          'EXAMPLE_GENERAL_POULTRY',
          'Example general poultry programme',
          'Illustrative template only — not a veterinarian-approved schedule. '
          'Day labels map to elapsed-day offsets (Day 1 = hatch = target_age_days 0).',
          1,
          'active',
          true
        );

        INSERT INTO vaccine_catalogue_items
          (id, catalogue_id, sort_order, name, category, description, disease_label, instructions)
        VALUES
          (
            'a1000000-0000-4000-8000-000000000011',
            'a1000000-0000-4000-8000-000000000001',
            1,
            'Example IBD (illustrative)',
            'vaccine',
            'Illustrative IBD-style entry for QA only.',
            'IBD (example)',
            NULL
          ),
          (
            'a1000000-0000-4000-8000-000000000012',
            'a1000000-0000-4000-8000-000000000001',
            2,
            'Example ND (illustrative)',
            'vaccine',
            'Illustrative ND-style entry for QA only.',
            'ND (example)',
            NULL
          );

        INSERT INTO vaccine_catalogue_item_rules
          (id, catalogue_item_id, dose_number, target_age_days, display_day_label,
           grace_period_days, reminder_lead_days, label)
        VALUES
          (
            'a1000000-0000-4000-8000-000000000021',
            'a1000000-0000-4000-8000-000000000011',
            1, 0, 'Day 1 (hatch)', 0, 3, 'Dose 1'
          ),
          (
            'a1000000-0000-4000-8000-000000000022',
            'a1000000-0000-4000-8000-000000000011',
            2, 20, 'Day 21', 0, 3, 'Dose 2'
          ),
          (
            'a1000000-0000-4000-8000-000000000023',
            'a1000000-0000-4000-8000-000000000012',
            1, 7, 'Day 8', 0, 3, 'Dose 1'
          );
        """
    )

    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT ON vaccine_catalogues, vaccine_catalogue_items, vaccine_catalogue_item_rules TO app_user;
            GRANT SELECT, INSERT, UPDATE, DELETE ON owner_catalogue_assignments TO app_user;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_vaccine_definitions_source_item", table_name="vaccine_definitions")
    op.drop_column("vaccine_definitions", "source_catalogue_item_id")
    op.drop_table("owner_catalogue_assignments")
    op.drop_table("vaccine_catalogue_item_rules")
    op.drop_table("vaccine_catalogue_items")
    op.drop_table("vaccine_catalogues")
