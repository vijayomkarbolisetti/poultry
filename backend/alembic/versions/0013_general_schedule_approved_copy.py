"""Clean General Schedule user-facing copy (approved / experimented).

Revision ID: 0013_general_schedule_copy
Revises: 0012_gamefowl_catalogue
Create Date: 2026-10-28

- Mark General Schedule as non-example (approved & field-experimented).
- Remove "not approved" / illustrative / technical offset wording from
  catalogue descriptions shown in the app.
- Soften Gamefowl catalogue description (no target_age / grace jargon).
Does not change schedule rules, codes, IDs, or farm assignments.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013_general_schedule_copy"
down_revision: str | None = "0012_gamefowl_catalogue"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE vaccine_catalogues
        SET name = 'General Schedule',
            is_example = false,
            requires_veterinary_review = false,
            description = 'General poultry vaccination schedule.',
            updated_at = now()
        WHERE code = 'EXAMPLE_GENERAL_POULTRY'
          AND owner_account_id IS NULL;

        UPDATE vaccine_catalogue_items i
        SET name = 'IBD',
            description = NULL,
            disease_label = 'IBD',
            instructions = NULL
        FROM vaccine_catalogues c
        WHERE i.catalogue_id = c.id
          AND c.code = 'EXAMPLE_GENERAL_POULTRY'
          AND c.owner_account_id IS NULL
          AND i.sort_order = 1;

        UPDATE vaccine_catalogue_items i
        SET name = 'ND',
            description = NULL,
            disease_label = 'ND',
            instructions = NULL
        FROM vaccine_catalogues c
        WHERE i.catalogue_id = c.id
          AND c.code = 'EXAMPLE_GENERAL_POULTRY'
          AND c.owner_account_id IS NULL
          AND i.sort_order = 2;

        UPDATE vaccine_catalogues
        SET description = 'Gamefowl chick vaccination schedule from day 1 through week 18.',
            updated_at = now()
        WHERE code = 'GAMEFOWL_CHICK_0_18'
          AND owner_account_id IS NULL;

        -- Drop long technical / disclaimer item blurbs; keep dose/route/rules intact.
        UPDATE vaccine_catalogue_items i
        SET description = NULL,
            instructions = NULL
        FROM vaccine_catalogues c
        WHERE i.catalogue_id = c.id
          AND c.code = 'GAMEFOWL_CHICK_0_18'
          AND c.owner_account_id IS NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE vaccine_catalogues
        SET is_example = true,
            description = 'Illustrative general poultry template — not a veterinarian-approved schedule. '
                          'Day labels map to elapsed-day offsets (Day 1 = hatch = target_age_days 0).',
            updated_at = now()
        WHERE code = 'EXAMPLE_GENERAL_POULTRY'
          AND owner_account_id IS NULL;

        UPDATE vaccine_catalogue_items i
        SET name = 'Example IBD (illustrative)',
            description = 'Illustrative IBD-style entry for QA only.',
            disease_label = 'IBD (example)'
        FROM vaccine_catalogues c
        WHERE i.catalogue_id = c.id
          AND c.code = 'EXAMPLE_GENERAL_POULTRY'
          AND c.owner_account_id IS NULL
          AND i.sort_order = 1;

        UPDATE vaccine_catalogue_items i
        SET name = 'Example ND (illustrative)',
            description = 'Illustrative ND-style entry for QA only.',
            disease_label = 'ND (example)'
        FROM vaccine_catalogues c
        WHERE i.catalogue_id = c.id
          AND c.code = 'EXAMPLE_GENERAL_POULTRY'
          AND c.owner_account_id IS NULL
          AND i.sort_order = 2;
        """
    )
