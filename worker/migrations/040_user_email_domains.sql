-- Migration 040: User email domain identities for SES custom-domain sending.
--
-- Stores one (or future: multiple) customer-owned domain identities per user.
-- The partial unique index enforces at most one *active* domain per user in MVP.
-- Forward-compatible: additional rows with is_active=false are allowed for history.

CREATE TABLE user_email_domains (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain              TEXT        NOT NULL,
    from_email          TEXT        NOT NULL,
    from_name           TEXT,
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    verification_status TEXT        NOT NULL DEFAULT 'pending',
    dkim_tokens         TEXT[]      NOT NULL DEFAULT '{}',
    dkim_records        JSONB       NOT NULL DEFAULT '[]'::jsonb,
    verified_at         TIMESTAMPTZ,
    last_checked_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_email_domains_user
    ON user_email_domains(user_id);

-- Enforce at most one active domain per user (MVP constraint).
CREATE UNIQUE INDEX idx_user_email_domains_user_active
    ON user_email_domains(user_id) WHERE is_active = true;
