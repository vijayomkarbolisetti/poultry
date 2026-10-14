# How to view database data

Postgres runs in Docker on **host port 5433**.

## Option A — Docker CLI (quick)

```powershell
cd d:\learning\poultry
docker exec -it poultry-db-1 psql -U poultry -d poultry_tracker
```

Useful SQL:

```sql
\dt
SELECT email, full_name FROM users;
SELECT name FROM owner_accounts;
SELECT code, name FROM sheds;
SELECT batch_code, current_count, tracking_mode FROM flocks;
SELECT band_id, lifecycle_status FROM birds;
```

Exit: `\q`

## Option B — GUI (recommended)

1. Install [DBeaver](https://dbeaver.io/) or pgAdmin  
2. New PostgreSQL connection:
   - Host: `localhost`
   - Port: `5433`
   - Database: `poultry_tracker`
   - User: `poultry`
   - Password: `poultry`

## Option C — API browser

Open http://localhost:8001/docs and call list endpoints after login.
