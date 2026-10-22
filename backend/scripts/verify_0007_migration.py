"""Disposable-DB verification for alembic revision 0007_p5_cohort_idempotency.

Does NOT touch poultry_tracker or poultry_tracker_test.
Creates poultry_p5_migverify, upgrades 0001→0006, seeds rows, upgrades 0007,
checks constraints/indexes/data, exercises downgrade abort + clean downgrade,
then drops the database.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote_plus
from uuid import uuid4

import psycopg2

ROOT = Path(__file__).resolve().parents[1]

# Prefer env (PG* / P5_MIG_*), fall back to local docker-compose defaults used by conftest.
_PGHOST = os.environ.get("P5_MIG_PGHOST", os.environ.get("PGHOST", "localhost"))
_PGPORT = os.environ.get("P5_MIG_PGPORT", os.environ.get("PGPORT", "5433"))
_PGUSER = os.environ.get("P5_MIG_PGUSER", os.environ.get("PGUSER", "poultry"))
_PGPASSWORD = os.environ.get("P5_MIG_PGPASSWORD", os.environ.get("PGPASSWORD", "poultry"))
_ADMIN_DB = os.environ.get("P5_MIG_ADMIN_DB", "poultry_tracker")
MIG_DB = os.environ.get("P5_MIG_DB", "poultry_p5_migverify")


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
ASYNC_URL = f"postgresql+asyncpg://{_user_q}:{_pass_q}@{_PGHOST}:{_PGPORT}/{MIG_DB}"


def admin_exec(sql: str, params: tuple | None = None) -> None:
    """Run DDL outside a transaction (DROP/CREATE DATABASE)."""
    c = psycopg2.connect(ADMIN_DSN)
    try:
        c.autocommit = True
        with c.cursor() as cur:
            cur.execute(sql, params)
    finally:
        c.close()


def mig_conn():
    return psycopg2.connect(MIG_DSN)


def run_alembic(*args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DATABASE_URL_SYNC"] = SYNC_URL
    env["DATABASE_URL"] = ASYNC_URL
    # Fresh settings cache in child process
    env["ENVIRONMENT"] = "test"
    env["JWT_SECRET"] = env.get("JWT_SECRET", "mig-verify-secret")
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def step(msg: str) -> None:
    print(f"\n=== {msg} ===")


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    step(f"Recreate disposable database {MIG_DB}")
    admin_exec(
        """
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = %s AND pid <> pg_backend_pid()
        """,
        (MIG_DB,),
    )
    admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}"')
    admin_exec(f'CREATE DATABASE "{MIG_DB}" OWNER poultry')

    step("Alembic upgrade to 0006_perf_indexes_fk (pre-0007 chain)")
    r = run_alembic("upgrade", "0006_perf_indexes_fk")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        fail("upgrade to 0006 failed")
    print(r.stdout or "(ok)")

    owner_a = str(uuid4())
    owner_b = str(uuid4())
    user_a = str(uuid4())
    shed_a = str(uuid4())
    flock_exact_1 = str(uuid4())
    flock_est_1 = str(uuid4())
    life_1 = str(uuid4())
    life_2 = str(uuid4())

    step("Seed pre-0007 rows (owners, shed, flocks, lifecycle events)")
    with mig_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.rls_bypass', 'on', true)")
            cur.execute(
                """
                INSERT INTO users (id, email, full_name, password_hash, is_active, is_platform_super_admin)
                VALUES (%s, %s, 'Mig User', 'x', true, false)
                """,
                (user_a, f"mig-{uuid4().hex[:8]}@ex.com"),
            )
            cur.execute(
                """
                INSERT INTO owner_accounts (id, name, created_by_user_id)
                VALUES (%s, 'Mig Org A', %s), (%s, 'Mig Org B', %s)
                """,
                (owner_a, user_a, owner_b, user_a),
            )
            cur.execute(
                """
                INSERT INTO sheds (
                  id, owner_account_id, name, code, is_owner_managed, is_active
                ) VALUES (%s, %s, 'Mig Shed', 'MIG1', true, true)
                """,
                (shed_a, owner_a),
            )
            cur.execute(
                """
                INSERT INTO flocks (
                  id, owner_account_id, shed_id, batch_code, hatch_date,
                  estimated_age_days, age_reported_on, dob_confidence,
                  initial_count, current_count, banded_count, unbanded_count,
                  tracking_mode, status
                ) VALUES
                (%s, %s, %s, 'EXACT-1', CURRENT_DATE, NULL, NULL, 'exact',
                 5, 5, 0, 5, 'batch', 'active'),
                (%s, %s, %s, 'EST-1', NULL, 14, CURRENT_DATE, 'estimated',
                 3, 3, 0, 3, 'batch', 'active')
                """,
                (flock_exact_1, owner_a, shed_a, flock_est_1, owner_a, shed_a),
            )
            cur.execute(
                """
                INSERT INTO lifecycle_events (
                  id, owner_account_id, shed_id, flock_id, bird_id,
                  event_type, effective_date, quantity, reason,
                  recorded_by_user_id, idempotency_key
                ) VALUES
                (%s, %s, %s, %s, NULL, 'onboarding', CURRENT_DATE, 5, 'seed',
                 %s, 'mig-key-owner-a'),
                (%s, %s, NULL, NULL, NULL, 'onboarding', CURRENT_DATE, 1, 'seed-b',
                 %s, 'mig-key-owner-b')
                """,
                (life_1, owner_a, shed_a, flock_exact_1, user_a, life_2, owner_b, user_a),
            )
            cur.execute("SELECT COUNT(*) FROM flocks")
            flocks_before = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM lifecycle_events")
            life_before = cur.fetchone()[0]
        conn.commit()
    print(f"seeded flocks={flocks_before} lifecycle_events={life_before}")

    step("Capture pre-0007 constraint state")
    with mig_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'lifecycle_events'::regclass AND contype = 'u'
                """
            )
            pre_unique = sorted(r[0] for r in cur.fetchall())
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'lifecycle_events' AND column_name = 'idempotency_payload_hash'
                """
            )
            pre_hash = cur.fetchone()
    print(f"pre unique constraints={pre_unique} hash_col={pre_hash}")
    if "lifecycle_events_idempotency_key_key" not in pre_unique:
        fail("expected global unique constraint before 0007")
    if pre_hash is not None:
        fail("idempotency_payload_hash must not exist before 0007")

    step("Alembic upgrade to 0007_p5_cohort_idempotency")
    r = run_alembic("upgrade", "0007_p5_cohort_idempotency")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        fail("upgrade to 0007 failed")
    print(r.stdout or "(ok)")

    step("Verify post-0007 schema + data preservation")
    with mig_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.rls_bypass', 'on', true)")
            cur.execute("SELECT version_num FROM alembic_version")
            ver = cur.fetchone()[0]
            if ver != "0007_p5_cohort_idempotency":
                fail(f"unexpected alembic version {ver}")

            cur.execute(
                """
                SELECT column_name, data_type, character_maximum_length
                FROM information_schema.columns
                WHERE table_name = 'lifecycle_events' AND column_name = 'idempotency_payload_hash'
                """
            )
            hash_col = cur.fetchone()
            if not hash_col or hash_col[2] != 64:
                fail(f"bad idempotency_payload_hash column: {hash_col}")

            cur.execute(
                """
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'lifecycle_events'::regclass AND contype = 'u'
                """
            )
            post_unique = sorted(r[0] for r in cur.fetchall())
            if "lifecycle_events_idempotency_key_key" in post_unique:
                fail(f"global unique still present: {post_unique}")

            cur.execute(
                """
                SELECT indexname, indexdef FROM pg_indexes
                WHERE tablename IN ('lifecycle_events', 'flocks')
                  AND indexname IN (
                    'uq_lifecycle_owner_idempotency_key',
                    'uq_flocks_active_exact_cohort',
                    'uq_flocks_active_estimated_cohort'
                  )
                ORDER BY indexname
                """
            )
            indexes = {r[0]: r[1] for r in cur.fetchall()}
            expected = {
                "uq_lifecycle_owner_idempotency_key",
                "uq_flocks_active_exact_cohort",
                "uq_flocks_active_estimated_cohort",
            }
            if set(indexes) != expected:
                fail(f"missing indexes: {expected - set(indexes)}; got {set(indexes)}")

            defn = indexes["uq_lifecycle_owner_idempotency_key"].lower()
            if "owner_account_id" not in defn or "idempotency_key" not in defn:
                fail(f"owner-scoped index def unexpected: {indexes['uq_lifecycle_owner_idempotency_key']}")
            if "where" not in defn or "idempotency_key is not null" not in defn:
                fail(f"partial predicate missing on lifecycle index: {defn}")

            exact_def = indexes["uq_flocks_active_exact_cohort"].lower()
            if "hatch_date" not in exact_def or "dob_confidence" not in exact_def:
                fail(f"exact cohort index unexpected: {exact_def}")
            est_def = indexes["uq_flocks_active_estimated_cohort"].lower()
            if "estimated_age_days" not in est_def or "age_reported_on" not in est_def:
                fail(f"estimated cohort index unexpected: {est_def}")

            cur.execute("SELECT COUNT(*) FROM flocks")
            flocks_after = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM lifecycle_events")
            life_after = cur.fetchone()[0]
            if flocks_after != flocks_before or life_after != life_before:
                fail(
                    f"row counts changed flocks {flocks_before}->{flocks_after} "
                    f"life {life_before}->{life_after}"
                )

            # Owner-scoped uniqueness allows same key across owners.
            cur.execute(
                """
                INSERT INTO lifecycle_events (
                  id, owner_account_id, event_type, effective_date, quantity,
                  recorded_by_user_id, idempotency_key
                ) VALUES
                (%s, %s, 'onboarding', CURRENT_DATE, 1, %s, 'shared-across-owners'),
                (%s, %s, 'onboarding', CURRENT_DATE, 1, %s, 'shared-across-owners')
                """,
                (str(uuid4()), owner_a, user_a, str(uuid4()), owner_b, user_a),
            )
        conn.commit()
    print("post-0007 schema OK; data preserved; cross-owner same key allowed")

    step("Downgrade must abort while duplicate global keys exist")
    r = run_alembic("downgrade", "-1")
    if r.returncode == 0:
        print(r.stdout)
        print(r.stderr)
        fail("downgrade unexpectedly succeeded with colliding idempotency keys")
    combined = (r.stdout or "") + (r.stderr or "")
    if "Cannot downgrade 0007" not in combined and "duplicate idempotency_key" not in combined:
        print(r.stdout)
        print(r.stderr)
        fail("downgrade failed but without expected abort message")
    print("downgrade aborted as documented")

    step("Remove colliding keys, downgrade cleanly, re-upgrade")
    with mig_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.rls_bypass', 'on', true)")
            cur.execute(
                "DELETE FROM lifecycle_events WHERE idempotency_key = 'shared-across-owners'"
            )
        conn.commit()

    r = run_alembic("downgrade", "-1")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        fail("clean downgrade failed")
    print(r.stdout or "(downgrade ok)")

    with mig_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version_num FROM alembic_version")
            ver = cur.fetchone()[0]
            if ver != "0006_perf_indexes_fk":
                fail(f"expected 0006 after downgrade, got {ver}")
            cur.execute(
                """
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'lifecycle_events'::regclass
                  AND conname = 'lifecycle_events_idempotency_key_key'
                """
            )
            if cur.fetchone() is None:
                fail("global unique not restored on downgrade")
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'lifecycle_events'
                  AND column_name = 'idempotency_payload_hash'
                """
            )
            if cur.fetchone() is not None:
                fail("hash column still present after downgrade")

    r = run_alembic("upgrade", "0007_p5_cohort_idempotency")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        fail("re-upgrade to 0007 failed")
    print("re-upgrade OK")

    step(f"Drop disposable database {MIG_DB}")
    admin_exec(
        """
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = %s AND pid <> pg_backend_pid()
        """,
        (MIG_DB,),
    )
    admin_exec(f'DROP DATABASE IF EXISTS "{MIG_DB}"')

    print("\nVERIFY_0007_RESULT=PASS")


if __name__ == "__main__":
    main()
