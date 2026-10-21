# Backend Deployment Handoff — Bird Management Release

**Date:** 2026-10-20  
**Audience:** Deployment owner with access to the production/staging API host  
**Prepared from:** Local working tree (uncommitted bird-management changes)  
**Commit/push from this agent session:** None

---

## 1. Why this handoff exists

The mobile preview profile (`mobile/eas.json`) points at:

```text
https://3.6.160.64.sslip.io
```

That host’s OpenAPI **does not** expose the shed-centric bird-management routes required by the current mobile client. Local API on port **8002** does.

**Deploy access from the development workstation used for this work:** SSH, AWS CLI, and Render API were **unavailable** (publickey denied / invalid token / unauthorized). This document does **not** claim those channels work. A human with credentials must perform the deploy.

Until the configured host’s OpenAPI matches the checklist in §6, **do not** build a new preview APK.

---

## 2. Deployment target and service configuration

### Intended preview / production API host (mobile config)

| Item | Value |
|------|--------|
| Public base URL | `https://3.6.160.64.sslip.io` |
| Health | `GET /health` |
| OpenAPI | `GET /openapi.json` |
| API prefix | `/api/v1` |
| Current observed health | `{"status":"ok","environment":"production"}` |

### Documented Render blueprint (repo)

File: `render.yaml`

| Setting | Value |
|---------|--------|
| Service type | Web |
| Name | `poultry-api` |
| Runtime | Python |
| Plan | free (sleeps when idle) |
| Root directory | `backend` |
| Build | `pip install -r requirements.txt` |
| Start | `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --timeout-keep-alive 75 --proxy-headers` |
| Health check path | `/health` |
| Auto-deploy | `true` (when connected to the GitHub repo) |
| Database | External (Neon) — set `DATABASE_URL` in dashboard |

**Important:** The live hostname `3.6.160.64.sslip.io` may be EC2 or another host, not necessarily the Render service named in `render.yaml`. Confirm which infrastructure actually serves that URL before changing DNS or mobile config.

### Local reference API (developer machine)

| Item | Value |
|------|--------|
| Base | `http://127.0.0.1:8002` |
| Environment (health) | `local` |
| OpenAPI route count (verified 2026-10-20) | **42** (includes all required bird routes) |

---

## 3. Backend source revision / local-tree identification

| Field | Value |
|-------|--------|
| Git branch | `main` (tracks `origin/main`) |
| Last **committed** revision on this machine | `5db244312918a25a3f7040cb973bb6c7c6ce2cda` — *Fix failed data loads by attaching the signed-in user without a second query.* |
| Bird-management / shed-centric API code | Present in the **local working tree** (modified + untracked files). **Not** contained in `5db2443` alone. |
| Must deploy | The **current local backend tree** that passes pytest (104) and OpenAPI checklist — after the deployment owner commits/pushes or otherwise packages those files. |

**Do not** redeploy only `origin/main` at `5db2443` and expect bird routes to appear.

Key backend files that must be on the server (non-exhaustive):

- `backend/app/api/v1/birds.py` — `register-in-shed`, `add-unbanded-in-shed`, `band-from-unbanded`, `in-shed`, profile
- `backend/app/api/v1/sheds.py` — `/{shed_id}/overview`
- `backend/app/api/v1/lifecycle.py` — `transfer-to-shed`
- `backend/app/services/flock_service.py` — cohort find/create, exact DOB, `FOR UPDATE` on conversion
- `backend/app/schemas/flock.py` — `RegisterBandedInShedIn`, `AddUnbandedInShedIn`, etc.

---

## 4. Required environment variables (names only)

Never paste secret values into tickets, chat, or this repo.

### Required for API boot

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Postgres URL (Neon or other). App normalizes to `postgresql+asyncpg` / sync Alembic driver. |
| `JWT_SECRET` | Strong secret in production (`render.yaml` can `generateValue`). |
| `ENVIRONMENT` | Use `production` on the public host. |
| `DEBUG` | `false` in production. |

### Strongly recommended

