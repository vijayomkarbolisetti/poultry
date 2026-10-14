# Backup and restore

## Local Docker Postgres

```powershell
# Backup
docker exec poultry-db-1 pg_dump -U poultry poultry_tracker > backup_poultry.sql

# Restore (destroys current data in DB)
Get-Content backup_poultry.sql | docker exec -i poultry-db-1 psql -U poultry -d poultry_tracker
```

## Neon / production

1. Use provider PITR / scheduled backups (paid plan recommended for production).
2. Keep development and production databases separate.
3. Before migrations: take a snapshot.
4. Test restore on a staging branch/DB at least once per release.

## Media (Cloudinary)

- DB stores public_ids only.
- Soft-delete keeps audit; Cloudinary destroy is best-effort.
- Export asset list from Cloudinary console for disaster recovery.
