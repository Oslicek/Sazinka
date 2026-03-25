-- Migration 041: normalize zeroed system "Standard" scoring profiles
--
-- Some system profiles may have ended up with missing/zero sorting weights,
-- which effectively disables urgency ordering. Restore the recommended
-- baseline only for system profiles where all 3 sorting factors are zero/missing:
--   lifecycle_rank = +1000
--   days_until_due = -5
--   customer_age_days = +0.01
--
-- NOTE: This intentionally does NOT overwrite customized system profiles.

WITH zeroed_system_profiles AS (
    SELECT srs.id
    FROM scoring_rule_sets srs
    LEFT JOIN scoring_rule_factors lifecycle
      ON lifecycle.rule_set_id = srs.id
     AND lifecycle.factor_key = 'lifecycle_rank'
    LEFT JOIN scoring_rule_factors due
      ON due.rule_set_id = srs.id
     AND due.factor_key = 'days_until_due'
    LEFT JOIN scoring_rule_factors age
      ON age.rule_set_id = srs.id
     AND age.factor_key = 'customer_age_days'
    WHERE srs.is_system = TRUE
      AND COALESCE(lifecycle.weight, 0) = 0
      AND COALESCE(due.weight, 0) = 0
      AND COALESCE(age.weight, 0) = 0
)
INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight)
SELECT zsp.id, defaults.factor_key, defaults.weight
FROM zeroed_system_profiles zsp
CROSS JOIN (
    VALUES
      ('lifecycle_rank', 1000.0::NUMERIC),
      ('days_until_due',   -5.0::NUMERIC),
      ('customer_age_days', 0.01::NUMERIC)
) AS defaults(factor_key, weight)
ON CONFLICT (rule_set_id, factor_key)
DO UPDATE
SET weight = EXCLUDED.weight;
