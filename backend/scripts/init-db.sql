-- Fresh cluster bootstrap for local Docker Postgres.
SELECT 'CREATE DATABASE poultry_tracker_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'poultry_tracker_test')\gexec

-- Application role that cannot bypass RLS (not a superuser).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE poultry_tracker TO app_user;
GRANT CONNECT ON DATABASE poultry_tracker_test TO app_user;
GRANT USAGE, CREATE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
