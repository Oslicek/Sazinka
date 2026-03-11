-- Phase 6 / P6-06: Drop legacy planned_actions columns
-- These columns are superseded by action_target_id → action_targets → tasks.
-- GUARD: Only run after migration 036 has been applied and all planned_actions
-- have been linked to action_targets via action_target_id.
--
-- planned_actions.revision_id → action_targets.task_id (via migration 036)
-- planned_actions.visit_id    → action_targets.visit_id
-- planned_actions.device_id   → accessible via tasks.device_id

ALTER TABLE planned_actions
    DROP COLUMN IF EXISTS revision_id,
    DROP COLUMN IF EXISTS visit_id,
    DROP COLUMN IF EXISTS device_id;
