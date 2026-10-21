# Shed Overview & Birds Management Redesign Report

**Date:** 2026-10-20 (Birds 9-screen redesign + QA)  
**Commit/push:** Not performed (per instructions)

---

## Verdict

Birds management UI redesigned to the 9-screen reference and wired to live APIs. Backend **100 pytest passed**. Mobile `tsc --noEmit` **PASS**. Preview APK build started for this change set (see Build section).

Physical-device walkthrough: **NOT RUN**.

---

## Schema reconciliation (no new migration)

| Topic | Decision |
|-------|----------|
| Banded bird DOB | Existing `birds.hatch_date` / `estimated_age_days` / `dob_confidence` |
| Unbanded cohort DOB | Existing `flocks` age fields (same columns) |
| Unknown age | Explicitly allowed for **unbanded cohorts** (`dob_confidence=unknown`) — documented exception |
| Approximate ages | Stored as `estimated` + `estimated_age_days` — **never** invented as exact hatch dates |
| Multiple DOB cohorts | Create a **new group** (flock) — do not mix ages on one headcount |
| Unbanded → banded | New atomic `POST /birds/band-from-unbanded` (idempotent) |

No tables dropped; no applied migrations rewritten.

---

## Screens (reference 1–9)

| # | Screen | Status |
|---|--------|--------|
| 1 | Birds list (identity, metrics, search, filter icon, rows, + Add birds) | **PASS** (implemented) |
| 2 | Add birds bottom sheet (Register banded / Add unbanded count) | **PASS** |
| 3 | Register banded bird (group, band, required DOB, save / save & another) | **PASS** |
| 4 | Add unbanded count (group, count, age chips incl. Unknown) | **PASS** |
| 5 | Paginated list (20/page, load more) | **PASS** |
| 6 | Search by band (debounced, clear) | **PASS** |
| 7 | Filters sheet (group + status; draft Apply/Reset) | **PASS** |
| 8 | Empty state | **PASS** |
| 9 | Bird details (change band, mortality, transfer) | **PASS** |

Removed duplicate **Register band** / **Tag bird** from the list header. Selection mode remains for bulk mortality / bulk transfer.

---

## Backend API

| Endpoint | Change |
|----------|--------|
| `POST /birds` | DOB validation: exact/estimated required fields; future hatch rejected; unknown only when converting/inheriting flock age |
| `POST /birds/band-from-unbanded` | **New** — atomic conversion; idempotency key; population unchanged |
| `POST /lifecycle-events/transfer-to-shed` | Unchanged (live shed moves) |
| `PATCH /flocks/{id}` `add_unbanded` | Unchanged |

---

## Population integrity

- Banded + unbanded = live for mixed groups (existing reconcile).
- Band-from-unbanded: unbanded −1, banded +1, **current unchanged**.
- Mortality / count mortality / shed transfer: existing services + tests.

---

## Tests

| Check | Result |
|-------|--------|
| Full `pytest app/tests` | **PASS — 100 passed** |
| New `test_birds_management_dob.py` | DOB required, future DOB, estimated/exact, band-from-unbanded + idempotency + zero unbanded + duplicate band |
| `npx tsc --noEmit` | **PASS** |
| Emulator screenshots (this pass) | **NOT RUN** (implementation-focused; prior QA screenshots still under `docs/qa-screenshots/`) |
| Physical device | **NOT RUN** |

---

## Key mobile files

- `app/(app)/sheds/[id]/birds.tsx` — redesigned list
- `components/birds/BirdsFilterSheet.tsx` — new
- `components/birds/AddBirdsSheet.tsx` — copy aligned to reference
- `app/(app)/birds/add.tsx` — mandatory DOB
- `app/(app)/birds/add-unbanded.tsx` — unbanded count
- `app/(app)/birds/band-from-unbanded.tsx` — conversion UI
- `app/(app)/birds/[id].tsx` — profile actions matching reference
- `theme/birdManagementUi.ts` — reference tokens

---

## Build (EAS preview)

| Field | Value |
|-------|--------|
| Status | **FINISHED** |
| Build ID | `5b0e69f1-3f52-45ec-8b17-2bb148408264` |
| Profile | `preview` (APK) |
| API URL in profile | `https://3.6.160.64.sslip.io` |
| Expo page | https://expo.dev/accounts/gopimaganti/projects/poultry-vaccine-tracker/builds/5b0e69f1-3f52-45ec-8b17-2bb148408264 |
| Direct APK | https://expo.dev/artifacts/eas/O-U8Up8ctaEJ8yA8r9NyQ7Pufv9g4qbV9i3K2KmeuWw.apk |
| Local path | `mobile/builds/poultrytrack-birds-mgmt-5b0e69f1.apk` (~99 MB) |

```powershell
adb devices
adb -s SERIAL install -r "D:\Vaccine-Tracker\poultry\mobile\builds\poultrytrack-birds-mgmt-5b0e69f1.apk"
adb -s SERIAL shell am start -n com.vijayomkar.poultrytracker/.MainActivity
```

---

## Outstanding

1. Physical device QA **NOT RUN**.
2. Preview APK uses production API URL — **blocked for new builds** until `https://3.6.160.64.sslip.io` OpenAPI includes shed-centric bird routes (see `BIRD_MANAGEMENT_IMPLEMENTATION_STATUS.md`).
3. Login marketing copy / Home / Sheds list were not redesigned in this pass (out of scope).
4. No commit/push.

### Follow-up (2026-10-20 verification)

- Local backend + mobile shed-centric flows: **VERIFIED** (pytest 104, local smoke, tsc, helpers).
- Concurrent band-from-unbanded oversubscription: **FIXED** (`FOR UPDATE` on flock).
- New preview APK: **NOT BUILT** (deploy alignment still failed).
