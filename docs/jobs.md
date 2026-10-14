# Background jobs (reminders)

Core due/overdue status is computed on read (`refresh_dose_statuses`) and does not require a worker.

Alert generation: `POST /api/v1/notifications/generate` (authenticated).

## Recommended hosting

- **Render Cron Job** (or GitHub Actions cron) calling the generate endpoint with a service token/user.
- Do not rely on a free Render web instance staying awake.

## Local

```powershell
# after login, with owner header
curl -X POST http://localhost:8001/api/v1/notifications/generate -H "Authorization: Bearer ..." -H "X-Owner-Account-Id: ..."
```
