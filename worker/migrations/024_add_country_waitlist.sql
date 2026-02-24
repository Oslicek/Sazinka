-- Migration 024: Country waitlist + coming_soon flag
--
-- Part of Phase 10 (Onboarding Wizard). Adds:
--   - country_waitlist table for "Notify me" signups
--   - coming_soon flag on countries table for the landing page

CREATE TABLE country_waitlist (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       VARCHAR(255) NOT NULL,
    country     CHAR(2) NOT NULL,
    locale      VARCHAR(10) NOT NULL DEFAULT 'en',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(email, country)
);

CREATE INDEX idx_waitlist_country ON country_waitlist(country);

ALTER TABLE countries
    ADD COLUMN coming_soon BOOLEAN NOT NULL DEFAULT false;

UPDATE countries SET coming_soon = true WHERE code = 'SK';
