# Permissions Matrix — Poultry Vaccine Tracker

Aligned with locked decisions **D6**, **D7**, **D8**, **D10** in `docs/open-decisions.md`.

## Roles

| Role | Scope | Notes |
|------|-------|-------|
| `platform_super_admin` | Platform | User flag; **no** automatic farm data access (D10) |
| `owner` | Entire `owner_account` | Implicit full permissions for that org |
| `org_admin` | Entire `owner_account` where granted | **D6:** Enabled, but permissions are **explicitly assigned** — not automatic near-owner privileges |
| `farmer` | Assigned sheds only | Explicit grants; multi-org via separate memberships (D8) |
| `read_only` | Granted view scope | **D7:** View only; no write |

## Permission codes

| Code | Owner | Org Admin | Farmer (typical) | Read-only |
|------|-------|-----------|------------------|-----------|
| shed.view | ✓ | *granted* | assigned | ✓ if granted |
| shed.create | ✓ | *granted* | ✗ | ✗ |
| shed.update | ✓ | *granted* | ✗ | ✗ |
| farmer.manage | ✓ | *granted* | ✗ | ✗ |
| flock.view | ✓ | *granted* | assigned | ✓ if granted |
| flock.create | ✓ | *granted* | optional | ✗ |
| flock.update | ✓ | *granted* | optional | ✗ |
| bird.view | ✓ | *granted* | assigned | ✓ if granted |
| bird.create | ✓ | *granted* | optional | ✗ |
| bird.update | ✓ | *granted* | optional | ✗ |
| vaccination.view | ✓ | *granted* | assigned | ✓ if granted |
| vaccination.record | ✓ | *granted* | optional | ✗ |
| vaccination.correct | ✓ | *granted* | ✗ | ✗ |
| schedule.view | ✓ | *granted* | assigned | ✓ if granted |
| schedule.manage | ✓ | *granted* | ✗ | ✗ |
| report.view | ✓ | *granted* | assigned | ✓ if granted |
| media.view | ✓ | *granted* | assigned | ✓ if granted |
| media.upload | ✓ | *granted* | optional | ✗ |
| lifecycle.record | ✓ | *granted* | optional | ✗ |

`*granted*` = Org Admin receives the permission **only** when the owner (or an authorized admin with `farmer.manage` / membership-manage capability) explicitly assigns it. New Org Admin memberships start with **no** write permissions until configured.

Owners may grant/revoke permissions per membership (and optionally per shed in Phase 2).

## Enforcement order

1. Authenticated user active?
2. Active membership for selected `owner_account_id`?
3. Role/permission allows action? (Owner = all; Org Admin/Farmer/Read-only = stored grants)
4. Resource belongs to that owner (and shed assignment for farmers)?
5. RLS still filters at DB layer

Frontend may hide buttons; API + RLS are authoritative.
