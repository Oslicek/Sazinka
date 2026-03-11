-- Phase 1 / P1-02: Create enums for planned_actions and action_targets
CREATE TYPE action_status AS ENUM (
    'open',        -- pending, not yet performed
    'completed',   -- done
    'cancelled',   -- no longer needed
    'snoozed'      -- deferred to a later date
);

CREATE TYPE action_target_kind AS ENUM (
    'task',
    'visit',
    'project',
    'other'
);