| Variable | Notes |
|----------|--------|
| `DATABASE_URL_SYNC` | Optional if derived from `DATABASE_URL` (Alembic). |
| `APP_DATABASE_URL` | Optional RLS-constrained app role URL. |
| `CORS_ORIGINS` | `*` in blueprint; prefer explicit mobile origins for hardening. |
| `MEDIA_ENABLED` | `false` unless Cloudinary is configured. |

### Optional (media)

| Variable | Notes |
|----------|--------|
| `CLOUDINARY_CLOUD_NAME` | |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |

### Python / platform

| Variable | Notes |
|----------|--------|
| `PYTHON_VERSION` | Blueprint: `3.13.1` |
| `PORT` | Provided by Render (uvicorn binds `$PORT`). |

Reference template (placeholders only): repo root `.env.example`.

---

## 5. Database migration requirements

| Item | Detail |
|------|--------|
| Tool | Alembic |
| Migration dir | `backend/alembic/versions/` |
| Current heads in tree | `0001` … `0006` (auth → sheds → flocks/birds → vaccines/media → perf indexes) |
| Bird-management feature migrations | **None new.** Shed-centric APIs reuse existing `flocks` / `birds` tables and nullable DOB columns. |
| Start command | `alembic upgrade head` (already in `render.yaml` startCommand) |
| Destructive ops | **Do not** drop flocks, reset production data, or backfill historical DOB values. |

If `alembic upgrade head` is already applied on the target DB, start is a no-op for schema and only the new Python routes matter.

---

## 6. Build and startup commands

### Render (when blueprint / dashboard is authorized)

1. Ensure the GitHub repo (or deploy artifact) contains the **bird-management backend tree**.
2. Confirm env vars in §4 are set in the Render dashboard (especially `DATABASE_URL`, `JWT_SECRET`).
3. Deploy / restart service `poultry-api`.
4. Start command (from blueprint):

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --timeout-keep-alive 75 --proxy-headers
```

Build:

```bash
pip install -r requirements.txt
```

Working directory: `backend`.

### Generic host (e.g. EC2 behind sslip)

```bash
cd /path/to/poultry/backend
python -m venv .venv   # if needed
source .venv/bin/activate   # or Windows equivalent
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
```

Put TLS termination and the public hostname in front of uvicorn (nginx/Caddy/ALB). Set env vars from §4.

### Dependencies

File: `backend/requirements.txt` (FastAPI, uvicorn, SQLAlchemy, asyncpg, Alembic, pydantic-settings, jose, httpx, pytest, reportlab, etc.).

---

## 7. Health-check and OpenAPI verification

Replace `BASE` with the public URL after deploy (default preview target shown).

```bash
# Health
curl -sS "https://3.6.160.64.sslip.io/health"
# Expect: {"status":"ok","environment":"production"}

# OpenAPI present
curl -sS "https://3.6.160.64.sslip.io/openapi.json" -o openapi.json

# Route checklist (must all be present)
python -c "
import json
want = [
  '/api/v1/birds/register-in-shed',
  '/api/v1/birds/add-unbanded-in-shed',
  '/api/v1/birds/band-from-unbanded',
  '/api/v1/birds/in-shed',
  '/api/v1/birds/{bird_id}/profile',
  '/api/v1/sheds/{shed_id}/overview',
  '/api/v1/lifecycle-events/transfer-to-shed',
]
paths = json.load(open('openapi.json'))['paths']
missing = [p for p in want if p not in paths]
print('missing', missing or 'NONE')
for p in want:
    print(p, list(paths.get(p, {}).keys()) or 'MISSING')
"
```

**Pass criterion:** `missing NONE` and methods match (`post` / `get` as listed in §8).

Local comparison reference:

```bash
curl -sS "http://127.0.0.1:8002/openapi.json" -o local-openapi.json
```

---

## 8. Required route checklist

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/birds/register-in-shed` | Banded bird in shed + exact hatch date (auto cohort) |
| `POST` | `/api/v1/birds/add-unbanded-in-shed` | Unbanded quantity + exact hatch date |
| `POST` | `/api/v1/birds/band-from-unbanded` | Atomic unbanded→banded conversion (row-locked) |
| `GET` | `/api/v1/birds/in-shed` | Paginated banded birds in shed |
| `GET` | `/api/v1/birds/{bird_id}/profile` | Bird profile |
| `GET` | `/api/v1/sheds/{shed_id}/overview` | Shed population + batches summary |
| `POST` | `/api/v1/lifecycle-events/transfer-to-shed` | Shed-to-shed transfer |

