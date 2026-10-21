# Bird Management Simplification — Implementation Status

**Updated:** 2026-10-20 (release gate locked)  
**Based on:** `BIRD_MANAGEMENT_ARCHITECTURE_AUDIT.md` + approved shed-centric direction  
**Handoff:** [`BACKEND_DEPLOYMENT_HANDOFF.md`](./BACKEND_DEPLOYMENT_HANDOFF.md)  
**Commit/push/reset:** None — **preserve the local working tree**; do not replace with `5db2443` alone

---

## Release gate (locked)

| Rule | Status |
|------|--------|
| Preserve local working tree (no commit / push / reset / replace with `5db2443`) | **IN FORCE** |
| No redesign | **IN FORCE** |
| No preview APK against current stale `sslip.io` OpenAPI | **IN FORCE** |
| Next dependency | **Authorized deployment access only** |

### Next deliverable (required before any APK)

**Deployment verification evidence** — all three, for the same URL:

1. **Deployed URL** (preview host or verified staging)  
2. **OpenAPI route check** — all **7** required bird-management routes present  
3. **Disposable smoke result** against that same URL (`backend/scripts/smoke_shed_centric_local.py <URL>`)

Until that evidence exists, the preview APK remains **blocked**.

### Deploy attempt (2026-10-20, this session)

| Channel | Result |
|---------|--------|
| Deploy local working tree to sslip / staging | **BLOCKED** — no authorized path |
| SSH (`ubuntu@3.6.160.64`) | **DENIED** (`Permission denied (publickey)`); no private key in `~/.ssh` (only `known_hosts`) |
| AWS STS | **DENIED** (`InvalidClientTokenId`) |
| Render CLI / API | **NOT AVAILABLE** / unauthorized |
| GitHub push to `vijayomkarbolisetti/poultry` | **DENIED** (`permissions.push: false` — pull only) |
| Tunnel tools (ngrok / cloudflared) | **NOT INSTALLED** |
| `https://3.6.160.64.sslip.io` OpenAPI | Still **0/7** required routes |
| Local `http://127.0.0.1:8002` OpenAPI | Still **7/7** |

**Deployment verification evidence (URL + OpenAPI 7/7 + smoke on that URL):** **NOT PRODUCED** — waiting on credentialed owner.

---

## Summary

Shed-centric bird registration with exact DOB is **complete and verified locally** (backend + mobile).

The preview API host `https://3.6.160.64.sslip.io` **still does not** list the required bird-management routes in OpenAPI. SSH / AWS / Render deploy access were **unavailable** from this environment.

**Deployment handoff for a credentialed owner:** `mobile/docs/BACKEND_DEPLOYMENT_HANDOFF.md`.

**Preview APK:** **NOT BUILT** — gate remains closed until the next deliverable above is complete.

---

## Outstanding deployment dependency (blocks release)

| Dependency | Status |
|------------|--------|
| Deploy bird-management **local backend tree** (not only git `5db2443`) to the host serving `3.6.160.64.sslip.io` (or a verified staging URL) | **BLOCKED** — no deploy credentials here |
| OpenAPI lists all seven required bird routes | **FAILED** on prod (0/7); **VERIFIED** on local `:8002` (7/7) |
| Authenticated smoke on that host | **NOT RUN** (host not aligned) |
| Retarget or keep `eas.json` preview URL | Only after host verification |
| New EAS preview APK | **NOT RUN** |
| Physical-device QA | **NOT RUN** |

### Exact external action to unblock

1. Owner follows [`BACKEND_DEPLOYMENT_HANDOFF.md`](./BACKEND_DEPLOYMENT_HANDOFF.md): deploy the **current backend working tree**, set env vars (names only), Alembic + restart, then produce the **next deliverable** (URL + OpenAPI 7/7 + smoke).
2. Confirm to the mobile owner that the host is verified.
3. **Only then** `eas build --profile preview` against the verified URL and run physical-device QA.

---

## Phase status

| Phase | Status | Evidence |
|-------|--------|----------|
| Architecture / routes | **VERIFIED** | `/api/v1` birds, sheds, lifecycle |
| Local backend correctness | **VERIFIED** | pytest **104** passed; smoke OK |
| Navigation + shed-centric UI | **VERIFIED** in code | Single back; no group gate for register |
| Exact DOB | **VERIFIED** locally | Future DOB → 422; no age chips on add flows |
| Conversion + concurrency | **VERIFIED** locally | `FOR UPDATE` on flock; race test passed |
| Deployment alignment | **FAILED** / **BLOCKED** | Prod OpenAPI missing 7 routes; no SSH/AWS/Render access |
| Preview APK | **NOT RUN** | Gate closed |
| Physical-device QA | **NOT RUN** | Emulator present ≠ physical device |

---

## Local verification (re-checked this handoff pass)

| Check | Result |
|-------|--------|
| `GET http://127.0.0.1:8002/health` | **VERIFIED** `environment: local` |
| Local OpenAPI required routes | **VERIFIED** 7/7 present |
| Prod OpenAPI required routes | **FAILED** 0/7 present |
| `smoke_shed_centric_local.py http://127.0.0.1:8002` | **VERIFIED** SMOKE OK |
| `npx tsc --noEmit` | **VERIFIED** exit 0 |
| Prior full pytest | **VERIFIED** 104 passed (includes concurrency test) |

---

## Backend changes (local tree)

### New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/birds/register-in-shed` | Banded bird by shed + exact hatch date |
| `POST` | `/api/v1/birds/add-unbanded-in-shed` | Unbanded quantity + exact DOB cohort |

Also required (local present / prod missing): `band-from-unbanded`, `in-shed`, `birds/{id}/profile`, `sheds/{id}/overview`, `lifecycle-events/transfer-to-shed`.

### Service notes

- Internal flock/cohort find-or-create (hidden from UX).
- Exact hatch required for net-new banded registration.
- Direct register does not consume unbanded; conversion is `band-from-unbanded` with row lock.
- **No new Alembic migrations** for this feature.

### Source identification

| Item | Value |
|------|--------|
| Last committed SHA | `5db244312918a25a3f7040cb973bb6c7c6ce2cda` |
| Bird APIs | In **uncommitted** local working tree |

---

## Mobile / EAS

| Item | Value |
|------|--------|
| Preview `EXPO_PUBLIC_API_URL` | `https://3.6.160.64.sslip.io` |
| New preview build this session | **NOT RUN** |
| Prior APK | `poultrytrack-birds-mgmt-5b0e69f1` — **not** a current release candidate |

---

## Related documents

- [`BACKEND_DEPLOYMENT_HANDOFF.md`](./BACKEND_DEPLOYMENT_HANDOFF.md) — deploy steps, env names, checklist, rollback
- [`BIRD_MANAGEMENT_ARCHITECTURE_AUDIT.md`](./BIRD_MANAGEMENT_ARCHITECTURE_AUDIT.md)
- [`SHED_OVERVIEW_BIRD_MANAGEMENT_REDESIGN_REPORT.md`](./SHED_OVERVIEW_BIRD_MANAGEMENT_REDESIGN_REPORT.md)
- `render.yaml`, `docs/deployment.md`
