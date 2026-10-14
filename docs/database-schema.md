# Database Schema — Poultry Vaccine Tracker

## Conventions

- Primary keys: UUID (`gen_random_uuid()`).
- Display codes (shed code, batch code) are unique **per owner**, not global secrets.
- Timestamps: `timestamptz` stored in UTC.
- Soft archive: `is_active` / `archived_at` preferred over hard delete for farm history.
- Every tenant table: `owner_account_id UUID NOT NULL` (+ FK) unless purely global (e.g. `permissions` catalog).

## Phase 1 tables

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| email | CITEXT UNIQUE | login |
| password_hash | TEXT | bcrypt |
| full_name | TEXT | |
| is_active | BOOLEAN | |
| is_platform_super_admin | BOOLEAN | |
| created_at / updated_at | timestamptz | |

### `owner_accounts`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | tenant root |
| name | TEXT | farm/org name |
| is_active | BOOLEAN | |
| timezone | TEXT NULL | IANA TZ for farm-local calendar (D2); Phase 2+ |
| created_by_user_id | UUID FK users | |
| created_at / updated_at | timestamptz | UTC storage |

### `owner_memberships`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| owner_account_id | UUID FK | |
| user_id | UUID FK | |
| role | ENUM | owner, org_admin, farmer, read_only |
| is_active | BOOLEAN | |
| created_at / updated_at | timestamptz | |
| UNIQUE(owner_account_id, user_id) | | one membership row per user per org |

### `refresh_tokens`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK | |
| token_hash | TEXT UNIQUE | |
| expires_at | timestamptz | |
| revoked_at | timestamptz NULL | |
| replaced_by_id | UUID NULL | rotation chain |
| created_at | timestamptz | |

### `audit_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| owner_account_id | UUID NULL | null for platform-only |
| actor_user_id | UUID | |
| action | TEXT | |
| entity_type / entity_id | TEXT/UUID | |
| before / after | JSONB | |
| reason | TEXT NULL | |
| created_at | timestamptz | |

### `permissions` (seeded catalog)
Static codes such as `shed.view`, `vaccination.record`, …

## Phase 2 tables

- `permissions` — global catalog of permission codes
- `membership_permissions` — explicit grants per membership (D6); optional `shed_id`
- `sheds` — tenant-owned; unique `(owner_account_id, code)`
- `shed_memberships` — farmer assignments to sheds
- `owner_accounts.timezone` — IANA TZ for farm-local calendar (D2)

## Later-phase tables (summary)

- `flocks`, `birds`, `lifecycle_events`
- `vaccine_definitions`, `vaccine_schedule_versions`, `schedule_rules`, `scheduled_doses`
- `vaccination_events`, `vaccination_event_outcomes`
- `notifications`, `notification_deliveries`
- `animal_media` (Cloudinary metadata + versions)

## RLS strategy

Enable RLS on all tenant tables. Example policy pattern:

```sql
CREATE POLICY owner_isolation_select ON sheds
  FOR SELECT TO app_user
  USING (owner_account_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
```

Farmer scope (Phase 2+): AND shed_id IN (assigned sheds for current user).

Session GUCs set per request transaction; never left on pooled connections after commit/rollback.

## Indexes (minimum)

- `(owner_account_id)` on all tenant tables
- memberships: `(user_id)`, `(owner_account_id, user_id)`
- later: `(shed_id)`, `(flock_id)`, `(bird_id)`, `(due_date)`, `(status)`