Also required for app login (already on prod historically): `/api/v1/auth/*`, `/api/v1/sheds`, `/api/v1/flocks`, etc.

---

## 9. Safe deployment and rollback steps

### Deploy (safe)

1. Snapshot / note current release commit or container image on the host.
2. Confirm DB backup / Neon point-in-time recovery is available for the target database.
3. Deploy the bird-management backend tree (commit first if your process requires Git-triggered Render autoDeploy).
4. Watch start logs for Alembic + uvicorn bind.
5. Run §7 OpenAPI checklist.
6. Run §10 authenticated smoke against a **disposable QA org** only.
7. Only then approve a mobile preview APK build using this base URL (or update `eas.json` if using a different verified host).

### Rollback

1. Redeploy the previous known-good backend revision/image.
2. Re-check `/health` and OpenAPI.
3. **Do not** run destructive down-migrations against production farm data unless explicitly approved with a restore plan.
4. Keep mobile on the last APK that matches the rolled-back API contract.

### Precautions

- Free Render services sleep → cold starts; smoke may need a warm-up request.
- Do not reset Neon/production databases.
- Do not change `JWT_SECRET` casually (invalidates all sessions).

---

## 10. Authenticated smoke-test instructions

Use a **new disposable owner** account. Do not use real farm credentials for destructive experiments.

### Option A — Script (from repo)

Against the verified host (after OpenAPI pass):

```bash
cd backend
python scripts/smoke_shed_centric_local.py https://3.6.160.64.sslip.io
```

(The script registers `smoke-*@example.com`, creates a shed, exercises register / unbanded / convert / list / profile / duplicate band.)

### Option B — Manual curl outline

1. `POST /api/v1/auth/register-owner` → access token + `X-Owner-Account-Id` from `/auth/me`.
2. `POST /api/v1/sheds` → `shed_id`.
3. `POST /api/v1/birds/register-in-shed` with exact past `hatch_date` and unique `band_id`.
4. `POST /api/v1/birds/add-unbanded-in-shed` with same DOB + quantity.
5. `GET /api/v1/sheds/{id}/overview` — assert banded + unbanded = total.
6. `POST /api/v1/birds/band-from-unbanded` with `idempotency_key`; replay same key → `idempotent_replay: true`.
7. `GET /api/v1/birds/in-shed?shed_id=…`
8. Reject future hatch date (expect **422**) and duplicate band (expect **400**).

---

## 11. Manual actions the deployment owner must perform

1. **Identify** which system serves `https://3.6.160.64.sslip.io` (Render service vs EC2 vs other).
2. **Package** the local bird-management backend (commit/push to the connected repo, or copy files) — not only `5db2443`.
3. **Set/confirm** env vars in §4 on that host (secrets stay in the secret store).
4. **Deploy/restart** using §6.
5. **Verify** OpenAPI checklist §7–§8.
6. **Run** disposable smoke §10.
7. **Notify** mobile/release owner that the host is verified so a preview APK can be built.
8. If using a **different** staging URL, update `mobile/eas.json` `preview.env.EXPO_PUBLIC_API_URL` only after that URL passes the same checklist.

---

## 12. APK gate (explicit)

| Condition | Action |
|-----------|--------|
| OpenAPI missing any §8 route | **Do not** build preview APK |
| OpenAPI complete + smoke pass | Build with EAS `preview` profile |
| Emulator-only testing | Never report as physical-device QA |

Current status as of handoff write: **gate closed** (prod OpenAPI missing all 7 routes).

---

## 13. Related docs

- `mobile/docs/BIRD_MANAGEMENT_IMPLEMENTATION_STATUS.md` — verification results
- `mobile/docs/BIRD_MANAGEMENT_ARCHITECTURE_AUDIT.md` — root-cause audit
- `docs/deployment.md` — general local / Render / Neon notes
- `render.yaml` — Render blueprint
- `backend/scripts/smoke_shed_centric_local.py` — automated smoke

