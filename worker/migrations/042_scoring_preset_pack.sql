-- Migration 042: Scoring Preset Pack
--
-- Goals:
--   1. Add system_key column to scoring_rule_sets (immutable preset identifier).
--   2. Backfill existing single-system-profile rows with system_key = 'standard'.
--   3. Add a unique partial index on (user_id, system_key) WHERE system_key IS NOT NULL.
--   4. Seed the four new system presets for every existing company that only has Standard.
--
-- Backfill rule: if a user has exactly one is_system = TRUE profile, it is assigned
-- system_key = 'standard'. If a user somehow has more (unlikely in prod), we only assign
-- 'standard' to the DEFAULT one; others are left NULL and can be cleaned up manually.
--
-- After this migration:
--   - Every company has 5 system presets (standard + 4 new).
--   - 'standard' is the only is_default = TRUE system profile.
--   - Custom (user-created) profiles keep system_key = NULL.

-- ── Step 1: add column ────────────────────────────────────────────────────────

ALTER TABLE scoring_rule_sets
    ADD COLUMN IF NOT EXISTS system_key TEXT DEFAULT NULL;

-- ── Step 2: backfill existing Standard rows ───────────────────────────────────

-- Users with exactly one system profile → assign 'standard'
UPDATE scoring_rule_sets rs
SET system_key = 'standard'
WHERE rs.is_system = TRUE
  AND rs.system_key IS NULL
  AND (
      SELECT COUNT(*) FROM scoring_rule_sets x
      WHERE x.user_id = rs.user_id AND x.is_system = TRUE
  ) = 1;

-- Users with multiple system profiles → assign 'standard' to the default one
UPDATE scoring_rule_sets rs
SET system_key = 'standard'
WHERE rs.is_system = TRUE
  AND rs.is_default = TRUE
  AND rs.system_key IS NULL
  AND (
      SELECT COUNT(*) FROM scoring_rule_sets x
      WHERE x.user_id = rs.user_id AND x.is_system = TRUE
  ) > 1;

-- ── Step 3: unique partial index ─────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uidx_scoring_rule_sets_user_system_key
    ON scoring_rule_sets (user_id, system_key)
    WHERE system_key IS NOT NULL;

-- ── Step 4: seed missing presets for existing companies ────────────────────────
--
-- For each user that already has a 'standard' system profile but is missing any
-- of the four new presets, insert the new preset row.
-- Factor weights are seeded via separate INSERT INTO scoring_rule_factors blocks below.
-- We do NOT touch existing rows (ON CONFLICT DO NOTHING).

DO $$
DECLARE
    rec RECORD;
    new_id UUID;
BEGIN
    FOR rec IN
        SELECT DISTINCT user_id FROM scoring_rule_sets WHERE system_key = 'standard'
    LOOP
        -- new_customers_first
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description,
            is_default, is_archived, is_system, system_key,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), rec.user_id, 'New Customers First', NULL,
            FALSE, FALSE, TRUE, 'new_customers_first',
            rec.user_id, rec.user_id, NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM scoring_rule_sets
            WHERE user_id = rec.user_id AND system_key = 'new_customers_first'
        )
        RETURNING id INTO new_id;

        IF new_id IS NOT NULL THEN
            INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight) VALUES
                (new_id, 'lifecycle_rank',    1700),
                (new_id, 'days_until_due',      -2),
                (new_id, 'customer_age_days',  0.005),
                (new_id, 'no_open_action',     350);
            new_id := NULL;
        END IF;

        -- due_date_radar
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description,
            is_default, is_archived, is_system, system_key,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), rec.user_id, 'Due-Date Radar', NULL,
            FALSE, FALSE, TRUE, 'due_date_radar',
            rec.user_id, rec.user_id, NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM scoring_rule_sets
            WHERE user_id = rec.user_id AND system_key = 'due_date_radar'
        )
        RETURNING id INTO new_id;

        IF new_id IS NOT NULL THEN
            INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight) VALUES
                (new_id, 'lifecycle_rank',    700),
                (new_id, 'days_until_due',    -12),
                (new_id, 'customer_age_days', 0.005),
                (new_id, 'overdue_days',        3);
            new_id := NULL;
        END IF;

        -- overdue_firefighter
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description,
            is_default, is_archived, is_system, system_key,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), rec.user_id, 'Overdue Firefighter', NULL,
            FALSE, FALSE, TRUE, 'overdue_firefighter',
            rec.user_id, rec.user_id, NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM scoring_rule_sets
            WHERE user_id = rec.user_id AND system_key = 'overdue_firefighter'
        )
        RETURNING id INTO new_id;

        IF new_id IS NOT NULL THEN
            INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight) VALUES
                (new_id, 'lifecycle_rank', 500),
                (new_id, 'days_until_due', -18),
                (new_id, 'overdue_days',     8),
                (new_id, 'no_open_action', 100);
            new_id := NULL;
        END IF;

        -- data_quality_first
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description,
            is_default, is_archived, is_system, system_key,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), rec.user_id, 'Data Quality First', NULL,
            FALSE, FALSE, TRUE, 'data_quality_first',
            rec.user_id, rec.user_id, NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM scoring_rule_sets
            WHERE user_id = rec.user_id AND system_key = 'data_quality_first'
        )
        RETURNING id INTO new_id;

        IF new_id IS NOT NULL THEN
            INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight) VALUES
                (new_id, 'lifecycle_rank',  500),
                (new_id, 'days_until_due',   -4),
                (new_id, 'geocode_failed',  900),
                (new_id, 'no_open_action',  150);
            new_id := NULL;
        END IF;

    END LOOP;
END;
$$;
