"""Disposable-DB verification for alembic revision 0008_vaccine_catalogues.

Does NOT touch poultry_tracker or poultry_tracker_test.
Creates poultry_vax_migverify, upgrades to head (through 0008), checks catalogue
tables/seed/RLS, then drops the database.
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
MIG_DB = os.environ.get("VAX_MIG_DB", "poultry_vax_migverify")


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


def main() -> int:
    print(f"verify_0008: host={_PGHOST}:{_PGPORT} db={MIG_DB}")
    admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
    admin_exec(f'CREATE DATABASE "{MIG_DB}"')
    try:
        alembic_upgrade("head")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                ver = cur.fetchone()[0]
                assert ver == "0008_vaccine_catalogues", ver

                for table in (
                    "vaccine_catalogues",
                    "vaccine_catalogue_items",
                    "vaccine_catalogue_item_rules",
                    "owner_catalogue_assignments",
                ):
                    cur.execute("SELECT to_regclass(%s)", (table,))
                    assert cur.fetchone()[0] == table, table

                cur.execute(
                    "SELECT code, is_example FROM vaccine_catalogues WHERE code = %s",
                    ("EXAMPLE_GENERAL_POULTRY",),
                )
                row = cur.fetchone()
                assert row and row[0] == "EXAMPLE_GENERAL_POULTRY" and row[1] is True

                cur.execute(
                    """
                    SELECT r.target_age_days, r.display_day_label
                    FROM vaccine_catalogue_item_rules r
                    JOIN vaccine_catalogue_items i ON i.id = r.catalogue_item_id
                    WHERE r.display_day_label LIKE 'Day 1%%'
                    """
                )
                day1 = cur.fetchone()
                assert day1 and day1[0] == 0, day1

                cur.execute(
                    """
                    SELECT relrowsecurity
                    FROM pg_class
                    WHERE relname = 'owner_catalogue_assignments'
                    """
                )
                assert cur.fetchone()[0] is True

                cur.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'vaccine_definitions'
                      AND column_name = 'source_catalogue_item_id'
                    """
                )
                assert cur.fetchone()

        print("upgrade+checks OK; exercising downgrade to 0007…")
        alembic_downgrade("0007_p5_cohort_idempotency")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == "0007_p5_cohort_idempotency"
                cur.execute("SELECT to_regclass('vaccine_catalogues')")
                assert cur.fetchone()[0] is None

        print("re-upgrade to head on existing DB…")
        alembic_upgrade("head")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == "0008_vaccine_catalogues"
                cur.execute("SELECT count(*) FROM vaccine_catalogues")
                assert cur.fetchone()[0] >= 1

        print("VERIFY_0008_OK")
        return 0
    finally:
        try:
            admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
        except Exception as exc:  # noqa: BLE001
            print(f"cleanup warning: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
