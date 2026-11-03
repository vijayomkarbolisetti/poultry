"""Rename General Schedule + seed Gamefowl Chick Vaccination Schedule.

Revision ID: 0012_gamefowl_catalogue
Revises: 0011_shed_capacity
Create Date: 2026-10-28

Additive + idempotent data:
- Rename EXAMPLE_GENERAL_POULTRY display name to "General Schedule" (preserve id/code/items).
- Add requires_veterinary_review on vaccine_catalogues.
- Seed platform catalogue GAMEFOWL_CHICK_0_18 with 11 reference entries (no auto-assign).

Age convention matches 0008: Day 1 (hatch) => target_age_days 0.
Age ranges use start offset + grace_period_days as inclusive due window (one task).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_gamefowl_catalogue"
down_revision: str | None = "0011_shed_capacity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATALOGUE_ID = "b1000000-0000-4000-8000-000000000001"
CODE = "GAMEFOWL_CHICK_0_18"


def upgrade() -> None:
    op.add_column(
        "vaccine_catalogues",
        sa.Column(
            "requires_veterinary_review",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )

    # Preserve code/id/items/history — display name only.
    op.execute(
        """
        UPDATE vaccine_catalogues
        SET name = 'General Schedule',
            description = 'General poultry vaccination schedule.',
            updated_at = now()
        WHERE code = 'EXAMPLE_GENERAL_POULTRY'
          AND owner_account_id IS NULL
          AND name <> 'General Schedule';
        """
    )

    # Idempotent platform seed (safe to re-run after partial apply).
    op.execute(
        f"""
        INSERT INTO vaccine_catalogues
          (id, code, name, description, version, status, is_example, requires_veterinary_review)
        SELECT
          '{CATALOGUE_ID}',
          '{CODE}',
          'Gamefowl Chick Vaccination Schedule (0–18 Weeks)',
          'Gamefowl chick vaccination schedule from day 1 through week 18.',
          1,
          'active',
          false,
          true
        WHERE NOT EXISTS (
          SELECT 1 FROM vaccine_catalogues
          WHERE code = '{CODE}' AND owner_account_id IS NULL
        );
        """
    )

    # Resolve catalogue id (fixed seed or pre-existing row with same code).
    op.execute(
        f"""
        DO $$
        DECLARE
          cat_id uuid;
        BEGIN
          SELECT id INTO cat_id
          FROM vaccine_catalogues
          WHERE code = '{CODE}' AND owner_account_id IS NULL
          LIMIT 1;

          IF cat_id IS NULL THEN
            RAISE EXCEPTION 'GAMEFOWL_CHICK_0_18 catalogue missing after insert';
          END IF;

          UPDATE vaccine_catalogues
          SET requires_veterinary_review = true,
              name = 'Gamefowl Chick Vaccination Schedule (0–18 Weeks)',
              updated_at = now()
          WHERE id = cat_id;

          -- Skip item seed if already materialized (idempotent).
          IF EXISTS (SELECT 1 FROM vaccine_catalogue_items WHERE catalogue_id = cat_id) THEN
            RETURN;
          END IF;

          INSERT INTO vaccine_catalogue_items
            (id, catalogue_id, sort_order, name, category, description, disease_label,
             instructions, recommended_dose_text, route, diluent_instructions)
          VALUES
            (
              'b1000000-0000-4000-8000-000000000011', cat_id, 1,
              'Marek''s', 'vaccine',
              'Reference entry — confirm product and hatchery protocol with a veterinarian.',
              'Marek''s',
              'Day 1 subcutaneous dose as shown on reference schedule.',
              '0.2 ml', 'Subcutaneous (S/C)', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000012', cat_id, 2,
              'IB + Lasota + ND + VVND (Killed)', 'vaccine',
              'Combined Day 6 reference entry — product composition and local availability need veterinary review.',
              'IB / ND / VVND',
              'Preserve combined label from reference; do not split without veterinary guidance.',
              '0.5 ml', 'Subcutaneous (S/C)', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000013', cat_id, 3,
              'IBD Intermediate', 'vaccine',
              'Reference ocular entry for Day 8–9 window.',
              'IBD',
              'Eye drops; due window Day 8–9 (single task).',
              'Eye drops', 'Ocular', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000014', cat_id, 4,
              'IBD Plus', 'vaccine',
              'Reference ocular entry for Day 18–19 window.',
              'IBD',
              'Eye drops; due window Day 18–19 (single task).',
              'Eye drops', 'Ocular', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000015', cat_id, 5,
              'IB + Lasota Booster', 'vaccine',
              'Reference oral/water booster at Day 31.',
              'IB / ND',
              'Dilute in drinking water per product label and veterinary guidance.',
              'Dilute in drinking water', 'Oral / Water',
              'Dilute in drinking water as directed on product label.'
            ),
            (
              'b1000000-0000-4000-8000-000000000016', cat_id, 6,
              'Fowl Pox', 'vaccine',
              'Reference lists Subcutaneous (S/C) — wing-web scarification is common for fowl pox; confirm route with a veterinarian.',
              'Fowl Pox',
              'Ambiguous route vs common practice — veterinary review required before use.',
              '0.2 ml', 'Subcutaneous (S/C)', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000017', cat_id, 7,
              'Coryza', 'vaccine',
              'Reference Coryza at Week 6–7 — confirm antigen/product with a veterinarian.',
              'Coryza',
              'Injection 0.5 ml; due window Week 6–7 (single task).',
              '0.5 ml', 'Injection', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000018', cat_id, 8,
              'IB + Lasota', 'vaccine',
              'Reference Week 10 drinking-water entry. Vial fraction is product guidance, not a universal per-bird dose.',
              'IB / ND',
              '1/2 dose from 1500-dose vial in drinking water — interpret per product insert.',
              '1/2 dose (from 1500-dose vial) in drinking water', 'Oral / Water',
              'Prepare from labelled multi-dose vial; do not treat vial fraction as a fixed per-bird volume.'
            ),
            (
              'b1000000-0000-4000-8000-000000000019', cat_id, 9,
              'Coryza', 'vaccine',
              'Second Coryza reference dose at Week 14 — confirm same product series with a veterinarian.',
              'Coryza',
              'Injection 0.5 ml at Week 14.',
              '0.5 ml', 'Injection', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000020', cat_id, 10,
              'ND + IB (Killed)', 'vaccine',
              'Reference killed ND + IB at Week 17.',
              'ND / IB',
              'Injection 0.5 ml.',
              '0.5 ml', 'Injection', NULL
            ),
            (
              'b1000000-0000-4000-8000-000000000021', cat_id, 11,
              'VVND', 'vaccine',
              'Reference Week 18 VVND — confirm strain/product and local VVND control requirements with a veterinarian.',
              'VVND',
              'Injection 0.5 ml; veterinary review required before operational use.',
              '0.5 ml', 'Injection', NULL
            );

          -- target_age_days = calendar Day N − 1 (Day 1 hatch => 0).
          -- Ranges: start offset + grace_period_days covering inclusive end day.
          INSERT INTO vaccine_catalogue_item_rules
            (id, catalogue_item_id, dose_number, target_age_days, display_day_label,
             grace_period_days, reminder_lead_days, label)
          VALUES
            ('b1000000-0000-4000-8000-000000000031',
             'b1000000-0000-4000-8000-000000000011', 1, 0, 'Day 1', 0, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000032',
             'b1000000-0000-4000-8000-000000000012', 1, 5, 'Day 6', 0, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000033',
             'b1000000-0000-4000-8000-000000000013', 1, 7, 'Day 8–9', 1, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000034',
             'b1000000-0000-4000-8000-000000000014', 1, 17, 'Day 18–19', 1, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000035',
             'b1000000-0000-4000-8000-000000000015', 1, 30, 'Day 31', 0, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000036',
             'b1000000-0000-4000-8000-000000000016', 1, 34, 'Week 5–6', 7, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000037',
             'b1000000-0000-4000-8000-000000000017', 1, 41, 'Week 6–7', 7, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000038',
             'b1000000-0000-4000-8000-000000000018', 1, 69, 'Week 10', 0, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000039',
             'b1000000-0000-4000-8000-000000000019', 1, 97, 'Week 14', 0, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000040',
             'b1000000-0000-4000-8000-000000000020', 1, 118, 'Week 17', 0, 3, 'Dose 1'),
            ('b1000000-0000-4000-8000-000000000041',
             'b1000000-0000-4000-8000-000000000021', 1, 125, 'Week 18', 0, 3, 'Dose 1');
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DELETE FROM vaccine_catalogue_item_rules
        WHERE catalogue_item_id IN (
          SELECT i.id FROM vaccine_catalogue_items i
          JOIN vaccine_catalogues c ON c.id = i.catalogue_id
          WHERE c.code = '{CODE}' AND c.owner_account_id IS NULL
        );
        DELETE FROM vaccine_catalogue_items
        WHERE catalogue_id IN (
          SELECT id FROM vaccine_catalogues
          WHERE code = '{CODE}' AND owner_account_id IS NULL
        );
        DELETE FROM vaccine_catalogues
        WHERE code = '{CODE}' AND owner_account_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM owner_catalogue_assignments a
            WHERE a.catalogue_id = vaccine_catalogues.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM vaccine_definitions d
            WHERE d.source_catalogue_item_id IN (
              SELECT i.id FROM vaccine_catalogue_items i
              WHERE i.catalogue_id = vaccine_catalogues.id
            )
          );
        """
    )
    op.execute(
        """
        UPDATE vaccine_catalogues
        SET name = 'Example general poultry programme',
            updated_at = now()
        WHERE code = 'EXAMPLE_GENERAL_POULTRY'
          AND owner_account_id IS NULL
          AND name = 'General Schedule';
        """
    )
    op.drop_column("vaccine_catalogues", "requires_veterinary_review")
