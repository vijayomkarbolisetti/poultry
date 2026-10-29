"""Disposable-DB verification for alembic revision 0010_catalogue_item_admin_fields.

Does NOT touch poultry_tracker or poultry_tracker_test.
Creates poultry_vax_migverify10, upgrades through 0010, checks new columns,
downgrades to 0009, re-upgrades, then drops DB.
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
MIG_DB = os.environ.get("VAX_MIG_DB", "poultry_vax_migverify10")

NEW_COLS = ("recommended_dose_text", "route", "diluent_instructions")


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


def _assert_columns(cur, present: bool) -> None:
    for col in NEW_COLS:
        cur.execute(
            """
            SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'vaccine_catalogue_items' AND column_name = %s
            """,
            (col,),
        )
        row = cur.fetchone()
        if present:
            assert row is not None, col
            assert row[0] == "YES", f"{col} must be nullable"
        else:
            assert row is None, col


def main() -> int:
    print(f"verify_0010: host={_PGHOST}:{_PGPORT} db={MIG_DB}")
    admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
    admin_exec(f'CREATE DATABASE "{MIG_DB}"')
    try:
        alembic_upgrade("head")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                ver = cur.fetchone()[0]
                assert ver == "0010_catalogue_item_admin_fields", ver

                _assert_columns(cur, present=True)

                # Existing example rows remain readable with null admin fields.
                cur.execute(
                    """
                    SELECT i.recommended_dose_text, i.route, i.diluent_instructions, i.instructions
                    FROM vaccine_catalogue_items i
                    JOIN vaccine_catalogues c ON c.id = i.catalogue_id
                    WHERE c.code = %s
                    LIMIT 1
                    """,
                    ("EXAMPLE_GENERAL_POULTRY",),
                )
                row = cur.fetchone()
                assert row is not None
                assert row[0] is None and row[1] is None and row[2] is None

                # Event recording columns unchanged / still present
                for col in ("dose_amount", "route"):
                    cur.execute(
                        """
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'vaccination_events' AND column_name = %s
                        """,
                        (col,),
                    )
                    assert cur.fetchone(), col

        print("upgrade+checks OK; downgrade to 0009…")
        alembic_downgrade("0009_owner_catalogues")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == "0009_owner_catalogues"
                _assert_columns(cur, present=False)
                cur.execute(
                    "SELECT code FROM vaccine_catalogues WHERE code = %s",
                    ("EXAMPLE_GENERAL_POULTRY",),
                )
                assert cur.fetchone()

        print("re-upgrade to head…")
        alembic_upgrade("head")
        with mig_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version_num FROM alembic_version")
                assert cur.fetchone()[0] == "0010_catalogue_item_admin_fields"
                _assert_columns(cur, present=True)

        print("VERIFY_0010_OK")
        return 0
    finally:
        try:
            admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}" WITH (FORCE)')
        except Exception as exc:  # noqa: BLE001
            print(f"cleanup warning: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
