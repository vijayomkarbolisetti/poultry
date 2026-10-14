# Architecture — Poultry Vaccine Tracker

## Overview

```
Expo (React Native)  --HTTPS/JSON-->  FastAPI (/api/v1)  -->  PostgreSQL (+ RLS)
                                              |
                                              +--> Cloudinary (optional media)
                                              +--> Background jobs (reminders)
```

Modular monolith: one deployable API owns auth, authorization, vaccination math, audit, and media signing.

## Layers (backend)

| Layer | Responsibility |
|-------|----------------|
| `api/v1` | HTTP routers, dependency wiring, status codes |
| `schemas` | Pydantic request/response validation |
| `services` | Business rules (auth, schedules, vaccinations) |
| `repositories` | SQLAlchemy queries |
| `authorization` | Permission checks + active membership resolution |
| `models` | ORM + table metadata |
| `jobs` | Reminder generation / alert recomputation |
| `core` | Config, security, DB session, RLS context |

Business logic does **not** live only in route handlers.

## Multi-tenancy

- One PostgreSQL database.
- `owner_accounts` is the tenant root.
- Tenant-owned rows carry `owner_account_id` (directly or via FK chain).
- Request path: authenticate JWT → resolve membership → set DB session GUC `app.current_owner_id` / `app.current_user_id` / `app.role` inside the **same transaction** as queries.
- Application DB role has no `BYPASSRLS`. Migrations use a separate admin role.
- Client-supplied `owner_id` is never trusted for authorization.

## Authentication

- Password: bcrypt (passlib/bcrypt).
- Access token: short-lived JWT (sub=user_id, typ=access).
- Refresh token: opaque random value, hashed at rest, rotatable/revocable.
- Mobile: Expo SecureStore for tokens.
- Deactivated users/memberships cannot obtain or refresh tokens.

## Authorization

1. Platform Super Admin: platform ops only — **no** automatic farm data access (D10).
2. Owner: full org scope.
3. Org Admin: org-wide **only** for permissions explicitly granted (D6 — not near-owner by default).
4. Farmer: shed-scoped via `shed_memberships` + granted permissions; multi-org via memberships (D8).
5. Read-only: view permissions only (D7).

Permission codes are stored in DB (`permissions`, `membership_permissions`). UI hides actions but API enforces.

## Media (Cloudinary)

- Optional. All workflows work with zero media.
- Backend holds Cloudinary API credentials.
- Client requests signed upload params; uploads go to Cloudinary.
- PostgreSQL stores `public_id`, `resource_type`, `version`, `format`, ownership FKs.
- Update = new version (Cloudinary versioning) + metadata update.
- Past = list versions / previous metadata rows.
- Delete = Cloudinary destroy + soft-delete metadata (audit retained).
- Access checked against owner/shed before any signed URL or destroy.

## Schedule engine (later phases)

Central service in `services/schedule_engine.py`:

- Inputs: hatch/estimated age, schedule versions, events, lifecycle, farm timezone.
- Outputs: scheduled doses + status enum.
- Timestamps stored in **UTC**; on-time / due-day / late use **farm-local calendar dates** (D2).
- Monthly default = fixed 30 days (D1); grace default 0 days (D3).
- Schedule changes require selected scope + effective date + preview; never rewrite completed events (D5).
- Pure functions unit-tested for leap years, farm TZ boundaries, grace, late completion, inactive flocks.

## API surface

Versioned under `/api/v1`. OpenAPI via FastAPI `/docs`. Consistent error envelope:

```json
{ "detail": "...", "code": "FORBIDDEN", "request_id": "..." }
```

## Mobile structure

Feature folders under `mobile/src/features/*` with TanStack Query hooks calling typed API clients. Navigation via Expo Router; screens permission-aware but not security-critical.

## Non-goals (v1)

- Per-owner physical databases
- Microservices
- Firebase/Supabase
- Public media buckets
- Hardcoded vaccine schedules presented as medical advice
