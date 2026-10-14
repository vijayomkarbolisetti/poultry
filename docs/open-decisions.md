# Locked Product Decisions — Poultry Vaccine Tracker

**Status:** Confirmed by product owner (2026-10-14). These decisions are binding for Phases 1–8 unless formally revised in this document.

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
| **D4** | Historical unverified vaccines | Allowed with `verification_status=unverified`. Excluded from on-time compliance **numerator**. Missing data is never treated as completed. |
| **D5** | Schedule change application | Require an explicit **selected scope** (new flocks only / selected flocks / all active) **and** an **effective date**. **Preview** affected schedules before apply. **Preserve** all completed events and full audit history. Recalculate only eligible future schedule instances. Never silently rewrite past due dates or completions. |
| **D6** | Organization Admin | Role **enabled**. Permissions are **explicitly configurable** by the owner — **not** automatic near-owner privileges. Org Admin starts with a minimal/empty grant set until the owner assigns permissions. |
| **D7** | Read-only role | **Enabled**. View permissions only; no write/correct/manage. |
| **D8** | Farmer multi-owner | **Supported** via separate `owner_membership` rows. Switching active organization changes authorized scope. |
| **D9** | Media delete | Soft-delete metadata in PostgreSQL + Cloudinary destroy when authorized. Retain audit trail. Missing media shows placeholder, never blocks workflow. |
| **D10** | Platform Super Admin farm access | **No** automatic farm data access. Explicit break-glass procedure only if added later. |

## Implementation notes

- Phase 1 (auth, tenancy, RLS) does not encode schedule math (D1–D5); those bind Phase 4+.
- Phase 2 must implement D6 as explicit permission grants for `org_admin` (no implicit full-org write).
- Farm timezone field for D2 belongs on owner/farm settings (Phase 2+); until set, document fallback as UTC for display-equivalent calculations and flag for review if used in production without a configured timezone.
