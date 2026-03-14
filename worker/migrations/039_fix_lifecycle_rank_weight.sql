-- Migration 039: fix lifecycle_rank weight in all system scoring profiles
--
-- The lifecycle_rank scoring formula was changed from (rank × weight)
-- to an inverted formula: (3 − rank) × weight.
-- To preserve the same ordering (untouched first, needs_action last)
-- the weight must be positive. Update existing system profiles from -1000 → +1000.
--
-- Also widen the weight check constraint to allow values up to 10000
-- (in case migration 038 partially succeeded with only -10000..10000,
--  which already covers this, but we make it explicit).

UPDATE scoring_rule_factors srf
SET weight = 1000.0
FROM scoring_rule_sets srs
WHERE srf.rule_set_id = srs.id
  AND srs.is_system = TRUE
  AND srf.factor_key = 'lifecycle_rank'
  AND srf.weight = -1000.0;
