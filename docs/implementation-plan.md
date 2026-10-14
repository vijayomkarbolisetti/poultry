# Implementation Plan — Poultry Vaccine Tracker

## Source of truth

- Product requirements: `poultry_vaccine_tracker_requirements.md` (copied from Downloads)
- Stack override (user mandate, supersedes PRD Flutter/Supabase section):
  - Mobile: React Native + Expo + TypeScript (strict) + Expo Router + TanStack Query + RHF/Zod
  - Backend: FastAPI + SQLAlchemy 2.x + Alembic + PostgreSQL + pytest
  - Media: **Cloudinary** (upload / update / past versions / delete) instead of Amazon S3
- Architecture: modular monolith, single shared DB with logical tenant isolation + PostgreSQL RLS

## Decisions locked (C1–C2, D1–D10)

Authoritative detail: `docs/open-decisions.md` (confirmed 2026-10-14).

| Topic | Decision |
|-------|----------|
| Stack (C1) | RN/Expo + FastAPI + PostgreSQL (not Flutter/Supabase) |
| Media (C2) | Cloudinary private uploads; optional; upload/update/past/delete |
| Tenancy | Shared DB, `owner_account_id` on tenant tables, RLS enforced |
| Auth | Email/password, bcrypt, JWT access + rotating refresh tokens |
| Monthly (D1) | Fixed **30 days** default; optional calendar-month later |
| On-time (D2) | Store UTC; evaluate on **farm-local calendar date** |
| Grace (D3) | Default **0 days** unless rule sets grace |
| Unverified (D4) | Allowed; excluded from on-time compliance numerator |
| Schedule edits (D5) | Require selected scope + effective date + preview; preserve completions/audit |
| Org Admin (D6) | Enabled; **explicit configurable permissions only** (not near-owner by default) |
| Read-only (D7) | Enabled |
| Farmer multi-org (D8) | Supported; active org switch changes scope |
| Media delete (D9) | Soft-delete metadata + Cloudinary destroy; keep audit |
| Super Admin (D10) | No automatic farm data access |
| Band uniqueness | Unique active band ID **per owner** |

## Phases

### Phase 1 — Foundation (done)
Repository, Docker Compose PostgreSQL, Alembic, users, owner accounts, memberships, JWT auth, RLS, isolation tests.

### Phase 2 — Farmers, sheds, permissions, dashboards (done)
Farmer onboarding, shed CRUD, shed memberships, permission grants, owner/farmer dashboard from live aggregates, Expo UI flows.

### Phase 3 — Flocks, birds, onboarding, bulk CSV, lifecycle, counts (done)
Tracking modes, DOB confidence, bulk band import, mortality/sale/transfer, count reconciliation, Expo flock screens.

### Phase 4 — Vaccine catalogue + schedule engine (done)
Versioned definitions/rules, generation for any-age onboarding, status calculations + unit tests.

### Phase 5 — Vaccination events, corrections, audit (done)
Individual/bulk recording, partial coverage, idempotency, void/correct with audit.

### Phase 6 — Alerts, reports, filters, aggregations (done)
In-app notifications, job docs, compliance reports, live dashboard dose metrics.

### Phase 7 — Cloudinary media (done)
Signed uploads (when configured), version history, soft-delete + destroy, works without Cloudinary.

### Phase 8 — Hardening, deploy, Android release prep (done)
Backup/restore docs, jobs docs, emulator setup docs, full automated test suite.

## Phase exit criteria (every phase)

1. Automated tests pass (including negative isolation tests where relevant)
2. Lint/typecheck clean for touched packages
3. Migrations apply cleanly on empty DB
4. Docs updated
5. Report: completed features, files, test results, limitations, next phase
6. No mock/hardcoded production dashboard values

## Phase 1 deliverables checklist

- [x] Docs: architecture, schema, permissions, security, deployment, plan
- [x] Backend app skeleton + settings
- [x] Models: User, OwnerAccount, OwnerMembership, RefreshToken, AuditLog (minimal)
- [x] Auth register/login/refresh/logout/me
- [x] RLS policies + session context helpers
- [x] pytest isolation suite (API + non-superuser RLS)
- [x] docker-compose + `.env.example` + README
