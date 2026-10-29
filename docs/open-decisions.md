# Locked Product Decisions — Poultry Vaccine Tracker

**Status:** Confirmed by product owner (2026-10-14). Vaccination catalogue redesign amendments approved **2026-10-23**. Binding unless formally revised in this document.

## Confirmed stack & media (C1–C2)

| # | Topic | Decision |
|---|-------|----------|
| **C1** | Stack | React Native + Expo + TypeScript + FastAPI + SQLAlchemy 2.x + Alembic + PostgreSQL + pytest. Overrides PRD Flutter/Supabase direction. |
| **C2** | Media | **Cloudinary** for optional image/video upload, update, past versions, and delete. Private assets; credentials server-side only. Overrides Amazon S3. App must work with zero media. |

## Confirmed policy decisions (D1–D10)

| # | Topic | Locked decision |
|---|-------|-----------------|
| **D1** | “Monthly” interval | Fixed **30 days** by default. Optional calendar-month mode may be added later as an explicit schedule setting; never mix silently. |
| **D2** | On-time evaluation | Store all timestamps in **UTC**. Calculate on-time / late / due-day status using the applicable **farm-local calendar date** (farm timezone on the owner account / farm settings). Administration is on time if its farm-local calendar date is on or before the due farm-local calendar date. |
| **D3** | Grace period default | **0 days** unless a schedule rule sets an explicit grace period. Overdue starts after due date + grace. |
| **D4** | Historical unverified vaccines | Allowed with `verification_status=unverified`. Excluded from the on-time compliance **numerator**. Missing data is never treated as completed. |
| **D5** | Schedule change application | Require an explicit **selected scope** (new flocks only / selected flocks / all active) **and** an **effective date**. **Preview** affected schedules before apply. **Preserve** all completed events and full audit history. Recalculate only eligible future schedule instances. Never silently rewrite past due dates or completions. |
| **D6** | Organization Admin | Role **enabled**. Permissions are **explicitly configurable** by the owner — **not** automatic near-owner privileges. Org Admin starts with a minimal/empty grant set until the owner assigns permissions. |
| **D7** | Read-only role | **Enabled**. View permissions only; no write/correct/manage. |
| **D8** | Farmer multi-owner | **Supported** via separate `owner_membership` rows. Switching active organization changes authorized scope. |
| **D9** | Media delete | Soft-delete metadata in PostgreSQL + Cloudinary destroy when authorized. Retain audit trail. Missing media shows placeholder, never blocks workflow. |
| **D10** | Platform Super Admin farm access | **No** automatic farm data access. Explicit break-glass procedure only if added later. |

## Vaccination catalogue redesign (approved 2026-10-23)

Approach: **A** — redesign/replace vaccination UI and workflows while **extending** the existing backend (schedule engine, `scheduled_doses`, `vaccination_events`, catalogue materialization). Do not rewrite or drop core vaccination tables.

| # | Topic | Locked decision |
|---|-------|-----------------|
| **A2′** | Catalogue scope (revises plan **A2**) | Farm has a **default** catalogue via `owner_catalogue_assignments`. Flocks may set an **optional override**. Effective catalogue = flock override if set, else farm default. Farmers do not each own a catalogue; `schedule.manage` controls create/edit/assign. |
| **V1** | Catalogue provenance | Support **both** platform-provided and farm-created catalogues. |
| **V2** | Platform edit rule | Platform catalogues are **read-only** for farms. Editing requires **clone into a farm-owned catalogue**, then edit the clone. |
| **V3** | Onboarding | On **existing** flock create screen only: preselect farm default; allow override. No duplicate onboarding screen. |
| **V4** | Schedule engine | Reuse `schedule_engine` for due dates and status (upcoming / due_soon / due_today / overdue / completed_* / needs_review). |
| **V5** | Operational UX | **Tasks** remains the vaccination inbox. **One** primary recording flow (extend Confirm vaccination). |
| **V6** | Administration fields | Confirm captures administered date, vaccine identity (from definition/dose), optional manufacturer/brand, batch/lot, expiry, type/strain, route, dose amount, notes. Manufacturer/brand and strain are **optional** but stored in **structured columns**. |
| **V7** | History | Show vaccination history on bird and flock profiles using existing profile/event APIs where possible; keep PDF report. |
| **V8** | Attribution | Flock-level `birds_covered` with `bird_id` null must **not** be presented as identifying specific birds. |
| **V9** | Consolidation | One coherent catalogues experience replaces competing **Vaccination programme**, orphaned **Vaccines**, and plan-as-catalogue entry points. Do not delete tables/APIs until dependency checks pass. |
| **V10** | Safeguards | Preserve all events, corrections, completed history; keep doses ≠ events; keep D5 preview/effective-date semantics; stable idempotency; tenant isolation and catalogue ownership; no commits/PRs unless separately instructed. |

### Implementation notes (catalogue redesign)

- Day-number offset remains **A1**: `target_age_days` = days after hatch (Day 1 / hatch ⇒ `0`).
- Materialization remains: effective catalogue → tenant `vaccine_definitions` (+ versions/rules) → `scheduled_doses`.
- Estimated age continues to resolve hatch when `dob_confidence=estimated`; unknown/null hatch ⇒ `needs_review` (no invented dates).
- See `docs/VACCINE_MODULE_IMPLEMENTATION_PLAN.md` § Phase 0 for verified schema gaps and migration plan.

## Implementation notes (earlier phases)

- Phase 1 (auth, tenancy, RLS) does not encode schedule math (D1–D5); those bind Phase 4+.
- Phase 2 must implement D6 as explicit permission grants for `org_admin` (no implicit full-org write).
- Farm timezone field for D2 belongs on owner/farm settings (Phase 2+); until set, document fallback as UTC for display-equivalent calculations and flag for review if used in production without a configured timezone.
