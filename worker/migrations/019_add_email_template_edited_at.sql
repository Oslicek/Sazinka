-- Migration 019: Add edited_at timestamps for email templates
-- Tracks when each template pair was last manually edited by the user.
-- NULL means the template uses the default based on company_locale.
-- Non-NULL means the template was manually edited and is locked (locale changes won't overwrite it).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_confirmation_edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_reminder_edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_third_edited_at TIMESTAMPTZ;