---

## 14. PR readiness (authorized collaborator) — 2026-10-20

**No commit/push performed by the agent.** This section prepares review of the **local working tree** against base `origin/main` @ `5db244312918a25a3f7040cb973bb6c7c6ce2cda`.

### 14.1 Base branch

| Item | Value |
|------|--------|
| Base for PR | `main` / `origin/main` @ `5db2443…` |
| Implementation | Local uncommitted working tree (not `5db2443` alone) |
| Current GitHub push rights (agent account) | **pull only** on `vijayomkarbolisetti/poultry` |
| GitHub Actions workflows | **None** (`total_count: 0`; no `.github/workflows` in repo) |
| Deployment after PR merge | **Not automatic via Actions.** If Render Blueprint `autoDeploy: true` is wired to this repo, merge+push of the bird tree may trigger Render — **verify in the Render dashboard**. Host `3.6.160.64.sslip.io` may be separate (EC2); treat as **manual** unless ownership is confirmed. |

### 14.2 Seven routes — contract summary

| Method | Path | Auth permission | Request (core) | Response | DB ops |
|--------|------|-----------------|----------------|----------|--------|
| `POST` | `/api/v1/birds/register-in-shed` | `bird.create` | `shed_id`, `band_id`, `hatch_date` (exact, not future) | `BirdOut` | find/create cohort flock; insert `birds`; reconcile counts |
| `POST` | `/api/v1/birds/add-unbanded-in-shed` | `flock.create` | `shed_id`, `quantity`, `hatch_date`, optional `idempotency_key` | `AddUnbandedInShedOut` | find/create cohort; increment `unbanded_count` / lifecycle |
| `POST` | `/api/v1/birds/band-from-unbanded` | `bird.create` | `flock_id`, `band_id`, `idempotency_key` | `BandFromUnbandedOut` | `SELECT … FOR UPDATE` flock; decrement unbanded; insert bird |
| `GET` | `/api/v1/birds/in-shed` | `bird.view` | `shed_id` (+ pagination/filters) | `BirdListOut` | list banded birds; unbanded summary |
| `GET` | `/api/v1/birds/{bird_id}/profile` | `bird.view` | path id | `BirdProfileOut` | bird + shed/flock context |
| `GET` | `/api/v1/sheds/{shed_id}/overview` | `shed.view` | path id | `ShedOverviewOut` | population aggregates |
| `POST` | `/api/v1/lifecycle-events/transfer-to-shed` | `lifecycle.record` | `ShedTransferCreate` | `ShedTransferOut` | move birds or unbanded qty |

Service-layer also calls `assert_shed_access` / `assert_shed_accepts_new_records` where applicable.

### 14.3 Migrations

| Item | Finding |
|------|---------|
| New Alembic revision for bird routes | **None required** |
| Existing | `0003_phase3_flocks_birds_lifecycle.py` already defines `flocks` / `birds` (`flock_id` NOT NULL, `hatch_date` nullable) |
| Deploy | `alembic upgrade head` (no-op if already at `0006`) |

### 14.4 Files an authorized reviewer must inspect (bird-management core)

**Required for the seven routes (include in PR):**

| Path | Role |
|------|------|
| `backend/app/api/v1/birds.py` | Route registration |
| `backend/app/api/v1/lifecycle.py` | `transfer-to-shed` |
| `backend/app/api/v1/sheds.py` | `overview` |
| `backend/app/api/v1/__init__.py` | Router mount |
| `backend/app/schemas/flock.py` | Request/response models |
| `backend/app/schemas/shed.py` | Overview models |
| `backend/app/services/flock_service.py` | Cohort, register, unbanded, convert (lock), list, profile, transfer |
| `backend/app/services/shed_service.py` | Overview aggregation |
| `backend/app/tests/test_shed_centric_birds.py` | Empty shed / cohort / concurrency |
| `backend/app/tests/test_birds_management_dob.py` | Exact DOB / conversion |
| `backend/app/tests/test_shed_transfer.py` | Transfer + counts |
| `backend/app/tests/test_shed_birds_manage.py` | `in-shed` authz |
| `backend/app/tests/test_shed_overview.py` | Overview integrity |
| `backend/app/tests/test_bulk_lifecycle.py` | Bulk lifecycle (related) |
| `backend/app/tests/test_phase3_flocks_birds.py` | Legacy create DOB alignment |
| `backend/scripts/smoke_shed_centric_local.py` | Post-deploy smoke |

