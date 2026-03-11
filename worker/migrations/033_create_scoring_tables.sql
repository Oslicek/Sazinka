-- Phase 4 / P4-01: Create scoring rule sets, factors, and dispatcher inbox state tables

-- Company scoring rule sets (named profiles)
CREATE TABLE scoring_rule_sets (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- company_id will reference companies(id) when that table is created.
    -- For now, scoped to user_id as a proxy for company.
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                VARCHAR(120) NOT NULL,
    description         TEXT,
    is_default          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_archived         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce unique (case-insensitive) names per user/company
CREATE UNIQUE INDEX uq_scoring_rule_sets_user_name_ci
    ON scoring_rule_sets(user_id, LOWER(name));

-- Weights/factors for a rule set
CREATE TABLE scoring_rule_factors (
    rule_set_id  UUID        NOT NULL REFERENCES scoring_rule_sets(id) ON DELETE CASCADE,
    factor_key   VARCHAR(80) NOT NULL,
    weight       NUMERIC     NOT NULL CHECK (weight >= -100 AND weight <= 100),
    PRIMARY KEY (rule_set_id, factor_key)
);

-- Per-dispatcher persisted inbox state
CREATE TABLE dispatcher_inbox_state (
    user_id                 UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_rule_set_id    UUID        REFERENCES scoring_rule_sets(id) ON DELETE SET NULL,
    sort_mode               VARCHAR(20) NOT NULL DEFAULT 'rank_first',
    active_filters_json     JSONB       NOT NULL DEFAULT '{}',
    page_number             INTEGER     NOT NULL DEFAULT 1,
    page_size               INTEGER     NOT NULL DEFAULT 25,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
