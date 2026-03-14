-- Migration 038: Add is_system column to scoring_rule_sets and seed default profiles
--
-- Part of Phase 4B. Changes:
--   1. Adds is_system BOOLEAN to scoring_rule_sets (immutable flag, set only at seed time).
--   2. Backfills a "Standard" system profile for every admin/customer user that has no
--      scoring rule sets yet (existing companies created before Phase 4B).
--
-- The DEFAULT_FACTORS (lifecycle_rank=-1000, days_until_due=-5, customer_age_days=0.01)
-- reproduce the legacy hardcoded lifecycle-rank → due-date → age sort order.

-- 1. Add the is_system column
ALTER TABLE scoring_rule_sets
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- 1b. Widen the weight constraint to accommodate sorting factors like lifecycle_rank
--     (factory weight -1000). Original range was -100..+100 which is too narrow.
ALTER TABLE scoring_rule_factors
    DROP CONSTRAINT IF EXISTS scoring_rule_factors__weight_check,
    ADD CONSTRAINT scoring_rule_factors__weight_check CHECK (weight >= -10000 AND weight <= 10000);

-- 2. Backfill: insert a Standard system profile for every qualifying user
--    (role IN ('admin', 'customer') AND no existing scoring_rule_sets)
WITH new_sets AS (
    INSERT INTO scoring_rule_sets (
        id, user_id, name, description,
        is_default, is_archived, is_system,
        created_by_user_id, updated_by_user_id,
        created_at, updated_at
    )
    SELECT
        uuid_generate_v4(),
        u.id,
        'Standard',
        NULL,
        TRUE,   -- is_default
        FALSE,  -- is_archived
        TRUE,   -- is_system
        u.id,
        u.id,
        NOW(),
        NOW()
    FROM users u
    WHERE u.role IN ('admin', 'customer')
      AND NOT EXISTS (
          SELECT 1 FROM scoring_rule_sets s WHERE s.user_id = u.id
      )
    RETURNING id
)
-- 3. Insert the 3 factory factors for each newly created rule set
INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight)
SELECT ns.id, f.key, f.weight
FROM new_sets ns
CROSS JOIN (VALUES
    ('lifecycle_rank',   -1000.0),
    ('days_until_due',      -5.0),
    ('customer_age_days',    0.01)
) AS f(key, weight);
