# Deployment — Poultry Vaccine Tracker

## Local development

1. Copy `.env.example` → `backend/.env` and `mobile/.env` (placeholders only in repo).
2. Start Postgres: `docker compose up -d db`
3. Create app role + apply migrations (see README).
4. Run API: `cd backend && uvicorn app.main:app --reload --port 8000`
5. Run mobile: `cd mobile && npx expo start`
6. Health: `GET http://localhost:8000/health` — OpenAPI: `/docs`

## Testing deployment (initial)

| Component | Suggested platform | Notes |
|-----------|--------------------|-------|
| API | Render (Web Service) | Free tier may sleep; document cold starts |
| DB | Neon PostgreSQL | Separate branch/DB from production |
| Mobile | Expo Go / Android device | Point `EXPO_PUBLIC_API_URL` at HTTPS API |
| Media | Cloudinary | Free/dev cloud; private assets |

Steps:
1. Private GitHub repo
2. Set Render env: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, Cloudinary keys
3. Run Alembic migrate on release / start command
4. Verify `/health` and `/docs`
5. Install Android build or Expo Go against HTTPS API

## Free-tier limitations (must document to users)

- Render free web services sleep after inactivity → slow first request; jobs may not run while asleep
- Neon free storage/compute limits and branch expiry policies
- Cloudinary free transform/storage quotas
- Do **not** promise permanently free production infrastructure

## Production readiness (later)

- Paid Postgres with PITR backups
- Separate prod secrets and DB
- Controlled migrations
- Monitoring/error reporting
- Backup restore drill (`docs/backup-and-restore.md` in Phase 8)
- Do not call “production ready” merely because deploy succeeds

## Jobs / reminders

Because free Render may sleep, reminder jobs must use an external cron (Render Cron Job, GitHub Actions, or paid always-on) calling a secured internal endpoint. Document chosen mechanism in Phase 6.
