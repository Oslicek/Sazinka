-- Migration 025: Onboarding progress tracking
--
-- Part of Phase 10 (Onboarding Wizard). Adds:
--   - onboarding_completed_at: NULL until wizard is finished
--   - onboarding_step: tracks resume point
--     (0 = pre-verification, 2 = at About you, 3 = at Devices,
--      4 = at Depot, 5 = at All set, 6 = completed)

ALTER TABLE users
    ADD COLUMN onboarding_completed_at TIMESTAMPTZ,
    ADD COLUMN onboarding_step         SMALLINT NOT NULL DEFAULT 0;

-- Backfill: existing verified users are considered onboarded
UPDATE users
SET onboarding_completed_at = created_at,
    onboarding_step = 6
WHERE email_verified = true;
