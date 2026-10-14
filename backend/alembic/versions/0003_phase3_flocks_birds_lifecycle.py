"""phase3 flocks birds lifecycle

Revision ID: 0003_phase3
Revises: 0002_phase2
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_phase3"
down_revision: str | None = "0002_phase2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    dob = postgresql.ENUM("exact", "estimated", "unknown", name="dob_confidence", create_type=False)
    tracking = postgresql.ENUM("batch", "individual", "mixed", name="tracking_mode", create_type=False)
    flock_status = postgresql.ENUM("active", "closed", name="flock_status", create_type=False)
    bird_status = postgresql.ENUM(
        "active", "sold", "dead", "transferred_out", "inactive", name="bird_lifecycle_status", create_type=False
    )
    life_type = postgresql.ENUM(
        "mortality",
        "sale",
        "transfer",
        "flock_closure",
        "band_assignment",
        "count_adjustment",
        "onboarding",
        name="lifecycle_event_type",
        create_type=False,
    )
    bind = op.get_bind()
    for e in (dob, tracking, flock_status, bird_status, life_type):
        e.create(bind, checkfirst=True)

    op.create_table(
        "flocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sheds.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("batch_code", sa.String(64), nullable=False),
        sa.Column("breed", sa.String(128), nullable=True),
        sa.Column("hatch_date", sa.Date(), nullable=True),
        sa.Column("estimated_age_days", sa.Integer(), nullable=True),
        sa.Column("age_reported_on", sa.Date(), nullable=True),
        sa.Column("dob_confidence", dob, nullable=False, server_default="unknown"),
        sa.Column("initial_count", sa.Integer(), nullable=False),
        sa.Column("current_count", sa.Integer(), nullable=False),
        sa.Column("banded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unbanded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tracking_mode", tracking, nullable=False),
        sa.Column("status", flock_status, nullable=False, server_default="active"),
        sa.Column("onboarded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("count_mismatch", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("owner_account_id", "batch_code", name="uq_flock_owner_batch"),
    )
    op.create_index("ix_flocks_owner_account_id", "flocks", ["owner_account_id"])
    op.create_index("ix_flocks_shed_id", "flocks", ["shed_id"])

    op.create_table(
        "birds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sheds.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("flock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("flocks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("band_id", sa.String(64), nullable=True),
        sa.Column("display_code", sa.String(64), nullable=True),
        sa.Column("hatch_date", sa.Date(), nullable=True),
        sa.Column("estimated_age_days", sa.Integer(), nullable=True),
        sa.Column("age_reported_on", sa.Date(), nullable=True),
        sa.Column("dob_confidence", dob, nullable=False, server_default="unknown"),
        sa.Column("breed", sa.String(128), nullable=True),
        sa.Column("sex", sa.String(16), nullable=True),
        sa.Column("sire_bird_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("birds.id", ondelete="SET NULL"), nullable=True),
        sa.Column("dam_bird_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("birds.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lifecycle_status", bird_status, nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_birds_owner_account_id", "birds", ["owner_account_id"])
    op.create_index("ix_birds_shed_id", "birds", ["shed_id"])
    op.create_index("ix_birds_flock_id", "birds", ["flock_id"])
    op.create_index("ix_birds_band_id", "birds", ["band_id"])
    op.execute(
        """
        CREATE UNIQUE INDEX uq_birds_active_band
        ON birds (owner_account_id, band_id)
        WHERE is_active = true AND band_id IS NOT NULL
        """
    )

    op.create_table(
        "lifecycle_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shed_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sheds.id", ondelete="SET NULL"), nullable=True),
        sa.Column("flock_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("flocks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bird_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("birds.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", life_type, nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("recorded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_lifecycle_events_owner_account_id", "lifecycle_events", ["owner_account_id"])

    for table in ("flocks", "birds", "lifecycle_events"):
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
    op.drop_table("lifecycle_events")
    op.drop_table("birds")
    op.drop_table("flocks")
    for name in (
        "lifecycle_event_type",
        "bird_lifecycle_status",
        "flock_status",
        "tracking_mode",
        "dob_confidence",
    ):
        op.execute(f"DROP TYPE IF EXISTS {name}")
