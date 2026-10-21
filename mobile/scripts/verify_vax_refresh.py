"""Record a vaccination via API and confirm shed overview task counts update."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8001"
OWNER = json.loads(Path(__file__).with_name("pilot-owner.json").read_text(encoding="utf-8"))


def req(method: str, path: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")


def main() -> None:
    code, login = req(
        "POST",
        "/api/v1/auth/login",
        {"email": OWNER["ownerEmail"], "password": OWNER["ownerPassword"]},
    )
    print("LOGIN", code)
    if code != 200:
        raise SystemExit(login)
    headers = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Owner-Account-Id": OWNER["ownerAccountId"],
    }

    # Ensure a vaccine + schedule exist for the pilot flock
    vcode, vaccines = req("GET", "/api/v1/vaccines", headers=headers)
    print("vaccines", vcode, len(vaccines) if isinstance(vaccines, list) else vaccines)
    if not vaccines:
        vcode, vaccine = req(
            "POST",
            "/api/v1/vaccines",
            {
                "name": "Pilot Refresh Vax",
                "rules": [
                    {
                        "dose_number": 1,
                        "target_age_days": 1,
                        "grace_period_days": 0,
                        "reminder_lead_days": 0,
                    }
                ],
            },
            headers,
        )
        print("create vaccine", vcode)
        vaccine_id = vaccine["id"]
    else:
        vaccine_id = vaccines[0]["id"]

    gcode, gen = req(
        "POST",
        "/api/v1/vaccines/generate-schedules",
        {"flock_id": OWNER["flockId"], "vaccine_definition_ids": [vaccine_id]},
        headers,
    )
    print("generate", gcode, "doses", len(gen) if isinstance(gen, list) else gen)

    ocode, before = req("GET", f"/api/v1/sheds/{OWNER['shedId']}/overview", headers=headers)
    print("overview before", ocode, before.get("vaccination") if isinstance(before, dict) else before)

    doses_code, doses = req(
        "GET",
        f"/api/v1/vaccines/scheduled-doses?shed_id={OWNER['shedId']}",
        headers=headers,
    )
    open_doses = [
        d
        for d in doses
        if d["status"] in {"overdue", "due_today", "due_soon", "upcoming", "needs_review"}
        and d["completed_count"] < d["eligible_count"]
    ]
    print("open doses", len(open_doses))
    if not open_doses:
        print("NO_OPEN_DOSE — cannot exercise record path")
        return

    dose = open_doses[0]
    remaining = max(dose["eligible_count"] - dose["completed_count"], 1)
    rcode, recorded = req(
        "POST",
        "/api/v1/vaccination-events",
        {
            "scheduled_dose_id": dose["id"],
            "birds_covered": remaining,
            "administration_date": "2026-10-18",
            "idempotency_key": f"pilot-refresh-{dose['id']}-{remaining}",
        },
        headers,
    )
    print("record", rcode, recorded if rcode >= 400 else {"id": recorded.get("id"), "birds": remaining})

    ocode2, after = req("GET", f"/api/v1/sheds/{OWNER['shedId']}/overview", headers=headers)
    print("overview after", ocode2, after.get("vaccination") if isinstance(after, dict) else after)
    print(
        "CHANGED",
        before.get("vaccination") != after.get("vaccination") if isinstance(before, dict) else False,
    )


if __name__ == "__main__":
    main()
