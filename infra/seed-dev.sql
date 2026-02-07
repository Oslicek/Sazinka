-- Development seed data for Sazinka
-- Run after migrations: docker exec -i sazinka-postgres psql -U sazinka -d sazinka < infra/seed-dev.sql

-- Test admin user for development
-- Password: password123 (dev only -- never use in production!)
-- Note: The password_hash will be set by the worker on first login attempt with
-- the legacy TEMP_USER_ID fallback. For fresh DBs, use the register endpoint.
INSERT INTO users (
    id, 
    email, 
    password_hash, 
    name, 
    phone, 
    business_name, 
    street, 
    city, 
    postal_code,
    country,
    role
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'test@example.com',
    'not_a_real_hash',
    'Testovací uživatel',
    '+420 123 456 789',
    'Revize s.r.o.',
    'Revizní 123',
    'Praha',
    '11000',
    'CZ',
    'admin'
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    business_name = EXCLUDED.business_name,
    role = EXCLUDED.role;

-- Verify
SELECT id, email, name, business_name, role FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
