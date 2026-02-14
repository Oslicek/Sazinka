-- Migration 017: Add locale column to users table
-- Stores the user's preferred BCP-47 locale code (e.g. 'en', 'cs', 'en-GB').
-- Default is 'en' (English) per i18n architecture decision (PRJ_I18N.MD).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS locale VARCHAR(10) NOT NULL DEFAULT 'en';

-- Index not needed: locale is read per-user, never queried across users.
