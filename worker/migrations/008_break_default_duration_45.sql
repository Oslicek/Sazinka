-- Set default break duration to 45 minutes
ALTER TABLE users
  ALTER COLUMN break_duration_minutes SET DEFAULT 45;

-- Backfill existing values that still use the old system default
UPDATE users
SET break_duration_minutes = 45
WHERE break_duration_minutes = 30;
