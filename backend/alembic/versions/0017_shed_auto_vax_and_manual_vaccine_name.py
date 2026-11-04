"""Shed auto vaccination schedules setting + manual vaccine name on events.

Revision ID: 0017_shed_auto_vax_manual_name
Revises: 0016_catalogue_item_is_active
Create Date: 2026-11-03

- sheds.auto_vaccination_schedules_enabled (default true) gates automatic schedule generation
- vaccination_events.vaccine_definition_id becomes nullable for custom/manual vaccines
- vaccination_events.custom_vaccine_name stores free-text vaccine names without catalogue entries
- Check: at least one of vaccine_definition_id or custom_vaccine_name must be present
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_shed_auto_vax_manual_name"
down_revision: str | None = "0016_catalogue_item_is_active"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sheds",
        sa.Column(
            "auto_vaccination_schedules_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )

    op.add_column(
        "vaccination_events",
        sa.Column("custom_vaccine_name", sa.String(length=255), nullable=True),
    )
    op.alter_column(
        "vaccination_events",
        "vaccine_definition_id",
        existing_type=sa.UUID(),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_vaccination_events_vaccine_identity",
        "vaccination_events",
        "vaccine_definition_id IS NOT NULL OR custom_vaccine_name IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_vaccination_events_vaccine_identity",
        "vaccination_events",
        type_="check",
    )
    # Restore NOT NULL only when every row has a definition id (manual rows must be resolved first).
    op.execute(
        """
        UPDATE vaccination_events
        SET custom_vaccine_name = NULL
        WHERE vaccine_definition_id IS NOT NULL
        """
    )
    op.alter_column(
        "vaccination_events",
        "vaccine_definition_id",
        existing_type=sa.UUID(),
        nullable=False,
    )
    op.drop_column("vaccination_events", "custom_vaccine_name")
    op.drop_column("sheds", "auto_vaccination_schedules_enabled")
