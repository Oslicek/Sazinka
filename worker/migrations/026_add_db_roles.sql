-- Migration 026: Create sazinka_admin and sazinka_app PostgreSQL roles
--
-- sazinka_admin: DDL rights — used by CI migration job only
-- sazinka_app:   DML only  — used by runtime worker container
--
-- Passwords are set to a placeholder here. After applying this migration,
-- change passwords via SOPS secrets on VPS:
--   ALTER ROLE sazinka_admin PASSWORD '...';
--   ALTER ROLE sazinka_app   PASSWORD '...';

-- ============================================================
-- sazinka_admin: migration role (DDL rights)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sazinka_admin') THEN
    CREATE ROLE sazinka_admin LOGIN PASSWORD 'PLACEHOLDER_CHANGE_VIA_SECRETS';
  END IF;
END $$;

GRANT CONNECT ON DATABASE sazinka TO sazinka_admin;
GRANT ALL PRIVILEGES ON SCHEMA public TO sazinka_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO sazinka_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO sazinka_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO sazinka_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO sazinka_admin;

-- ============================================================
-- sazinka_app: runtime role (DML only — no schema changes)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sazinka_app') THEN
    CREATE ROLE sazinka_app LOGIN PASSWORD 'PLACEHOLDER_CHANGE_VIA_SECRETS';
  END IF;
END $$;

GRANT CONNECT ON DATABASE sazinka TO sazinka_app;
GRANT USAGE ON SCHEMA public TO sazinka_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sazinka_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sazinka_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sazinka_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sazinka_app;
