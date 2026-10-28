"""Owner-owned catalogues, flock override, administration product fields.

Revision ID: 0009_owner_catalogues
Revises: 0008_vaccine_catalogues
Create Date: 2026-10-23

Additive only. Preserves platform catalogues, assignments, doses, and events.
Downgrade removes only objects introduced here.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_owner_catalogues"
down_revision: str | None = "0008_vaccine_catalogues"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- vaccine_catalogues: ownership + clone lineage ---
    op.add_column(
        "vaccine_catalogues",
        sa.Column(
            "owner_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("owner_accounts.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "vaccine_catalogues",
        sa.Column(
            "cloned_from_catalogue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaccine_catalogues.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "vaccine_catalogues",
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_vaccine_catalogues_owner_account_id",
        "vaccine_catalogues",
        ["owner_account_id"],
    )
    op.create_index(
        "ix_vaccine_catalogues_cloned_from",
        "vaccine_catalogues",
        ["cloned_from_catalogue_id"],
    )

    # Replace global code unique with NULL-safe partial uniques.
    op.drop_constraint("uq_vaccine_catalogues_code", "vaccine_catalogues", type_="unique")
    op.create_index(
        "uq_vaccine_catalogues_platform_code",
        "vaccine_catalogues",
        ["code"],
        unique=True,
        postgresql_where=sa.text("owner_account_id IS NULL"),
    )
    op.create_index(
        "uq_vaccine_catalogues_owner_code",
        "vaccine_catalogues",
        ["owner_account_id", "code"],
        unique=True,
        postgresql_where=sa.text("owner_account_id IS NOT NULL"),
    )

    # RLS: platform rows readable; farm-owned rows tenant-scoped.
    op.execute("ALTER TABLE vaccine_catalogues ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE vaccine_catalogues FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY vaccine_catalogues_tenant ON vaccine_catalogues
          FOR ALL TO PUBLIC
          USING (
            current_setting('app.rls_bypass', true) = 'on'
            OR owner_account_id IS NULL
            OR owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
          )
          WITH CHECK (
            current_setting('app.rls_bypass', true) = 'on'
            OR (
              owner_account_id IS NOT NULL
              AND owner_account_id::text = NULLIF(current_setting('app.current_owner_id', true), '')
            )
          )
        """
    )

    # --- flocks: optional catalogue override ---
    op.add_column(
        "flocks",
        sa.Column(
            "vaccination_catalogue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vaccine_catalogues.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_flocks_vaccination_catalogue_id",
        "flocks",
        ["owner_account_id", "vaccination_catalogue_id"],
    )

    # --- vaccination_events: structured optional product fields ---
    op.add_column(
        "vaccination_events",
        sa.Column("manufacturer_or_brand", sa.String(128), nullable=True),
    )
    op.add_column(
        "vaccination_events",
        sa.Column("vaccine_type_or_strain", sa.String(128), nullable=True),
    )

    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON vaccine_catalogues TO app_user;
            GRANT SELECT, INSERT, UPDATE, DELETE ON vaccine_catalogue_items TO app_user;
            GRANT SELECT, INSERT, UPDATE, DELETE ON vaccine_catalogue_item_rules TO app_user;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_column("vaccination_events", "vaccine_type_or_strain")
    op.drop_column("vaccination_events", "manufacturer_or_brand")

    op.drop_index("ix_flocks_vaccination_catalogue_id", table_name="flocks")
    op.drop_column("flocks", "vaccination_catalogue_id")

    op.execute("DROP POLICY IF EXISTS vaccine_catalogues_tenant ON vaccine_catalogues")
    op.execute("ALTER TABLE vaccine_catalogues NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE vaccine_catalogues DISABLE ROW LEVEL SECURITY")

    op.drop_index("uq_vaccine_catalogues_owner_code", table_name="vaccine_catalogues")
    op.drop_index("uq_vaccine_catalogues_platform_code", table_name="vaccine_catalogues")
    op.create_unique_constraint("uq_vaccine_catalogues_code", "vaccine_catalogues", ["code"])

    op.drop_index("ix_vaccine_catalogues_cloned_from", table_name="vaccine_catalogues")
    op.drop_index("ix_vaccine_catalogues_owner_account_id", table_name="vaccine_catalogues")
    op.drop_column("vaccine_catalogues", "created_by_user_id")
    op.drop_column("vaccine_catalogues", "cloned_from_catalogue_id")
    op.drop_column("vaccine_catalogues", "owner_account_id")

    # Restore SELECT-only grants for platform catalogue tables (0008 posture).
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
            REVOKE INSERT, UPDATE, DELETE ON vaccine_catalogues FROM app_user;
            REVOKE INSERT, UPDATE, DELETE ON vaccine_catalogue_items FROM app_user;
            REVOKE INSERT, UPDATE, DELETE ON vaccine_catalogue_item_rules FROM app_user;
            GRANT SELECT ON vaccine_catalogues, vaccine_catalogue_items, vaccine_catalogue_item_rules TO app_user;
          END IF;
        END $$;
        """
    )
