-- Phase 6 / P6-01: Create task_types and tasks tables
-- Tasks are the generic unit of work that replaces the revision-centric model.
-- task_types are user-definable categories (revision, installation, callback, etc.)

CREATE TABLE task_types (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(120) NOT NULL,
    label_key       VARCHAR(120),
    is_system       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    payload_schema  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_task_types_user_name ON task_types(user_id, LOWER(name));
CREATE INDEX idx_task_types_user_active ON task_types(user_id) WHERE is_active = TRUE;

CREATE TABLE tasks (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_type_id    UUID        NOT NULL REFERENCES task_types(id) ON DELETE RESTRICT,
    customer_id     UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    visit_id        UUID        REFERENCES visits(id) ON DELETE SET NULL,
    device_id       UUID        REFERENCES devices(id) ON DELETE SET NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'pending',
    payload         JSONB,
    due_date        DATE,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_customer ON tasks(customer_id);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);

-- Add FK from action_targets.task_id to tasks.id (was deferred in Phase 1)
ALTER TABLE action_targets
    ADD CONSTRAINT fk_action_targets_task_id
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
