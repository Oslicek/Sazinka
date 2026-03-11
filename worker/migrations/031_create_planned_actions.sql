-- Phase 1 / P1-04: Create planned_actions table
CREATE TABLE planned_actions (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id      UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status           action_status NOT NULL DEFAULT 'open',

    -- When should the dispatcher deal with this?
    due_date         DATE        NOT NULL,
    snooze_until     DATE,
    snooze_reason    VARCHAR(255),

    -- Polymorphic target (nullable during Phase 1-4 transition)
    action_target_id UUID        REFERENCES action_targets(id) ON DELETE SET NULL,

    -- Legacy transitional links (Phase 1-4; replaced by action_target_id in Phase 6)
    revision_id      UUID        REFERENCES revisions(id) ON DELETE SET NULL,
    visit_id         UUID        REFERENCES visits(id) ON DELETE SET NULL,
    device_id        UUID        REFERENCES devices(id) ON DELETE SET NULL,

    -- Context
    note             TEXT,

    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for the inbox queue: only open/snoozed actions that are due
CREATE INDEX idx_planned_actions_queue
    ON planned_actions(user_id, status, due_date)
    WHERE status IN ('open', 'snoozed');

CREATE INDEX idx_planned_actions_customer
    ON planned_actions(customer_id);
