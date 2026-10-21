"""Look up the Pilot Farm owner email from the local Postgres (dev) database."""
from __future__ import annotations

import json
from pathlib import Path

import psycopg2

FARMER = json.loads(Path(__file__).with_name("pilot-farmer.json").read_text(encoding="utf-8"))
OWNER_ID = FARMER["ownerAccountId"]

# Prefer the same DB the running API uses (port 5432 typically for dev; 5433 for tests).
CANDIDATE_URLS = [
    "postgresql://poultry:poultry@localhost:5433/poultry_tracker",
    "postgresql://poultry:poultry@localhost:5433/poultry_tracker_test",
]


def main() -> None:
    last_err = None
    for url in CANDIDATE_URLS:
        try:
            conn = psycopg2.connect(url)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            print("skip", url, exc)
            continue
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.email, u.full_name, m.role
                FROM owner_memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.owner_account_id = %s AND m.role = 'owner' AND m.is_active = true
                """,
                (OWNER_ID,),
            )
            rows = cur.fetchall()
            print("db", url, "rows", rows)
            if rows:
                email, name, role = rows[0]
                out = {
                    "ownerEmail": email,
                    "ownerPassword": "password123",
                    "ownerAccountId": OWNER_ID,
                    "shedId": FARMER["shedId"],
                    "flockId": FARMER["flockId"],
                    "shedName": FARMER.get("shedName"),
                    "fullName": name,
                    "role": role,
                    "passwordNote": "Assumed seed password password123 if login succeeds",
                }
                Path(__file__).with_name("pilot-owner.json").write_text(
                    json.dumps(out, indent=2), encoding="utf-8"
                )
                print("WROTE pilot-owner.json", email)
                return
        conn.close()
    raise SystemExit(f"Owner not found for {OWNER_ID}; last_err={last_err}")


if __name__ == "__main__":
    main()
