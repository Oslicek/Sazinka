-- Phase 5 / P5-03: Drop deprecated snooze and follow-up columns
-- These columns are superseded by planned_actions (Phase 1-4).
-- GUARD: Only run after verifying no application code references these columns.
--
-- revisions.snooze_until / snooze_reason  → planned_actions.snooze_until / snooze_reason
-- communications.follow_up_date / follow_up_completed → planned_actions (auto-created in Phase 5)

ALTER TABLE revisions
    DROP COLUMN IF EXISTS snooze_until,
    DROP COLUMN IF EXISTS snooze_reason;

ALTER TABLE communications
    DROP COLUMN IF EXISTS follow_up_date,
    DROP COLUMN IF EXISTS follow_up_completed;
