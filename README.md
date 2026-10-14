# Poultry Vaccine Tracker

Multi-tenant poultry vaccine management: **Expo (React Native)** mobile app + **FastAPI** + **PostgreSQL (RLS)** + optional **Cloudinary** media.

Primary requirements: `poultry_vaccine_tracker_requirements.md`  
Stack/architecture overrides: `docs/architecture.md`, `docs/open-decisions.md`

## Current status

**Phases 1–8 complete.** Auth, sheds, farmers, flocks/birds, vaccines, vaccinations, alerts, reports, optional Cloudinary media. Automated tests: `cd backend && pytest -q`.

## Quick start (local)

### Prerequisites

- Docker Desktop
- Python 3.12+
- Node 20+ (for later mobile phases)

### Database

```bash
docker compose up -d db
# Postgres is published on host port 5433 (avoids conflict with local PG on 5432)
```

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example .env   # or cp on Unix
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

- Health: http://localhost:8000/health  
- OpenAPI: http://localhost:8000/docs  

### Tests

```bash
cd backend
pytest -q
```

Requires Postgres reachable (Docker). Tests create/use `poultry_tracker_test`.

### Mobile UI

```powershell
cd mobile
npm start
```

See `mobile/README.md` for Android emulator / Expo Go and API URL settings.
Sign in + register owner screens are available now.

## Documentation

| Doc | Purpose |
|-----|---------|
| `docs/implementation-plan.md` | Phased delivery |
| `docs/architecture.md` | System design |
| `docs/database-schema.md` | Schema + RLS |
| `docs/permissions-matrix.md` | Roles/permissions |
| `docs/security-plan.md` | Threats & checklist |
| `docs/deployment.md` | Local / Render / Neon |
| `docs/open-decisions.md` | Locked C1–C2 and D1–D10 decisions |

## Media

Images/videos are **optional**. When enabled, media uses **Cloudinary** (upload, update/version, past versions, delete) with private assets and server-side credentials only.
