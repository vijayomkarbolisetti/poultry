"""Disposable-DB verification for alembic revision 0012_gamefowl_catalogue.

Does NOT touch poultry_tracker or poultry_tracker_test.
Creates poultry_vax_migverify12, upgrades through 0012, checks rename + seed,
downgrades to 0011, re-upgrades (idempotent), then drops DB.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote_plus

import psycopg2

ROOT = Path(__file__).resolve().parents[1]

_PGHOST = os.environ.get("VAX_MIG_PGHOST", os.environ.get("PGHOST", "localhost"))
_PGPORT = os.environ.get("VAX_MIG_PGPORT", os.environ.get("PGPORT", "5433"))
_PGUSER = os.environ.get("VAX_MIG_PGUSER", os.environ.get("PGUSER", "poultry"))
_PGPASSWORD = os.environ.get("VAX_MIG_PGPASSWORD", os.environ.get("PGPASSWORD", "poultry"))
_ADMIN_DB = os.environ.get("VAX_MIG_ADMIN_DB", "poultry_tracker")
MIG_DB = os.environ.get("VAX_MIG_DB", "poultry_vax_migverify12")

REV = "0012_gamefowl_catalogue"
PREV = "0011_shed_capacity"


def _libpq_dsn(dbname: str) -> str:
    return (
        f"dbname={dbname} user={_PGUSER} password={_PGPASSWORD} "
        f"host={_PGHOST} port={_PGPORT}"
    )


ADMIN_DSN = _libpq_dsn(_ADMIN_DB)
MIG_DSN = _libpq_dsn(MIG_DB)
_user_q = quote_plus(_PGUSER)
_pass_q = quote_plus(_PGPASSWORD)
SYNC_URL = f"postgresql+psycopg2://{_user_q}:{_pass_q}@{_PGHOST}:{_PGPORT}/{MIG_DB}"


def admin_exec(sql: str, params: tuple | None = None) -> None:
    c = psycopg2.connect(ADMIN_DSN)
    try:
        c.autocommit = True
        with c.cursor() as cur:
            cur.execute(sql, params)
    finally:
        c.close()


def mig_conn():
    return psycopg2.connect(MIG_DSN)


def alembic_upgrade(rev: str = "head") -> None:
    env = os.environ.copy()
    env["DATABASE_URL_SYNC"] = SYNC_URL
    env["DATABASE_URL"] = SYNC_URL.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    subprocess.check_call(
        [sys.executable, "-m", "alembic", "upgrade", rev],
        cwd=str(ROOT),
        env=env,
    )


def alembic_downgrade(rev: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL_SYNC"] = SYNC_URL
    env["DATABASE_URL"] = SYNC_URL.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    subprocess.check_call(
        [sys.executable, "-m", "alembic", "downgrade", rev],
        cwd=str(ROOT),
        env=env,
    )


def _assert_seed(cur) -> None:
    cur.execute(
        """
        SELECT name, requires_veterinary_review, is_example
        FROM vaccine_catalogues
        WHERE code = 'EXAMPLE_GENERAL_POULTRY' AND owner_account_id IS NULL
        """
    )
    row = cur.fetchone()
    assert row is not None
    assert row[0] == "General Schedule", row
    assert row[1] is False
    assert row[2] is True  # still example at 0012; cleared in 0013

    cur.execute(
        """
        SELECT name, requires_veterinary_review, is_example
        FROM vaccine_catalogues
        WHERE code = 'GAMEFOWL_CHICK_0_18' AND owner_account_id IS NULL
        """
    )
    gf = cur.fetchone()
    assert gf is not None
    assert gf[0] == "Gamefowl Chick Vaccination Schedule (0–18 Weeks)"
    assert gf[1] is True
    assert gf[2] is False

    cur.execute(
        """
        SELECT COUNT(*) FROM vaccine_catalogue_items i
        JOIN vaccine_catalogues c ON c.id = i.catalogue_id
        WHERE c.code = 'GAMEFOWL_CHICK_0_18' AND c.owner_account_id IS NULL
        """
    )
    assert cur.fetchone()[0] == 11

    cur.execute(
        """
        SELECT COUNT(*) FROM vaccine_catalogue_item_rules r
        JOIN vaccine_catalogue_items i ON i.id = r.catalogue_item_id
        JOIN vaccine_catalogues c ON c.id = i.catalogue_id
        WHERE c.code = 'GAMEFOWL_CHICK_0_18' AND c.owner_account_id IS NULL
        """
    )
    assert cur.fetchone()[0] == 11

    cur.execute(
        """
        SELECT r.target_age_days, r.grace_period_days, r.display_day_label, i.name,
               i.recommended_dose_text, i.route
        FROM vaccine_catalogue_item_rules r
        JOIN vaccine_catalogue_items i ON i.id = r.catalogue_item_id
        JOIN vaccine_catalogues c ON c.id = i.catalogue_id
        WHERE c.code = 'GAMEFOWL_CHICK_0_18' AND c.owner_account_id IS NULL
        ORDER BY r.target_age_days, i.sort_order
        """
    )
    rows = cur.fetchall()
    assert rows[0][:3] == (0, 0, "Day 1")
    assert rows[0][3] == "Marek's"
    assert rows[2][:3] == (7, 1, "Day 8–9")
    assert rows[5][:3] == (34, 7, "Week 5–6")
    assert rows[-1][:3] == (125, 0, "Week 18")
    assert rows[-1][3] == "VVND"


def main() -> int:
    print(f"verify_0012: host={_PGHOST}:{_PGPORT} db={MIG_DB}")
    admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
    admin_exec(f'CREATE DATABASE "{MIG_DB}"')
    try:
        alembic_upgrade(REV)
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == REV
                cur.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'vaccine_catalogues'
                      AND column_name = 'requires_veterinary_review'
                    """
                )
                assert cur.fetchone()
                _assert_seed(cur)

        print("upgrade+checks OK; downgrade to 0011…")
        alembic_downgrade(PREV)
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == PREV
                cur.execute(
                    "SELECT name FROM vaccine_catalogues WHERE code = 'EXAMPLE_GENERAL_POULTRY'"
                )
                assert cur.fetchone()[0] == "Example general poultry programme"
                cur.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'vaccine_catalogues'
                      AND column_name = 'requires_veterinary_review'
                    """
                )
                assert cur.fetchone() is None

        print("re-upgrade (idempotent)…")
        alembic_upgrade(REV)
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == REV
                _assert_seed(cur)
                # Second upgrade path already applied — re-run SQL seed block via upgrade no-op.
                # Count must stay at 11.
                cur.execute(
                    """
                    SELECT COUNT(*) FROM vaccine_catalogues
                    WHERE code = 'GAMEFOWL_CHICK_0_18' AND owner_account_id IS NULL
                    """
                )
                assert cur.fetchone()[0] == 1

        print("VERIFY_0012_OK")
        return 0
    finally:
        try:
            admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
        except Exception as exc:  # noqa: BLE001
            print(f"cleanup warning: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
