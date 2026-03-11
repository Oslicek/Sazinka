-- Phase 1 / P1-01: Add customer lifecycle fields for is_abandoned and GDPR soft-delete
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS is_abandoned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

-- Partial index: fast lookup of abandoned customers per user
CREATE INDEX IF NOT EXISTS idx_customers_abandoned
    ON customers(user_id)
    WHERE is_abandoned = TRUE;
