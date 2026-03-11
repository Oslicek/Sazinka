-- Phase 6 / P6-02: Backfill tasks from revisions
-- Creates a 'revision' task_type per user, then migrates each revision to a task.
-- Also creates action_targets for the migrated tasks and links planned_actions.

-- 1. Create a system 'revision' task type for each user that has revisions
INSERT INTO task_types (id, user_id, name, label_key, is_system, is_active, created_at)
SELECT
    uuid_generate_v4(),
    u.id,
    'Revision',
    'task_type.revision',
    TRUE,
    TRUE,
    NOW()
FROM users u
WHERE EXISTS (SELECT 1 FROM revisions r WHERE r.user_id = u.id)
  AND NOT EXISTS (
      SELECT 1 FROM task_types tt
      WHERE tt.user_id = u.id AND LOWER(tt.name) = 'revision' AND tt.is_system = TRUE
  );

-- 2. Migrate revisions to tasks
INSERT INTO tasks (
    id, user_id, task_type_id, customer_id, visit_id, device_id,
    status, payload, due_date, completed_at, created_at, updated_at
)
SELECT
    r.id,  -- reuse revision id for traceability
    r.user_id,
    tt.id,
    r.customer_id,
    NULL,  -- visits are separate entities
    r.device_id,
    CASE r.status
        WHEN 'upcoming'  THEN 'pending'
        WHEN 'scheduled' THEN 'pending'
        WHEN 'confirmed' THEN 'pending'
        WHEN 'completed' THEN 'completed'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
    END,
    jsonb_build_object(
        'revision_status', r.status,
        'result', r.result,
        'findings', r.findings,
        'scheduled_date', r.scheduled_date,
        'duration_minutes', r.duration_minutes
    ),
    r.due_date,
    r.completed_at,
    r.created_at,
    r.updated_at
FROM revisions r
INNER JOIN task_types tt ON tt.user_id = r.user_id AND LOWER(tt.name) = 'revision' AND tt.is_system = TRUE
WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = r.id);

-- 3. Create action_targets for migrated tasks
INSERT INTO action_targets (id, user_id, target_kind, task_id, created_at)
SELECT
    uuid_generate_v4(),
    t.user_id,
    'task'::action_target_kind,
    t.id,
    NOW()
FROM tasks t
WHERE NOT EXISTS (
    SELECT 1 FROM action_targets at WHERE at.task_id = t.id
);

-- 4. Link planned_actions that reference revision_id to the new action_target
UPDATE planned_actions pa
SET action_target_id = at.id,
    updated_at = NOW()
FROM action_targets at
INNER JOIN tasks t ON t.id = at.task_id
WHERE pa.revision_id = t.id
  AND pa.action_target_id IS NULL;
