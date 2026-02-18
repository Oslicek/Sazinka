-- Migration 0002: add country_code to contacts
ALTER TABLE contacts ADD COLUMN country_code TEXT;
