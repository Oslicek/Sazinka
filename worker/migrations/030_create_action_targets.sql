-- Phase 1 / P1-03: Create action_targets table (polymorphic target for planned_actions)
CREATE TABLE action_targets (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_kind action_target_kind NOT NULL,

    -- Exactly one of these must be set; task_id FK added in Phase 6 (tasks table).
    task_id     UUID,
    visit_id    UUID        REFERENCES visits(id) ON DELETE SET NULL,
    project_id  UUID,
    other_ref   TEXT,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Enforce that target_kind matches exactly the one non-NULL target reference.
    CONSTRAINT chk_action_target_kind CHECK (
        (target_kind = 'task'    AND task_id    IS NOT NULL AND visit_id   IS NULL AND project_id IS NULL AND other_ref IS NULL) OR
        (target_kind = 'visit'   AND task_id    IS NULL     AND visit_id   IS NOT NULL AND project_id IS NULL AND other_ref IS NULL) OR
        (target_kind = 'project' AND task_id    IS NULL     AND visit_id   IS NULL AND project_id IS NOT NULL AND other_ref IS NULL) OR
        (target_kind = 'other'   AND task_id    IS NULL     AND visit_id   IS NULL AND project_id IS NULL AND other_ref IS NOT NULL)
    )
);

CREATE INDEX idx_action_targets_user_kind ON action_targets(user_id, target_kind);
