-- Migration 016: Persist all email templates and reminder send time
-- Adds dedicated columns for:
-- 1) confirmation template (sent immediately after appointment agreement)
-- 2) reminder template (sent day before, with configurable send time)
-- 3) third template (reserved for future workflow)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_confirmation_subject_template TEXT,
    ADD COLUMN IF NOT EXISTS email_confirmation_body_template TEXT,
    ADD COLUMN IF NOT EXISTS email_reminder_subject_template TEXT,
    ADD COLUMN IF NOT EXISTS email_reminder_body_template TEXT,
    ADD COLUMN IF NOT EXISTS email_reminder_send_time TIME DEFAULT '09:00',
    ADD COLUMN IF NOT EXISTS email_third_subject_template TEXT,
    ADD COLUMN IF NOT EXISTS email_third_body_template TEXT;

-- Backfill reminder template from legacy columns where new values are missing.
UPDATE users
SET
    email_reminder_subject_template = COALESCE(email_reminder_subject_template, email_subject_template),
    email_reminder_body_template = COALESCE(email_reminder_body_template, email_body_template);

-- Backfill confirmation template from reminder values if missing.
UPDATE users
SET
    email_confirmation_subject_template = COALESCE(email_confirmation_subject_template, email_reminder_subject_template),
    email_confirmation_body_template = COALESCE(email_confirmation_body_template, email_reminder_body_template);
