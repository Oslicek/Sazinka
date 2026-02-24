-- Migration 023: Add email verification columns + ToS consent tracking
--
-- Part of Phase 10 (Onboarding Wizard). Adds:
--   - email_verified: gates access to the app
--   - verification_token_hash: SHA-256 hash of the emailed token (not plaintext)
--   - verification_expires: 24h TTL on the token
--   - tos_accepted_at: GDPR compliance — when user consented to ToS + Privacy Policy

ALTER TABLE users
    ADD COLUMN email_verified         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN verification_token_hash VARCHAR(128),
    ADD COLUMN verification_expires   TIMESTAMPTZ,
    ADD COLUMN tos_accepted_at        TIMESTAMPTZ;

-- Backfill: all existing users with a real password are considered verified
-- (they registered before email verification was required)
UPDATE users SET email_verified = true, tos_accepted_at = created_at
WHERE password_hash != 'not-set';

CREATE INDEX idx_users_verification_token_hash
    ON users(verification_token_hash)
    WHERE verification_token_hash IS NOT NULL;
