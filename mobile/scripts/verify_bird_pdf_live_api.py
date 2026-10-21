"""Hit live :8001 with a fresh bird and assert customer-ready PDF content."""

from __future__ import annotations

import json
from datetime import date
from io import BytesIO
from pathlib import Path

import fitz
from httpx import Client
from pypdf import PdfReader

BASE = "http://127.0.0.1:8002"
OUT = Path(r"D:\Vaccine-Tracker\poultry\mobile\scripts")


def main() -> None:
    stamp = "110200"
    email = f"vfy.customer.pdf.{stamp}@example.com"
    report: dict = {"steps": [], "customer_ready": {}, "stale_generator": None}

    with Client(timeout=60) as c:
        reg = c.post(
            f"{BASE}/api/v1/auth/register-owner",
            json={
                "email": email,
                "password": "password123",
                "full_name": "PDF Verify Owner",
                "organization_name": f"PDF Live Farm {stamp}",
            },
        )
        report["steps"].append({"register": reg.status_code})
        if reg.status_code not in {200, 201}:
            # already exists — login
            login = c.post(
                f"{BASE}/api/v1/auth/login",
                json={"email": email, "password": "password123"},
            )
            assert login.status_code == 200, login.text
            token = login.json()["access_token"]
        else:
            token = reg.json()["access_token"]

        me = c.get(f"{BASE}/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        owner = me.json()["memberships"][0]["owner_account_id"]
        headers = {"Authorization": f"Bearer {token}", "X-Owner-Account-Id": owner}

        shed = c.post(
            f"{BASE}/api/v1/sheds",
            headers=headers,
            json={"name": "Live PDF Shed", "code": f"L{stamp[-3:]}", "is_owner_managed": True},
        )
        assert shed.status_code == 201, shed.text
        flock = c.post(
            f"{BASE}/api/v1/flocks",
            headers=headers,
            json={
                "shed_id": shed.json()["id"],
                "batch_code": f"LB{stamp[-4:]}",
                "initial_count": 10,
                "tracking_mode": "mixed",
                "dob_confidence": "estimated",
                "estimated_age_days": 14,
                "age_reported_on": date.today().isoformat(),
                "unbanded_count": 10,
                "breed": "Layer",
            },
        )
        assert flock.status_code == 201, flock.text
        bird = c.post(
            f"{BASE}/api/v1/birds",
            headers=headers,
            json={
                "flock_id": flock.json()["id"],
                "band_id": f"LIVE-{stamp}",
                "dob_confidence": "unknown",
            },
        )
        assert bird.status_code == 201, bird.text
        bird_id = bird.json()["id"]

        vax = c.post(
            f"{BASE}/api/v1/vaccines",
            headers=headers,
            json={
                "name": "Live PDF Vax",
                "rules": [
                    {
                        "dose_number": 1,
                        "target_age_days": 1,
                        "grace_period_days": 0,
                        "reminder_lead_days": 0,
                    },
                    {
                        "dose_number": 2,
                        "target_age_days": 50,
                        "grace_period_days": 0,
                        "reminder_lead_days": 0,
                    },
                ],
            },
        )
        assert vax.status_code == 201, vax.text
        gen = c.post(
            f"{BASE}/api/v1/vaccines/generate-schedules",
            headers=headers,
            json={
                "flock_id": flock.json()["id"],
                "vaccine_definition_ids": [vax.json()["id"]],
            },
        )
        assert gen.status_code == 200, gen.text
        ind = c.post(
            f"{BASE}/api/v1/vaccination-events",
            headers=headers,
            json={
                "flock_id": flock.json()["id"],
                "bird_id": bird_id,
                "vaccine_definition_id": vax.json()["id"],
                "birds_covered": 1,
                "administration_date": date.today().isoformat(),
                "lot_number": "LIVE-LOT-1",
                "notes": "Live verify",
            },
        )
        assert ind.status_code == 201, ind.text

        pdf = c.get(
            f"{BASE}/api/v1/birds/{bird_id}/vaccination-report.pdf",
            headers=headers,
        )
        report["steps"].append(
            {
                "pdf_status": pdf.status_code,
                "ct": pdf.headers.get("content-type"),
                "cd": pdf.headers.get("content-disposition"),
                "bytes": len(pdf.content),
            }
        )
        assert pdf.status_code == 200, pdf.text
        assert pdf.content[:4] == b"%PDF"

        path = OUT / f"verify_bird_report_live_api_{stamp}.pdf"
        path.write_bytes(pdf.content)
        text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(pdf.content)).pages)

        checks = {
            "uuid_absent": bird_id not in text,
            "no_as_of": "As-of bird id" not in text,
            "no_internal_id": "Internal bird ID" not in text,
            "no_display_code": "Display code" not in text,
            "no_dob_conf": "DOB confidence" not in text,
            "no_enum": "BirdLifecycleStatus" not in text and "DobConfidence" not in text,
            "no_integrity": "Data integrity" not in text,
            "no_compliance": "compliance" not in text.lower(),
            "has_brand": "PoultryTrack" in text,
            "has_title": "Individual Bird Vaccination Report" in text,
            "has_band": f"LIVE-{stamp}" in text,
            "has_lot": "LIVE-LOT" in text,
            "has_history_heading": "Vaccination History" in text,
            "has_upcoming_heading": "Upcoming Vaccinations" in text,
            "has_batch_note": "does not confirm" in text.lower(),
            "has_active_label": "Active" in text,
            "has_page_footer": "Page" in text and "of" in text,
        }
        report["customer_ready"] = checks
        report["stale_generator"] = (
            "Data integrity" in text or "As-of bird id" in text or "Internal bird ID" in text
        )
        report["all_checks_pass"] = all(checks.values()) and not report["stale_generator"]
        report["pdf_path"] = str(path)
        report["bird_id"] = bird_id

        doc = fitz.open(stream=pdf.content, filetype="pdf")
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        png = OUT / f"verify_bird_report_live_api_{stamp}_page1.png"
        pix.save(str(png))
        report["png"] = str(png)
        doc.close()

        # Authz: unassigned farmer + cross-org
        farmer = c.post(
            f"{BASE}/api/v1/farmers",
            headers=headers,
            json={
                "email": f"vfy.customer.farmer.{stamp}@example.com",
                "password": "password123",
                "full_name": "Live Farmer",
                "role": "farmer",
                "permission_codes": ["bird.view", "shed.view", "flock.view"],
                "shed_ids": [shed.json()["id"]],
            },
        )
        report["steps"].append({"farmer_create": farmer.status_code})
        fl = c.post(
            f"{BASE}/api/v1/auth/login",
            json={
                "email": f"vfy.customer.farmer.{stamp}@example.com",
                "password": "password123",
            },
        )
        fh = {
            "Authorization": f"Bearer {fl.json()['access_token']}",
            "X-Owner-Account-Id": owner,
        }
        ok = c.get(f"{BASE}/api/v1/birds/{bird_id}/vaccination-report.pdf", headers=fh)
        report["steps"].append({"farmer_assigned_pdf": ok.status_code})

        other_shed = c.post(
            f"{BASE}/api/v1/sheds",
            headers=headers,
            json={"name": "Other", "code": f"O{stamp[-3:]}", "is_owner_managed": True},
        )
        other_flock = c.post(
            f"{BASE}/api/v1/flocks",
            headers=headers,
            json={
                "shed_id": other_shed.json()["id"],
                "batch_code": f"OX{stamp[-4:]}",
                "initial_count": 5,
                "tracking_mode": "mixed",
                "dob_confidence": "estimated",
                "estimated_age_days": 10,
                "age_reported_on": date.today().isoformat(),
                "unbanded_count": 5,
                "breed": "Layer",
            },
        )
        other_bird = c.post(
            f"{BASE}/api/v1/birds",
            headers=headers,
            json={"flock_id": other_flock.json()["id"], "band_id": f"OTHER-{stamp}"},
        )
        deny = c.get(
            f"{BASE}/api/v1/birds/{other_bird.json()['id']}/vaccination-report.pdf",
            headers=fh,
        )
        report["steps"].append({"farmer_unassigned_pdf": deny.status_code})

        other_owner = c.post(
            f"{BASE}/api/v1/auth/register-owner",
            json={
                "email": f"vfy.customer.other.{stamp}@example.com",
                "password": "password123",
                "full_name": "Other Org",
                "organization_name": f"Other Org {stamp}",
            },
        )
        ot = other_owner.json()["access_token"]
        ome = c.get(f"{BASE}/api/v1/auth/me", headers={"Authorization": f"Bearer {ot}"})
        oheaders = {
            "Authorization": f"Bearer {ot}",
            "X-Owner-Account-Id": ome.json()["memberships"][0]["owner_account_id"],
        }
        cross = c.get(
            f"{BASE}/api/v1/birds/{bird_id}/vaccination-report.pdf",
            headers=oheaders,
        )
        report["steps"].append({"cross_org_pdf": cross.status_code})

    (OUT / "bird_pdf_live_api_verification.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
