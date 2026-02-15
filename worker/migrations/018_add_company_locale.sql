-- Migration 018: Add company_locale column to users table
-- Stores the company-level locale for emails and external communication.
-- Separate from the user's UI locale (locale column).
-- Default is 'cs' (Czech) since the primary customer base is Czech.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS company_locale VARCHAR(10) NOT NULL DEFAULT 'cs';
