"""Disposable-DB verification for alembic revision 0009_owner_catalogues.

Does NOT touch poultry_tracker or poultry_tracker_test.
Creates poultry_vax_migverify9, upgrades through 0009 (with seed data from 0008),
checks new columns/indexes/RLS, downgrades to 0008, re-upgrades, then drops DB.
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
MIG_DB = os.environ.get("VAX_MIG_DB", "poultry_vax_migverify9")


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
    print(f"verify_0009: host={_PGHOST}:{_PGPORT} db={MIG_DB}")
    admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
    admin_exec(f'CREATE DATABASE "{MIG_DB}"')
    try:
        alembic_upgrade("head")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                ver = cur.fetchone()[0]
                assert ver == "0009_owner_catalogues", ver

                # Platform seed preserved
                cur.execute(
                    "SELECT owner_account_id, code FROM vaccine_catalogues WHERE code = %s",
                    ("EXAMPLE_GENERAL_POULTRY",),
                )
                row = cur.fetchone()
                assert row and row[0] is None and row[1] == "EXAMPLE_GENERAL_POULTRY"

                for col in ("owner_account_id", "cloned_from_catalogue_id", "created_by_user_id"):
                    cur.execute(
                        """
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'vaccine_catalogues' AND column_name = %s
                        """,
                        (col,),
                    )
                    assert cur.fetchone(), col

                cur.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'flocks' AND column_name = 'vaccination_catalogue_id'
                    """
                )
                assert cur.fetchone()

                for col in ("manufacturer_or_brand", "vaccine_type_or_strain"):
                    cur.execute(
                        """
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'vaccination_events' AND column_name = %s
                        """,
                        (col,),
                    )
                    assert cur.fetchone(), col

                cur.execute(
                    """
                    SELECT indexname FROM pg_indexes
                    WHERE tablename = 'vaccine_catalogues'
                      AND indexname IN (
                        'uq_vaccine_catalogues_platform_code',
                        'uq_vaccine_catalogues_owner_code'
                      )
                    ORDER BY 1
                    """
                )
                idxs = [r[0] for r in cur.fetchall()]
                assert idxs == [
                    "uq_vaccine_catalogues_owner_code",
                    "uq_vaccine_catalogues_platform_code",
                ], idxs

                cur.execute(
                    """
                    SELECT relrowsecurity FROM pg_class WHERE relname = 'vaccine_catalogues'
                    """
                )
                assert cur.fetchone()[0] is True

                # Historical tables still present after upgrade
                for table in (
                    "vaccination_events",
                    "vaccination_corrections",
                    "scheduled_doses",
                    "owner_catalogue_assignments",
                ):
                    cur.execute("SELECT to_regclass(%s)", (table,))
                    assert cur.fetchone()[0] == table, table

        print("upgrade+checks OK; downgrade to 0008…")
        alembic_downgrade("0008_vaccine_catalogues")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == "0008_vaccine_catalogues"
                cur.execute(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'flocks' AND column_name = 'vaccination_catalogue_id'
                    """
                )
                assert cur.fetchone() is None
                cur.execute(
                    "SELECT code FROM vaccine_catalogues WHERE code = %s",
                    ("EXAMPLE_GENERAL_POULTRY",),
                )
                assert cur.fetchone()
                cur.execute("SELECT to_regclass('vaccination_events')")
                assert cur.fetchone()[0] == "vaccination_events"

        print("re-upgrade to head…")
        alembic_upgrade("head")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == "0009_owner_catalogues"
                cur.execute("SELECT count(*) FROM vaccine_catalogues")
                assert cur.fetchone()[0] >= 1

        print("VERIFY_0009_OK")
        return 0
    finally:
        try:
            admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
        except Exception as exc:  # noqa: BLE001
            print(f"cleanup warning: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
