-- Initial database setup for Sazinka
-- This file runs automatically when the PostgreSQL container starts

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Note: Actual schema will be managed by SQLx migrations
-- This file is for extensions and initial setup only

-- Create a health check function
CREATE OR REPLACE FUNCTION health_check()
RETURNS TEXT AS $$
BEGIN
  RETURN 'OK';
END;
$$ LANGUAGE plpgsql;

-- Dev test user (created after migrations run, see seed script)
-- ID: 00000000-0000-0000-0000-000000000001