**Related backend (same working tree; include if PR scopes “shed/bird management”, else split):**

| Path | Note |
|------|------|
| `backend/app/api/v1/flocks.py`, `search.py` | Flock search / batch APIs |
| `backend/app/schemas/search.py` | Search DTOs |
| `backend/app/services/search_service.py`, `bird_report_service.py` | Search / PDF (PDF route test-only) |
| `backend/app/services/dashboard_service.py`, `notification_service.py`, `media_service.py`, `vaccination_service.py`, `vaccine_service.py` | Adjacent product changes |
| `backend/app/api/v1/vaccines.py`, `schemas/vaccine.py` | Vaccine tweaks |
| Other `backend/app/tests/test_shed_*.py`, `test_global_search.py`, etc. | Supporting coverage |
| `backend/requirements.txt` | Adds `reportlab`, `pypdf`, `tzdata` (PDF/report related — not strictly required for the seven routes alone) |

**Do not put in the bird-API PR (unrelated / keep local):**

- Entire `mobile/` tree, assets, builds, maestro, mobile docs except this handoff if desired
- `poultry_vaccine_tracker_requirements.md`, `.easignore`
- `backend/.env` (**gitignored** — never commit)

### 14.5 Diff hygiene review

| Check | Result |
|-------|--------|
| Secrets in tracked backend diffs | **None found** for commit (`backend/.env` gitignored; values not reviewed into PR) |
| Environment URLs hardcoded into backend API | Smoke script defaults to `127.0.0.1:8002` (CLI override) — OK |
| Accidental DB data / migration drops | **None** — no new destructive migrations |
| Unrelated mobile + binary assets in same working tree | **Yes** — exclude from backend-focused PR |

### 14.6 Test commands and actual results (this pass)

```text
cd backend
.venv\Scripts\python.exe -m pytest app/tests/test_shed_centric_birds.py app/tests/test_birds_management_dob.py app/tests/test_shed_transfer.py app/tests/test_shed_birds_manage.py app/tests/test_shed_overview.py app/tests/test_bulk_lifecycle.py -q
# RESULT: 36 passed in 56.70s  (2026-10-20)

.venv\Scripts\python.exe scripts\smoke_shed_centric_local.py http://127.0.0.1:8002
# RESULT: SMOKE OK
```

Prior full suite (same tree): **104 passed**.

### 14.7 Secrets / permissions for deploy (names only)

| Name | Purpose |
|------|---------|
| `DATABASE_URL` | Postgres (e.g. Neon) |
| `JWT_SECRET` | Token signing |
| `ENVIRONMENT` | `production` on public host |
| `DEBUG` | `false` |
| Optional: `DATABASE_URL_SYNC`, `APP_DATABASE_URL`, `CORS_ORIGINS`, `MEDIA_ENABLED`, Cloudinary keys | See §4 |

Collaborator also needs: **Git push** (or alternate artifact path) + **host deploy access** (Render and/or SSH to sslip host).

### 14.8 Post-merge / post-deploy verification (mandatory)

1. Confirm deployed URL (sslip or staging).
2. OpenAPI: all 7 routes present (§8).
3. Smoke: `python scripts/smoke_shed_centric_local.py <DEPLOYED_URL>`.
4. Only then approve preview APK against that URL.

### 14.9 Exact action for authorized collaborator

1. Create a branch from `main` and stage **only** the bird-management backend file set in §14.4 (or a larger intentional shed/bird PR — do not silently include mobile binaries).
2. Commit and push with an account that has **write** access (agent account cannot).
3. Open PR against `main`; reviewers use §14.2–14.4.
4. After merge: **manually verify** whether Render auto-deployed or whether EC2/sslip needs a **manual** pull/restart — **do not assume PR approval deploys**.
5. Produce deployment verification evidence (URL + OpenAPI 7/7 + smoke).
6. Do **not** build a preview APK until step 5 passes.
