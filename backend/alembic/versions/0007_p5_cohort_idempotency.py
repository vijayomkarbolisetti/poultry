"""P5: owner-scoped lifecycle idempotency + active cohort uniqueness.

Revision ID: 0007_p5_cohort_idempotency
Revises: 0006_perf_indexes_fk
Create Date: 2026-10-22

IMPORTANT: Before upgrading, run backend/scripts/p5_cohort_preflight.sql against the
target database. Do not auto-merge or close conflicting cohorts.

Constraint/index names (must match SQLAlchemy models):
  - Drop: lifecycle_events_idempotency_key_key (global UNIQUE from 0003)
  - Add:  uq_lifecycle_owner_idempotency_key (partial UNIQUE)
  - Add:  uq_flocks_active_exact_cohort / uq_flocks_active_estimated_cohort
  - Add column: lifecycle_events.idempotency_payload_hash VARCHAR(64)

Downgrade recreates the global unique only if no duplicate idempotency_key values exist.
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_p5_cohort_idempotency"
down_revision = "0006_perf_indexes_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lifecycle_events",
        sa.Column("idempotency_payload_hash", sa.String(length=64), nullable=True),
    )

    # Replace global unique(idempotency_key) with owner-scoped partial unique.
    op.drop_constraint("lifecycle_events_idempotency_key_key", "lifecycle_events", type_="unique")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_lifecycle_owner_idempotency_key
        ON lifecycle_events (owner_account_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX uq_flocks_active_exact_cohort
        ON flocks (owner_account_id, shed_id, hatch_date)
        WHERE status = 'active'
          AND dob_confidence = 'exact'
          AND hatch_date IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_flocks_active_estimated_cohort
        ON flocks (owner_account_id, shed_id, estimated_age_days, age_reported_on)
        WHERE status = 'active'
          AND dob_confidence = 'estimated'
          AND estimated_age_days IS NOT NULL
          AND age_reported_on IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_flocks_active_estimated_cohort")
    op.execute("DROP INDEX IF EXISTS uq_flocks_active_exact_cohort")
    op.execute("DROP INDEX IF EXISTS uq_lifecycle_owner_idempotency_key")

    # Global unique(idempotency_key) cannot be restored if the same key was reused
    # across owners under the owner-scoped index. Abort rather than silently failing.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM lifecycle_events
            WHERE idempotency_key IS NOT NULL
            GROUP BY idempotency_key
            HAVING COUNT(*) > 1
          ) THEN
            RAISE EXCEPTION
              'Cannot downgrade 0007: duplicate idempotency_key values exist (owner-scoped keys collide under global unique)';
          END IF;
        END $$;
        """
    )
    op.create_unique_constraint(
        "lifecycle_events_idempotency_key_key",
        "lifecycle_events",
        ["idempotency_key"],
    )
    op.drop_column("lifecycle_events", "idempotency_payload_hash")
