-- Set automatic break insertion default to ON
ALTER TABLE users
  ALTER COLUMN break_enabled SET DEFAULT true;

-- Backfill existing users created with previous default
UPDATE users
SET break_enabled = true
WHERE break_enabled = false;
